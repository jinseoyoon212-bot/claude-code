/**
 * `MetaGroupWrapperNode` for the browser: closed groups (03) on top of the official libsession
 * WASM (`MetaGroupW`).
 *
 * The WASM build lacks several things the app relies on (restoring a saved state, confirming pushed
 * configs, reading the encryption keys, member side signing...). They are provided here, with an
 * "event sourcing" approach:
 *
 *   The wrapper keeps an ordered log of everything that shaped its state: key messages loaded,
 *   config messages merged (from the swarm, or our own confirmed pushes) and local changes. The WASM
 *   object is a pure function of that log, so it can be rebuilt from scratch at any time:
 *    - to RESTORE a saved group (the log is what `metaDump()` saves, instead of libsession's dump)
 *    - to CONFIRM a push: the pushed snapshot replaces what it supersedes in the log (with the hash
 *      the network gave it), which gives libsession the active hashes it needs to later report the
 *      obsolete ones.
 *   Replaying only the messages libsession still considers "active" gives the same state, which is
 *   how the log is kept small.
 *
 * What is NOT identical to the native addon:
 *  - `keysNeedsRekey()` always returns false (the WASM doesn't expose it)
 *  - the "profile updated" time of members is tracked here, it isn't read from / written to the
 *    synced members config
 *  - `memberResetAllSendingState()` has nothing to reset (the WASM has no "sending" state)
 */
/* eslint-disable max-classes-per-file */
import sodium from 'libsodium-wrappers-sumo';
import { fromHex, toHex } from './messages';

type Wasm = any;

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const NAMESPACE = { GroupKeys: 12, GroupInfo: 13, GroupMembers: 14 } as const;
const DUMP_MAGIC = 'SESSION-WEB-METAGROUP-V1';

const MEMBER_STATUS = [
  'INVITE_UNKNOWN',
  'INVITE_NOT_SENT',
  'INVITE_SENDING',
  'INVITE_FAILED',
  'INVITE_SENT',
  'INVITE_ACCEPTED',
  'PROMOTION_UNKNOWN',
  'PROMOTION_NOT_SENT',
  'PROMOTION_SENDING',
  'PROMOTION_FAILED',
  'PROMOTION_SENT',
  'PROMOTION_ACCEPTED',
  'REMOVED_UNKNOWN',
  'REMOVED_MEMBER',
  'REMOVED_MEMBER_AND_MESSAGES',
] as const;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

function vecToArray<T = any>(vec: any, map: (v: any) => T = v => v): Array<T> {
  const out: Array<T> = [];
  try {
    for (let i = 0; i < vec.size(); i++) {
      out.push(map(vec.get(i)));
    }
  } finally {
    vec.delete?.();
  }
  return out;
}

function enumValue(e: any): number {
  return typeof e === 'number' ? e : (e?.value ?? 0);
}

function concat(...parts: Array<Uint8Array>) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  parts.forEach(p => {
    out.set(p, pos);
    pos += p.length;
  });
  return out;
}

type Pic = { url: string | null; key: Uint8Array | null };
type PicJson = { url: string; keyHex: string } | null;

const picFromWasm = (pic: { url: string; key: string } | undefined): Pic => ({
  url: pic?.url || null,
  key: pic?.key ? fromHex(pic.key) : null,
});

/** mirrors `profile_pic_from_object` of the native addon */
function picToJson(pic: Pic | null | undefined): PicJson {
  if (!pic || !pic.url || !pic.key || !pic.key.length) {
    return null;
  }
  return { url: pic.url, keyHex: toHex(pic.key) };
}

const picJsonToWasm = (pic: PicJson) => ({ url: pic?.url ?? '', key: pic?.keyHex ?? '' });

// ---------------------------------------------------------------------------------------------
// bencode: only used to read the keys out of the keys config dump
// ---------------------------------------------------------------------------------------------
type Bt = number | Uint8Array | Array<Bt> | { [key: string]: Bt };

function btDecode(buf: Uint8Array): Bt {
  let i = 0;
  const readInt = (end: number) => Number(new TextDecoder().decode(buf.subarray(i, end)));
  const parse = (): Bt => {
    const c = buf[i];
    if (c === 0x69 /* i */) {
      const e = buf.indexOf(0x65, i);
      const n = readInt(e);
      i = e + 1;
      return n;
    }
    if (c === 0x6c /* l */) {
      i++;
      const list: Array<Bt> = [];
      while (buf[i] !== 0x65) {
        list.push(parse());
      }
      i++;
      return list;
    }
    if (c === 0x64 /* d */) {
      i++;
      const dict: { [key: string]: Bt } = {};
      while (buf[i] !== 0x65) {
        const key = new TextDecoder().decode(parse() as Uint8Array);
        dict[key] = parse();
      }
      i++;
      return dict;
    }
    const colon = buf.indexOf(0x3a, i);
    const len = readInt(colon);
    const s = buf.subarray(colon + 1, colon + 1 + len);
    i = colon + 1 + len;
    return s;
  };
  return parse();
}

/**
 * Same rules as libsession's `Keys::group_keys()` / `group_enc_key()`: a pending key (rekey not yet
 * pushed) first, then the stored keys from the newest to the oldest.
 */
function readKeysFromDump(dump: Uint8Array): { all: Array<Uint8Array>; current: Uint8Array | null } {
  const d = btDecode(dump) as { [k: string]: Bt };
  const stored = ((d.L as Array<{ [k: string]: Bt }>) || []).map(e => e.k as Uint8Array);
  const pending = d.P ? ((d.P as { [k: string]: Bt }).k as Uint8Array) : null;
  const all = [...(pending ? [pending] : []), ...[...stored].reverse()];
  return { all, current: all[0] ?? null };
}

// ---------------------------------------------------------------------------------------------
// member side swarm signing (libsession: Keys::swarm_subaccount_sign)
// ---------------------------------------------------------------------------------------------
/**
 * Signs `message` with the sub account described by `authData` (100 bytes: 4 flag bytes, 32 bytes
 * `k`, the admin's 64 bytes signature of the token). The signature is a standard Ed25519 signature
 * for the public key `kT` found in the returned token.
 */
export function swarmSubaccountSign(
  message: Uint8Array,
  authData: Uint8Array,
  userEd25519Secretkey: Uint8Array
) {
  if (authData.length !== 100) {
    throw new Error('Invalid signing value: size is wrong');
  }
  const k = authData.subarray(4, 36);

  // token = flags || kT, with T = |S| (the sign bit of our pubkey is cleared)
  const T = sodium.crypto_sign_ed25519_sk_to_pk(userEd25519Secretkey);
  const neg = (T[31] & 0x80) !== 0;
  T[31] &= 0x7f;
  const kT = sodium.crypto_scalarmult_ed25519_noclamp(k, T);
  const token = concat(authData.subarray(0, 4), kT);

  // our signing scalar is kt, with t = ±s depending on whether we had to negate S to make T
  let t = sodium.crypto_sign_ed25519_sk_to_curve25519(userEd25519Secretkey);
  if (neg) {
    t = sodium.crypto_core_ed25519_scalar_negate(t);
  }
  const kt = sodium.crypto_core_ed25519_scalar_mul(k, t);

  // r = H64(H32(seed, key="SubaccountSeed") || kT || M, key="SubaccountSig") mod L
  const hseed = sodium.crypto_generichash(32, userEd25519Secretkey.subarray(0, 32), 'SubaccountSeed');
  const r = sodium.crypto_core_ed25519_scalar_reduce(
    sodium.crypto_generichash(64, concat(hseed, kT, message), 'SubaccountSig')
  );
  const R = sodium.crypto_scalarmult_ed25519_base_noclamp(r);

  // S = r + H(R || kT || M) kt  (mod L)
  const hram = sodium.crypto_core_ed25519_scalar_reduce(
    sodium.crypto_hash_sha512(concat(R, kT, message))
  );
  const S = sodium.crypto_core_ed25519_scalar_add(sodium.crypto_core_ed25519_scalar_mul(hram, kt), r);

  return {
    subaccount: b64(token),
    subaccount_sig: b64(authData.subarray(36)),
    signature: b64(concat(R, S)),
  };
}

// ---------------------------------------------------------------------------------------------
// the log
// ---------------------------------------------------------------------------------------------
type Config = 'info' | 'members';

type KeyEvent = {
  t: 'key';
  id: number;
  hash: string;
  data: string;
  ts: number;
  /** a rekey made by us. While it is true, `pending` tells which configs still have to be re-pushed with the new key */
  local?: { pending: { info: boolean; members: boolean } };
};
type MergeEvent = { t: 'merge'; id: number; c: Config; hash: string; data: string };
type OpEvent = { t: 'op'; id: number; c: Config; n: string; a: Array<any> };
type LogEvent = KeyEvent | MergeEvent | OpEvent;

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

type PushSnapshot = { seqno: number; data: string };
/** `afterId`: id of the last event of the log when the push was made */
type LastPush = { afterId: number; info: PushSnapshot | null; members: PushSnapshot | null };

type Dump = {
  magic: string;
  events: Array<LogEvent>;
  pendingKeys: string | null;
  lastPush: LastPush | null;
  nextLocalKey: number;
  nextEventId: number;
};

export type GroupWrapperConstructor = {
  userEd25519Secretkey: Uint8Array;
  groupEd25519Pubkey: Uint8Array;
  groupEd25519Secretkey: Uint8Array | null;
  metaDumped: Uint8Array | null;
};

export function createMetaGroupWrapperClass(getWasm: () => Wasm) {
  const w = getWasm;

  return class MetaGroupWrapperNode {
    private inner: any;

    private readonly userSk: Uint8Array;

    private readonly groupPk: Uint8Array;

    private adminSk: Uint8Array | null;

    private events: Array<LogEvent> = [];

    private pendingKeys: string | null = null;

    private lastPush: LastPush | null = null;

    private nextLocalKey = 1;

    private nextEventId = 1;

    private dumpDirty = true;

    private replaying = false;

    private readonly profileUpdated = new Map<string, number>();

    constructor(options: GroupWrapperConstructor) {
      this.userSk = options.userEd25519Secretkey;
      this.groupPk = options.groupEd25519Pubkey;
      this.adminSk = options.groupEd25519Secretkey || null;
      if (this.groupPk.length === 33) {
        this.groupPk = this.groupPk.subarray(1);
      }
      if (options.metaDumped && options.metaDumped.length) {
        this.loadDump(options.metaDumped);
      }
      this.rebuild();
    }

    // -------------------------------------------------------------------------------------------
    // log / rebuild / dump
    // -------------------------------------------------------------------------------------------
    private loadDump(bytes: Uint8Array) {
      try {
        const dump = JSON.parse(new TextDecoder().decode(bytes)) as Dump;
        if (dump.magic !== DUMP_MAGIC) {
          throw new Error('not a web dump');
        }
        this.events = dump.events;
        this.pendingKeys = dump.pendingKeys;
        this.lastPush = dump.lastPush;
        this.nextLocalKey = dump.nextLocalKey;
        this.nextEventId = dump.nextEventId;
      } catch (e) {
        console.warn('MetaGroupWrapperNode: unreadable dump, starting from an empty group state', e);
        this.events = [];
      }
    }

    private newInner() {
      return new (w().MetaGroupW)(
        toHex(this.userSk),
        toHex(this.groupPk),
        this.adminSk ? toHex(this.adminSk) : undefined,
        undefined
      );
    }

    private rebuild() {
      this.inner?.delete?.();
      this.inner = this.newInner();
      this.profileUpdated.clear();
      this.replaying = true;
      try {
        this.events.forEach(ev => this.applyEvent(ev));
      } finally {
        this.replaying = false;
      }
    }

    private applyEvent(ev: LogEvent) {
      switch (ev.t) {
        case 'key':
          this.inner.loadKeyMessageHex(ev.hash, ev.data, ev.ts);
          if (ev.local) {
            // A real rekey makes both configs dirty (they must be re-pushed with the new key).
            // Loading the key message doesn't, so make them dirty again with a change we revert.
            if (ev.local.pending.info) {
              this.toggleInfoDirty();
            }
            if (ev.local.pending.members) {
              this.toggleMembersDirty();
            }
          }
          break;
        case 'merge': {
          const infos = new (w().MergeStructVector)();
          const members = new (w().MergeStructVector)();
          (ev.c === 'info' ? infos : members).push_back({ hash: ev.hash, dataHex: ev.data });
          const keys = new (w().MergeStructGroupKeysVector)();
          try {
            this.inner.merge(infos, members, keys);
          } finally {
            infos.delete();
            members.delete();
            keys.delete();
          }
          break;
        }
        case 'op':
          this.applyOp(ev.n, ev.a);
          break;
        default:
          break;
      }
    }

    private toggleInfoDirty() {
      const name = this.inner.getName();
      if (name !== undefined && name !== null) {
        this.inner.setName(`${name}.`);
        this.inner.setName(name);
        return;
      }
      const description = this.inner.getDescription() ?? '';
      this.inner.setDescription(`${description}.`);
      this.inner.setDescription(description);
    }

    private toggleMembersDirty() {
      const all = vecToArray(this.inner.membersAll());
      const first = all[0];
      if (!first) {
        return;
      }
      const sessionId = first.pubkey;
      const original = first.name;
      first.name = `${original}.`;
      this.inner.membersSet(first);
      const again = this.inner.membersGet(sessionId);
      again.name = original;
      this.inner.membersSet(again);
    }

    /**
     * The hashes libsession considers active once the local changes are left out. (With a local
     * change pending, libsession hands the active hashes over to its "obsolete" list, so the live
     * instance can't be asked.)
     */
    private cleanActiveHashes(): Set<string> {
      const scratch = this.newInner();
      try {
        this.events.forEach(ev => {
          if (ev.t === 'key') {
            scratch.loadKeyMessageHex(ev.hash, ev.data, ev.ts);
          } else if (ev.t === 'merge') {
            const infos = new (w().MergeStructVector)();
            const members = new (w().MergeStructVector)();
            (ev.c === 'info' ? infos : members).push_back({ hash: ev.hash, dataHex: ev.data });
            const keys = new (w().MergeStructGroupKeysVector)();
            try {
              scratch.merge(infos, members, keys);
            } finally {
              infos.delete();
              members.delete();
              keys.delete();
            }
          }
        });
        return new Set<string>(vecToArray<string>(scratch.activeHashes()));
      } finally {
        scratch.delete?.();
      }
    }

    /** Drops the messages libsession doesn't consider active anymore (superseded). */
    private prune() {
      const active = this.cleanActiveHashes();
      this.events = this.events.filter(ev => {
        if (ev.t === 'op') {
          return true;
        }
        if (ev.t === 'key' && ev.local) {
          return true; // our own rekeys stay until both configs were re-pushed with them
        }
        return active.has(ev.hash);
      });
    }

    private record(ev: DistributiveOmit<LogEvent, 'id'>) {
      this.events.push({ ...ev, id: this.nextEventId++ } as LogEvent);
      this.dumpDirty = true;
    }

    private apply(c: Config, name: string, args: Array<any>) {
      if (!this.replaying) {
        this.record({ t: 'op', c, n: name, a: args });
      }
      return this.applyOp(name, args);
    }

    // -------------------------------------------------------------------------------------------
    // push / merge / dump
    // -------------------------------------------------------------------------------------------
    public needsPush() {
      return !!this.pendingKeys || this.inner.needsPush();
    }

    public push() {
      const res = this.inner.pushHex();
      const toResult = (p: any, namespace: number) =>
        p
          ? {
              data: vecToArray<Uint8Array>(p.dataHex, fromHex),
              seqno: Number(p.seqno),
              hashes: vecToArray<string>(p.hashes),
              namespace,
            }
          : null;
      const groupInfo = toResult(res.infosPush, NAMESPACE.GroupInfo);
      const groupMember = toResult(res.membersPush, NAMESPACE.GroupMembers);

      this.lastPush = {
        afterId: this.nextEventId - 1,
        info: groupInfo ? { seqno: groupInfo.seqno, data: toHex(groupInfo.data[0]) } : null,
        members: groupMember ? { seqno: groupMember.seqno, data: toHex(groupMember.data[0]) } : null,
      };
      this.dumpDirty = true;

      return {
        groupInfo,
        groupMember,
        groupKeys: this.pendingKeys
          ? { data: fromHex(this.pendingKeys), namespace: NAMESPACE.GroupKeys }
          : null,
      };
    }

    /** Re-emits the configs even when they have nothing new, to put them back on the swarm after they expired. */
    public pushForRecovery() {
      const fresh = this.inner.pushHex();
      const snapshot = (config: Config) => {
        const p = config === 'info' ? fresh.infosPush : fresh.membersPush;
        if (p) {
          return { data: vecToArray<Uint8Array>(p.dataHex, fromHex), seqno: Number(p.seqno), hashes: vecToArray<string>(p.hashes) };
        }
        const last = this.lastPush?.[config];
        const confirmed = this.events
          .filter((e): e is MergeEvent => e.t === 'merge' && e.c === config)
          .pop();
        if (last && confirmed && last.data === confirmed.data) {
          return { data: [fromHex(last.data)], seqno: last.seqno, hashes: [] as Array<string> };
        }
        throw new Error(`pushForRecovery: no ${config} config to re-push`);
      };
      const info = snapshot('info');
      const members = snapshot('members');
      return {
        groupInfo: { ...info, namespace: NAMESPACE.GroupInfo },
        groupMember: { ...members, namespace: NAMESPACE.GroupMembers },
      };
    }

    public needsDump() {
      return this.dumpDirty;
    }

    public metaDump() {
      this.prune();
      const dump: Dump = {
        magic: DUMP_MAGIC,
        events: this.events,
        pendingKeys: this.pendingKeys,
        lastPush: this.lastPush,
        nextLocalKey: this.nextLocalKey,
        nextEventId: this.nextEventId,
      };
      this.dumpDirty = false;
      return new TextEncoder().encode(JSON.stringify(dump));
    }

    public metaMakeDump() {
      return this.metaDump();
    }

    public metaConfirmPushed({
      groupInfo,
      groupMember,
    }: {
      groupInfo: { seqno: number; hashes: Array<string> } | null;
      groupMember: { seqno: number; hashes: Array<string> } | null;
    }) {
      const push = this.lastPush;
      if (!push) {
        return;
      }
      let changed = false;
      const confirm = (config: Config, confirmed: { seqno: number; hashes: Array<string> } | null) => {
        const snap = push[config];
        if (!confirmed || !snap || snap.seqno !== confirmed.seqno || !confirmed.hashes.length) {
          return;
        }
        // everything of that config before the push is superseded by the pushed snapshot
        const isOfConfig = (ev: LogEvent) => (ev.t === 'merge' || ev.t === 'op') && ev.c === config;
        const beforePush = (ev: LogEvent) => ev.id <= push.afterId;
        const kept = this.events.filter(ev => !(beforePush(ev) && isOfConfig(ev)));
        // a rekey is settled for that config once the config was re-pushed after it
        kept.forEach(ev => {
          if (ev.t === 'key' && ev.local && beforePush(ev)) {
            ev.local.pending[config] = false;
          }
        });
        // the snapshot goes right after what was there at push time (the keys it needs come first)
        const before = kept.filter(beforePush);
        const after = kept.filter(ev => !beforePush(ev));
        const snapshots: Array<LogEvent> = confirmed.hashes.map(hash => ({
          t: 'merge' as const,
          id: this.nextEventId++,
          c: config,
          hash,
          data: snap.data,
        }));
        this.events = [...before, ...snapshots, ...after];
        push.afterId = snapshots.length ? snapshots[snapshots.length - 1].id : push.afterId;
        push[config] = null;
        changed = true;
      };
      confirm('info', groupInfo);
      confirm('members', groupMember);
      if (changed) {
        this.events = this.events.map(ev =>
          ev.t === 'key' && ev.local && !ev.local.pending.info && !ev.local.pending.members
            ? { ...ev, local: undefined }
            : ev
        );
        this.rebuild();
        this.dumpDirty = true;
      }
    }

    public metaMerge({
      groupInfo,
      groupMember,
      groupKeys,
    }: {
      groupInfo: Array<{ hash: string; data: Uint8Array }> | null;
      groupMember: Array<{ hash: string; data: Uint8Array }> | null;
      groupKeys: Array<{ hash: string; data: Uint8Array; timestampMs: number }> | null;
    }) {
      const infos = new (w().MergeStructVector)();
      const members = new (w().MergeStructVector)();
      const keys = new (w().MergeStructGroupKeysVector)();
      let needsRebuild = false;
      try {
        (groupKeys || []).forEach(k => {
          const data = toHex(k.data);
          keys.push_back({ hash: k.hash, dataHex: data, timestampMs: k.timestampMs });
          const known = this.events.find((e): e is KeyEvent => e.t === 'key' && e.data === data);
          if (known) {
            // our own rekey came back from the swarm: it is now known under its real hash
            if (known.hash !== k.hash) {
              known.hash = k.hash;
              needsRebuild = true;
            }
          } else {
            this.record({ t: 'key', hash: k.hash, data, ts: k.timestampMs });
          }
          if (this.pendingKeys === data) {
            this.pendingKeys = null;
          }
        });
        (groupInfo || []).forEach(m => {
          const data = toHex(m.data);
          infos.push_back({ hash: m.hash, dataHex: data });
          this.record({ t: 'merge', c: 'info', hash: m.hash, data });
        });
        (groupMember || []).forEach(m => {
          const data = toHex(m.data);
          members.push_back({ hash: m.hash, dataHex: data });
          this.record({ t: 'merge', c: 'members', hash: m.hash, data });
        });

        const merged = Number(this.inner.merge(infos, members, keys));
        if (needsRebuild) {
          this.rebuild();
        }
        this.prune();
        return merged;
      } finally {
        infos.delete();
        members.delete();
        keys.delete();
      }
    }

    // -------------------------------------------------------------------------------------------
    // info
    // -------------------------------------------------------------------------------------------
    public infoGet() {
      const orNull = (n: number | undefined) => (n ? Number(n) : null);
      return {
        name: this.inner.getName() ?? null,
        createdAtSeconds: orNull(this.inner.getCreatedAtSeconds()),
        deleteAttachBeforeSeconds: orNull(this.inner.getDeleteAttachBeforeSeconds()),
        deleteBeforeSeconds: orNull(this.inner.getDeleteBeforeSeconds()),
        expirySeconds: orNull(this.inner.getExpiryTimerSeconds()),
        isDestroyed: !!this.inner.isDestroyed(),
        profilePicture: picFromWasm(this.inner.getProfilePic()),
        description: this.inner.getDescription() ?? '',
      };
    }

    public infoSet(info: any) {
      this.apply('info', 'infoSet', [
        {
          name: typeof info.name === 'string' && info.name.length ? info.name : null,
          createdAtSeconds: info.createdAtSeconds ?? null,
          expirySeconds: info.expirySeconds ?? null,
          deleteBeforeSeconds: info.deleteBeforeSeconds ?? null,
          deleteAttachBeforeSeconds: info.deleteAttachBeforeSeconds ?? null,
          // like the native addon, a missing / null picture clears it
          profilePicture: picToJson(info.profilePicture),
          description: typeof info.description === 'string' ? info.description : null,
        },
      ]);
      return this.infoGet();
    }

    public infoDestroy() {
      this.apply('info', 'infoDestroy', []);
      return this.infoGet();
    }

    // -------------------------------------------------------------------------------------------
    // members
    // -------------------------------------------------------------------------------------------
    private memberToJs(member: any) {
      const pubkeyHex = member.pubkey;
      const status = this.inner.memberGetStatus(pubkeyHex);
      const result = {
        pubkeyHex,
        name: member.name ?? '',
        profilePicture: picFromWasm(member.profile_picture),
        profileUpdatedSeconds: this.profileUpdated.get(pubkeyHex) ?? 0,
        supplement: !!member.supplement,
        memberStatus: status === undefined ? 'INVITE_NOT_SENT' : MEMBER_STATUS[enumValue(status)],
        nominatedAdmin: !!member.admin,
      };
      member.delete?.();
      return result;
    }

    public memberGetAll() {
      return vecToArray(this.inner.membersAll(), m => this.memberToJs(m));
    }

    public memberGetAllPendingRemovals() {
      return this.memberGetAll().filter(m => m.memberStatus.startsWith('REMOVED'));
    }

    public memberGet(pubkeyHex: string) {
      const m = this.inner.membersGet(pubkeyHex);
      return m ? this.memberToJs(m) : null;
    }

    public memberGetOrConstruct(pubkeyHex: string) {
      return this.memberToJs(this.inner.membersGetOrConstruct(pubkeyHex));
    }

    public memberConstructAndSet(pubkeyHex: string) {
      this.apply('members', 'memberConstructAndSet', [pubkeyHex]);
      return this.memberGet(pubkeyHex);
    }

    public memberSetSupplement(pubkeyHex: string) {
      this.apply('members', 'memberSetSupplement', [pubkeyHex]);
    }

    public memberSetInviteFailed(pubkeyHex: string) {
      this.apply('members', 'memberSetInviteFailed', [pubkeyHex]);
    }

    public memberSetInviteSent(pubkeyHex: string) {
      this.apply('members', 'memberSetInviteSent', [pubkeyHex]);
    }

    public memberSetInviteNotSent(pubkeyHex: string) {
      this.apply('members', 'memberSetInviteNotSent', [pubkeyHex]);
    }

    public memberSetInviteAccepted(pubkeyHex: string) {
      this.apply('members', 'memberSetInviteAccepted', [pubkeyHex]);
    }

    public memberSetPromoted(pubkeyHex: string) {
      this.apply('members', 'memberSetPromoted', [pubkeyHex]);
    }

    public memberSetPromotionSent(pubkeyHex: string) {
      this.apply('members', 'memberSetPromotionSent', [pubkeyHex]);
    }

    public memberSetPromotionFailed(pubkeyHex: string) {
      this.apply('members', 'memberSetPromotionFailed', [pubkeyHex]);
    }

    public memberSetPromotionAccepted(pubkeyHex: string) {
      this.apply('members', 'memberSetPromotionAccepted', [pubkeyHex]);
    }

    public memberSetProfileDetails(
      pubkeyHex: string,
      details: { profileUpdatedSeconds: number; name: string; profilePicture: Pic }
    ) {
      this.apply('members', 'memberSetProfileDetails', [
        pubkeyHex,
        {
          profileUpdatedSeconds: details.profileUpdatedSeconds,
          name: details.name,
          profilePicture: picToJson(details.profilePicture),
        },
      ]);
    }

    /** the WASM has no "sending" state, so there is nothing to reset */
    public memberResetAllSendingState() {
      return false;
    }

    public membersMarkPendingRemoval(members: Array<string>, withMessages: boolean) {
      this.apply('members', 'membersMarkPendingRemoval', [members, withMessages]);
    }

    public memberEraseAndRekey(members: Array<string>) {
      let erased = false;
      members.forEach(pk => {
        if (this.inner.membersGet(pk)) {
          erased = true;
        }
      });
      if (!erased) {
        return false;
      }
      this.apply('members', 'memberEraseAndRekey', [members]);
      this.keyRekey();
      return true;
    }

    // -------------------------------------------------------------------------------------------
    // the replayable local changes
    // -------------------------------------------------------------------------------------------
    private updateMember(pubkeyHex: string, fn: (m: any) => void) {
      const m = this.inner.membersGet(pubkeyHex);
      if (m) {
        fn(m);
        this.inner.membersSet(m);
        m.delete?.();
      }
    }

    private applyOp(name: string, a: Array<any>) {
      switch (name) {
        case 'infoSet': {
          const info = a[0];
          const i = this.inner;
          if (info.name) {
            i.setNameTruncated(info.name);
          }
          if (info.createdAtSeconds !== null) {
            i.setCreatedAtSeconds(info.createdAtSeconds);
          }
          if (info.expirySeconds !== null) {
            i.setExpiryTimerSeconds(info.expirySeconds);
          }
          if (info.deleteBeforeSeconds !== null) {
            i.setDeleteBeforeSeconds(info.deleteBeforeSeconds);
          }
          if (info.deleteAttachBeforeSeconds !== null) {
            i.setDeleteAttachBeforeSeconds(info.deleteAttachBeforeSeconds);
          }
          i.setProfilePic(picJsonToWasm(info.profilePicture));
          if (info.description !== null) {
            i.setDescriptionTruncated(info.description);
          }
          return undefined;
        }
        case 'infoDestroy':
          this.inner.destroyGroup();
          return undefined;
        case 'memberConstructAndSet': {
          const m = this.inner.membersGetOrConstruct(a[0]);
          this.inner.membersSet(m);
          m.delete?.();
          return undefined;
        }
        case 'memberSetSupplement':
          return this.updateMember(a[0], m => {
            m.supplement = true;
          });
        case 'memberSetInviteFailed':
          return this.updateMember(a[0], m => m.setInviteFailed());
        case 'memberSetInviteSent':
          return this.updateMember(a[0], m => m.setInviteSent());
        case 'memberSetInviteNotSent':
          return this.updateMember(a[0], m => m.setInviteNotSent());
        case 'memberSetInviteAccepted':
          return this.updateMember(a[0], m => m.setInviteAccepted());
        case 'memberSetPromoted':
          return this.updateMember(a[0], m => m.setPromoted());
        case 'memberSetPromotionSent':
          return this.updateMember(a[0], m => m.setPromotionSent());
        case 'memberSetPromotionFailed':
          return this.updateMember(a[0], m => m.setPromotionFailed());
        case 'memberSetPromotionAccepted':
          return this.updateMember(a[0], m => m.setPromotionAccepted());
        case 'memberSetProfileDetails': {
          const [pubkeyHex, details] = a;
          const known = this.profileUpdated.get(pubkeyHex) ?? 0;
          if (details.profileUpdatedSeconds > known || known === 0) {
            this.updateMember(pubkeyHex, m => {
              m.setNameTruncated(details.name);
              m.profile_picture = picJsonToWasm(details.profilePicture);
            });
            this.profileUpdated.set(pubkeyHex, details.profileUpdatedSeconds);
          }
          return undefined;
        }
        case 'membersMarkPendingRemoval': {
          const [members, withMessages] = a;
          (members as Array<string>).forEach(pk => this.updateMember(pk, m => m.setRemoved(withMessages)));
          return undefined;
        }
        case 'memberEraseAndRekey': {
          (a[0] as Array<string>).forEach(pk => this.inner.membersErase(pk));
          return undefined;
        }
        default:
          throw new Error(`MetaGroupWrapperNode: unknown op ${name}`);
      }
    }

    // -------------------------------------------------------------------------------------------
    // keys
    // -------------------------------------------------------------------------------------------
    public keysNeedsRekey() {
      return false;
    }

    public keyRekey() {
      const data = this.inner.rekeyHex() as string;
      const key = {
        t: 'key' as const,
        hash: `local-key-${this.nextLocalKey++}`,
        data,
        ts: Date.now(),
        local: { pending: { info: true, members: true } },
      };
      this.record(key);
      this.pendingKeys = data;
      // the state after a rekey is rebuilt from the log, exactly like after a restore
      this.rebuild();
      return fromHex(data);
    }

    private readKeys() {
      return readKeysFromDump(fromHex(this.inner.makeKeysDumpHex()));
    }

    public keyGetAll() {
      return this.readKeys().all;
    }

    public keyGetEncryptionKeyHex() {
      const { current } = this.readKeys();
      if (!current) {
        throw new Error('group_enc_key failed: Keys object has no keys at all!');
      }
      return toHex(current);
    }

    public loadKeyMessage(hash: string, data: Uint8Array, timestampMs: number) {
      const hex = toHex(data);
      const known = this.events.find((e): e is KeyEvent => e.t === 'key' && e.data === hex);
      if (known) {
        if (known.hash !== hash) {
          known.hash = hash;
          this.rebuild();
        }
      } else {
        this.record({ t: 'key', hash, data: hex, ts: timestampMs });
      }
      if (this.pendingKeys === hex) {
        this.pendingKeys = null;
      }
      return !!this.inner.loadKeyMessageHex(hash, hex, timestampMs);
    }

    public keysAdmin() {
      return !!this.inner.admin();
    }

    public keyGetCurrentGen() {
      return Number(this.inner.keysCurrentGeneration());
    }

    public loadAdminKeys(secret: Uint8Array) {
      this.adminSk = secret;
      this.inner.loadAdminKey(toHex(secret));
      this.dumpDirty = true;
      return null;
    }

    private realHashes() {
      return vecToArray<string>(this.inner.activeHashes()).filter(h => !h.startsWith('local-'));
    }

    public activeHashes() {
      return this.realHashes();
    }

    public activeHashesByConfig() {
      const byHash = new Map<string, 'groupKeys' | 'groupInfo' | 'groupMember'>();
      this.events.forEach(ev => {
        if (ev.t === 'key') {
          byHash.set(ev.hash, 'groupKeys');
        } else if (ev.t === 'merge') {
          byHash.set(ev.hash, ev.c === 'info' ? 'groupInfo' : 'groupMember');
        }
      });
      const out = { groupKeys: [] as Array<string>, groupInfo: [] as Array<string>, groupMember: [] as Array<string> };
      this.realHashes().forEach(h => {
        const config = byHash.get(h);
        if (config) {
          out[config].push(h);
        }
      });
      return out;
    }

    public encryptMessages(plaintexts: Array<Uint8Array>) {
      const vec = new (w().StringVector)();
      plaintexts.forEach(p => vec.push_back(toHex(p)));
      try {
        return vecToArray<Uint8Array>(this.inner.encryptMessagesHex(vec), fromHex);
      } finally {
        vec.delete();
      }
    }

    public decryptMessage(ciphertext: Uint8Array) {
      const vec = new (w().VectorOfEncryptedGroupMessage)();
      vec.push_back({ dataHex: toHex(ciphertext), hash: '' });
      const [decrypted] = vecToArray(this.inner.decryptMessages(vec), d => ({
        pubkeyHex: d.author as string,
        plaintext: fromHex(d.dataHex),
      }));
      vec.delete?.();
      if (!decrypted) {
        throw new Error('decryptMessage: could not decrypt');
      }
      return decrypted;
    }

    // -------------------------------------------------------------------------------------------
    // swarm sub accounts
    // -------------------------------------------------------------------------------------------
    public makeSwarmSubAccount(memberPubkeyHex: string) {
      const bytes = fromHex(this.inner.makeSubaccountHex(memberPubkeyHex, true, false));
      if (bytes.length !== 100) {
        throw new Error('expected subaccount to be 100 bytes long');
      }
      return bytes;
    }

    public swarmSubAccountToken(memberPubkeyHex: string) {
      const hex = this.inner.subaccountTokenHex(memberPubkeyHex, true, false) as string;
      if (hex.length !== 72) {
        throw new Error('expected subaccount token to be 36 bytes long');
      }
      return hex;
    }

    public swarmVerifySubAccount(signingValue: Uint8Array) {
      return !!this.inner.verifySubaccountHex(toHex(signingValue), true, false);
    }

    public swarmSubaccountSign(message: Uint8Array, authData: Uint8Array) {
      return swarmSubaccountSign(message, authData, this.userSk);
    }

    public generateSupplementKeys(members: Array<string>) {
      const vec = new (w().StringVector)();
      members.forEach(m => vec.push_back(m));
      try {
        return fromHex(this.inner.keysSupplementHex(vec));
      } finally {
        vec.delete();
      }
    }
  };
}
