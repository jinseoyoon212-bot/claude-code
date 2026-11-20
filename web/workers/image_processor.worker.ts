/**
 * Browser image processor worker. Same actions and rules as the desktop worker
 * (ts/webworker/workers/node/image_processor/image_processor.worker.ts, which uses `sharp`), built
 * on `createImageBitmap` + `OffscreenCanvas`.
 *
 * Differences with sharp, caused by what browsers can do:
 *  - the canvas can only encode STATIC images. Animated sources (GIF / animated WebP) are kept
 *    as they are when they cannot be converted (like the desktop worker does when its animated
 *    conversion fails), and a static first-frame fallback is generated for avatars.
 *  - encoders available depend on the browser: WebP encoding isn't supported by Firefox / Safari, in
 *    which case the output is labelled with the format that was really produced.
 *  - EXIF orientation is applied by `createImageBitmap` itself.
 */
import {
  type ImageFormat,
  isAnimatedImage,
  planCoverResize,
  sniffFormat,
} from './imageFormat';

const WEBP_QUALITY = 0.8;
const MAX_AVATAR_PLAN_REUPLOAD_PX = 600;
const MAX_AVATAR_NO_REUPLOAD_PX = 200;

const ctx: any = globalThis;

type Decoded = { bitmap: ImageBitmap; format: ImageFormat; animated: boolean; bytes: Uint8Array };

function toBytes(input: ArrayBufferLike): Uint8Array {
  return new Uint8Array(input as ArrayBuffer);
}

async function decode(input: ArrayBufferLike): Promise<Decoded | null> {
  const bytes = toBytes(input);
  const format = sniffFormat(bytes);
  if (format === 'unknown') {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]), {
      imageOrientation: 'from-image',
    });
    return { bitmap, format, animated: isAnimatedImage(format, bytes), bytes };
  } catch (e) {
    return null;
  }
}

type Encoded = { buffer: ArrayBuffer; format: 'webp' | 'jpeg' | 'png'; width: number; height: number };

async function renderCover(
  bitmap: ImageBitmap,
  side: number,
  withoutEnlargement: boolean
): Promise<OffscreenCanvas> {
  const plan = planCoverResize(bitmap.width, bitmap.height, side, withoutEnlargement);
  const canvas = new OffscreenCanvas(plan.cropW, plan.cropH);
  const c = canvas.getContext('2d')!;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(
    bitmap,
    (plan.cropW - plan.outW) / 2,
    (plan.cropH - plan.outH) / 2,
    plan.outW,
    plan.outH
  );
  return canvas;
}

async function encode(
  canvas: OffscreenCanvas,
  type: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<Encoded> {
  const blob = await canvas.convertToBlob({ type, quality });
  const produced =
    blob.type === 'image/webp' ? 'webp' : blob.type === 'image/jpeg' ? 'jpeg' : ('png' as const);
  return {
    buffer: await blob.arrayBuffer(),
    format: produced,
    width: canvas.width,
    height: canvas.height,
  };
}

const encodeWebp = (canvas: OffscreenCanvas, quality = WEBP_QUALITY) =>
  encode(canvas, 'image/webp', quality);

function asStatic(e: Encoded) {
  return {
    outputBuffer: e.buffer,
    height: e.height,
    width: e.width,
    format: e.format as 'webp',
    contentType: `image/${e.format}` as 'image/webp',
    size: e.buffer.byteLength,
  };
}

function asSourceOutput(d: Decoded, buffer: ArrayBufferLike = d.bytes.buffer) {
  return {
    outputBuffer: buffer,
    height: d.bitmap.height,
    width: d.bitmap.width,
    format: d.format as any,
    isAnimated: d.animated,
    size: buffer.byteLength,
  };
}

async function firstFrameFallback(d: Decoded) {
  const canvas = await renderCover(d.bitmap, MAX_AVATAR_NO_REUPLOAD_PX, true);
  return asStatic(await encodeWebp(canvas));
}

async function processAvatar(input: ArrayBufferLike, planForReupload: boolean, remoteChange: boolean) {
  const d = await decode(input);
  if (!d) {
    return null;
  }
  if (d.animated && d.format !== 'webp' && d.format !== 'gif') {
    throw new Error('processAvatarData: we only support animated images in webp or gif');
  }
  const side = planForReupload
    ? remoteChange
      ? MAX_AVATAR_PLAN_REUPLOAD_PX + 1
      : MAX_AVATAR_PLAN_REUPLOAD_PX
    : MAX_AVATAR_NO_REUPLOAD_PX;

  const fits = d.bitmap.width <= side && d.bitmap.height <= side;
  const isSourceGif = d.format === 'gif';

  // already a webp of the right size: use it as is
  if (fits && d.format === 'webp') {
    return {
      mainAvatarDetails: {
        outputBuffer: d.bytes.buffer,
        height: d.bitmap.height,
        width: d.bitmap.width,
        isAnimated: d.animated,
        format: 'webp' as const,
        contentType: 'image/webp' as const,
        size: d.bytes.byteLength,
      },
      avatarFallback: d.animated ? await firstFrameFallback(d) : null,
    };
  }

  // an animated image can't be re-encoded in a canvas
  if (d.animated) {
    if (planForReupload) {
      // keep the original, like the desktop worker does when its animated conversion fails
      return {
        mainAvatarDetails: {
          outputBuffer: d.bytes.buffer,
          height: d.bitmap.height,
          width: d.bitmap.width,
          isAnimated: true,
          format: (isSourceGif ? 'gif' : 'webp') as 'gif',
          contentType: (isSourceGif ? 'image/gif' : 'image/webp') as 'image/gif',
          size: d.bytes.byteLength,
        },
        avatarFallback: await firstFrameFallback(d),
      };
    }
    // no reupload planned: only a static (first frame) avatar fits the requirements
    const still = await firstFrameFallback(d);
    return { mainAvatarDetails: { ...still, isAnimated: false }, avatarFallback: null };
  }

  const canvas = await renderCover(d.bitmap, side, true);
  const encoded = await encodeWebp(canvas);
  return {
    mainAvatarDetails: { ...asStatic(encoded), isAnimated: false },
    avatarFallback: null,
  };
}

const workerActions = {
  imageMetadata: async (input: ArrayBufferLike) => {
    if (!input?.byteLength) {
      throw new Error('imageMetadata: inputBuffer is required');
    }
    const d = await decode(input);
    if (!d) {
      return null;
    }
    return {
      size: d.bytes.byteLength,
      format: d.format,
      width: d.bitmap.width,
      height: d.bitmap.height,
      isAnimated: d.animated,
    };
  },

  processAvatarData: async (input: ArrayBufferLike, planForReupload: boolean, remoteChange: boolean) => {
    if (!input?.byteLength) {
      throw new Error('processAvatarData: inputBuffer is required');
    }
    return processAvatar(input, planForReupload, remoteChange);
  },

  processForLinkPreviewThumbnail: async (input: ArrayBufferLike, maxSidePx: number) => {
    if (!input?.byteLength) {
      throw new Error('processForLinkPreviewThumbnail: inputBuffer is required');
    }
    const d = await decode(input);
    if (!d) {
      return null;
    }
    // static output, may enlarge
    return asStatic(await encodeWebp(await renderCover(d.bitmap, maxSidePx, false)));
  },

  processForInConversationThumbnail: async (input: ArrayBufferLike, maxSidePx: number) => {
    if (!input?.byteLength) {
      throw new Error('processForInConversationThumbnail: inputBuffer is required');
    }
    const d = await decode(input);
    if (!d) {
      return null;
    }
    const encoded = await encodeWebp(await renderCover(d.bitmap, maxSidePx, false));
    return { ...asStatic(encoded), isAnimated: false };
  },

  processForFileServerUpload: async (
    input: ArrayBufferLike,
    maxSidePx: number,
    maxSizeBytes: number
  ) => {
    if (!input?.byteLength) {
      throw new Error('processForFileServerUpload: inputBuffer is required');
    }
    const d = await decode(input);
    if (!d || !['jpeg', 'png', 'webp', 'gif', 'avif'].includes(d.format)) {
      return null;
    }
    const lossy = d.format === 'jpeg' || d.format === 'webp' || d.format === 'avif';
    const fits =
      input.byteLength < maxSizeBytes && d.bitmap.width <= maxSidePx && d.bitmap.height <= maxSidePx;

    if (!lossy) {
      // lossless formats are never re-encoded: they either fit or are refused
      return input.byteLength >= maxSizeBytes ? null : asSourceOutput(d, input);
    }
    if (fits) {
      return asSourceOutput(d, input);
    }
    if (d.animated) {
      // animated + doesn't fit: the canvas cannot re-encode animations
      return null;
    }

    // scale down (never up) to fit inside maxSidePx
    const scale = Math.min(1, maxSidePx / Math.max(d.bitmap.width, d.bitmap.height));
    const w = Math.max(1, Math.round(d.bitmap.width * scale));
    const h = Math.max(1, Math.round(d.bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const c = canvas.getContext('2d')!;
    c.imageSmoothingQuality = 'high';
    c.drawImage(d.bitmap, 0, 0, w, h);

    const type = d.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    for (const quality of [0.95, 0.85, 0.75, 0.55, 0.3]) {
      const e = await encode(canvas, type, quality);
      if (e.buffer.byteLength < maxSizeBytes) {
        return {
          format: e.format as any,
          outputBuffer: e.buffer,
          size: e.buffer.byteLength,
          width: e.width,
          height: e.height,
          isAnimated: false,
        };
      }
    }
    return null;
  },

  testIntegrationFakeAvatar: async (
    maxSidePx: number,
    background: { r: number; g: number; b: number }
  ) => {
    const canvas = new OffscreenCanvas(maxSidePx, maxSidePx);
    const c = canvas.getContext('2d')!;
    c.fillStyle = `rgb(${background.r}, ${background.g}, ${background.b})`;
    c.fillRect(0, 0, maxSidePx, maxSidePx);
    return { ...asStatic(await encodeWebp(canvas)), isAnimated: false };
  },
};

function prepareErrorForPostMessage(error: any) {
  if (!error) {
    return null;
  }
  return error.stack || error.message || String(error);
}

ctx.onmessage = async (e: MessageEvent) => {
  const [jobId, fnName, ...args] = e.data;
  try {
    const fn = (workerActions as any)[fnName];
    if (!fn) {
      throw new Error(`Worker: job ${jobId} did not find function ${fnName}`);
    }
    const result = await fn(...args);
    // the buffers produced are ours, hand them over instead of copying
    const transfer: Array<Transferable> = [];
    const collect = (v: any) => {
      if (v?.outputBuffer instanceof ArrayBuffer && v.outputBuffer !== args[0]) {
        transfer.push(v.outputBuffer);
      }
    };
    collect(result);
    collect(result?.mainAvatarDetails);
    collect(result?.avatarFallback);
    ctx.postMessage([jobId, null, result], transfer);
  } catch (error) {
    ctx.postMessage([jobId, prepareErrorForPostMessage(error)]);
  }
};
