const $ = (id) => document.getElementById(id);
const log = $('log'), bubble = $('bubble'), input = $('input');
const history = [];
let busy = false;

function addLog(msg) { const d = document.createElement('div'); d.textContent = msg; log.appendChild(d); log.scrollTop = log.scrollHeight; }
const toolLabel = { run_command: (i) => '⚙ 실행: ' + i.command, read_file: (i) => '📖 읽기: ' + i.path, write_file: (i) => '✏ 쓰기: ' + i.path, list_dir: (i) => '📂 목록: ' + i.path, system_info: () => '🖥 시스템 정보' };

api.onEvent((ev) => {
  if (ev.type === 'tool') { Face.setMood('thinking'); Face.doMotion('nod'); addLog((toolLabel[ev.name] || (() => ev.name))(ev.input)); }
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || busy) return;
  input.value = ''; busy = true;
  addLog('🙂 ' + text);
  Face.react(text); bubble.textContent = '…';
  history.push({ role: 'user', content: text });
  const r = await api.send(history);
  busy = false;
  if (r.error) { Face.setMood('sad'); Face.doMotion('droop'); bubble.textContent = '⚠ ' + r.error; history.pop(); return; }
  history.push({ role: 'assistant', content: r.text });
  Face.setMood(r.mood); Face.doMotion({ happy: 'wave', laugh: 'bounce', love: 'bounce', sad: 'droop', angry: 'shake', surprised: 'jump', sleepy: 'sway', thinking: 'tilt' }[r.mood] || 'nod');
  bubble.textContent = r.text;
  Face.setTalking(true); setTimeout(() => Face.setTalking(false), Math.min(4000, 300 + r.text.length * 60));
});
input.addEventListener('input', () => Face.lookAt(0, 0.6));

// 설정
const dlg = $('settings');
$('gear').onclick = async () => { const s = await api.getSettings(); $('key').value = s.apiKey; $('model').value = s.model; $('auto').checked = s.autoApprove; dlg.showModal(); };
$('save').onclick = async () => { await api.setSettings({ apiKey: $('key').value.trim(), model: $('model').value.trim() || 'claude-sonnet-5-5', autoApprove: $('auto').checked }); };
api.getSettings().then((s) => { if (!s.apiKey) bubble.textContent = '안녕! 먼저 ⚙ 설정에서 API 키를 넣어줘 🌈'; });
