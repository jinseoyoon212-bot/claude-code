/**
 * Browser `crypto` (Node) replacement, limited to what the renderer uses:
 *  - randomBytes(n)            attachment file names
 *  - createHash('sha256'|'sha512')   hashing of strings / the (unsupported on web) db password
 * Hashes are synchronous in the app, so they use libsodium (ready long before they are needed).
 */
import sodium from 'libsodium-wrappers-sumo';
import { Buffer } from 'buffer';

export function randomBytes(size: number) {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));
}

class Hash {
  private chunks: Array<Uint8Array> = [];

  constructor(private readonly algorithm: 'sha256' | 'sha512') {}

  update(data: string | Uint8Array, _encoding?: string) {
    this.chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }

  digest(encoding?: 'hex' | 'base64') {
    const all = Buffer.concat(this.chunks);
    const bytes =
      this.algorithm === 'sha512' ? sodium.crypto_hash_sha512(all) : sodium.crypto_hash_sha256(all);
    const buffer = Buffer.from(bytes);
    return encoding ? buffer.toString(encoding) : buffer;
  }
}

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256' && algorithm !== 'sha512') {
    throw new Error(`createHash: ${algorithm} is not supported in the web version`);
  }
  return new Hash(algorithm);
}

export default { randomBytes, createHash };
