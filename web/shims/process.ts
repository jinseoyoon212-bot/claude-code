/**
 * `process` global for the browser build. Reports `linux` so the UI uses its default
 * (non-macOS, non-Windows) layout.
 */
import processBrowser from 'process/browser';
import { Buffer } from 'buffer';

// lodash's isBuffer() looks for `globalThis.Buffer` (webpack's ProvidePlugin only injects a variable
// into the modules that mention it), and without it isBuffer() is always false: the app then
// rejects the files it reads back ("'bufferIn' must be a buffer").
if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}

const proc: any = processBrowser;
proc.platform = 'linux';
proc.arch = 'wasm';
proc.env = proc.env || {};
proc.versions = { ...(proc.versions || {}), node: 'web' };
proc.type = 'renderer';
proc.resourcesPath = '/';

export default proc;
