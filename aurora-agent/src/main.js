const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { runAgent } = require('./agent');

let win;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = { apiKey: '', model: 'claude-sonnet-5-5', autoApprove: false };

function loadSettings() {
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch { return { ...defaults }; }
}
function saveSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }

function createWindow() {
  win = new BrowserWindow({
    width: 520, height: 820, minWidth: 380, minHeight: 600,
    backgroundColor: '#0b0b1a', title: 'Aurora Agent',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:set', (_e, patch) => { const s = { ...loadSettings(), ...patch }; saveSettings(s); return s; });

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
