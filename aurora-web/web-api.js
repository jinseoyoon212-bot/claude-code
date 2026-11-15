// 웹/APK 백엔드. 두 가지 모드:
//  1) 브리지 모드: PC의 Aurora 서버에 연결 → PC의 명령·파일 도구까지 동일하게 사용
//  2) 직접 모드: 브라우저에서 Anthropic API를 직접 호출 (대화만 가능)
(() => {
  const KEY = 'aurora-settings';
  const MOODS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'sleepy', 'love', 'laugh'];
  const defaults = { provider: 'pollinations', apiKey: '', fastModel: '', model: 'openai', serverUrl: '', token: '', mode: 'auto', phoneAuto: false, screenControl: false };
  const load = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const listeners = [];

  // 주소창의 ?token=... 을 저장하고 지운다 (PC가 알려준 접속 주소로 열면 자동 연결)
  try {
    const q = new URLSearchParams(location.search).get('token');
    if (q) { save({ ...load(), token: q }); history.replaceState(null, '', location.pathname); }
  } catch {}

  const SYSTEM = `당신은 "오로라"라는 귀여운 AI 에이전트입니다. 지금은 PC에 연결되지 않은 웹/모바일 앱에서 동작하므로 기기의 파일이나 프로그램에는 접근할 수 없습니다. 그런 요청을 받으면 "설정에서 PC 서버에 연결하면 가능해요"라고 짧게 안내하세요.
규칙: 한국어로 친근하고 간결하게, 단순한 질문은 바로 답합니다. 모든 답변의 맨 첫 줄에 기분 태그를 붙입니다: [기분:${MOODS.join('|')}]. 예: "[기분:happy] 안녕하세요!"`;

  let sameOriginBridge = null;
  async function bridgeBase(s) {
    if (s.serverUrl) return s.serverUrl.replace(/\/+$/, '');
    if (!/^https?:$/.test(location.protocol)) return null;
    if (sameOriginBridge === null) {
      try { const r = await fetch('/api/ping'); sameOriginBridge = r.ok && (await r.json()).ok === true; } catch { sameOriginBridge = false; }
    }
    return sameOriginBridge ? '' : null;
  }

  async function sendBridge(base, s, history) {
    const headers = { 'content-type': 'application/json', 'x-aurora-token': s.token };
    let res;
    try { res = await fetch(base + '/api/send', { method: 'POST', headers, body: JSON.stringify({ history }) }); }
    catch (e) { return { error: 'PC 서버에 연결할 수 없어요: ' + e.message }; }
    if (res.status === 401) return { error: 'PC 접속 토큰이 올바르지 않아요. ⚙ 설정에서 확인해 주세요.' };
    if (!res.body) return { error: '서버 응답이 올바르지 않아요.' };
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '', result = null;
    const handle = async (ev) => {
      if (ev.type === 'tool' || ev.type === 'wait') listeners.forEach((cb) => cb(ev));
      else if (ev.type === 'confirm') {
        const ok = window.confirm(ev.title + '\n\n' + ev.detail + '\n\n허용할까요?');
        fetch(base + '/api/confirm', { method: 'POST', headers, body: JSON.stringify({ id: ev.id, ok }) }).catch(() => {});
      } else if (ev.type === 'done') result = ev.error ? { error: ev.error } : { text: ev.text, mood: ev.mood };
    };
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { await handle(JSON.parse(line)); } catch {} } }
    }
    return result || { error: '서버가 응답 없이 종료됐어요.' };
  }

  async function sendDirect(s, history, notify) {
    if (LLM.needsKey(s.provider) && !s.apiKey) return { error: 'API 키가 없어요. ⚙ 설정에서 AI 제공자와 API 키를 넣거나 PC 서버에 연결해 주세요.' };
    try {
      const msgs = history.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      let r = await LLM.fastStream({ provider: s.provider, apiKey: s.apiKey, model: s.model, fastModel: s.fastModel, system: SYSTEM, maxTokens: 700, messages: msgs,
        onWait: (sec) => notify({ type: 'wait', seconds: sec }), onDelta: (t) => { const c = LLM.moodSplit(t); if (c.ready && c.text) notify({ type: 'delta', text: c.text }); } });
      let raw = (r.content[0] && r.content[0].text || '').trim();
      if (!raw) { r = await LLM.call({ provider: s.provider, apiKey: s.apiKey, model: s.model, system: SYSTEM, maxTokens: 700, messages: msgs, onWait: (sec) => notify({ type: 'wait', seconds: sec }) }); raw = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(); }
      const c = LLM.moodSplit(raw); return { text: c.text.trim() || raw, mood: c.mood };
    } catch (e) { return { error: String(e.message || e) }; }
  }

  window.api = {
    getSettings: async () => load(),
    setSettings: async (p) => { const s = { ...load(), ...p }; save(s); sameOriginBridge = null; return s; },
    onEvent: (cb) => listeners.push(cb),
    action: async (n) => {
      const D = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuroraDevice;
      if (!D) return 'APK 앱 안에서만 쓸 수 있어요.';
      try {
        if (n === 'mic') {
          if ((await D.micStatus()).granted) return '마이크 권한이 이미 허용돼 있어요 ✅';
          try { const s = await D.shizukuStatus(); if (s.granted) { await D.shizukuShell({ command: 'pm grant com.aurora.agent android.permission.RECORD_AUDIO' }); if ((await D.micStatus()).granted) return '마이크 권한을 허용했어요 ✅ (Shizuku)'; } } catch {}
          const r = await D.requestMic(); if (r.granted) return '마이크 권한을 허용했어요 ✅';
          await D.openAppInfo(); return '권한 창이 안 떠서 앱 정보를 열었어요. 권한 → 마이크 → 허용을 선택하세요.';
        }
        if (n === 'assist_set') { await D.openAssistantSettings(); return '기본 디지털 어시스턴트 화면을 열었어요. 목록에서 Aurora Agent를 선택하세요. (기기에 따라 설정 → 앱 → 기본 앱 → 디지털 어시스턴트 앱) 그다음 홈 버튼을 길게 누르세요.'; }
        if (n === 'assist_preview') { await D.previewAssist(); return '미리보기를 열었어요.'; }
        if (n === 'a11y') { await D.openAccessibilitySettings(); return '접근성 설정을 열었어요. 목록에서 "설치된 앱/다운로드한 앱"을 찾아 Aurora Agent를 켜세요.'; }
        if (n === 'detail') { const r = await D.openA11yDetails(); return r.opened === 'details' ? 'Aurora Agent 접근성 페이지를 열었어요. 스위치를 켜세요. (막히면 [앱 정보]에서 제한된 설정 허용 후 다시)' : '이 기기는 상세 페이지를 지원하지 않아 일반 접근성 설정을 열었어요.'; }
        if (n === 'appinfo') { await D.openAppInfo(); return '앱 정보를 열었어요. 오른쪽 위 ⋮ → "제한된 설정 허용"이 있으면 누르세요.'; }
        if (n === 'files') { await D.requestAllFilesAccess(); return '파일 권한 화면을 열었어요. Aurora Agent를 허용하세요.'; }
        if (n === 'secure') { await D.enableA11yViaSecureSettings(); return '접근성을 켰어요! 진단 버튼으로 확인해 보세요.'; }
        if (n === 'shz_status' || n === 'shz_enable') {
          const s = await D.shizukuStatus();
          if (!s.installed) return '① Play 스토어에서 "Shizuku" 앱을 설치하세요. 설치 후 이 버튼을 다시 누르세요.';
          if (!s.running) return '② Shizuku 앱을 열고 "무선 디버깅으로 시작"을 따라 하세요 (개발자 옵션 → 무선 디버깅 켜기 → 페어링 코드로 기기 페어링 → 알림에 코드 입력 → Shizuku의 "시작"). 실행 중으로 바뀌면 이 버튼을 다시 누르세요.';
          if (n === 'shz_status') return 'Shizuku 실행 중이에요. 권한: ' + (s.granted ? '허용됨 ✅' : '아직 안 줌 (아래 [Shizuku로 접근성 켜기]를 누르면 요청해요)');
          if (!s.granted) { const r = await D.shizukuRequestPermission(); if (!r.granted) return '③ Shizuku 권한 요청이 거부됐어요. 다시 누르고 "허용"을 선택하세요.'; }
          await appopsAllow(D);
          await D.shizukuEnableAccessibility();
          if (await waitConnected(D, 6)) return '✅ 접근성이 켜지고 연결됐어요! 이제 화면 조작을 쓸 수 있어요.';
          await restartA11y(D);                                   // 연결이 안 되면 껐다 켜서 다시 시도
          if (await waitConnected(D, 6)) return '✅ 재시작 후 접근성이 연결됐어요! 이제 화면 조작을 쓸 수 있어요.';
          return '이 기기는 접근성 켜기를 막고 있어요. 그래도 Shizuku로 화면 조작이 되니, 대화창에서 "설정 앱 열어줘" 같은 요청을 해 보세요.\n\n' + await collectDump(D);
        }
        if (n === 'shz_restart') { await restartA11y(D); return (await waitConnected(D, 6)) ? '✅ 연결됐어요!' : '재시작했지만 아직 연결 전이에요. [Shizuku 자세한 진단] 결과를 알려 주세요.'; }
        if (n === 'shz_dump') return await collectDump(D);
        if (n === 'diag') {
          const r = await D.a11yDiagnose();
          const head = `시스템 인식: ${r.registered ? '예' : '아니오'} / 켜짐: ${r.enabledInSettings ? '예' : '아니오'} / 연결됨: ${r.connected ? '예' : '아니오'} (안드로이드 ${r.android}, ${r.maker})`;
          const tip = !r.registered ? '→ 시스템이 서비스를 못 찾았어요. 앱을 지우고 APK를 다시 설치하세요.'
            : !r.enabledInSettings ? '→ 인식은 됐어요. 접근성 설정의 "설치된 앱/다운로드한 앱"에서 찾거나, [앱 정보]에서 제한된 설정을 허용한 뒤 켜세요.'
            : !r.connected ? '→ 켜져 있지만 연결 전이에요. 접근성 서비스를 껐다 다시 켜세요.' : '→ 정상이에요! 화면 조작을 쓸 수 있어요.';
          return head + '\n' + tip;
        }
      } catch (e) { return '실패: ' + (e && e.message ? e.message : e); }
      return '';
    },
    send: async (history) => {
      const s = load(), phone = window.PhoneAgent && window.PhoneAgent.available();
      const notify = (ev) => listeners.forEach((cb) => cb(ev));
      if (s.mode === 'chat') return sendDirect(s, history, notify);
      if (s.mode === 'phone') return phone ? window.PhoneAgent.run({ settings: s, history, notify }) : { error: '폰 제어는 Aurora Agent APK 앱에서만 가능해요.' };
      if (s.mode === 'auto' && phone && !s.serverUrl) return window.PhoneAgent.run({ settings: s, history, notify });
      const base = await bridgeBase(s);
      if (base === null) return s.mode === 'pc' ? { error: 'PC 서버 주소가 없거나 연결할 수 없어요. ⚙ 설정을 확인해 주세요.' } : sendDirect(s, history, notify);
      return sendBridge(base, s, history);
    },
  };
})();
