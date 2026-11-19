// `abort-controller` polyfill package -> the browser's native implementation
export const { AbortController, AbortSignal } = globalThis as any;
export default AbortController;
