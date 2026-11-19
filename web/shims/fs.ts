/**
 * Minimal `fs` / `fs-extra` replacement for the browser.
 *
 * Files are kept in memory (so the sync API works) and written through to IndexedDB so they
 * survive a reload. `initWebFs()` must be awaited once before the app starts.
 *
 * Only the functions the renderer actually uses are implemented (attachments, avatars, OS helpers).
 */
/* eslint-disable no-restricted-syntax */

const DB_NAME = 'session-web-fs';
const STORE = 'files';

const files = new Map<string, Uint8Array>();
let idb: IDBDatabase | undefined;

function normalize(p: string) {
  return `/${String(p)
    .split('/')
    .filter(s => s && s !== '.')
    .join('/')}`;
}

function openIdb(): Promise<IDBDatabase | undefined> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch (e) {
      resolve(undefined);
    }
  });
}

export async function initWebFs() {
  idb = await openIdb();
  if (!idb) {
    return;
  }
  await new Promise<void>(resolve => {
    const tx = idb!.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        files.set(String(cursor.key), new Uint8Array(cursor.value));
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => resolve();
  });
}

function persist(p: string, data?: Uint8Array) {
  if (!idb) {
    return;
  }
  try {
    const tx = idb.transaction(STORE, 'readwrite');
    if (data) {
      tx.objectStore(STORE).put(data, p);
    } else {
      tx.objectStore(STORE).delete(p);
    }
  } catch (e) {
    console.warn('web fs: persist failed', e);
  }
}

function enoent(p: string) {
  const err: any = new Error(`ENOENT: no such file or directory, '${p}'`);
  err.code = 'ENOENT';
  return err;
}

function toBytes(data: any): Uint8Array {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data.slice(0));
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  }
  return new TextEncoder().encode(String(data));
}

function decode(bytes: Uint8Array, options?: any) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  if (encoding) {
    return new TextDecoder().decode(bytes);
  }
  const { Buffer } = require('buffer');
  return Buffer.from(bytes);
}

function isDir(p: string) {
  const prefix = p === '/' ? '/' : `${p}/`;
  for (const k of files.keys()) {
    if (k.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

// ---- sync API ----
export function existsSync(p: string) {
  const n = normalize(p);
  return files.has(n) || isDir(n);
}
export function readFileSync(p: string, options?: any) {
  const n = normalize(p);
  const f = files.get(n);
  if (!f) {
    throw enoent(n);
  }
  return decode(f, options);
}
export function writeFileSync(p: string, data: any) {
  const n = normalize(p);
  const bytes = toBytes(data);
  files.set(n, bytes);
  persist(n, bytes);
}
export function unlinkSync(p: string) {
  const n = normalize(p);
  files.delete(n);
  persist(n);
}
export function renameSync(from: string, to: string) {
  const f = normalize(from);
  const t = normalize(to);
  const data = files.get(f);
  if (!data) {
    throw enoent(f);
  }
  files.delete(f);
  persist(f);
  files.set(t, data);
  persist(t, data);
}
export function mkdirSync() {
  /* directories are implicit */
}
export function readdirSync(p: string) {
  const n = normalize(p);
  const prefix = n === '/' ? '/' : `${n}/`;
  const names = new Set<string>();
  for (const k of files.keys()) {
    if (k.startsWith(prefix)) {
      names.add(k.slice(prefix.length).split('/')[0]);
    }
  }
  return [...names];
}
export function statSync(p: string) {
  const n = normalize(p);
  const f = files.get(n);
  if (!f && !isDir(n)) {
    throw enoent(n);
  }
  const now = Date.now();
  return {
    size: f?.byteLength ?? 0,
    isFile: () => !!f,
    isDirectory: () => !f,
    mtimeMs: now,
    birthtimeMs: now,
    ctimeMs: now,
    mtime: new Date(now),
    birthtime: new Date(now),
  };
}
export function removeSync(p: string) {
  const n = normalize(p);
  const prefix = `${n}/`;
  for (const k of [...files.keys()]) {
    if (k === n || k.startsWith(prefix)) {
      files.delete(k);
      persist(k);
    }
  }
}
export const pathExistsSync = existsSync;
export const ensureDirSync = mkdirSync;
export const rmSync = removeSync;

// ---- async API (fs-extra style, promise based) ----
export const readFile = async (p: string, options?: any) => readFileSync(p, options);
export const writeFile = async (p: string, data: any) => writeFileSync(p, data);
export const pathExists = async (p: string) => existsSync(p);
export const remove = async (p: string) => removeSync(p);
export const unlink = async (p: string) => unlinkSync(p);
export const rename = async (a: string, b: string) => renameSync(a, b);
export const stat = async (p: string) => statSync(p);
export const readdir = async (p: string) => readdirSync(p);
export const ensureDir = async () => undefined;
export const mkdir = async () => undefined;
export const ensureFile = async (p: string) => {
  if (!existsSync(p)) {
    writeFileSync(p, new Uint8Array());
  }
};
export const access = async (p: string) => {
  if (!existsSync(p)) {
    throw enoent(p);
  }
};
export const rm = async (p: string) => removeSync(p);

export const promises = {
  readFile,
  writeFile,
  unlink,
  rename,
  stat,
  readdir,
  mkdir,
  access,
  rm,
};

export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };

const fsDefault = {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  renameSync,
  mkdirSync,
  readdirSync,
  statSync,
  removeSync,
  pathExistsSync,
  ensureDirSync,
  rmSync,
  readFile,
  writeFile,
  pathExists,
  remove,
  unlink,
  rename,
  stat,
  readdir,
  ensureDir,
  mkdir,
  ensureFile,
  access,
  rm,
  promises,
  constants,
};

export default fsDefault;
