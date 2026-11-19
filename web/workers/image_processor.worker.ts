/**
 * Web placeholder for the image processor worker.
 *
 * Upstream uses `sharp` (native libvips) here. A browser version based on OffscreenCanvas /
 * createImageBitmap is on the roadmap (web/README.md); until then every call fails cleanly so the
 * UI can show its normal "could not process image" error.
 */
const ctx: any = globalThis;

ctx.onmessage = (e: MessageEvent) => {
  const [jobId, fnName] = e.data;
  ctx.postMessage([jobId, `Image processing (${fnName}) is not available in the web version yet`]);
};
