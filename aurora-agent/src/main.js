const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { runAgent } = require('./agent');
const { createBridge } = require('./server');

let win, bridge = null, remoteError = '';
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = { apiKey: '', model: 'claude-sonnet-5-5', autoApprove: false, remoteEnabled: false, remotePort: 8765, remoteToken: '' };

function loadSettings() {
  let s; try { s = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { s = { ...defaults }; }
  if (!s.remoteToken) { s.remoteToken = crypto.randomBytes(16).toString('hex'); saveSettings(s); }
  return s;
}
function saveSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }

async function applyRemote() {
  if (bridge) { await bridge.stop(); bridge = null; }
  remoteError = '';
  const s = loadSettings();
  if (!s.remoteEnabled) return;
  try {
    bridge = createBridge({ getSettings: loadSettings, wwwDir: path.join(__dirname, 'www'), token: s.remoteToken });
    await bridge.start(s.remotePort);
  } catch (e) { bridge = null; remoteError = '서버 시작 실패: ' + e.message; }
}
function remoteInfo() {
  const s = loadSettings();
  const ips = Object.values(os.networkInterfaces()).flat().filter((l) => l && l.family === 'IPv4' && !l.internal).map((l) => l.address);
  return { enabled: !!bridge, error: remoteError, token: s.remoteToken, urls: ips.map((ip) => `http://${ip}:${s.remotePort}/?token=${s.remoteToken}`) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 520, height: 820, minWidth: 380, minHeight: 600,
    backgroundColor: '#0b0b1a', title: 'Aurora Agent',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => { createWindow(); applyRemote(); });
app.on('window-all-closed', () => app.quit());

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', async (_e, patch) => {
  const before = loadSettings(); const s = { ...before, ...patch }; saveSettings(s);
  if (s.remoteEnabled !== before.remoteEnabled || s.remotePort !== before.remotePort) await applyRemote();
  return s;
});
ipcMain.handle('remote:info', () => remoteInfo());

ipcMain.handle('agent:send', async (_e, history) => {
  const settings = loadSettings();
  if (!settings.apiKey) return { error: 'API 키가 없어요. 오른쪽 위 ⚙ 설정에서 Anthropic API 키를 입력해 주세요.' };
  const confirm = async (title, detail) => {
    if (settings.autoApprove) return true;
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['허용', '거부'], defaultId: 1, cancelId: 1,
      title: '실행 승인', message: title, detail: String(detail).slice(0, 1500),
    });
    return r.response === 0;
  };
  const notify = (ev) => win && win.webContents.send('agent:event', ev);
  try { return await runAgent({ settings, history, confirm, notify }); }
  catch (err) { return { error: String(err && err.message || err) }; }
});
