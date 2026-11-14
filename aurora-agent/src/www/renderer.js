const $ = (id) => document.getElementById(id);
const log = $('log'), bubble = $('bubble'), input = $('input');
const history = [];
let busy = false;

function addLog(msg) { const d = document.createElement('div'); d.textContent = msg; log.appendChild(d); log.scrollTop = log.scrollHeight; }
const toolLabel = { run_command: (i) => '⚙ 실행: ' + i.command, read_file: (i) => '📖 읽기: ' + i.path, write_file: (i) => '✏ 쓰기: ' + i.path, list_dir: (i) => '📂 목록: ' + i.path, system_info: () => '🖥 시스템 정보', launch_app: (i) => '📱 앱 실행: ' + (i.name || i.package), list_apps: () => '📱 앱 목록 확인', screen_read: () => '👀 화면 읽는 중', screen_click_text: (i) => '👆 누르는 중: ' + i.text, screen_tap: () => '👆 화면 탭', screen_swipe: () => '👆 스와이프', screen_type: (i) => '⌨ 입력: ' + i.text, screen_global: (i) => '🔘 ' + i.action, device_info: () => '📊 기기 정보', open_intent: () => '🔗 열기', wait: () => '⏳ 잠시 대기', adb_command: (i) => '🛠 adb: ' + i.command, request_all_files_access: () => '🔐 파일 권한 요청', open_accessibility_settings: () => '🔐 접근성 설정 열기' };

api.onEvent((ev) => {
  if (ev.type === 'wait') { bubble.textContent = `무료 서버 한도 때문에 ${ev.seconds}초 기다리는 중이에요… ⏳`; Face.setMood('sleepy'); return; }
  if (ev.type === 'tool') { bubble.textContent = '🔧 ' + ((toolLabel[ev.name] || (() => ev.name))(ev.input)) + ' …'; Face.setMood('thinking'); Face.doMotion('nod'); addLog((toolLabel[ev.name] || (() => ev.name))(ev.input)); }
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
const prov = $('provider');
Object.entries(LLM.PRESETS).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = v.label; prov.appendChild(o); });
const modelEl = () => dlg.querySelector('[data-k=model]');
function provChanged(resetModel) {
  const p = LLM.PRESETS[prov.value] || LLM.PRESETS.pollinations, m = modelEl();
  if (resetModel && (!m.value || Object.values(LLM.PRESETS).some((x) => x.model === m.value))) m.value = p.model;
  $('keyHelp').textContent = 'API 키 발급: ' + p.keyUrl + (prov.value === 'pollinations' ? '  (API 키 칸은 비워 두세요)' : prov.value === 'anthropic' ? '' : '  (무료, 카드 등록 없이 가능. 한도 초과 시 잠시 후 재시도)');
}
prov.addEventListener('change', () => provChanged(true));
const fields = () => [...dlg.querySelectorAll('[data-k]')];
async function showRemote() {
  if (!api.remoteInfo || !$('remoteInfo')) return;
  const i = await api.remoteInfo();
  $('remoteInfo').textContent = i.error ? '⚠ ' + i.error : i.enabled ? '켜짐 — 같은 Wi-Fi의 폰/PC 브라우저에서 아래 주소로 접속하세요:\n' + i.urls.join('\n') : '꺼짐';
}
$('gear').onclick = async () => {
  const s = await api.getSettings();
  fields().forEach((el) => { const v = s[el.dataset.k]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v; });
  if (!prov.value) prov.value = 'pollinations'; provChanged(false);
  await showRemote(); dlg.showModal();
};
$('save').onclick = async () => {
  const patch = {};
  fields().filter((el) => el.offsetParent !== null).forEach((el) => { patch[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim(); });
  if (!patch.model) patch.model = (LLM.PRESETS[patch.provider] || LLM.PRESETS.pollinations).model;
  await api.setSettings(patch);
};
api.getSettings().then((s) => { if (LLM.needsKey(s.provider) && !s.apiKey && !s.token && !s.serverUrl) bubble.textContent = '안녕! ⚙ 설정에서 API 키를 넣거나, 키 없이 쓰려면 제공자를 Pollinations로 바꿔줘 🌈'; });

document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async (e) => {
  e.preventDefault(); const out = $('actResult'); if (!api.action) return;
  out.textContent = '…'; out.textContent = await api.action(b.dataset.act);
}));
