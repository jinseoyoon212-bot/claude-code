const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  send: (history) => ipcRenderer.invoke('agent:send', history),
  remoteInfo: () => ipcRenderer.invoke('remote:info'),
  onEvent: (cb) => ipcRenderer.on('agent:event', (_e, ev) => cb(ev)),
});
