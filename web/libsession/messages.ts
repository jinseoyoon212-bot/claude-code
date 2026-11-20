/**
 * Message encryption / decryption for the web build.
 *
 * Mirrors libsession-util's `encode_for_*` / `decode_*` functions (session_protocol.cpp) as exposed
 * by libsession_util_nodejs' `MultiEncryptWrapperNode`.
 *
 *  - 1:1 and sync messages: the official WASM build has the exact same functions, used as is.
 *  - Closed groups (03): the WASM exposes the encryption layer (`encryptForGroup`), the envelope
 *    that wraps the content is built / parsed here, like libsession does.
 *  - Communities: the WASM build doesn't implement them yet (`decrypt_for_community_not_implemented`),
 *    so they are done here (padding, optional envelope).
 *
 * Not implemented: Session Pro signatures. Messages are sent without a Pro signature (a decoy one
 * is attached to envelopes so that they look like any other message) and received Pro metadata is
 * not verified, i.e. `decodedPro` is `null` for groups / communities.
 */
import sodium from 'libsodium-wrappers-sumo';
import { SessionProtos } from '../../ts/protobuf/compiled';

type Wasm = any;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function toHex(bytes: Uint8Array | null | undefined): string {
  if (!bytes) {
    return '';
  }
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i]];
  }
  return out;
}

export function fromHex(hex: string | null | undefined): Uint8Array {
  if (!hex) {
    return new Uint8Array();
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** `COMMUNITY_OR_1O1_MSG_PADDING` in libsession */
const MSG_PADDING = 160;
const PADDING_TERMINATING_BYTE = 0x80;

export function padMessage(payload: Uint8Array): Uint8Array {
  let size = payload.length + 1;
  size += MSG_PADDING - (size % MSG_PADDING);
  const out = new Uint8Array(size);
  out.set(payload);
  out[payload.length] = PADDING_TERMINATING_BYTE;
  return out;
}

export function unpadMessage(payload: Uint8Array): Uint8Array {
  let size = payload.length;
  while (size) {
    const ch = payload[size - 1];
    if (ch !== 0 && ch !== PADDING_TERMINATING_BYTE) {
      break;
    }
    size--;
    if (ch === PADDING_TERMINATING_BYTE) {
      break;
    }
  }
  return payload.subarray(0, size);
}

function assertLength(value: string | Uint8Array | null | undefined, len: number, what: string) {
  if (!value || value.length !== len) {
    throw new Error(`${what}: expected a length of ${len}, got ${value?.length}`);
  }
}

/** A validly encoded ed25519 signature which verifies against nothing (see encode_for_destination) */
function decoySignature(): Uint8Array {
  const sig = new Uint8Array(64);
  const r = sodium.crypto_core_ed25519_scalar_random();
  sig.set(sodium.crypto_scalarmult_ed25519_base_noclamp(r), 0);
  sig.set(sodium.crypto_core_ed25519_scalar_random(), 32);
  return sig;
}

type ProKey = string | null | undefined;

function proSignature(content: Uint8Array, proRotatingEd25519PrivKey: ProKey): Uint8Array {
  if (!proRotatingEd25519PrivKey) {
    return decoySignature();
  }
  const key = fromHex(proRotatingEd25519PrivKey);
  const sk = key.length === 32 ? sodium.crypto_sign_seed_keypair(key).privateKey : key;
  assertLength(sk, 64, 'proRotatingEd25519PrivKey');
  return sodium.crypto_sign_detached(content, sk);
}

function toDecodedPro(pro: any) {
  if (!pro) {
    return null;
  }
  return {
    proStatus: pro.status === 'Invalid' || pro.proStatus === 'Invalid' ? 'Invalid' : 'ValidOrExpired',
    proProof: pro.proof ?? pro.proProof ?? null,
    proProfileBitset: BigInt(pro.profileBitset ?? pro.proProfileBitset ?? 0),
    proMessageBitset: BigInt(pro.msgBitset ?? pro.proMessageBitset ?? 0),
  };
}

export function makeMessageCrypto(w: () => Wasm) {
  const sessionIdFromEdPubkey = (edPubkeyHex: string) =>
    `05${w().SessionCryptoPrimitivesW.cryptoSignEd25519PkToCurve25519(edPubkeyHex)}`;

  /** The group ed25519 pubkey is given as `03...` (66 chars), libsession-wasm wants it without the prefix */
  const groupPkNoPrefix = (hex: string) => (hex.length === 66 ? hex.slice(2) : hex);

  // ------------------------------------------------------------------------------------------
  // ENCRYPT
  // ------------------------------------------------------------------------------------------
  function encryptFor1o1(
    items: Array<{
      plaintext: Uint8Array;
      sentTimestampMs: number;
      senderEd25519Seed: Uint8Array;
      recipientPubkey: string;
      proRotatingEd25519PrivKey: ProKey;
    }>
  ) {
    if (!items.length) {
      throw new Error('encryptFor1o1 received empty');
    }
    return {
      encryptedData: items.map(item => {
        assertLength(item.senderEd25519Seed, 32, 'encryptFor1o1.senderEd25519Seed');
        assertLength(item.recipientPubkey, 66, 'encryptFor1o1.recipientPubkey');
        const hex = w().SessionMessageW.encodeFor1o1(
          toHex(item.plaintext),
          toHex(item.senderEd25519Seed),
          item.sentTimestampMs,
          item.recipientPubkey,
          item.proRotatingEd25519PrivKey || ''
        );
        return fromHex(hex);
      }),
    };
  }

  function encryptForGroup(
    items: Array<{
      plaintext: Uint8Array;
      senderEd25519Seed: Uint8Array;
      sentTimestampMs: number;
      groupEd25519Pubkey: string;
      groupEncKey: string;
      proRotatingEd25519PrivKey: ProKey;
    }>
  ) {
    if (!items.length) {
      throw new Error('encryptForGroup received empty');
    }
    return {
      encryptedData: items.map(item => {
        assertLength(item.senderEd25519Seed, 32, 'encryptForGroup.senderEd25519Seed');
        assertLength(item.groupEd25519Pubkey, 66, 'encryptForGroup.groupEd25519Pubkey');
        assertLength(item.groupEncKey, 64, 'encryptForGroup.groupEncKey');
        if (!item.groupEd25519Pubkey.startsWith('03')) {
          throw new Error(
            'Unsupported configuration, encrypting for a legacy group (0x05 prefix) is no longer supported'
          );
        }

        // the content is not encrypted on its own in groups: the whole envelope is
        const envelope = SessionProtos.Envelope.encode({
          type: SessionProtos.Envelope.Type.CLOSED_GROUP_MESSAGE,
          timestamp: item.sentTimestampMs,
          content: item.plaintext,
          proSig: proSignature(item.plaintext, item.proRotatingEd25519PrivKey),
        }).finish();

        const hex = w().MultiEncryptW.encryptForGroup(
          toHex(item.senderEd25519Seed),
          groupPkNoPrefix(item.groupEd25519Pubkey),
          item.groupEncKey,
          toHex(envelope)
        );
        if (!hex) {
          throw new Error('encryptForGroup failed');
        }
        return fromHex(hex);
      }),
    };
  }

  function encryptForCommunity(
    items: Array<{ plaintext: Uint8Array; proRotatingEd25519PrivKey: ProKey }>
  ) {
    if (!items.length) {
      throw new Error('encryptForCommunity received empty');
    }
    return {
      encryptedData: items.map(item => {
        if (item.proRotatingEd25519PrivKey) {
          throw new Error('Session Pro messages in communities are not available on the web yet');
        }
        return padMessage(item.plaintext);
      }),
    };
  }

  function encryptForCommunityInbox(
    items: Array<{
      plaintext: Uint8Array;
      senderEd25519Seed: Uint8Array;
      recipientPubkey: string;
      communityPubkey: string;
      proRotatingEd25519PrivKey: ProKey;
    }>
  ) {
    if (!items.length) {
      throw new Error('encryptForCommunityInbox received empty');
    }
    return {
      encryptedData: items.map(item => {
        assertLength(item.senderEd25519Seed, 32, 'encryptForCommunityInbox.senderEd25519Seed');
        assertLength(item.recipientPubkey, 66, 'encryptForCommunityInbox.recipientPubkey');
        assertLength(item.communityPubkey, 64, 'encryptForCommunityInbox.communityPubkey');
        if (item.proRotatingEd25519PrivKey) {
          throw new Error('Session Pro messages in communities are not available on the web yet');
        }
        const hex = w().MultiEncryptW.encryptForCommunityInbox(
          toHex(item.senderEd25519Seed),
          item.communityPubkey,
          item.recipientPubkey,
          toHex(padMessage(item.plaintext))
        );
        if (!hex) {
          throw new Error('encryptForCommunityInbox failed');
        }
        return fromHex(hex);
      }),
    };
  }

  // ------------------------------------------------------------------------------------------
  // DECRYPT
  // ------------------------------------------------------------------------------------------
  function decryptFor1o1(
    items: Array<{ envelopePayload: Uint8Array; messageHash: string }>,
    opts: { proBackendPubkeyHex: string; ed25519PrivateKeyHex: string }
  ) {
    assertLength(opts.proBackendPubkeyHex, 64, 'decryptFor1o1.proBackendPubkeyHex');
    assertLength(opts.ed25519PrivateKeyHex, 64, 'decryptFor1o1.ed25519PrivateKeyHex');
    const out: Array<any> = [];
    items.forEach((item, index) => {
      try {
        const decoded = JSON.parse(
          w().SessionMessageW.decodeEnvelope1o1(
            toHex(item.envelopePayload),
            opts.ed25519PrivateKeyHex,
            opts.proBackendPubkeyHex
          )
        );
        out.push({
          decodedEnvelope: {
            envelope: { timestampMs: decoded.timestampMs, source: null },
            contentPlaintextUnpadded: fromHex(decoded.contentPlaintextHex),
            sessionId: `05${decoded.senderX25519PubkeyHex}`,
            decodedPro: toDecodedPro(decoded.pro),
          },
          messageHash: item.messageHash,
        });
      } catch (e) {
        console.warn(`decryptFor1o1: Failed to decrypt message at index ${index}:`, e);
      }
    });
    return out;
  }

  function decryptForGroup(
    items: Array<{ envelopePayload: Uint8Array; messageHash: string }>,
    opts: { proBackendPubkeyHex: string; ed25519GroupPubkeyHex: string; groupEncKeys: Array<Uint8Array> }
  ) {
    assertLength(opts.proBackendPubkeyHex, 64, 'decryptForGroup.proBackendPubkeyHex');
    assertLength(opts.ed25519GroupPubkeyHex, 66, 'decryptForGroup.ed25519GroupPubkeyHex');
    opts.groupEncKeys.forEach(k => assertLength(k, 32, 'decryptForGroup.groupEncKey'));

    const keys = new (w().StringVector)();
    opts.groupEncKeys.forEach(k => keys.push_back(toHex(k)));
    const out: Array<any> = [];
    try {
      items.forEach((item, index) => {
        try {
          const res: string = w().MultiEncryptW.decryptForGroup(
            keys,
            groupPkNoPrefix(opts.ed25519GroupPubkeyHex),
            toHex(item.envelopePayload)
          );
          if (!res) {
            throw new Error('could not decrypt with any of the group keys');
          }
          const [envelopeHex, senderSessionId] = res.split('|');
          if (!senderSessionId || senderSessionId.length !== 66) {
            throw new Error(`extracted session ID was wrong size: ${senderSessionId?.length}`);
          }
          const envelope = SessionProtos.Envelope.decode(fromHex(envelopeHex));
          if (!envelope.content) {
            throw new Error('Parse decrypted message failed, missing content');
          }
          const content = new Uint8Array(envelope.content);
          // the content has to be a valid Content protobuf
          SessionProtos.Content.decode(content);

          out.push({
            decodedEnvelope: {
              envelope: {
                timestampMs: Number(envelope.timestamp),
                source: envelope.source || null,
              },
              contentPlaintextUnpadded: content,
              sessionId: senderSessionId,
              decodedPro: null,
            },
            messageHash: item.messageHash,
          });
        } catch (e) {
          console.warn(`decryptForGroup: Failed to decrypt message at index ${index}:`, e);
        }
      });
    } finally {
      keys.delete();
    }
    return out;
  }

  function decryptForCommunity(
    items: Array<{ contentOrEnvelope: Uint8Array; serverId: number }>,
    _opts: { nowMs: number; proBackendPubkeyHex: string }
  ) {
    const out: Array<any> = [];
    items.forEach((item, index) => {
      try {
        let contentPlaintext: Uint8Array = item.contentOrEnvelope;
        let envelopeOut: { timestampMs: number; source: string | null } | null = null;

        // Communities may send a plain (padded) `Content`, or an `Envelope` holding one
        try {
          const envelope = SessionProtos.Envelope.decode(item.contentOrEnvelope);
          contentPlaintext = new Uint8Array(envelope.content || []);
          envelopeOut = {
            timestampMs: Number(envelope.timestamp),
            source: envelope.source || null,
          };
        } catch (_e) {
          /* not an envelope */
        }

        // the content has to be a valid Content protobuf once unpadded
        const unpadded = unpadMessage(contentPlaintext);
        SessionProtos.Content.decode(unpadded);

        out.push({
          envelope: envelopeOut,
          contentPlaintextUnpadded: unpadded,
          serverId: item.serverId,
          decodedPro: null,
        });
      } catch (e) {
        console.warn(`decryptForCommunity: Failed to decrypt message at index ${index}:`, e);
      }
    });
    return out;
  }

  return {
    encryptFor1o1,
    encryptForGroup,
    encryptForCommunity,
    encryptForCommunityInbox,
    decryptFor1o1,
    decryptForGroup,
    decryptForCommunity,
    sessionIdFromEdPubkey,
  };
}
