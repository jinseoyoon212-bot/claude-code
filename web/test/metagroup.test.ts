/**
 * Closed groups: multi-party simulation against the real libsession WASM.
 * An admin and members exchange group configs and messages through an in-memory "swarm".
 * Run with: pnpm test:web
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import sodium from 'libsodium-wrappers-sumo';
import { SessionProtos } from '../../ts/protobuf/compiled';
import { createMetaGroupWrapperClass } from '../libsession/metagroup';
import { fromHex, makeMessageCrypto, toHex } from '../libsession/messages';

const require = createRequire(import.meta.url);
const PRO_PK = '479ffca8bcec7b4a0f0f7afe48b8a6d15635a8c7ff15ad16add05752c19414d4';

type Wrapper = InstanceType<ReturnType<typeof createMetaGroupWrapperClass>>;
type Msg = { hash: string; data: Uint8Array; ts: number };

export async function runMetaGroupTests() {
  await sodium.ready;
  const factory = require('@session-foundation/libsession-wasm');
  const wasm = await factory({ getRandomValue: () => crypto.getRandomValues(new Uint32Array(1))[0] });
  const P = wasm.SessionCryptoPrimitivesW;
  const MetaGroup = createMetaGroupWrapperClass(() => wasm);
  const crypto2 = makeMessageCrypto(() => wasm);

  /** one group, with its own swarm */
  const makeEnv = () => {
    let hashCounter = 0;
    const swarm = { keys: [] as Array<Msg>, info: [] as Array<Msg>, members: [] as Array<Msg>, chat: [] as Array<Msg> };
    const store = (ns: keyof typeof swarm, data: Uint8Array) => {
      const hash = `h${++hashCounter}`;
      swarm[ns].push({ hash, data, ts: 1700000000000 + hashCounter * 1000 });
      return hash;
    };

    // ---- people --------------------------------------------------------------------------------
    const person = () => {
      const seed = P.randombytesBuf(32);
      const kp = JSON.parse(P.cryptoSignSeedKeypair(seed));
      return {
        seed: fromHex(seed),
        sk: fromHex(kp.privateKeyHex),
        edPk: kp.publicKeyHex as string,
        sessionId: `05${P.cryptoSignEd25519PkToCurve25519(kp.publicKeyHex)}`,
      };
    };
    const adminP = person();
    const aliceP = person();
    const bobP = person();
    const carolP = person();
    const groupKp = JSON.parse(P.cryptoSignSeedKeypair(P.randombytesBuf(32)));
    const groupPk32 = fromHex(groupKp.publicKeyHex);
    const groupSk = fromHex(groupKp.privateKeyHex);
    const groupPk03 = `03${groupKp.publicKeyHex}`;

    const open = (p: ReturnType<typeof person>, isAdmin: boolean, dump: Uint8Array | null = null): Wrapper =>
      new MetaGroup({
        userEd25519Secretkey: p.sk,
        groupEd25519Pubkey: groupPk32,
        groupEd25519Secretkey: isAdmin ? groupSk : null,
        metaDumped: dump,
      });

    // ---- helpers -------------------------------------------------------------------------------
    const cursors = new Map<string, { keys: number; info: number; members: number }>();
    const poll = (name: string, w: Wrapper) => {
      const c = cursors.get(name) || { keys: 0, info: 0, members: 0 };
      const merge = {
        groupKeys: swarm.keys.slice(c.keys).map(m => ({ hash: m.hash, data: m.data, timestampMs: m.ts })),
        groupInfo: swarm.info.slice(c.info).map(m => ({ hash: m.hash, data: m.data })),
        groupMember: swarm.members.slice(c.members).map(m => ({ hash: m.hash, data: m.data })),
      };
      cursors.set(name, { keys: swarm.keys.length, info: swarm.info.length, members: swarm.members.length });
      return w.metaMerge(merge);
    };
    /** what GroupSyncJob does: push, store on the swarm, confirm */
    const pushAndConfirm = (w: Wrapper, who = 'admin') => {
      const p = w.push();
      const keys = p.groupKeys ? { hash: store('keys', p.groupKeys.data), data: p.groupKeys.data } : null;
      const info = p.groupInfo ? { seqno: p.groupInfo.seqno, hashes: [store('info', p.groupInfo.data[0])] } : null;
      const members = p.groupMember ? { seqno: p.groupMember.seqno, hashes: [store('members', p.groupMember.data[0])] } : null;
      w.metaConfirmPushed({ groupInfo: info, groupMember: members });
      // keys are not confirmed explicitly: the pusher gets its own key message back when it polls
      poll(who, w);
      return { p, keys, info, members };
    };
    /** the state a user (or the app) can observe */
    const observe = (w: Wrapper) => {
      const byConfig = w.activeHashesByConfig();
      return {
        info: w.infoGet(),
        members: w.memberGetAll().sort((a, b) => a.pubkeyHex.localeCompare(b.pubkeyHex)),
        keys: w.keyGetAll().map(toHex),
        enc: w.keyGetAll().length ? w.keyGetEncryptionKeyHex() : null,
        gen: w.keyGetCurrentGen(),
        needsPush: w.needsPush(),
        active: {
          groupKeys: [...byConfig.groupKeys].sort(),
          groupInfo: [...byConfig.groupInfo].sort(),
          groupMember: [...byConfig.groupMember].sort(),
        },
      };
    };
    /** saves then restores a wrapper; the restored one must be indistinguishable */
    const roundTrip = (w: Wrapper, p: ReturnType<typeof person>, isAdmin: boolean, label: string) => {
      const restored = open(p, isAdmin, w.metaDump());
      assert.deepEqual(observe(restored), observe(w), `restore mismatch: ${label}`);
      return restored;
    };
    const content = (body: string) => SessionProtos.Content.encode({ dataMessage: { body } }).finish();
    const bodyOf = (b: Uint8Array) => SessionProtos.Content.decode(b).dataMessage?.body;
    const send = (w: Wrapper, from: ReturnType<typeof person>, body: string, ts = Date.now()) => {
      const { encryptedData } = crypto2.encryptForGroup([
        {
          plaintext: content(body),
          senderEd25519Seed: from.seed,
          sentTimestampMs: ts,
          groupEd25519Pubkey: groupPk03,
          groupEncKey: w.keyGetEncryptionKeyHex(),
          proRotatingEd25519PrivKey: null,
        },
      ]);
      return store('chat', encryptedData[0]);
    };
    const readAll = (w: Wrapper) =>
      crypto2
        .decryptForGroup(
          swarm.chat.map(m => ({ envelopePayload: m.data, messageHash: m.hash })),
          { proBackendPubkeyHex: PRO_PK, ed25519GroupPubkeyHex: groupPk03, groupEncKeys: w.keyGetAll() }
        )
        .map(d => ({ from: d.decodedEnvelope.sessionId, body: bodyOf(d.decodedEnvelope.contentPlaintextUnpadded) }));

    return { swarm, store, person, adminP, aliceP, bobP, carolP, groupPk03, open, poll, pushAndConfirm, observe, roundTrip, send, readAll };
  };

  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  };

  // ---- scenarios -----------------------------------------------------------------------------
  const env = makeEnv();
  const { swarm, store, adminP, aliceP, bobP, carolP, open, poll, pushAndConfirm, observe, roundTrip, send, readAll } = env;
  let admin = open(adminP, true);
  let alice: Wrapper | undefined;
  let bob: Wrapper | undefined;

  test('group: create, add members, first rekey, push', () => {
    assert.equal(admin.keysAdmin(), true);
    const infos = admin.infoGet();
    infos.name = 'Team';
    infos.description = 'our team';
    admin.infoSet(infos);
    [aliceP, bobP].forEach(m => {
      admin.memberConstructAndSet(m.sessionId);
      admin.memberSetProfileDetails(m.sessionId, { profileUpdatedSeconds: 10, name: m === aliceP ? 'Alice' : 'Bob', profilePicture: { url: null, key: null } });
      admin.memberSetInviteSent(m.sessionId);
    });
    admin.keyRekey();
    assert.equal(admin.needsPush(), true);
    admin = roundTrip(admin, adminP, true, 'before first push');

    const { p, keys } = pushAndConfirm(admin);
    assert.ok(p.groupInfo && p.groupMember && keys, 'info, members and keys are pushed');
    assert.equal(admin.needsPush(), false, 'nothing left to push once confirmed');
    assert.equal(admin.activeHashesByConfig().groupInfo.length, 1);
    admin = roundTrip(admin, adminP, true, 'after first push');
  });

  test('members: join, read the config, share the same keys', () => {
    alice = open(aliceP, false);
    bob = open(bobP, false);
    poll('alice', alice);
    poll('bob', bob);
    const view = alice.infoGet();
    assert.equal(view.name, 'Team');
    assert.equal(view.description, 'our team');
    assert.deepEqual(alice.memberGetAll().map(m => m.name).sort(), ['Alice', 'Bob']);
    assert.equal(alice.keyGetEncryptionKeyHex(), admin.keyGetEncryptionKeyHex());
    assert.equal(alice.needsPush(), false);
    assert.equal(alice.keysAdmin(), false);
    alice = roundTrip(alice, aliceP, false, 'member after join');
  });

  test('group messages: everyone reads everyone', () => {
    send(admin, adminP, 'hello team');
    send(alice!, aliceP, 'hi admin');
    send(bob!, bobP, 'hey');
    const adminView = readAll(admin);
    assert.deepEqual(adminView.map(m => m.body), ['hello team', 'hi admin', 'hey']);
    assert.deepEqual(adminView.map(m => m.from), [adminP.sessionId, aliceP.sessionId, bobP.sessionId]);
    assert.deepEqual(readAll(bob!).map(m => m.body), ['hello team', 'hi admin', 'hey']);
  });

  test('rename: only changed configs are pushed, the old info message becomes obsolete', () => {
    const oldInfoHash = admin.activeHashesByConfig().groupInfo[0];
    const infos = admin.infoGet();
    infos.name = 'Team renamed';
    admin.infoSet(infos);
    assert.equal(admin.needsPush(), true);
    const { p, info } = pushAndConfirm(admin);
    assert.ok(p.groupInfo, 'info pushed');
    assert.equal(p.groupMember, null, 'members untouched');
    assert.equal(p.groupKeys, null);
    assert.deepEqual(p.groupInfo.hashes, [oldInfoHash], 'the previous info message is reported as obsolete');
    assert.deepEqual(admin.activeHashesByConfig().groupInfo, info!.hashes);
    poll('alice', alice!);
    assert.equal(alice!.infoGet().name, 'Team renamed');
    admin = roundTrip(admin, adminP, true, 'after rename');
  });

  test('unconfirmed push survives a restart and can still be confirmed', () => {
    const infos = admin.infoGet();
    infos.name = 'Team v3';
    admin.infoSet(infos);
    const p = admin.push(); // pushed...
    const hash = store('info', p.groupInfo!.data[0]);
    admin = roundTrip(admin, adminP, true, 'between push and confirm'); // ...app restarts...
    assert.equal(admin.needsPush(), true, 'still not confirmed');
    admin.metaConfirmPushed({ groupInfo: { seqno: p.groupInfo!.seqno, hashes: [hash] }, groupMember: null }); // ...confirm arrives
    assert.equal(admin.needsPush(), false);
    assert.deepEqual(admin.activeHashesByConfig().groupInfo, [hash]);
    poll('alice', alice!);
    assert.equal(alice!.infoGet().name, 'Team v3');
  });

  test('a change made while a push is in flight is not lost', () => {
    const infos = admin.infoGet();
    infos.name = 'Team v4';
    admin.infoSet(infos);
    const p = admin.push();
    const hash = store('info', p.groupInfo!.data[0]);
    const again = admin.infoGet();
    again.name = 'Team v5'; // changed during the request
    admin.infoSet(again);
    admin.metaConfirmPushed({ groupInfo: { seqno: p.groupInfo!.seqno, hashes: [hash] }, groupMember: null });
    assert.equal(admin.needsPush(), true, 'v5 still has to be pushed');
    admin = roundTrip(admin, adminP, true, 'in-flight change');
    pushAndConfirm(admin);
    poll('alice', alice!);
    assert.equal(alice!.infoGet().name, 'Team v5');
  });

  test('add a member with history access (supplemental keys)', () => {
    send(admin, adminP, 'before carol');
    admin.memberConstructAndSet(carolP.sessionId);
    admin.memberSetSupplement(carolP.sessionId);
    admin.memberSetInviteSent(carolP.sessionId);
    const supplement = admin.generateSupplementKeys([carolP.sessionId]);
    store('keys', supplement);
    admin.keyRekey();
    pushAndConfirm(admin);
    const carol = open(carolP, false);
    poll('carol', carol);
    poll('alice', alice!);
    assert.equal(carol.infoGet().name, 'Team v5');
    assert.ok(readAll(carol).some(m => m.body === 'before carol'), 'carol can read what was said before she joined');
    assert.equal(alice!.memberGetAll().length, 3);
  });

  test('remove a member: rekey, the removed member cannot read new messages', () => {
    admin.membersMarkPendingRemoval([bobP.sessionId], false);
    assert.ok(admin.memberGetAllPendingRemovals().some(m => m.pubkeyHex === bobP.sessionId));
    assert.equal(admin.memberEraseAndRekey([bobP.sessionId]), true);
    assert.equal(admin.memberGet(bobP.sessionId), null);
    admin = roundTrip(admin, adminP, true, 'after removal');
    pushAndConfirm(admin);
    admin = roundTrip(admin, adminP, true, 'after removal push');

    send(admin, adminP, 'secret after bob left');
    poll('alice', alice!);
    poll('bob', bob!);
    assert.ok(readAll(alice!).some(m => m.body === 'secret after bob left'), 'alice reads it');
    assert.ok(!readAll(bob!).some(m => m.body === 'secret after bob left'), 'bob cannot');
    assert.ok(admin.keyGetCurrentGen() > 0);
  });

  test('swarm sub account: a member signs with the admin issued auth data', () => {
    const authData = admin.makeSwarmSubAccount(aliceP.sessionId);
    assert.equal(authData.length, 100);
    // the invited member checks that the auth data really is valid for her
    assert.equal(alice!.swarmVerifySubAccount(authData), true, 'the admin signature of the auth data is valid for alice');
    assert.equal(alice!.swarmVerifySubAccount(authData.map((b, i) => (i === 50 ? b ^ 1 : b))), false, 'a tampered auth data is refused');
    assert.equal(bob!.swarmVerifySubAccount(authData), false, 'auth data issued for alice is not valid for bob');

    const message = new TextEncoder().encode('store request to the group swarm');
    const signed = alice!.swarmSubaccountSign(message, authData);
    const token = Uint8Array.from(atob(signed.subaccount), c => c.charCodeAt(0));
    const signature = Uint8Array.from(atob(signed.signature), c => c.charCodeAt(0));
    assert.equal(token.length, 36);
    assert.equal(signature.length, 64);
    // the storage server verifies it as a plain Ed25519 signature for the pubkey kT of the token
    assert.equal(sodium.crypto_sign_verify_detached(signature, message, token.subarray(4)), true);
    assert.equal(sodium.crypto_sign_verify_detached(signature, new TextEncoder().encode('another message'), token.subarray(4)), false);
    // and the admin knows the same token for that member
    assert.equal(admin.swarmSubAccountToken(aliceP.sessionId), toHex(token));
    // sub account signatures of two members differ and each only verifies for its own token
    const bobSigned = bob!.swarmSubaccountSign(message, admin.makeSwarmSubAccount(bobP.sessionId));
    assert.notEqual(bobSigned.subaccount, signed.subaccount);
  });

  test('restore at every step of a random history gives an identical state', () => {
    const e = makeEnv(); // a separate group with its own swarm
    const rnd = (n: number) => Math.floor(Math.random() * n);
    let live = e.open(e.adminP, true);
    const infos = live.infoGet();
    infos.name = 'fuzz';
    live.infoSet(infos);
    live.memberConstructAndSet(e.aliceP.sessionId);
    live.keyRekey();
    e.pushAndConfirm(live);
    const watcher = e.open(e.aliceP, false);
    e.poll('watcher', watcher);

    for (let step = 0; step < 80; step++) {
      const action = rnd(7);
      if (action === 0) {
        const i = live.infoGet();
        i.name = `name-${step}`;
        live.infoSet(i);
      } else if (action === 1) {
        live.memberConstructAndSet(e.person().sessionId);
      } else if (action === 2) {
        const all = live.memberGetAll();
        if (all.length) {
          live.memberSetInviteSent(all[rnd(all.length)].pubkeyHex);
        }
      } else if (action === 3) {
        live.keyRekey();
      } else if (action === 4) {
        if (live.needsPush()) {
          e.pushAndConfirm(live);
        }
      } else if (action === 5) {
        // never the watcher: a removed member rightfully stops following the group
        const removable = live.memberGetAll().filter(m => m.pubkeyHex !== e.aliceP.sessionId);
        if (removable.length) {
          live.memberEraseAndRekey([removable[rnd(removable.length)].pubkeyHex]);
        }
      } else {
        e.poll('watcher', watcher);
        e.poll('admin', live);
      }
      const restored = e.open(e.adminP, true, live.metaDump());
      assert.deepEqual(e.observe(restored), e.observe(live), `fuzz step ${step} (action ${action})`);
      if (step % 2 === 0) {
        live = restored; // carry on from the restored copy
      }
    }
    // everything that was pushed ends up readable by an independent member
    while (live.needsPush()) {
      e.pushAndConfirm(live);
    }
    e.poll('watcher', watcher);
    assert.equal(watcher.infoGet().name, live.infoGet().name);
    assert.equal(watcher.memberGetAll().length, live.memberGetAll().length);
    assert.equal(watcher.keyGetEncryptionKeyHex(), live.keyGetEncryptionKeyHex());
  });

  return passed;
}
