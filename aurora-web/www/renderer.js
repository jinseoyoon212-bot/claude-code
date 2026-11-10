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

// 설정: data-k 속성이 붙은 입력칸을 자동으로 읽고 저장 (화면에 보이는 칸만)
const dlg = $('settings');
const fields = () => [...dlg.querySelectorAll('[data-k]')];
async function showRemote() {
  if (!api.remoteInfo || !$('remoteInfo')) return;
  const i = await api.remoteInfo();
  $('remoteInfo').textContent = i.error ? '⚠ ' + i.error : i.enabled ? '켜짐 — 같은 Wi-Fi의 폰/PC 브라우저에서 아래 주소로 접속하세요:\n' + i.urls.join('\n') : '꺼짐';
}
$('gear').onclick = async () => {
  const s = await api.getSettings();
  fields().forEach((el) => { const v = s[el.dataset.k]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v; });
  await showRemote(); dlg.showModal();
};
$('save').onclick = async () => {
  const patch = {};
  fields().filter((el) => el.offsetParent !== null).forEach((el) => { patch[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
  if (!patch.model) patch.model = 'claude-sonnet-5-5';
  await api.setSettings(patch);
};
api.getSettings().then((s) => { if (!s.apiKey && !s.token && !s.serverUrl) bubble.textContent = '안녕! 먼저 ⚙ 설정을 해줘 🌈'; });
