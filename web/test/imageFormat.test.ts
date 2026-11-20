/** Tests for web/workers/imageFormat.ts. Run with: pnpm test:web */
import assert from 'node:assert/strict';
import { isAnimatedImage, planCoverResize, sniffFormat } from '../workers/imageFormat';

const bytes = (...parts: Array<string | Array<number>>) =>
  Uint8Array.from(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)));

/** A GIF with `n` frames of 1x1 pixels (no color tables) */
function gif(n: number) {
  const frame = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0, /* image descriptor */ 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, /* lzw */ 2, 2, 0x44, 0x01, 0];
  return bytes('GIF89a', [1, 0, 1, 0, 0x00, 0, 0], ...Array.from({ length: n }, () => frame), [0x3b]);
}

export function runImageFormatTests() {
  let passed = 0;
  const test = (name: string, fn: () => void) => {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  };

  test('sniffs formats from magic bytes', () => {
    assert.equal(sniffFormat(bytes([0xff, 0xd8, 0xff, 0xe0, 0])), 'jpeg');
    assert.equal(sniffFormat(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])), 'png');
    assert.equal(sniffFormat(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')), 'webp');
    assert.equal(sniffFormat(gif(1)), 'gif');
    assert.equal(sniffFormat(bytes([0, 0, 0, 0x1c], 'ftypavif')), 'avif');
    assert.equal(sniffFormat(bytes('not an image at all')), 'unknown');
    assert.equal(sniffFormat(new Uint8Array()), 'unknown');
  });

  test('gif: counts frames', () => {
    assert.equal(isAnimatedImage('gif', gif(1)), false);
    assert.equal(isAnimatedImage('gif', gif(2)), true);
    assert.equal(isAnimatedImage('gif', gif(5)), true);
  });

  test('webp: animation flag of the VP8X chunk', () => {
    const vp8x = (flags: number) => bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0, flags, 0, 0, 0]);
    assert.equal(isAnimatedImage('webp', vp8x(0x02)), true);
    assert.equal(isAnimatedImage('webp', vp8x(0x10)), false);
    assert.equal(isAnimatedImage('webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ', [0, 0, 0, 0])), false);
  });

  test('png: acTL chunk marks an APNG', () => {
    const chunk = (type: string, len = 0) => [0, 0, 0, len, ...[...type].map(c => c.charCodeAt(0)), ...new Array(len + 4).fill(0)];
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    assert.equal(isAnimatedImage('png', bytes(sig, chunk('IHDR', 13), chunk('acTL', 8), chunk('IDAT'))), true);
    assert.equal(isAnimatedImage('png', bytes(sig, chunk('IHDR', 13), chunk('IDAT'), chunk('IEND'))), false);
  });

  test('cover resize matches sharp: scale + center crop, no enlargement when asked', () => {
    // 1000x500 -> 200x200 cover: scale 0.4 => 400x200 cropped to 200x200
    assert.deepEqual(planCoverResize(1000, 500, 200, true), { scale: 0.4, outW: 400, outH: 200, cropW: 200, cropH: 200 });
    // smaller than the target and withoutEnlargement: untouched, not even cropped
    assert.deepEqual(planCoverResize(150, 100, 200, true), { scale: 1, outW: 150, outH: 100, cropW: 150, cropH: 100 });
    // thumbnails may be enlarged
    assert.deepEqual(planCoverResize(100, 50, 200, false), { scale: 4, outW: 400, outH: 200, cropW: 200, cropH: 200 });
  });

  return passed;
}
