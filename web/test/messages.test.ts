/**
 * Round-trip tests for web/libsession/messages.ts against the real libsession WASM build.
 * Run with: pnpm test:web
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import sodium from 'libsodium-wrappers-sumo';
import { SessionProtos } from '../../ts/protobuf/compiled';
import { makeMessageCrypto, toHex, fromHex, padMessage, unpadMessage } from '../libsession/messages';

const require = createRequire(import.meta.url);
const PRO_PK = '479ffca8bcec7b4a0f0f7afe48b8a6d15635a8c7ff15ad16add05752c19414d4';

async function main() {
  await sodium.ready;
  const factory = require('@session-foundation/libsession-wasm');
  const wasm = await factory({ getRandomValue: () => crypto.getRandomValues(new Uint32Array(1))[0] });
  const P = wasm.SessionCryptoPrimitivesW;
  const mc = makeMessageCrypto(() => wasm);

  const newUser = () => {
    const seed = fromHex(P.randombytesBuf(32));
    const kp = JSON.parse(P.cryptoSignSeedKeypair(toHex(seed)));
    return { seed, edPk: kp.publicKeyHex as string, sessionId: `05${P.cryptoSignEd25519PkToCurve25519(kp.publicKeyHex)}` };
  };
  const content = (body: string) =>
    SessionProtos.Content.encode({ dataMessage: { body } }).finish();
  const bodyOf = (bytes: Uint8Array) => SessionProtos.Content.decode(bytes).dataMessage?.body;

  const alice = newUser();
  const bob = newUser();
  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  };

  test('padding matches libsession', () => {
    // same results as pad_message() in session_protocol.cpp: payload + 0x80, rounded up to 160
    // (a payload which exactly fills a block after the terminator gets one more block)
    const expected: Array<[number, number]> = [[0, 160], [158, 160], [159, 320], [160, 320], [318, 320], [319, 480]];
    expected.forEach(([len, padded]) => assert.equal(padMessage(new Uint8Array(len)).length, padded, `len ${len}`));
    const msg = content('hi');
    assert.deepEqual([...unpadMessage(padMessage(msg))], [...msg]);
  });

  test('1:1 alice -> bob', () => {
    const { encryptedData } = mc.encryptFor1o1([
      { plaintext: content('hello bob'), sentTimestampMs: 1700000000123, senderEd25519Seed: alice.seed,
        recipientPubkey: bob.sessionId, proRotatingEd25519PrivKey: null },
    ]);
    const [dec] = mc.decryptFor1o1([{ envelopePayload: encryptedData[0], messageHash: 'h1' }],
      { proBackendPubkeyHex: PRO_PK, ed25519PrivateKeyHex: toHex(bob.seed) });
    assert.equal(dec.messageHash, 'h1');
    assert.equal(dec.decodedEnvelope.sessionId, alice.sessionId);
    assert.equal(dec.decodedEnvelope.envelope.timestampMs, 1700000000123);
    assert.equal(bodyOf(dec.decodedEnvelope.contentPlaintextUnpadded), 'hello bob');
  });

  test('1:1 skips what it cannot decrypt, keeps the rest', () => {
    const { encryptedData } = mc.encryptFor1o1([
      { plaintext: content('ok'), sentTimestampMs: 1, senderEd25519Seed: alice.seed, recipientPubkey: bob.sessionId, proRotatingEd25519PrivKey: null },
    ]);
    const res = mc.decryptFor1o1(
      [{ envelopePayload: new Uint8Array(200), messageHash: 'bad' }, { envelopePayload: encryptedData[0], messageHash: 'good' }],
      { proBackendPubkeyHex: PRO_PK, ed25519PrivateKeyHex: toHex(bob.seed) });
    assert.deepEqual(res.map(r => r.messageHash), ['good']);
  });

  test('1:1 note to self (sync)', () => {
    const { encryptedData } = mc.encryptFor1o1([
      { plaintext: content('note'), sentTimestampMs: 5, senderEd25519Seed: alice.seed, recipientPubkey: alice.sessionId, proRotatingEd25519PrivKey: null },
    ]);
    const [dec] = mc.decryptFor1o1([{ envelopePayload: encryptedData[0], messageHash: 'n' }],
      { proBackendPubkeyHex: PRO_PK, ed25519PrivateKeyHex: toHex(alice.seed) });
    assert.equal(dec.decodedEnvelope.sessionId, alice.sessionId);
    assert.equal(bodyOf(dec.decodedEnvelope.contentPlaintextUnpadded), 'note');
  });

  test('group (03) alice -> members, wrong key is rejected', () => {
    const groupKp = JSON.parse(P.cryptoSignSeedKeypair(P.randombytesBuf(32)));
    const groupPk = `03${groupKp.publicKeyHex}`;
    const encKey = P.randombytesBuf(32);
    const { encryptedData } = mc.encryptForGroup([
      { plaintext: content('hello group'), senderEd25519Seed: alice.seed, sentTimestampMs: 1700000000999,
        groupEd25519Pubkey: groupPk, groupEncKey: encKey, proRotatingEd25519PrivKey: null },
    ]);
    const opts = (keys: Array<string>) => ({ proBackendPubkeyHex: PRO_PK, ed25519GroupPubkeyHex: groupPk, groupEncKeys: keys.map(fromHex) });
    const [dec] = mc.decryptForGroup([{ envelopePayload: encryptedData[0], messageHash: 'g1' }], opts([P.randombytesBuf(32), encKey]));
    assert.equal(dec.decodedEnvelope.sessionId, alice.sessionId);
    assert.equal(dec.decodedEnvelope.envelope.timestampMs, 1700000000999);
    assert.equal(bodyOf(dec.decodedEnvelope.contentPlaintextUnpadded), 'hello group');
    assert.equal(mc.decryptForGroup([{ envelopePayload: encryptedData[0], messageHash: 'g1' }], opts([P.randombytesBuf(32)])).length, 0);
  });

  test('legacy (05) groups are refused like in libsession', () => {
    assert.throws(() => mc.encryptForGroup([
      { plaintext: content('x'), senderEd25519Seed: alice.seed, sentTimestampMs: 1, groupEd25519Pubkey: bob.sessionId,
        groupEncKey: P.randombytesBuf(32), proRotatingEd25519PrivKey: null }]), /legacy group/);
  });

  test('community: encrypt (padded) -> decrypt', () => {
    const { encryptedData } = mc.encryptForCommunity([{ plaintext: content('hello community'), proRotatingEd25519PrivKey: null }]);
    assert.equal(encryptedData[0].length % 160, 0);
    const [dec] = mc.decryptForCommunity([{ contentOrEnvelope: encryptedData[0], serverId: 42 }], { nowMs: Date.now(), proBackendPubkeyHex: PRO_PK });
    assert.equal(dec.serverId, 42);
    assert.equal(dec.envelope, null);
    assert.equal(bodyOf(dec.contentPlaintextUnpadded), 'hello community');
  });

  test('community: envelope-wrapped content is understood', () => {
    const envelope = SessionProtos.Envelope.encode({
      type: SessionProtos.Envelope.Type.SESSION_MESSAGE, timestamp: 1700000000555, content: padMessage(content('wrapped')),
    }).finish();
    const [dec] = mc.decryptForCommunity([{ contentOrEnvelope: envelope, serverId: 1 }], { nowMs: 0, proBackendPubkeyHex: PRO_PK });
    assert.equal(dec.envelope?.timestampMs, 1700000000555);
    assert.equal(bodyOf(dec.contentPlaintextUnpadded), 'wrapped');
  });

  test('community inbox (blinded DM) encrypts', () => {
    const server = JSON.parse(P.cryptoSignSeedKeypair(P.randombytesBuf(32)));
    const recipient = JSON.parse(P.cryptoSignSeedKeypair(P.randombytesBuf(32)));
    const { encryptedData } = mc.encryptForCommunityInbox([
      { plaintext: content('dm'), senderEd25519Seed: alice.seed, recipientPubkey: `15${recipient.publicKeyHex}`,
        communityPubkey: server.publicKeyHex, proRotatingEd25519PrivKey: null }]);
    assert.ok(encryptedData[0].length > 160);
  });

  console.log(`\n${passed} passed`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
