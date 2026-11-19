/**
 * `process` global for the browser build. Reports `linux` so the UI uses its default
 * (non-macOS, non-Windows) layout.
 */
import processBrowser from 'process/browser';

const proc: any = processBrowser;
proc.platform = 'linux';
proc.arch = 'wasm';
proc.env = proc.env || {};
proc.versions = { ...(proc.versions || {}), node: 'web' };
proc.type = 'renderer';
proc.resourcesPath = '/';

export default proc;
