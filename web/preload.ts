/**
 * Web port of /preload.js: sets up all the `window.*` helpers the renderer expects.
 * Keep this file in sync with preload.js when updating from upstream.
 */
/* eslint-disable func-names */
import { clipboard, ipcRenderer as ipc, webFrame } from 'electron';
import _ from 'lodash';
import { Storage } from '../ts/util/storage';
import { setupI18n } from '../ts/util/i18n/i18n';
import { UserUtils } from '../ts/session/utils';
import { BlindingActions } from '../ts/webworker/workers/browser/libsession_worker_interface';
import { initializeRendererProcessLogger } from '../ts/util/logger/renderer_process_logging';
import * as data from '../ts/data/dataInit';
import { ConvoHub } from '../ts/session/conversations/ConversationController';
import {
  defaultBooleanFeatureFlags,
  defaultDataFeatureFlags,
} from '../ts/state/ducks/types/defaultFeatureFlags';
import {
  getDataFeatureFlag,
  getFeatureFlag,
} from '../ts/state/ducks/types/releasedFeaturesReduxTypes';
import { WEB_SEED_NODES } from './network/seedNodes';

declare const __SESSION_VERSION__: string;
declare const __SESSION_COMMIT__: string;

const w = window as any;

const { crowdinLocale } = ipc.sendSync('locale-data');

const config = {
  name: 'Session Web',
  environment: 'production',
  appInstance: '',
  version: __SESSION_VERSION__,
  commitHash: __SESSION_COMMIT__,
  giphyApiKey: '',
  node_version: 'web',
};

// Note: we have to call initializeRendererProcessLogger before setupI18n
initializeRendererProcessLogger();

setupI18n({ crowdinLocale });

const title = config.name;

w.platform = process.platform;
w.getTitle = () => title;
w.getEnvironment = () => config.environment;
w.getAppInstance = () => config.appInstance;
w.getVersion = () => config.version;
w.getCommitHash = () => config.commitHash;
w.getGiphyApiKey = () => config.giphyApiKey;
w.getNodeVersion = () => config.node_version;
w.getOSRelease = () => navigator.userAgent;
w.saveLog = () => ipc.send('export-logs');
w.getUserKeys = async () => {
  const pubkey = UserUtils.getOurPubKeyStrFromCache();
  const userEd25519SecretKey = (await UserUtils.getUserED25519KeyPairBytes())?.privKeyBytes;
  const blindedPkHex = await BlindingActions.blindVersionPubkey({
    ed25519SecretKey: userEd25519SecretKey,
  });

  return { id: pubkey, vbid: blindedPkHex };
};

w.versionInfo = {
  environment: w.getEnvironment(),
  version: w.getVersion(),
  commitHash: w.getCommitHash(),
  appInstance: w.getAppInstance(),
};

w.updateZoomFactor = () => {
  const zoomFactor = w.getSettingValue('zoom-factor-setting') || 100;
  w.setZoomFactor(zoomFactor / 100);
};

w.setZoomFactor = (number: number) => {
  webFrame.setZoomFactor(number);
};

w.setPassword = async (passPhrase: string, oldPhrase: string) =>
  new Promise(resolve => {
    ipc.once('set-password-response', (_event, response) => {
      if (!response) {
        return resolve(undefined);
      }
      return resolve(response);
    });
    ipc.send('set-password', passPhrase, oldPhrase);
  });

w.onTryPassword = async (passPhrase: string) =>
  new Promise<void>((resolve, reject) => {
    ipc.once('password-recovery-phrase-response', (_event, error) => {
      if (error) {
        return reject(error);
      }
      return resolve();
    });
    ipc.send('password-recovery-phrase', passPhrase);
  });

w.setStartInTray = async (startInTray: boolean) =>
  new Promise<void>((resolve, reject) => {
    ipc.once('start-in-tray-on-start-response', (_event, error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    ipc.send('start-in-tray-on-start', startInTray);
  });

w.getStartInTray = async () =>
  new Promise(resolve => {
    ipc.once('get-start-in-tray-response', (_event, value) => resolve(value));
    ipc.send('get-start-in-tray');
  });

w.getOpengroupPruning = async () =>
  new Promise(resolve => {
    ipc.once('get-opengroup-pruning-response', (_event, value) => resolve(value));
    ipc.send('get-opengroup-pruning');
  });

w.setOpengroupPruning = async (opengroupPruning: boolean) =>
  new Promise<void>((resolve, reject) => {
    ipc.once('set-opengroup-pruning-response', (_event, error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    ipc.send('set-opengroup-pruning', opengroupPruning);
  });

w._ = _;

w.drawAttention = () => ipc.send('draw-attention');
w.showWindow = () => {
  w.log.info('show window');
  ipc.send('show-window');
};
w.setAutoHideMenuBar = (autoHide: boolean) => ipc.send('set-auto-hide-menu-bar', autoHide);
w.setMenuBarVisibility = (visibility: boolean) => ipc.send('set-menu-bar-visibility', visibility);
w.restart = () => {
  w.log.info('restart');
  ipc.send('restart');
};
w.closeAbout = () => ipc.send('close-about');
w.readyForUpdates = () => ipc.send('ready-for-updates');

// Assume we are online until we are told otherwise (needed for restore from seed to work)
w.isOnline = true;

w.getSettingValue = (settingID: string, comparisonValue: any = null) => {
  if (settingID === 'media-permissions') {
    return w.getMediaPermissions();
  }
  if (settingID === 'call-media-permissions') {
    return w.getCallMediaPermissions();
  }
  if (settingID === 'auto-update') {
    return w.getAutoUpdateEnabled();
  }

  const settingVal = Storage.get(settingID);
  return comparisonValue ? !!settingVal === comparisonValue : settingVal;
};

w.setSettingValue = async (settingID: string, value: any) => {
  if (settingID === 'auto-update') {
    w.setAutoUpdateEnabled(value);
    return;
  }
  await Storage.put(settingID, value);
};

w.getMediaPermissions = () => ipc.sendSync('get-media-permissions');
w.setMediaPermissions = (value: boolean) => ipc.send('set-media-permissions', !!value);
w.getCallMediaPermissions = () => ipc.sendSync('get-call-media-permissions');
w.setCallMediaPermissions = (value: boolean) => ipc.send('set-call-media-permissions', !!value);
w.askForMediaAccess = () => ipc.send('media-access');
w.getAutoUpdateEnabled = () => ipc.sendSync('get-auto-update-setting');
w.setAutoUpdateEnabled = (value: boolean) => ipc.send('set-auto-update-setting', !!value);

w.nodeSetImmediate = (fn: () => void) => setTimeout(fn, 0);

data.initData();

w.sessionBooleanFeatureFlags = defaultBooleanFeatureFlags;
w.sessionDataFeatureFlags = defaultDataFeatureFlags;

w.getConversationController = ConvoHub.use;

w.clipboard = clipboard;

w.getSeedNodeList = () => {
  const localDevNet = getDataFeatureFlag('useLocalDevNet');
  if (localDevNet) {
    return [localDevNet];
  }
  if (getFeatureFlag('useTestNet')) {
    return ['http://seed2.getsession.org:38157'];
  }
  return WEB_SEED_NODES;
};

window.addEventListener('contextmenu', e => {
  const target = e?.target as HTMLElement | null;
  const editable = target?.closest?.('textarea, input, div, [contenteditable="true"]');
  const link = target?.closest?.('a');
  const selection = Boolean(window.getSelection()?.toString());
  if (!editable && !selection && !link) {
    e.preventDefault();
  }
});

