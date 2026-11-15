const $ = (id) => document.getElementById(id);
const log = $('log'), bubble = $('bubble'), input = $('input'), ubub = $('ubub');
let fadeT;
const root = document.documentElement;
// 음성 인식 중간 결과만 얼굴 위 풍선에 실시간 표시 (타이핑은 표시하지 않음)
function showUser(text, typing) { clearTimeout(fadeT); ubub.style.visibility = ''; ubub.classList.remove('fade'); ubub.classList.add('in'); ubub.classList.toggle('typing', !!typing); ubub.textContent = text; }
window.showUser = showUser;
const setBubble = (t) => { bubble.textContent = t; FX.jelly(bubble); };
window.setBubble = setBubble;
const faceRect = () => { const c = document.getElementById('face').getBoundingClientRect(); return { left: c.left + c.width / 2 - 22, top: c.top + c.height / 2 - 14, width: 44, height: 28 }; };
const inputRect = (text) => { const c = input.getBoundingClientRect(); const w = Math.min(c.width, 36 + text.length * 11); return { left: c.left + 6, top: c.top + c.height * .12, width: w, height: c.height * .76 }; };
const history = [];
let busy = false;

function addLog(msg) { const d = document.createElement('div'); d.textContent = msg; log.appendChild(d); log.scrollTop = log.scrollHeight; }
const toolLabel = { run_command: (i) => '⚙ 실행: ' + i.command, read_file: (i) => '📖 읽기: ' + i.path, write_file: (i) => '✏ 쓰기: ' + i.path, list_dir: (i) => '📂 목록: ' + i.path, system_info: () => '🖥 시스템 정보', launch_app: (i) => '📱 앱 실행: ' + (i.name || i.package), list_apps: () => '📱 앱 목록 확인', screen_read: () => '👀 화면 읽는 중', screen_click_text: (i) => '👆 누르는 중: ' + i.text, screen_tap: () => '👆 화면 탭', screen_swipe: () => '👆 스와이프', screen_type: (i) => '⌨ 입력: ' + i.text, screen_global: (i) => '🔘 ' + i.action, device_info: () => '📊 기기 정보', open_intent: () => '🔗 열기', wait: () => '⏳ 잠시 대기', adb_command: (i) => '🛠 adb: ' + i.command, request_all_files_access: () => '🔐 파일 권한 요청', open_accessibility_settings: () => '🔐 접근성 설정 열기' };

api.onEvent((ev) => {
  if (ev.type === 'wait') { bubble.textContent = `무료 서버 한도 때문에 ${ev.seconds}초 기다리는 중이에요… ⏳`; Face.setMood('sleepy'); return; }
  if (ev.type === 'tool') { bubble.textContent = '🔧 ' + ((toolLabel[ev.name] || (() => ev.name))(ev.input)) + ' …'; Face.setMood('thinking'); Face.doMotion('nod'); addLog((toolLabel[ev.name] || (() => ev.name))(ev.input)); }
});

// 말하거나 입력한 글 보내기: 글이 출발 지점에서 쭉 빨려 올라가 위 풍선이 된다
async function sendText(raw, from = 'input') {
  const text = String(raw || '').trim(); if (!text || busy) return;
  busy = true; document.body.classList.add('busy');
  const origin = from === 'face' ? faceRect() : inputRect(text);
  if (from === 'input') { input.value = ''; FX.jelly($('form'), 'jelly'); }
  Face.react(text); setBubble('…');
  history.push({ role: 'user', content: text });
  FX.flyUp(text, origin, ubub).then(() => { Face.poke(0.7); Face.lookAt(0, -0.5); setTimeout(() => Face.lookAt(0, 0), 900); });
  const r = await api.send(history);
  busy = false; document.body.classList.remove('busy');
  fadeT = setTimeout(() => ubub.classList.add('fade'), 7000);
  if (r.error) { Face.setMood('sad'); Face.doMotion('droop'); setBubble('⚠ ' + r.error); history.pop(); if (window.AuroraAssist) window.AuroraAssist.onAnswer({ text: '오류가 났어요. ' + String(r.error).slice(0, 80) }); return; }
  history.push({ role: 'assistant', content: r.text });
  Face.setMood(r.mood); Face.doMotion({ happy: 'wave', laugh: 'bounce', love: 'bounce', sad: 'droop', angry: 'shake', surprised: 'jump', sleepy: 'sway', thinking: 'tilt' }[r.mood] || 'nod');
  setBubble(r.text);
  if (window.AuroraAssist) window.AuroraAssist.onAnswer(r);
  Face.setTalking(true); setTimeout(() => Face.setTalking(false), Math.min(4000, 300 + r.text.length * 60));
}
window.sendText = sendText;
window.isBusy = () => busy;
$('form').addEventListener('submit', (e) => { e.preventDefault(); sendText(input.value, 'input'); });
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

// ---- 얼굴을 누르면 음성 인식 ----
let listening = false;
$('face').addEventListener('click', async () => {
  if (root.classList.contains('assist') || busy || listening || typeof Voice === 'undefined') return;
  listening = true; Face.poke(1); Face.setMood('surprised'); Face.doMotion('jump'); document.body.classList.add('listening'); setBubble('🎤 준비 중…');
  try {
    const v = await Voice.listen({
      onStatus: (t) => setBubble(t), onSpeech: () => setBubble('🎤 듣고 있어요…'), onPartial: (t) => showUser(t, true),
      onLevel: (l) => root.style.setProperty('--lvl', Number(l).toFixed(2)),
    });
    listening = false; document.body.classList.remove('listening'); root.style.setProperty('--lvl', 0);
    sendText(v.text, 'face');
  } catch (e) {
    listening = false; document.body.classList.remove('listening'); root.style.setProperty('--lvl', 0); Face.setMood('sad'); Face.doMotion('droop');
    setBubble(e.code === 'silence' ? '말소리가 들리지 않았어요. 얼굴을 눌러 다시 말해 주세요.' : e.code === 'mic' ? '마이크 권한이 필요해요. ⚙ 설정에서 마이크 권한을 허용해 주세요.' : '⚠ ' + (e && e.message ? e.message : e));
  }
});

// ---- 설정 시트: 스프링으로 열리고, 닫을 때 부드럽게 접힘 ----
dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); dlg.classList.add('closing'); setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 260); });
