// 웹사이트 버전 백엔드: 브라우저에서 AI 제공자 API를 직접 호출한다 (서버·기기 조작 없음). 키는 이 브라우저(localStorage)에만 저장.
window.AURORA_SITE = true;
(() => {
  const KEY = 'aurora-site-settings';
  const defaults = { provider: 'aurora', apiKey: '', model: 'default', fastModel: '' };
  const load = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const listeners = [];
  const notify = (ev) => listeners.forEach((cb) => cb(ev));
  const SYSTEM = `당신은 "오로라"라는 귀여운 AI입니다. 웹사이트에서 동작하며 사용자의 기기나 파일은 조작할 수 없습니다(그런 요청에는 웹 버전에서는 할 수 없다고 짧게 안내하세요).
한국어로 친근하고 간결하게 답합니다. 맨 첫 줄에 기분 태그를 붙입니다: [기분:${LLM.MOODS.join('|')}]. 예: "[기분:happy] 안녕하세요!"`;

  window.api = {
    getSettings: async () => load(),
    setSettings: async (p) => { const s = { ...load(), ...p }; save(s); return s; },
    onEvent: (cb) => listeners.push(cb),
    send: async (history) => {
      const s = load();
      if (LLM.needsKey(s.provider) && !s.apiKey) return { error: 'API 키가 없어요. ⚙ 설정에서 키를 넣거나, 키 없이 쓰려면 제공자를 "Aurora 기본 AI"로 바꿔 주세요.' };
      const msgs = history.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      try {
        let r = await LLM.fastStream({ provider: s.provider, apiKey: s.apiKey, model: s.model, fastModel: s.fastModel, system: SYSTEM, maxTokens: 700, messages: msgs,
          onWait: (sec) => notify({ type: 'wait', seconds: sec }),
          onDelta: (t) => { const c = LLM.moodSplit(t); if (c.ready && c.text) notify({ type: 'delta', text: c.text }); } });
        let raw = (r.content[0] && r.content[0].text || '').trim();
        if (!raw) {                                                                       // 스트리밍을 못 주는 서버면 일반 호출로
          r = await LLM.call({ provider: s.provider, apiKey: s.apiKey, model: s.model, system: SYSTEM, maxTokens: 700, messages: msgs, onWait: (sec) => notify({ type: 'wait', seconds: sec }) });
          raw = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        }
        const c = LLM.moodSplit(raw); return { text: c.text.trim() || raw, mood: c.mood };
      } catch (e) { return { error: String(e && e.message || e) }; }
    },
  };
})();
