/**
 * In-page emulation of the IPC handlers that `ts/mains/main_node.ts` registers in Electron.
 *
 * Persistent "user config" values (which live in a JSON file next to the DB on desktop) are kept in
 * localStorage here.
 */
import type { MainEvent, MainHandlers } from '../shims/electron';
import { removeSync } from 'fs';
import { loadLocalizedDictionary } from '../../ts/node/locale';
import { downloadLogs } from './logCapture';

const USER_CONFIG_KEY = 'session-web:userConfig';

function readUserConfig(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem(USER_CONFIG_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

export const userConfig = {
  get(key: string) {
    return readUserConfig()[key];
  },
  set(key: string, value: unknown) {
    const cfg = readUserConfig();
    cfg[key] = value;
    try {
      localStorage.setItem(USER_CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {
      console.warn('userConfig: could not persist', e);
    }
  },
  remove() {
    try {
      localStorage.removeItem(USER_CONFIG_KEY);
    } catch (e) {
      /* ignore */
    }
  },
};

/** Generate (once) and return the key used for the database, like main_node's getDefaultSQLKey */
export function getDefaultSQLKey(): string {
  let key = userConfig.get('key');
  if (!key) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    userConfig.set('key', key);
  }
  return key;
}

let crowdinLocale: string | undefined;

export function initLocale() {
  const appLocale = userConfig.get('locale') || navigator.language || 'en';
  crowdinLocale = loadLocalizedDictionary({ appLocale }).crowdinLocale;
  return crowdinLocale;
}

async function fetchAsset(path: string) {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`failed to fetch ${path}: ${res.status}`);
  }
  return res;
}

const sendBack = (channel: string) => (event: MainEvent, value?: unknown) =>
  event.sender.send(channel, value);

export function makeMainHandlers(): MainHandlers {
  const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

  return {
    on: {
      'locale-data': event => {
        // eslint-disable-next-line no-param-reassign
        event.returnValue = { crowdinLocale: crowdinLocale || initLocale() };
      },
      'get-user-data-path': event => {
        // eslint-disable-next-line no-param-reassign
        event.returnValue = '/session-web-data';
      },
      'get-media-permissions': event => {
        // eslint-disable-next-line no-param-reassign
        event.returnValue = userConfig.get('mediaPermissions') || false;
      },
      'set-media-permissions': (_e, value) => userConfig.set('mediaPermissions', value),
      'get-call-media-permissions': event => {
        // eslint-disable-next-line no-param-reassign
        event.returnValue = userConfig.get('callMediaPermissions') || false;
      },
      'set-call-media-permissions': (_e, value) => userConfig.set('callMediaPermissions', value),
      'get-auto-update-setting': event => {
        // eslint-disable-next-line no-param-reassign
        event.returnValue = false;
      },
      'set-auto-update-setting': () => undefined,
      'get-start-in-tray': event => event.sender.send('get-start-in-tray-response', false),
      'start-in-tray-on-start': event => event.sender.send('start-in-tray-on-start-response', null),
      'get-opengroup-pruning': event =>
        event.sender.send('get-opengroup-pruning-response', userConfig.get('opengroupPruning')),
      'set-opengroup-pruning': (event, value) => {
        userConfig.set('opengroupPruning', value);
        event.sender.send('set-opengroup-pruning-response', null);
      },
      'set-password': event =>
        event.sender.send('set-password-response', 'Passwords are not supported on the web yet'),
      'password-recovery-phrase': event =>
        event.sender.send('password-recovery-phrase-response', null),
      'get-native-theme': event => event.sender.send('send-native-theme', !!darkQuery?.matches),
      'load-maxmind-data': async event => {
        try {
          const res = await fetchAsset('dynamic_assets/GeoLite2-Country.mmdb');
          event.reply('load-maxmind-data-complete', new Uint8Array(await res.arrayBuffer()));
        } catch (e) {
          event.reply('load-maxmind-data-complete', null);
        }
      },
      'load-build-time-snode-pool': async event => {
        try {
          const res = await fetchAsset('dynamic_assets/service-nodes-cache.json');
          const text = await res.text();
          const lastModified = Date.parse(res.headers.get('last-modified') || '') || Date.now();
          event.reply('load-build-time-snode-pool-complete', text, lastModified);
        } catch (e) {
          event.reply('load-build-time-snode-pool-complete', null);
        }
      },
      restart: () => window.location.reload(),
      'force-exit': () => window.location.reload(),
      resetDatabase: () => window.location.reload(),
      'show-window': () => window.focus(),
      'draw-attention': () => undefined,
      'set-auto-hide-menu-bar': () => undefined,
      'set-menu-bar-visibility': () => undefined,
      'close-about': () => undefined,
      'ready-for-updates': () => undefined,
      'media-access': () => undefined,
      'export-logs': () => downloadLogs(),
      'update-badge-count': (_e, count: number) => {
        document.title = count > 0 ? `(${count}) Session Web` : 'Session Web';
      },
      'set-release-from-file-server': () => undefined,
      'now-ready-for-shutdown': () => undefined,
      __qa_action: () => undefined,
      // attachments live in the in-memory/IndexedDB file system (web/shims/fs.ts)
      'erase-attachments': event => {
        removeSync('/session-web-data/attachments.noindex');
        event.sender.send('erase-attachments-done');
      },
      'cleanup-orphaned-attachments': event => {
        // TODO(web): port ts/node/attachment_channel.ts orphan cleanup (needs a sql call)
        event.sender.send('cleanup-orphaned-attachments-done');
      },
    },
    handle: {
      'app-is-packaged': () => true,
      'get-storage-profile': () => '/session-web-data',
      'get-logs-folder-size': () => 0,
      'delete-all-logs': () => undefined,
      'trigger-update-check': () => undefined,
      'force-update-check': () => false,
    },
  };
}
