/**
 * Browser replacement for the `electron` module.
 *
 * The renderer code talks to Electron's main process through `ipcRenderer`. On the web there is no
 * main process, so this shim emulates it:
 *  - `sql-channel` and `erase-sql-key` are forwarded to the SQL worker (web/main/sql.worker.ts)
 *  - every other channel is handled in-page by web/main/ipcMainHandlers.ts
 *
 * Main-process-only APIs (app, dialog, Notification...) are stubbed so that shared modules which
 * import them still load (inside the SQL worker for instance).
 */
/* eslint-disable max-classes-per-file */
import { EventEmitter } from 'events';

type Listener = (event: any, ...args: Array<any>) => void;

export type MainHandlers = {
  on: Record<string, (event: MainEvent, ...args: Array<any>) => void | Promise<void>>;
  handle: Record<string, (event: MainEvent, ...args: Array<any>) => any>;
};

export type MainEvent = {
  returnValue: any;
  reply: (channel: string, ...args: Array<any>) => void;
  sender: { send: (channel: string, ...args: Array<any>) => void };
};

class IpcRendererShim extends EventEmitter {
  private handlers: MainHandlers = { on: {}, handle: {} };

  private sqlWorker: Worker | undefined;

  public _setMainHandlers(handlers: MainHandlers) {
    this.handlers = handlers;
  }

  public _setSqlWorker(worker: Worker) {
    this.sqlWorker = worker;
    worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data;
      if (msg?.type === 'call-done') {
        this._emitFromMain('sql-channel-done', msg.jobId, msg.error, msg.result);
      } else if (msg?.type === 'erase-done') {
        this._emitFromMain('erase-sql-key-done', msg.error);
      }
    });
  }

  /** Send an event to the renderer, as if it came from the main process. */
  public _emitFromMain(channel: string, ...args: Array<any>) {
    // emit asynchronously, like real IPC
    setTimeout(() => this.emit(channel, { sender: this }, ...args), 0);
  }

  private makeEvent(): MainEvent {
    return {
      returnValue: undefined,
      reply: (ch, ...args) => this._emitFromMain(ch, ...args),
      sender: { send: (ch, ...args) => this._emitFromMain(ch, ...args) },
    };
  }

  public send(channel: string, ...args: Array<any>) {
    if (channel === 'sql-channel') {
      const [jobId, callName, ...rest] = args;
      this.sqlWorker?.postMessage({ type: 'call', jobId, callName, args: rest });
      return;
    }
    if (channel === 'erase-sql-key') {
      this.sqlWorker?.postMessage({ type: 'erase' });
      return;
    }
    const handler = this.handlers.on[channel];
    if (!handler) {
      console.warn(`[web ipc] no main handler for "${channel}"`);
      return;
    }
    void Promise.resolve()
      .then(() => handler(this.makeEvent(), ...args))
      .catch(e => console.error(`[web ipc] handler "${channel}" failed`, e));
  }

  public sendSync(channel: string, ...args: Array<any>) {
    const handler = this.handlers.on[channel];
    if (!handler) {
      console.warn(`[web ipc] no sync main handler for "${channel}"`);
      return undefined;
    }
    const event = this.makeEvent();
    void handler(event, ...args);
    return event.returnValue;
  }

  public async invoke(channel: string, ...args: Array<any>) {
    const handler = this.handlers.handle[channel];
    if (!handler) {
      console.warn(`[web ipc] no invoke handler for "${channel}"`);
      return undefined;
    }
    return handler(this.makeEvent(), ...args);
  }

  public override on(channel: string | symbol, listener: Listener) {
    return super.on(channel, listener);
  }
}

export const ipcRenderer = new IpcRendererShim();
ipcRenderer.setMaxListeners(0);

export const clipboard = {
  writeText: (text: string) => {
    void navigator.clipboard?.writeText(text).catch(e => console.warn('clipboard write failed', e));
  },
  readText: () => '',
  writeImage: () => undefined,
};

export const shell = {
  openExternal: async (url: string) => {
    window.open?.call(window, url, '_blank', 'noopener,noreferrer');
  },
  openPath: async () => '',
  showItemInFolder: () => undefined,
};

export const webFrame = {
  setZoomFactor: (factor: number) => {
    document.body.style.zoom = String(factor);
  },
  getZoomFactor: () => Number(document.body.style.zoom || 1),
};

// ---- main process stubs (only loaded by shared modules, never really used on the web) ----
const noop = () => undefined;

export const app = {
  getPath: () => '/',
  getAppPath: () => '/',
  getLocale: () => (typeof navigator !== 'undefined' ? navigator.language : 'en'),
  getVersion: () => '0.0.0',
  isPackaged: true,
  quit: noop,
  exit: noop,
  relaunch: noop,
  on: noop,
};

export const dialog = {
  showMessageBox: async () => ({ response: 0 }),
  showMessageBoxSync: () => 0,
  showErrorBox: noop,
  showSaveDialog: async () => ({ canceled: true }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};

export class Notification {
  constructor(private readonly opts: any) {}

  show() {
    console.warn('[web] Notification:', this.opts);
  }
}

export const ipcMain = { on: noop, handle: noop, once: noop, removeHandler: noop };
export const powerMonitor = { on: noop };
export const powerSaveBlocker = { start: () => 0, stop: noop };
export const nativeTheme = { shouldUseDarkColors: true, on: noop };
export class BrowserWindow {}
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: noop };
export class Tray {}
export const session = { defaultSession: {} };

export default {
  ipcRenderer,
  clipboard,
  shell,
  webFrame,
  app,
  dialog,
  Notification,
  ipcMain,
  powerMonitor,
  powerSaveBlocker,
  nativeTheme,
  BrowserWindow,
  Menu,
  Tray,
  session,
};
