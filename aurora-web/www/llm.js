// 여러 AI 제공자를 하나의 형식(Anthropic 메시지 블록)으로 다루는 어댑터. 브라우저/Node 공용.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LLM = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const PRESETS = {
    aurora: { label: 'Aurora 기본 AI (키 없이 무료)', endpoint: '/api/v1/chat/completions', model: 'default', noKey: true, siteOnly: true, keyUrl: '필요 없음' },   // 웹사이트 전용: 사이트 서버(/api)가 클라우드플레어 AI에 대신 연결
    pollinations: { label: 'Pollinations (키 없이 무료)', endpoint: 'https://text.pollinations.ai/openai', model: 'openai', noKey: true, keyUrl: '필요 없음' },
    anthropic: { label: 'Anthropic Claude (유료)', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
    gemini: { label: 'Google Gemini (무료 사용량 있음)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
    groq: { label: 'Groq (무료 사용량 있음)', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
    openrouter: { label: 'OpenRouter (무료 모델 있음)', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys' },
  };
  const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
  const errMsg = (data, status) => { const d = Array.isArray(data) ? data[0] : data; const e = d && d.error; return (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || 'HTTP ' + status; };
  const EFFORTS = ['none', 'low', null];       // Gemini 생각 단계: 모델이 거부하면 한 단계씩 완화
  const effortIdx = {};                          // `${제공자}:${모델}` → 마지막으로 통한 단계 (다음부터는 실패한 단계를 건너뛰어 왕복을 아낀다)
  const badFast = {};                            // 존재하지 않아 못 쓴 빠른 모델 기억

  function toOA(system, messages) {
    const oa = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (typeof m.content === 'string') { oa.push({ role: m.role, content: m.content }); continue; }
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => { const c = { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }; if (b.extra_content) c.extra_content = b.extra_content; return c; });
        const msg = { role: 'assistant', content: text || null }; if (calls.length) msg.tool_calls = calls; oa.push(msg);
      } else if (m.content.some((b) => b.type === 'tool_result')) {
        for (const b of m.content) if (b.type === 'tool_result') oa.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) });
      } else {
        oa.push({ role: m.role, content: m.content.map((b) => b.type === 'image' ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } } : b.type === 'audio' ? { type: 'input_audio', input_audio: { data: b.source.data, format: /mp3|mpeg/.test(b.source.media_type) ? 'mp3' : 'wav' } } : { type: 'text', text: b.text }) });
      }
    }
    return oa;
  }
  const oaTools = (tools) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const oaUrl = (p, baseUrl) => (!baseUrl && p.endpoint ? p.endpoint : (baseUrl || p.base).replace(/\/+$/, '') + '/chat/completions');
  const oaHeaders = (apiKey) => { const h = { 'content-type': 'application/json' }; if (apiKey) h.authorization = 'Bearer ' + apiKey; return h; };
  const anHeaders = (apiKey) => ({ 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  const anBase = (baseUrl) => (baseUrl || env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/+$/, '');

  // 무료 서버 한도("Retry after Ns")면 기다렸다가 재시도
  async function withRetry(fn, opts) {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); }
      catch (e) {
        const m = /retry after (\d+)\s*s/i.exec(String(e && e.message));
        if (!m || attempt >= 4) throw e;
        const sec = Math.min(120, +m[1] + 2); if (opts && opts.onWait) opts.onWait(sec);
        await new Promise((r) => setTimeout(r, sec * 1000));
      }
    }
  }
  const call = (opts) => withRetry(() => callOnce(opts), opts);

  async function callOnce({ provider = 'anthropic', apiKey, model, system, tools = [], messages, maxTokens = 4096, baseUrl }) {
    const p = PRESETS[provider] || PRESETS.anthropic;
    model = model || p.model;
    if (provider === 'anthropic' || !PRESETS[provider]) {
      const body = { model, max_tokens: maxTokens, system, messages }; if (tools.length) body.tools = tools;
      const res = await fetch(anBase(baseUrl) + '/v1/messages', { method: 'POST', headers: anHeaders(apiKey), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, res.status));
      return { content: data.content, stop_reason: data.stop_reason };
    }
    // OpenAI 호환 (Gemini / Groq / OpenRouter / Pollinations)
    const body = { model, messages: toOA(system, messages), max_tokens: maxTokens };
    if (tools.length) body.tools = oaTools(tools);
    const url = oaUrl(p, baseUrl), headers = oaHeaders(apiKey), key = provider + ':' + model;
    const efforts = provider === 'gemini' ? EFFORTS.slice(effortIdx[key] || 0) : [null];
    let res, data;
    for (const ef of efforts) {
      if (ef) body.reasoning_effort = ef; else delete body.reasoning_effort;
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      data = await res.json();
      if (res.ok) { if (provider === 'gemini') effortIdx[key] = EFFORTS.indexOf(ef); break; }
      if (!/reasoning|thinking|effort/i.test(errMsg(data, res.status))) break;
    }
    if (!res.ok) throw new Error(errMsg(data, res.status));
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const content = []; if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const c of msg.tool_calls || []) { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch {} const tu = { type: 'tool_use', id: c.id || 'call_' + Math.random().toString(36).slice(2), name: c.function.name, input }; if (c.extra_content) tu.extra_content = c.extra_content; content.push(tu); }
    return { content, stop_reason: (msg.tool_calls || []).length ? 'tool_use' : 'end_turn' };
  }

  /** 글자가 생성되는 대로 onDelta(지금까지의 글)를 부른다. 도구 호출 없이 글만. signal로 중단 가능 */
  async function streamOnce({ provider = 'anthropic', apiKey, model, system, messages, maxTokens = 400, baseUrl, onDelta, signal }) {
    const p = PRESETS[provider] || PRESETS.anthropic; model = model || p.model; let text = '';
    const pump = async (res, pick) => {
      const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (!res.body || !res.body.getReader || (ct && !/event-stream/.test(ct))) { const d = await res.json(); const t = pick(d, true); if (t) { text += t; if (onDelta) onDelta(text); } return; }   // 스트림이 아니면 한 번에
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const d = line.slice(5).trim(); if (!d || d === '[DONE]') continue; try { const t = pick(JSON.parse(d)); if (t) { text += t; if (onDelta) onDelta(text); } } catch {} }
      }
    };
    if (provider === 'anthropic' || !PRESETS[provider]) {
      const res = await fetch(anBase(baseUrl) + '/v1/messages', { method: 'POST', headers: anHeaders(apiKey), body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }), signal });
      if (!res.ok) throw new Error(errMsg(await res.json().catch(() => ({})), res.status));
      await pump(res, (d, whole) => whole ? (d.content || []).map((b) => b.text || '').join('') : ((d.type === 'content_block_delta' && d.delta && d.delta.text) || ''));
    } else {
      const url = oaUrl(p, baseUrl), headers = oaHeaders(apiKey), key = provider + ':' + model;
      const efforts = provider === 'gemini' ? EFFORTS.slice(effortIdx[key] || 0) : [null]; let res;
      for (let k = 0; k < efforts.length; k++) {
        const ef = efforts[k], body = { model, messages: toOA(system, messages), max_tokens: maxTokens, stream: true }; if (ef) body.reasoning_effort = ef;
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
        if (res.ok) { if (provider === 'gemini') effortIdx[key] = EFFORTS.indexOf(ef); break; }
        const msg = errMsg(await res.json().catch(() => ({})), res.status);
        if (!/reasoning|thinking|effort/i.test(msg) || k === efforts.length - 1) throw new Error(msg);
      }
      await pump(res, (d, whole) => whole ? ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '') : ((d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content) || ''));
      if (!text && res.ok) { /* 일부 서버는 스트림을 지원하지 않아 빈 결과일 수 있음 → 호출자가 비어 있으면 일반 호출로 재시도 */ }
    }
    return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
  }
  const stream = (opts) => withRetry(() => streamOnce(opts), opts);

  /** 빠른 응답용: Gemini는 가벼운 모델을 먼저 쓰고, 없으면 사용자 모델로 자동 대체 */
  function fastModelOf(opts) { const fm = opts.fastModel || (opts.provider === 'gemini' ? 'gemini-2.5-flash-lite' : opts.model); return badFast[fm] ? opts.model : fm; }
  async function fastStream(opts) {
    const fm = fastModelOf(opts);
    try { return await stream({ ...opts, model: fm }); }
    catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (fm !== opts.model && /not found|404|unsupported|invalid.*model|model/i.test(String(e && e.message))) { badFast[fm] = true; return stream({ ...opts, model: opts.model }); }
      throw e;
    }
  }
  /** 연결을 미리 맺어 둔다 (첫 요청의 TLS 핸드셰이크 시간 절약) */
  function warm(provider, baseUrl) {
    try { const p = PRESETS[provider]; const u = (p && (p.endpoint || p.base)) || 'https://api.anthropic.com'; fetch(new URL(u).origin + '/', { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch {}
  }
  const needsKey = (provider) => !((PRESETS[provider] || {}).noKey);
  const MOODS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'thinking', 'sleepy', 'love', 'laugh'];
  /** 스트리밍 중인 글에서 맨 앞 [기분:x] 태그를 떼어낸다. ready=false면 태그가 아직 다 안 와서 표시를 미룬다 */
  function moodSplit(t) {
    const m = t.match(/^\s*\[기분:([a-z]+)\]\s*/);
    if (m) return { ready: true, mood: MOODS.includes(m[1]) ? m[1] : 'neutral', text: t.slice(m[0].length) };
    if (/^\s*\[[^\]]{0,12}$/.test(t)) return { ready: false, mood: 'neutral', text: '' };
    return { ready: true, mood: 'neutral', text: t };
  }
  /** 기기를 조작해야 할 것 같은 말(도구가 필요한 요청) */
  const TOOLISH = /(열어|열기|켜|꺼|끄|끌|실행|파일|폴더|저장|삭제|만들어|설치|앱|어플|설정|화면|볼륨|소리|밝기|전화|문자|카메라|와이파이|블루투스|데이터|배터리|저장공간|캡처|스크린샷|폰에서|핸드폰|명령|adb|쉘|다운로드|사진)/;
  return { PRESETS, call, stream, fastStream, warm, needsKey, moodSplit, TOOLISH, MOODS };
});
