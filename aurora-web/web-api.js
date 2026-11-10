// 웹/APK용 백엔드: Anthropic API를 브라우저에서 직접 호출 (기기 파일/명령 접근 없음)
(() => {
  const KEY = 'aurora-settings';
  const MOODS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'sleepy', 'love', 'laugh'];
  const defaults = { apiKey: '', model: 'claude-sonnet-5-5' };
  const load = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; } };
  const SYSTEM = `당신은 "오로라"라는 귀여운 AI 에이전트입니다. 지금은 웹/모바일 앱에서 동작하므로 사용자 기기의 파일이나 프로그램에는 접근할 수 없습니다. 그런 요청을 받으면 "PC용 Aurora Agent 앱에서만 가능해요"라고 짧게 안내하세요.
규칙: 한국어로 친근하고 간결하게, 단순한 질문은 바로 답합니다. 모든 답변의 맨 첫 줄에 기분 태그를 붙입니다: [기분:${MOODS.join('|')}]. 예: "[기분:happy] 안녕하세요!"`;
  window.api = {
    getSettings: async () => load(),
    setSettings: async (p) => { const s = { ...load(), ...p }; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} return s; },
    onEvent() {},
    send: async (history) => {
      const s = load();
      if (!s.apiKey) return { error: 'API 키가 없어요. 오른쪽 위 ⚙ 설정에서 Anthropic API 키를 입력해 주세요.' };
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: s.model, max_tokens: 2048, system: SYSTEM, messages: history.map((m) => ({ role: m.role, content: m.content })) }),
        });
        const data = await res.json();
        if (!res.ok) return { error: (data.error && data.error.message) || ('HTTP ' + res.status) };
        let text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        let mood = 'neutral'; const m = text.match(/^\s*\[기분:([a-z]+)\]\s*/);
        if (m) { if (MOODS.includes(m[1])) mood = m[1]; text = text.slice(m[0].length); }
        return { text, mood };
      } catch (e) { return { error: '네트워크 오류: ' + e.message }; }
    },
  };
})();
