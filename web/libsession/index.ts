/**
 * `libsession_util_nodejs` for the browser, implemented on top of the official libsession WASM
 * build (@session-foundation/libsession-wasm).
 *
 * The upstream libsession worker (ts/webworker/workers/node/libsession/libsession.worker.ts) is
 * bundled unchanged: webpack swaps its `libsession_util_nodejs` import for this file. Each class
 * below mirrors the API of the native addon (Uint8Array in/out, plain JS objects) and translates it
 * to the WASM API (hex strings, embind objects and vectors).
 *
 * Status:
 *  - UserConfig, Contacts, UserGroups, ConvoInfoVolatile: implemented
 *  - Blinding, Utilities: implemented
 *  - MultiEncrypt: multi(de|en)crypt, attachments, 1o1 / group / community message encryption
 *    (see messages.ts)
 *  - MetaGroup (closed groups): metagroup.ts. Pro: not available (see ProWrapperNode)
 */
/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */
import sodium from 'libsodium-wrappers-sumo';
import { makeMessageCrypto, multiEncrypt as multiEncryptJs } from './messages';
import { createMetaGroupWrapperClass } from './metagroup';

export { CONSTANTS } from './constants';

type Wasm = any;
let wasm: Wasm | undefined;

export const libsessionReady: Promise<void> = (async () => {
  if (typeof WorkerGlobalScope === 'undefined') {
    // only the libsession & sql workers need the WASM module, the page never calls it
    return;
  }
  // loaded lazily so that the page bundle doesn't carry the WASM glue code
  // @ts-ignore no types for the raw emscripten glue
  const { default: createLibsession } = await import('libsession-wasm-glue');
  // @ts-ignore resolved to a URL by webpack (asset/resource)
  const { default: wasmUrl } = await import('libsession-wasm-binary');
  await sodium.ready;
  wasm = await createLibsession({
    locateFile: () => wasmUrl,
    getRandomValue: () => crypto.getRandomValues(new Uint32Array(1))[0],
  });
})();

function w(): Wasm {
  if (!wasm) {
    throw new Error('libsession WASM is not loaded (yet)');
  }
  return wasm;
}

type MessageCrypto = ReturnType<typeof makeMessageCrypto>;
let messageCryptoInstance: MessageCrypto | undefined;
function messageCrypto() {
  messageCryptoInstance ??= makeMessageCrypto(w);
  return messageCryptoInstance;
}

class NotAvailableOnWebError extends Error {
  constructor(what: string) {
    super(`${what} is not available in the web version yet`);
  }
}

// ---------------------------------------------------------------------------------------------
// conversion helpers
// ---------------------------------------------------------------------------------------------
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function toHex(bytes: Uint8Array | null | undefined): string {
  if (!bytes) {
    return '';
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i]];
  }
  return out;
}

function fromHex(hex: string | null | undefined): Uint8Array {
  if (!hex) {
    return new Uint8Array();
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function fromHexOrNull(hex: string | null | undefined): Uint8Array | null {
  return hex ? fromHex(hex) : null;
}

function b64ToHex(b64: string | null | undefined): string {
  if (!b64) {
    return '';
  }
  return toHex(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
}

function hexToB64(hex: string | null | undefined): string | null {
  if (!hex) {
    return null;
  }
  return btoa(String.fromCharCode(...fromHex(hex)));
}

/** Read an embind vector into an array (and free it) */
function vecToArray<T = any>(vec: any, map: (v: any) => T = v => v): Array<T> {
  const out: Array<T> = [];
  try {
    const size = vec.size();
    for (let i = 0; i < size; i++) {
      out.push(map(vec.get(i)));
    }
  } finally {
    vec.delete?.();
  }
  return out;
}

function stringVector(items: Array<string>) {
  const vec = new (w().StringVector)();
  items.forEach(i => vec.push_back(i));
  return vec;
}

function enumValue(e: any): number {
  return typeof e === 'number' ? e : (e?.value ?? 0);
}

function enumByValue(enumObj: Record<string, any>, value: number) {
  return Object.values(enumObj).find((e: any) => e?.value === value);
}

function dumpToHex(dump: Uint8Array | null): string | undefined {
  return dump && dump.length ? toHex(dump) : undefined;
}

function picFromWasm(pic: { url: string; key: string } | undefined) {
  return { url: pic?.url || null, key: fromHexOrNull(pic?.key) };
}

function picToWasm(pic: { url: string | null; key: Uint8Array | null } | null | undefined) {
  return { url: pic?.url || '', key: toHex(pic?.key || null) };
}

const expirationModes = ['off', 'deleteAfterSend', 'deleteAfterRead'] as const;

function parseCommunityUrl(fullUrl: string) {
  const url = new URL(fullUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const room = parts[parts.length - 1] || '';
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    room,
    pubkeyHex: url.searchParams.get('public_key') || '',
  };
}

// ---------------------------------------------------------------------------------------------
// Base config wrapper
// ---------------------------------------------------------------------------------------------
abstract class BaseConfigWrapperWeb {
  protected readonly inner: any;

  protected constructor(ctorName: string, secretKey: Uint8Array, dump: Uint8Array | null) {
    this.inner = new (w()[ctorName])(toHex(secretKey), dumpToHex(dump));
  }

  public needsDump() {
    return this.inner.needsDump();
  }

  public needsPush() {
    return this.inner.needsPush();
  }

  public push() {
    const res = this.inner.pushHex();
    return {
      seqno: Number(res.seqno),
      data: vecToArray<Uint8Array>(res.dataHex, fromHex),
      hashes: vecToArray<string>(res.hashes),
      namespace: enumValue(res.storageNamespace),
    };
  }

  public dump() {
    return fromHex(this.inner.dumpHex());
  }

  public makeDump() {
    return fromHex(this.inner.makeDumpHex());
  }

  public confirmPushed({ seqno, hashes }: { seqno: number; hashes: Array<string> }) {
    const vec = stringVector(hashes);
    try {
      this.inner.confirmPushed(seqno, vec);
    } finally {
      vec.delete();
    }
  }

  public merge(toMerge: Array<{ hash: string; data: Uint8Array }>) {
    const vec = new (w().MergeStructVector)();
    toMerge.forEach(m => vec.push_back({ hash: m.hash, dataHex: toHex(m.data) }));
    try {
      return vecToArray<string>(this.inner.mergeHex(vec));
    } finally {
      vec.delete();
    }
  }

  public storageNamespace() {
    return enumValue(this.inner.storageNamespace());
  }

  public activeHashes() {
    return vecToArray<string>(this.inner.activeHashes());
  }
}

// ---------------------------------------------------------------------------------------------
// UserConfig
// ---------------------------------------------------------------------------------------------
export class UserConfigWrapperNode extends BaseConfigWrapperWeb {
  private profileUpdatedSeconds = 0;

  constructor(secretKey: Uint8Array, dump: Uint8Array | null) {
    super('UserProfileW', secretKey, dump);
  }

  public getPriority() {
    return this.inner.getNtsPriority();
  }

  public setPriority(priority: number) {
    this.inner.setNtsPriority(priority);
  }

  public getName() {
    return this.inner.getName() ?? null;
  }

  public setName(name: string) {
    this.inner.setName(name);
    this.profileUpdatedSeconds = Math.floor(Date.now() / 1000);
  }

  public setNameTruncated(name: string) {
    this.inner.setNameTruncated(name);
    this.profileUpdatedSeconds = Math.floor(Date.now() / 1000);
  }

  public getProfilePic() {
    return picFromWasm(this.inner.getProfilePic());
  }

  public setNewProfilePic(pic: { url: string | null; key: Uint8Array | null }) {
    this.inner.setProfilePic(picToWasm(pic));
    this.profileUpdatedSeconds = Math.floor(Date.now() / 1000);
  }

  public setReuploadProfilePic(pic: { url: string | null; key: Uint8Array | null }) {
    this.inner.setProfilePic(picToWasm(pic));
  }

  public getProfileUpdatedSeconds() {
    return this.profileUpdatedSeconds;
  }

  public getEnableBlindedMsgRequest() {
    return this.inner.getBlindedMsgRequests();
  }

  public setEnableBlindedMsgRequest(enabled: boolean) {
    this.inner.setBlindedMsgRequests(enabled);
  }

  public getNoteToSelfExpiry() {
    return this.inner.getNtsExpirySeconds();
  }

  public setNoteToSelfExpiry(seconds: number) {
    this.inner.setNtsExpirySeconds(seconds);
  }

  // --- Session Pro: the web version has no Pro support yet, report "no pro" ---
  public getProConfig() {
    return null;
  }

  public setProConfig() {
    throw new NotAvailableOnWebError('Session Pro');
  }

  public removeProConfig() {
    return false;
  }

  public getProProfileBitset() {
    return BigInt(0);
  }

  public setAnimatedAvatar() {
    /* pro only */
  }

  public setProBadge(enabled: boolean) {
    this.inner.setProBadge(enabled);
  }

  public getProAccessExpiry() {
    const s = this.inner.getProAccessExpirySeconds();
    return s ? s * 1000 : null;
  }

  public setProAccessExpiry(expiryTsMs: number | null) {
    this.inner.setProAccessExpirySeconds(expiryTsMs ? Math.floor(expiryTsMs / 1000) : 0);
  }

  public getProAutoRenewing() {
    return this.inner.getProAutoRenewing();
  }

  public setProAutoRenewing(v: boolean) {
    this.inner.setProAutoRenewing(v);
  }

  public getProGracePeriod() {
    return this.inner.getProGracePeriodSeconds() * 1000;
  }

  public setProGracePeriod(graceMs: number) {
    this.inner.setProGracePeriodSeconds(Math.floor(graceMs / 1000));
  }

  public getRefundRequested() {
    return null;
  }

  public setRefundRequested() {
    /* pro only */
  }

  public getProPrepaid() {
    return null;
  }

  public setProPrepaid() {
    /* pro only */
  }

  public getProRenewalTarget() {
    return null;
  }

  public generateProMasterKey({ ed25519SeedHex }: { ed25519SeedHex: string }) {
    return { proMasterKeyHex: w().ProBackendW.masterPrivkeyHexForSeed(ed25519SeedHex) };
  }

  public generateRotatingPrivKeyHex() {
    const kp = JSON.parse(
      w().SessionCryptoPrimitivesW.cryptoSignSeedKeypair(
        w().SessionCryptoPrimitivesW.randombytesBuf(32)
      )
    );
    return { rotatingPrivKeyHex: kp.privateKeyHex };
  }

  public deriveProRotatingKey({
    proMasterKeyHex,
    nowMs,
  }: {
    proMasterKeyHex: string;
    nowMs: number;
  }) {
    const rotatingSeedHex = w().ProBackendW.rotatingSeedHex(
      proMasterKeyHex,
      Math.floor(nowMs / 1000)
    );
    const kp = JSON.parse(w().SessionCryptoPrimitivesW.cryptoSignSeedKeypair(rotatingSeedHex));
    return { rotatingSeedHex, rotatingPrivKeyHex: kp.privateKeyHex };
  }
}

// ---------------------------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------------------------
function contactFromWasm(c: any) {
  const result = {
    id: c.sessionId,
    name: c.name || undefined,
    nickname: c.nickname || undefined,
    approved: c.approved,
    approvedMe: c.approvedMe,
    blocked: c.blocked,
    priority: c.priority,
    createdAtSeconds: c.createdAtSeconds,
    profileUpdatedSeconds: c.profileUpdatedAtSeconds,
    expirationMode: expirationModes[enumValue(c.expirationMode)] ?? 'off',
    expirationTimerSeconds: c.expireTimerSeconds,
    profilePicture: picFromWasm(c.profilePicture),
    proProfileBitset: BigInt(0),
  };
  c.delete?.();
  return result;
}

export class ContactsConfigWrapperNode extends BaseConfigWrapperWeb {
  constructor(secretKey: Uint8Array, dump: Uint8Array | null) {
    super('ContactsW', secretKey, dump);
  }

  public get(pubkeyHex: string) {
    const c = this.inner.getContact(pubkeyHex);
    return c ? contactFromWasm(c) : null;
  }

  public getAll() {
    return vecToArray(this.inner.allContacts(), contactFromWasm);
  }

  public set(info: any) {
    const c = this.inner.getOrConstructContact(info.id);
    try {
      if (info.name !== undefined) {
        c.name = info.name || '';
      }
      if (info.nickname !== undefined) {
        c.nickname = info.nickname || '';
      }
      if (info.approved !== undefined) {
        c.approved = !!info.approved;
      }
      if (info.approvedMe !== undefined) {
        c.approvedMe = !!info.approvedMe;
      }
      if (info.blocked !== undefined) {
        c.blocked = !!info.blocked;
      }
      if (info.priority !== undefined) {
        c.priority = info.priority;
      }
      if (info.createdAtSeconds !== undefined) {
        c.createdAtSeconds = info.createdAtSeconds;
      }
      if (info.profileUpdatedSeconds !== undefined) {
        c.profileUpdatedAtSeconds = info.profileUpdatedSeconds;
      }
      if (info.expirationMode !== undefined) {
        const idx = Math.max(0, expirationModes.indexOf(info.expirationMode));
        c.expirationMode = enumByValue(w().ExpirationMode, idx);
      }
      if (info.expirationTimerSeconds !== undefined) {
        c.expireTimerSeconds = info.expirationTimerSeconds || 0;
      }
      if (info.profilePicture !== undefined) {
        c.profilePicture = picToWasm(info.profilePicture);
      }
      this.inner.setContact(c);
    } finally {
      c.delete?.();
    }
  }

  public erase(pubkeyHex: string) {
    this.inner.eraseContact(pubkeyHex);
  }
}

// ---------------------------------------------------------------------------------------------
// UserGroups
// ---------------------------------------------------------------------------------------------
function communityFromWasm(c: any) {
  const result = {
    fullUrlWithPubkey: c.fullUrl(),
    baseUrl: c.baseUrl(),
    roomCasePreserved: c.room(),
    pubkeyHex: c.pubkeyHex(),
    priority: c.priority,
  };
  c.delete?.();
  return result;
}

function legacyGroupFromWasm(g: any) {
  const admins = new Set(vecToArray<string>(g.admins()));
  const result = {
    pubkeyHex: g.groupPk,
    name: g.name,
    encPubkey: fromHex(g.encPubkeyHex),
    encSeckey: fromHex(g.encSeckeyHex),
    members: vecToArray<string>(g.members()).map(pubkeyHex => ({
      pubkeyHex,
      isAdmin: admins.has(pubkeyHex),
    })),
    priority: g.priority,
    joinedAtSeconds: Number(g.joinedAtSeconds),
    disappearingTimerSeconds: g.expiryTimerSeconds,
  };
  g.delete?.();
  return result;
}

function groupFromWasm(g: any) {
  const result = {
    pubkeyHex: g.groupPk,
    secretKey: fromHexOrNull(g.adminSecretKey),
    authData: fromHexOrNull(g.authData),
    name: g.name || null,
    invitePending: g.invitePending,
    kicked: g.kicked(),
    destroyed: g.destroyed(),
    priority: g.priority,
    joinedAtSeconds: Number(g.joinedAtSeconds),
  };
  g.delete?.();
  return result;
}

export class UserGroupsWrapperNode extends BaseConfigWrapperWeb {
  constructor(secretKey: Uint8Array, dump: Uint8Array | null) {
    super('UserGroupsW', secretKey, dump);
  }

  public getCommunityByFullUrl(fullUrl: string) {
    const { baseUrl, room } = parseCommunityUrl(fullUrl);
    return (
      this.getAllCommunities().find(
        c =>
          c.baseUrl.toLowerCase() === baseUrl.toLowerCase() &&
          c.roomCasePreserved.toLowerCase() === room.toLowerCase()
      ) || null
    );
  }

  public setCommunityByFullUrl(fullUrl: string, priority: number) {
    const c = this.inner.getOrConstructCommunity(fullUrl);
    try {
      c.priority = priority;
      this.inner.setCommunity(c);
    } finally {
      c.delete?.();
    }
    return null;
  }

  public getAllCommunities() {
    return vecToArray(this.inner.allCommunities(), communityFromWasm);
  }

  public eraseCommunityByFullUrl(fullUrl: string) {
    const { baseUrl, room } = parseCommunityUrl(fullUrl);
    this.inner.eraseCommunity(baseUrl, room);
  }

  public buildFullUrlFromDetails(baseUrl: string, roomId: string, pubkeyHex: string) {
    return `${baseUrl.replace(/\/+$/, '')}/${roomId}?public_key=${pubkeyHex}`;
  }

  public getLegacyGroup(pubkeyHex: string) {
    const g = this.inner.getLegacyGroup(pubkeyHex);
    return g ? legacyGroupFromWasm(g) : null;
  }

  public getAllLegacyGroups() {
    return vecToArray(this.inner.allLegacyGroups(), legacyGroupFromWasm);
  }

  public setLegacyGroup(info: any) {
    const g = this.inner.getOrConstructLegacyGroup(info.pubkeyHex);
    try {
      g.name = info.name || '';
      g.encPubkeyHex = toHex(info.encPubkey);
      g.encSeckeyHex = toHex(info.encSeckey);
      g.priority = info.priority || 0;
      g.joinedAtSeconds = BigInt(info.joinedAtSeconds || 0);
      g.expiryTimerSeconds = info.disappearingTimerSeconds || 0;
      const wanted = new Map<string, boolean>(
        (info.members || []).map((m: any) => [m.pubkeyHex, !!m.isAdmin])
      );
      vecToArray<string>(g.members()).forEach(m => {
        if (!wanted.has(m)) {
          g.erase(m);
        }
      });
      wanted.forEach((isAdmin, pk) => g.insert(pk, isAdmin));
      this.inner.setLegacyGroup(g);
      return true;
    } finally {
      g.delete?.();
    }
  }

  public eraseLegacyGroup(pubkeyHex: string) {
    this.inner.eraseLegacyGroup(pubkeyHex);
    return true;
  }

  public createGroup() {
    return groupFromWasm(this.inner.createGroup());
  }

  public getGroup(pubkeyHex: string) {
    const g = this.inner.getGroup(pubkeyHex);
    return g ? groupFromWasm(g) : null;
  }

  public getAllGroups() {
    return vecToArray(this.inner.allGroups(), groupFromWasm);
  }

  public setGroup(info: any) {
    const g = this.inner.getOrConstructGroup(info.pubkeyHex);
    try {
      if (info.secretKey) {
        g.adminSecretKey = toHex(info.secretKey);
      }
      if (info.authData) {
        g.authData = toHex(info.authData);
      }
      if (info.name !== null && info.name !== undefined) {
        g.name = info.name;
      }
      if (info.invitePending !== null && info.invitePending !== undefined) {
        g.invitePending = info.invitePending;
      }
      if (info.priority !== null && info.priority !== undefined) {
        g.priority = info.priority;
      }
      if (info.joinedAtSeconds !== null && info.joinedAtSeconds !== undefined) {
        g.joinedAtSeconds = BigInt(info.joinedAtSeconds);
      }
      this.inner.setGroup(g);
    } finally {
      g.delete?.();
    }
    return this.getGroup(info.pubkeyHex);
  }

  public markGroupKicked(pubkeyHex: string) {
    this.inner.markGroupKicked(pubkeyHex);
    return this.getGroup(pubkeyHex);
  }

  public markGroupInvited(pubkeyHex: string) {
    this.inner.markGroupInvited(pubkeyHex);
    return this.getGroup(pubkeyHex);
  }

  public markGroupDestroyed(pubkeyHex: string) {
    this.inner.markGroupDestroyed(pubkeyHex);
    return this.getGroup(pubkeyHex);
  }

  public eraseGroup(pubkeyHex: string) {
    this.inner.eraseGroup(pubkeyHex);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// ConvoInfoVolatile
// ---------------------------------------------------------------------------------------------
function baseVolatile(c: any) {
  return { lastReadTsMs: Number(c.lastReadMs), forcedUnread: c.forcedUnread };
}

function volatile1o1FromWasm(c: any) {
  const result = {
    ...baseVolatile(c),
    pubkeyHex: c.sessionId,
    proExpiryTsMs: c.proExpiryAtS ? c.proExpiryAtS * 1000 : null,
    revocationTagB64: hexToB64(c.proRevocationTagHex),
  };
  c.delete?.();
  return result;
}

function volatileGroupFromWasm(c: any) {
  const result = { ...baseVolatile(c), pubkeyHex: c.sessionId };
  c.delete?.();
  return result;
}

function volatileCommunityFromWasm(c: any) {
  const result = {
    ...baseVolatile(c),
    fullUrlWithPubkey: c.fullUrl(),
    baseUrl: c.baseUrl(),
    roomCasePreserved: c.room(),
  };
  c.delete?.();
  return result;
}

type BaseVolatileSet = { lastReadTsMs: number; forcedUnread: boolean };

export class ConvoInfoVolatileWrapperNode extends BaseConfigWrapperWeb {
  constructor(secretKey: Uint8Array, dump: Uint8Array | null) {
    super('ConvoInfoVolatileW', secretKey, dump);
  }

  public get1o1(pubkeyHex: string) {
    const c = this.inner.get1o1(pubkeyHex);
    return c ? volatile1o1FromWasm(c) : null;
  }

  public getAll1o1() {
    return vecToArray(this.inner.getAll1o1s(), volatile1o1FromWasm);
  }

  public set1o1(
    pubkeyHex: string,
    args: BaseVolatileSet & { proExpiryTsMs: number | null; proRevocationTagB64: string | null }
  ) {
    this.inner.set1o1({
      sessionId: pubkeyHex,
      lastReadMs: BigInt(Math.floor(args.lastReadTsMs || 0)),
      forcedUnread: !!args.forcedUnread,
      proRevocationTagHex: b64ToHex(args.proRevocationTagB64),
      proExpiryAtS: args.proExpiryTsMs ? Math.floor(args.proExpiryTsMs / 1000) : 0,
    });
  }

  public erase1o1(pubkeyHex: string) {
    return this.inner.erase1o1(pubkeyHex);
  }

  public getLegacyGroup(pubkeyHex: string) {
    const c = this.inner.getLegacyGroup(pubkeyHex);
    return c ? volatileGroupFromWasm(c) : null;
  }

  public getAllLegacyGroups() {
    return vecToArray(this.inner.getAllLegacyGroups(), volatileGroupFromWasm);
  }

  public setLegacyGroup(pubkeyHex: string, args: BaseVolatileSet) {
    this.inner.setLegacyGroup({
      groupId: pubkeyHex,
      lastReadMs: BigInt(Math.floor(args.lastReadTsMs || 0)),
      forcedUnread: !!args.forcedUnread,
    });
  }

  public eraseLegacyGroup(pubkeyHex: string) {
    return this.inner.eraseLegacyGroup(pubkeyHex);
  }

  public getGroup(pubkeyHex: string) {
    const c = this.inner.getGroup(pubkeyHex);
    return c ? volatileGroupFromWasm(c) : null;
  }

  public getAllGroups() {
    return vecToArray(this.inner.getAllGroups(), volatileGroupFromWasm);
  }

  public setGroup(pubkeyHex: string, args: BaseVolatileSet) {
    this.inner.setGroup({
      groupId: pubkeyHex,
      lastReadMs: BigInt(Math.floor(args.lastReadTsMs || 0)),
      forcedUnread: !!args.forcedUnread,
    });
  }

  public eraseGroup(pubkeyHex: string) {
    return this.inner.eraseGroup(pubkeyHex);
  }

  public getCommunity(fullUrl: string) {
    const c = this.inner.getCommunity(fullUrl);
    return c ? volatileCommunityFromWasm(c) : null;
  }

  public getAllCommunities() {
    return vecToArray(this.inner.getAllCommunities(), volatileCommunityFromWasm);
  }

  public setCommunityByFullUrl(fullUrl: string, args: BaseVolatileSet) {
    this.inner.setCommunityByFullUrl({
      fullUrl,
      lastReadMs: BigInt(Math.floor(args.lastReadTsMs || 0)),
      forcedUnread: !!args.forcedUnread,
    });
  }

  public eraseCommunityByFullUrl(fullUrl: string) {
    this.inner.eraseCommunityByFullUrl(fullUrl);
  }
}

// ---------------------------------------------------------------------------------------------
// Static wrappers
// ---------------------------------------------------------------------------------------------
export class BlindingWrapperNode {
  public static blindVersionPubkey({ ed25519SecretKey }: { ed25519SecretKey: Uint8Array }) {
    return w().BlindingW.blindVersionPubkey(toHex(ed25519SecretKey));
  }

  public static blindVersionSignRequest(opts: {
    ed25519SecretKey: Uint8Array;
    sigTimestampSeconds: number;
    sigMethod: string;
    sigPath: string;
    sigBody: Uint8Array | null;
  }) {
    return fromHex(
      w().BlindingW.blindVersionSignRequest(
        toHex(opts.ed25519SecretKey),
        opts.sigTimestampSeconds,
        opts.sigMethod,
        opts.sigPath,
        toHex(opts.sigBody)
      )
    );
  }
}

export class UtilitiesWrapperNode {
  public static freeAllWrappers() {
    /* wrappers are freed by the worker itself */
  }
}

export class MultiEncryptWrapperNode {
  public static multiEncrypt(opts: Parameters<typeof multiEncryptJs>[0]) {
    return multiEncryptJs(opts);
  }

  public static multiDecryptEd25519(opts: {
    encoded: Uint8Array;
    userEd25519SecretKey: Uint8Array;
    senderEd25519Pubkey: Uint8Array;
    domain: string;
  }) {
    const res = w().MultiEncryptW.multiDecryptEd25519(
      toHex(opts.encoded),
      toHex(opts.userEd25519SecretKey),
      toHex(opts.senderEd25519Pubkey),
      opts.domain
    );
    return res ? fromHex(res) : null;
  }

  public static attachmentEncrypt(opts: {
    seed: Uint8Array;
    data: Uint8Array;
    domain: string;
    allowLarge: boolean;
  }) {
    const res = w().MultiEncryptW.attachmentEncrypt(
      toHex(opts.seed),
      toHex(opts.data),
      opts.domain,
      opts.allowLarge
    );
    return {
      encryptedData: fromHex(res.encryptedDataHex),
      encryptionKey: fromHex(res.encryptionKeyHex),
    };
  }

  public static attachmentDecrypt(opts: { encryptedData: Uint8Array; decryptionKey: Uint8Array }) {
    return {
      decryptedData: fromHex(
        w().MultiEncryptW.attachmentDecrypt(toHex(opts.encryptedData), toHex(opts.decryptionKey))
      ),
    };
  }

  public static encryptFor1o1(items: Parameters<MessageCrypto['encryptFor1o1']>[0]) {
    return messageCrypto().encryptFor1o1(items);
  }

  public static encryptForCommunityInbox(
    items: Parameters<MessageCrypto['encryptForCommunityInbox']>[0]
  ) {
    return messageCrypto().encryptForCommunityInbox(items);
  }

  public static encryptForCommunity(items: Parameters<MessageCrypto['encryptForCommunity']>[0]) {
    return messageCrypto().encryptForCommunity(items);
  }

  public static encryptForGroup(items: Parameters<MessageCrypto['encryptForGroup']>[0]) {
    return messageCrypto().encryptForGroup(items);
  }

  public static decryptForCommunity(
    items: Parameters<MessageCrypto['decryptForCommunity']>[0],
    opts: Parameters<MessageCrypto['decryptForCommunity']>[1]
  ) {
    return messageCrypto().decryptForCommunity(items, opts);
  }

  public static decryptFor1o1(
    items: Parameters<MessageCrypto['decryptFor1o1']>[0],
    opts: Parameters<MessageCrypto['decryptFor1o1']>[1]
  ) {
    return messageCrypto().decryptFor1o1(items, opts);
  }

  public static decryptForGroup(
    items: Parameters<MessageCrypto['decryptForGroup']>[0],
    opts: Parameters<MessageCrypto['decryptForGroup']>[1]
  ) {
    return messageCrypto().decryptForGroup(items, opts);
  }
}

export class ProWrapperNode {
  public static proFeaturesForMessage({ codepointCount }: { codepointCount: number }) {
    const limit = w().ProBackendW.standardCharacterLimit();
    return {
      status: codepointCount > limit ? 'EXCEEDS_CHARACTER_LIMIT' : 'SUCCESS',
      proMessageBitset: BigInt(0),
    };
  }

  public static visiblePlatforms() {
    return [];
  }

  public static providerUrls() {
    return null;
  }

  public static proProofRequest(): never {
    throw new NotAvailableOnWebError('Session Pro');
  }

  public static proRevocationsRequest(): never {
    throw new NotAvailableOnWebError('Session Pro');
  }

  public static proStatusRequest(): never {
    throw new NotAvailableOnWebError('Session Pro');
  }

  public static parseProProofResponse(): never {
    throw new NotAvailableOnWebError('Session Pro');
  }

  public static parseRevocationsResponse(): never {
    throw new NotAvailableOnWebError('Session Pro');
  }

  public static parseProStatusResponse(): never {
    throw new NotAvailableOnWebError('Session Pro');
  }
}

/** Closed groups (03). See metagroup.ts for how the gaps of the official WASM are covered. */
export const MetaGroupWrapperNode = createMetaGroupWrapperClass(w);

export const BaseConfigWrapperNode = BaseConfigWrapperWeb;
