/**
 * What the renderer (page) sees when it imports `libsession_util_nodejs`.
 *
 * In the desktop app, the renderer only uses the module for types and for `CONSTANTS`: every real
 * libsession call goes through the libsession web worker (see web/libsession/index.ts).
 */
export { CONSTANTS } from './constants';
