/**
 * Image format sniffing, shared by the image processor worker and its tests.
 *
 * Reproduces what sharp's `metadata()` reports that the app relies on: `format` and whether the
 * image is animated (`pages > 1`). Dimensions come from the browser's decoder, not from here.
 */

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'bmp' | 'unknown';

const ascii = (b: Uint8Array, start: number, text: string) =>
  text.split('').every((ch, i) => b[start + i] === ch.charCodeAt(0));

export function sniffFormat(b: Uint8Array): ImageFormat {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'jpeg';
  }
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a) {
    return 'png';
  }
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) {
    return 'webp';
  }
  if (b.length >= 6 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) {
    return 'gif';
  }
  if (b.length >= 12 && ascii(b, 4, 'ftyp') && (ascii(b, 8, 'avif') || ascii(b, 8, 'avis'))) {
    return 'avif';
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return 'bmp';
  }
  return 'unknown';
}

/** Number of frames of a GIF (counts the image descriptors, walking the block structure). */
function gifFrameCount(b: Uint8Array): number {
  if (b.length < 13) {
    return 0;
  }
  let pos = 13;
  const flags = b[10];
  if (flags & 0x80) {
    pos += 3 * (1 << ((flags & 0x07) + 1)); // global color table
  }
  let frames = 0;
  const skipSubBlocks = () => {
    while (pos < b.length && b[pos] !== 0) {
      pos += b[pos] + 1;
    }
    pos += 1; // block terminator
  };
  while (pos < b.length) {
    const marker = b[pos++];
    if (marker === 0x3b) {
      break; // trailer
    }
    if (marker === 0x21) {
      pos += 1; // extension label
      skipSubBlocks();
    } else if (marker === 0x2c) {
      frames++;
      if (frames > 1) {
        return frames;
      }
      pos += 8; // left, top, width, height
      const localFlags = b[pos++];
      if (localFlags & 0x80) {
        pos += 3 * (1 << ((localFlags & 0x07) + 1)); // local color table
      }
      pos += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      break; // corrupt
    }
  }
  return frames;
}

/** An animated WebP has the "animation" flag in its VP8X chunk. */
function webpIsAnimated(b: Uint8Array): boolean {
  return b.length >= 21 && ascii(b, 12, 'VP8X') && (b[20] & 0x02) !== 0;
}

/** An APNG has an `acTL` chunk before its first `IDAT`. */
function pngIsAnimated(b: Uint8Array): boolean {
  let pos = 8;
  while (pos + 8 <= b.length) {
    const len = (b[pos] << 24) | (b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3];
    if (ascii(b, pos + 4, 'acTL')) {
      return true;
    }
    if (ascii(b, pos + 4, 'IDAT')) {
      return false;
    }
    pos += 12 + (len >>> 0);
  }
  return false;
}

export function isAnimatedImage(format: ImageFormat, b: Uint8Array): boolean {
  switch (format) {
    case 'gif':
      return gifFrameCount(b) > 1;
    case 'webp':
      return webpIsAnimated(b);
    case 'png':
      return pngIsAnimated(b);
    default:
      return false;
  }
}

export type CoverPlan = { scale: number; outW: number; outH: number; cropW: number; cropH: number };

/**
 * sharp's `resize({ width: side, height: side, fit: 'cover', withoutEnlargement })`:
 * the image is scaled to cover the side x side square, then cropped around its center.
 * With `withoutEnlargement`, nothing at all happens when covering would require enlarging.
 */
export function planCoverResize(
  width: number,
  height: number,
  side: number,
  withoutEnlargement: boolean
): CoverPlan {
  const scale = Math.max(side / width, side / height);
  if (withoutEnlargement && scale > 1) {
    return { scale: 1, outW: width, outH: height, cropW: width, cropH: height };
  }
  return {
    scale,
    outW: Math.round(width * scale),
    outH: Math.round(height * scale),
    cropW: side,
    cropH: side,
  };
}
