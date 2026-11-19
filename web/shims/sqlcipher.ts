/**
 * Browser replacement for `@signalapp/sqlcipher`.
 *
 * Implements the (synchronous) subset of the sqlcipher `Database` / `Statement` API that
 * `ts/node/*` relies on, on top of the official SQLite WASM build.
 *
 * It must only be used from inside the "main" web worker (see web/main/main.worker.ts), after
 * `initSqliteWasm()` resolved: the OPFS "SAH pool" VFS gives us synchronous, persistent storage
 * without needing COOP/COEP headers (which static hosts like GitHub Pages can't set).
 *
 * Note: SQLCipher encryption pragmas (key/rekey/cipher_*) are accepted but ignored. The database
 * is stored in the browser's origin-private file system, which is not encrypted at rest.
 */
/* eslint-disable max-classes-per-file */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

type AnySqlite = any;

let sqlite3: AnySqlite | undefined;
let sahPool: AnySqlite | undefined;

export async function initSqliteWasm() {
  if (sqlite3) {
    return;
  }
  sqlite3 = await (sqlite3InitModule as any)({
    print: (...args: Array<unknown>) => console.log('[sqlite]', ...args),
    printErr: (...args: Array<unknown>) => console.warn('[sqlite]', ...args),
  });
  try {
    sahPool = await sqlite3.installOpfsSAHPoolVfs({ name: 'session-web-sahpool' });
    console.info('[sqlite] using persistent OPFS SAH pool storage');
  } catch (e) {
    console.warn('[sqlite] OPFS not available, falling back to a non-persistent in-memory db', e);
    sahPool = undefined;
  }
}

export function wipeSqliteStorage() {
  sahPool?.wipeFiles?.();
}

export type SqliteValue = string | Uint8Array | number | null | bigint;
export type StatementOptions = Readonly<{ persistent?: boolean; pluck?: true; bigint?: true }>;
export type StatementParameters =
  | ReadonlyArray<SqliteValue>
  | Readonly<Record<string, SqliteValue>>;
export type DatabaseOptions = Readonly<{ cacheStatements?: boolean }>;
export type RunResult = { changes: number; lastInsertRowid: number };

const IGNORED_PRAGMAS = /^\s*(key|rekey|cipher_[a-z_]+|journal_mode|synchronous)\b/i;

function normalizeParams(params?: StatementParameters): any {
  if (params === undefined || params === null) {
    return undefined;
  }
  if (Array.isArray(params)) {
    return params.map(p => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
  }
  const out: Record<string, unknown> = {};
  Object.entries(params as Record<string, unknown>).forEach(([k, v]) => {
    const value = typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v;
    if (/^[$:@]/.test(k)) {
      out[k] = value;
    } else {
      // sqlcipher accepts the bare name for `$name`, `:name` and `@name` placeholders
      out[`$${k}`] = value;
      out[`:${k}`] = value;
      out[`@${k}`] = value;
    }
  });
  return out;
}

class Statement {
  readonly #db: Database;
  readonly #sql: string;
  readonly #options: StatementOptions;

  constructor(db: Database, sql: string, options: StatementOptions = {}) {
    this.#db = db;
    this.#sql = sql;
    this.#options = options;
  }

  #withStmt<T>(params: StatementParameters | undefined, fn: (stmt: AnySqlite) => T): T {
    const stmt = this.#db.raw.prepare(this.#sql);
    try {
      const bind = normalizeParams(params);
      if (bind !== undefined && stmt.parameterCount > 0) {
        if (Array.isArray(bind)) {
          stmt.bind(bind);
        } else {
          // only bind the names which are actually used by the statement
          const used: Record<string, unknown> = {};
          for (let i = 1; i <= stmt.parameterCount; i++) {
            const name = sqlite3.capi.sqlite3_bind_parameter_name(stmt.pointer, i);
            if (name && name in bind) {
              used[name] = bind[name];
            }
          }
          stmt.bind(used);
        }
      }
      return fn(stmt);
    } finally {
      stmt.finalize();
    }
  }

  #readRow(stmt: AnySqlite) {
    if (this.#options.pluck) {
      return stmt.get(0);
    }
    return stmt.get({});
  }

  run(params?: StatementParameters): RunResult {
    return this.#withStmt(params, stmt => {
      while (stmt.step()) {
        /* drain */
      }
      return {
        changes: this.#db.raw.changes(),
        lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(this.#db.raw.pointer)),
      };
    });
  }

  get<Row = any>(params?: StatementParameters): Row | undefined {
    return this.#withStmt(params, stmt => (stmt.step() ? this.#readRow(stmt) : undefined));
  }

  all<Row = any>(params?: StatementParameters): Array<Row> {
    return this.#withStmt(params, stmt => {
      const rows: Array<Row> = [];
      while (stmt.step()) {
        rows.push(this.#readRow(stmt));
      }
      return rows;
    });
  }

  scanStats() {
    return [];
  }

  close() {
    /* statements are finalized after each call */
  }
}

export class Database {
  readonly raw: AnySqlite;
  #txDepth = 0;

  constructor(path?: string, _options?: DatabaseOptions) {
    if (!sqlite3) {
      throw new Error('sqlcipher web shim: initSqliteWasm() was not called');
    }
    const inMemory = !path || path === ':memory:';
    if (!inMemory && sahPool) {
      this.raw = new sahPool.OpfsSAHPoolDb(path.startsWith('/') ? path : `/${path}`);
    } else {
      this.raw = new sqlite3.oo1.DB(':memory:', 'c');
    }
  }

  initTokenizer() {
    /* the signal FTS5 tokenizer is not available, `porter unicode61` is used instead */
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  createFunction(name: string, fn: (...args: ReadonlyArray<unknown>) => unknown) {
    this.raw.createFunction(name, (_ctx: unknown, ...args: Array<unknown>) => fn(...args), {
      arity: -1,
    });
  }

  prepare(query: string, options?: StatementOptions) {
    return new Statement(this, query, options);
  }

  close() {
    this.raw.close();
  }

  pragma(source: string, { simple }: { simple?: true } = {}): any {
    if (IGNORED_PRAGMAS.test(source)) {
      if (/^\s*cipher_integrity_check/i.test(source)) {
        return simple ? undefined : [];
      }
      if (/^\s*cipher_version/i.test(source)) {
        return simple ? 'web' : [{ cipher_version: 'web' }];
      }
      return simple ? undefined : [];
    }
    const rows = this.raw.exec(`PRAGMA ${source}`, { rowMode: 'object', returnValue: 'resultRows' });
    if (simple) {
      const first = rows[0];
      return first ? Object.values(first)[0] : undefined;
    }
    return rows;
  }

  transaction<Result>(fn: (...params: Array<any>) => Result): (...params: Array<any>) => Result {
    return (...params: Array<any>) => {
      const savepoint = `sp_${this.#txDepth}`;
      const outer = this.#txDepth === 0;
      this.raw.exec(outer ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      this.#txDepth++;
      try {
        const result = fn(...params);
        this.#txDepth--;
        this.raw.exec(outer ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (e) {
        this.#txDepth--;
        this.raw.exec(outer ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw e;
      }
    };
  }

  signalTokenize(value: string): Array<string> {
    return value.split(/\s+/).filter(Boolean);
  }
}

export function setLogger() {
  /* noop */
}

export default Database;
