/**
 * Entry point of the web build. Replaces what Electron's main process (ts/mains/main_node.ts) does
 * before it opens the main window, then runs the regular preload + renderer.
 *
 *   1. load the persisted virtual file system (attachments, avatars)
 *   2. install the in-page IPC "main process" handlers + the locale
 *   3. start the SQL worker and open/migrate the database
 *   4. run web/preload.ts (port of preload.js) and ts/mains/main_renderer.tsx (unchanged)
 */
import '../stylesheets/manifest.scss';
import './styles/google-sans.scss';
import './styles/nanum-square-neo.scss';
import './styles/liquid-glass.scss';
import './styles/layout.scss';
import './styles/popups.scss';
import './styles/light-theme.scss';
import { ipcRenderer } from 'electron';
import { initWebFs } from 'fs';
import { getDefaultSQLKey, initLocale, makeMainHandlers } from './main/ipcMainHandlers';
import { showFatalError } from './fatalError';
import { startLogCapture } from './main/logCapture';
import { startSendMotion } from './styles/sendMotion';
import { startLayoutControls } from './styles/layoutControls';
import { startComposerSend } from './styles/composerSend';

startLogCapture();
startSendMotion();
startLayoutControls();
startComposerSend();

async function startSqlWorker() {
  const worker = new Worker(new URL('./main/sql.worker.ts', import.meta.url));
  (ipcRenderer as any)._setSqlWorker(worker);

  await new Promise<void>((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'init-done') {
        return;
      }
      worker.removeEventListener('message', onMessage);
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve();
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'init', key: getDefaultSQLKey() });
  });
}

async function boot() {
  await initWebFs();
  (ipcRenderer as any)._setMainHandlers(makeMainHandlers());
  initLocale();
  await startSqlWorker();

  await import('./preload');
  await import('../ts/mains/main_renderer');
}

boot().catch(e => {
  console.error('Session Web failed to start', e);
  showFatalError(e);
});
