// Web entry for the libsession worker. `libsession_util_nodejs` is aliased to the WASM adapter
// (web/libsession/index.ts) by web/webpack.config.js, everything else is upstream code.
import { libsessionReady } from '../libsession';

// Queue messages until the WASM module is loaded, then hand them to the upstream worker.
const queued: Array<MessageEvent> = [];
(globalThis as any).onmessage = (e: MessageEvent) => queued.push(e);

void libsessionReady.then(async () => {
  await import('../../ts/webworker/workers/node/libsession/libsession.worker');
  const handler = (globalThis as any).onmessage;
  queued.splice(0).forEach(e => handler(e));
});
