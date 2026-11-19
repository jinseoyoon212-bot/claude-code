/**
 * `libsession_util_nodejs` for the libsession web worker, implemented on top of the official
 * libsession WASM build (@session-foundation/libsession-wasm).
 */
export { CONSTANTS } from './constants';

export const libsessionReady: Promise<void> = Promise.resolve();
