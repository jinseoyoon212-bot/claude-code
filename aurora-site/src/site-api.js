// 웹사이트 버전 백엔드: 브라우저에서 AI 제공자 API를 직접 호출한다 (서버·기기 조작 없음). 키는 이 브라우저(localStorage)에만 저장.
window.AURORA_SITE = true;
(() => {
  const KEY = 'aurora-site-settings';
  const defaults = { provider: 'aurora', apiKey: '', model: 'default', fastModel: '', searchMode: 'auto' };
  const load = () => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...defaults }; } };
  const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const listeners = [];
  const notify = (ev) => listeners.forEach((cb) => cb(ev));
  const SYSTEM = `당신은 "오로라"라는 귀여운 AI입니다. 웹사이트에서 동작하며 사용자의 기기나 파일은 조작할 수 없습니다(그런 요청에는 웹 버전에서는 할 수 없다고 짧게 안내하세요).
한국어로 친근하고 간결하게 답합니다. 맨 첫 줄에 기분 태그를 붙입니다: [기분:${LLM.MOODS.join('|')}]. 예: "[기분:happy] 안녕하세요!"`;

  const MARKER_RULE = '\n최신·실시간 정보(날씨, 뉴스, 가격, 순위, 방금 일어난 일 등)가 꼭 필요한데 아직 검색 결과가 없다면, 다른 말 없이 정확히 [검색:검색어] 한 줄만 출력하세요.';
  const RESULT_RULE = '\n사용자 메시지 뒤에 "웹 검색 결과"가 붙어 있습니다. 그 결과를 근거로 한국어로 간결하게 답하고, 근거로 쓴 출처 이름(예: 연합뉴스, Open-Meteo)을 문장 끝에 괄호로 짧게 밝히세요. 결과에 없는 내용은 지어내지 말고 모른다고 하세요. 숫자와 날짜는 결과 그대로 쓰세요.';
  const NO_RESULT_RULE = '\n실시간 검색을 시도했지만 결과를 얻지 못했습니다(이 사이트는 날씨·환율·뉴스·위키백과만 검색할 수 있어요). 최신 정보를 확인하지 못했다고 먼저 한 문장으로 밝힌 뒤, 아는 범위에서 조심스럽게 답하세요.';

  window.api = {
    getSettings: async () => load(),
    setSettings: async (p) => { const s = { ...load(), ...p }; save(s); return s; },
    onEvent: (cb) => listeners.push(cb),
    send: async (history) => {
      const s = load();
      if (LLM.needsKey(s.provider) && !s.apiKey) return { error: 'API 키가 없어요. ⚙ 설정에서 키를 넣거나, 키 없이 쓰려면 제공자를 "Aurora 기본 AI"로 바꿔 주세요.' };
      const S = window.AuroraSearch, mode = s.searchMode || 'auto';
      const msgs0 = history.slice(-10).map((m) => ({ role: m.role, content: m.content })), lastUser = msgs0[msgs0.length - 1].content;
      let found = null, searched = false;
      const doSearch = async (q) => {                                                       // 실시간 검색 (실패해도 대화는 계속)
        searched = true; const t0 = Date.now(); notify({ type: 'search', query: q, sec: 0 });
        const tick = setInterval(() => notify({ type: 'search', query: q, sec: Math.round((Date.now() - t0) / 1000) }), 1000);   // "검색 중… N초"로 멈춘 게 아님을 보여줌
        try { found = await S.run(q); found.ms = found.ms || Date.now() - t0; } catch (e) { found = { query: q, results: [], error: /timeout|abort/i.test(String(e && e.name || e)) ? '시간 초과(7초)' : String(e && e.message || e), ms: Date.now() - t0 }; }
        finally { clearInterval(tick); }
      };
      const mkReq = (allowMarker) => {                                                      // 검색 결과가 있으면 마지막 사용자 메시지 뒤에 붙인다 (기록에는 남기지 않음)
        const m = msgs0.map((x) => ({ ...x })); let sys = SYSTEM + `\n현재 시각: ${S.now()} (한국 시간).`;
        if (found && found.results && found.results.length) { m[m.length - 1].content = lastUser + '\n\n' + S.format(found); sys += RESULT_RULE; }
        else if (searched) sys += NO_RESULT_RULE;
        else if (allowMarker && mode !== 'off') sys += MARKER_RULE;
        return { system: sys, messages: m };
      };
      const base = () => ({ provider: s.provider, apiKey: s.apiKey, model: s.model, fastModel: s.fastModel, onWait: (sec) => notify({ type: 'wait', seconds: sec }) });
      const viaCall = async (strict, allowMarker) => {                                      // 스트리밍 없이 한 번에 받는 안전한 길 (strict = 생각 없이)
        const r = await LLM.call({ ...base(), ...mkReq(allowMarker), maxTokens: 700, extra: strict && s.provider === 'aurora' ? { strict: true } : undefined });
        return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      };
      const answer = async (allowMarker) => {
        let raw = '';
        try {
          const r = await LLM.fastStream({ ...base(), ...mkReq(allowMarker), maxTokens: 700, onDelta: (t) => { if (/^\s*\[검색/.test(t)) return; const c = LLM.moodSplit(t); if (c.ready && c.text) notify({ type: 'delta', text: c.text }); } });
          raw = (r.content[0] && r.content[0].text || '').trim();
        } catch (e) {
          const m = String(e && e.message || e);
          if (e && e.code === 'THINKING') raw = await viaCall(true, allowMarker);                  // 모델이 생각만 길게 함 → 생각 없이 다시
          else if (/network error|Failed to fetch|Load failed|NetworkError|ERR_/i.test(m)) raw = await viaCall(false, allowMarker);   // 연결이 끊김 → 한 번 더
          else throw e;
        }
        return raw || await viaCall(true, allowMarker);                                         // 빈 응답 → 생각 없이 다시
      };
      try {
        if (mode === 'always' || (mode === 'auto' && S.needs(lastUser))) await doSearch(S.queryOf(lastUser));   // 최신 정보가 필요해 보이면 먼저 검색
        let raw = await answer(true);
        const mk = /^\s*\[검색:([^\]\n]+)\]/.exec(raw);
        if (mk && !searched) { await doSearch(S.queryOf(mk[1])); raw = await answer(false); }  // 모델이 직접 검색을 요청한 경우
        raw = raw.replace(/^\s*\[검색:[^\]]*\]\s*/, '');
        const c = LLM.moodSplit(raw);
        return { text: c.text.trim() || raw || '죄송해요, 답을 만들지 못했어요. 한 번만 더 물어봐 주실래요?', mood: c.mood, sources: found && found.results && found.results.length ? S.sources(found) : null, note: searched ? S.note(found) : '' };
      } catch (e) {
        const m = String(e && e.message || e);
        if (s.provider === 'aurora' && /HTTP (404|405)\b/.test(m)) return { error: 'AI 연결(/api)이 이 사이트에 배포되지 않았어요. Cloudflare Pages 설정에서 Root directory가 aurora-site인지, Bindings에 Workers AI(이름 AI)가 있는지 확인한 뒤 다시 배포해 주세요. (확인: 사이트 주소 뒤에 /api/health)' };
        return { error: m };
      }
    },
  };
})();
