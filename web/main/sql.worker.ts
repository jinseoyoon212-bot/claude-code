/**
 * The web equivalent of the SQL half of Electron's main process.
 *
 * Runs the unmodified `ts/node/sql.ts` (sqlNode) inside a dedicated worker, backed by SQLite WASM
 * (see web/shims/sqlcipher.ts). The page talks to it through web/shims/electron.ts, which forwards
 * the `sql-channel` IPC messages here, exactly like `ts/node/sql_channel.ts` does in Electron.
 *
 * Protocol:
 *  page -> worker: { type: 'init', key } | { type: 'call', jobId, callName, args } | { type: 'erase' }
 *  worker -> page: { type: 'init-done', error? } | { type: 'call-done', jobId, error, result }
 */
import sodium from 'libsodium-wrappers-sumo';
import { initSqliteWasm, wipeSqliteStorage } from '../shims/sqlcipher';
import { sqlNode } from '../../ts/node/sql';

const ctx: any = globalThis;

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      try {
        await sodium.ready;
        await initSqliteWasm();
        await sqlNode.initializeSql({ configDir: '/', key: msg.key, passwordAttempt: false });
        ctx.postMessage({ type: 'init-done' });
      } catch (err) {
        console.error('sql worker: init failed', err);
        ctx.postMessage({ type: 'init-done', error: String(err?.stack || err) });
      }
      return;
    }
    case 'call': {
      const { jobId, callName, args } = msg;
      try {
        const fn = (sqlNode as any)[callName];
        if (!fn) {
          throw new Error(`sql channel: ${callName} is not an available function`);
        }
        const result = await fn(...args);
        ctx.postMessage({ type: 'call-done', jobId, error: null, result });
      } catch (error) {
        const errorForDisplay = error && error.stack ? error.stack : String(error);
        console.log(`sql channel error with call ${callName}: ${errorForDisplay}`);
        ctx.postMessage({ type: 'call-done', jobId, error: errorForDisplay });
      }
      return;
    }
    case 'erase': {
      try {
        try {
          sqlNode.close();
        } catch (_e) {
          /* already closed */
        }
        wipeSqliteStorage();
        ctx.postMessage({ type: 'erase-done' });
      } catch (error) {
        ctx.postMessage({ type: 'erase-done', error: String(error) });
      }
      return;
    }
    default:
      console.warn('sql worker: unknown message', msg);
  }
};
