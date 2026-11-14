// 여러 AI 제공자를 하나의 형식(Anthropic 메시지 블록)으로 다루는 어댑터. 브라우저/Node 공용.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LLM = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const PRESETS = {
    pollinations: { label: 'Pollinations (키 없이 무료)', endpoint: 'https://text.pollinations.ai/openai', model: 'openai', noKey: true, keyUrl: '필요 없음' },
    anthropic: { label: 'Anthropic Claude (유료)', model: 'claude-sonnet-5-5', keyUrl: 'https://console.anthropic.com/settings/keys' },
    gemini: { label: 'Google Gemini (무료 사용량 있음)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyUrl: 'https://aistudio.google.com/apikey' },
    groq: { label: 'Groq (무료 사용량 있음)', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys' },
    openrouter: { label: 'OpenRouter (무료 모델 있음)', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', keyUrl: 'https://openrouter.ai/keys' },
  };
  const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
  const errMsg = (data, status) => { const d = Array.isArray(data) ? data[0] : data; const e = d && d.error; return (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || 'HTTP ' + status; };

  async function call(opts) {
    for (let attempt = 0; ; attempt++) {
      try { return await callOnce(opts); }
      catch (e) {
        const m = /retry after (\d+)\s*s/i.exec(String(e && e.message));
        if (!m || attempt >= 4) throw e;
        const sec = Math.min(120, +m[1] + 2); if (opts.onWait) opts.onWait(sec);
        await new Promise((r) => setTimeout(r, sec * 1000));
      }
    }
  }
  async function callOnce({ provider = 'anthropic', apiKey, model, system, tools = [], messages, maxTokens = 4096, baseUrl }) {
    const p = PRESETS[provider] || PRESETS.anthropic;
    model = model || p.model;
    if (provider === 'anthropic' || !PRESETS[provider]) {
      const base = (baseUrl || env('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com').replace(/\/+$/, '');
      const body = { model, max_tokens: maxTokens, system, messages }; if (tools.length) body.tools = tools;
      const res = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(errMsg(data, res.status));
      return { content: data.content, stop_reason: data.stop_reason };
    }
    // OpenAI 호환 (Gemini / Groq / OpenRouter)
    const oa = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (typeof m.content === 'string') { oa.push({ role: m.role, content: m.content }); continue; }
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use').map((b) => { const c = { id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }; if (b.extra_content) c.extra_content = b.extra_content; return c; });
        const msg = { role: 'assistant', content: text || null }; if (calls.length) msg.tool_calls = calls; oa.push(msg);
      } else for (const b of m.content) if (b.type === 'tool_result') oa.push({ role: 'tool', tool_call_id: b.tool_use_id, content: String(b.content) });
    }
    const body = { model, messages: oa, max_tokens: maxTokens };
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const url = !baseUrl && p.endpoint ? p.endpoint : (baseUrl || p.base).replace(/\/+$/, '') + '/chat/completions';
    const headers = { 'content-type': 'application/json' }; if (apiKey) headers.authorization = 'Bearer ' + apiKey;
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(errMsg(data, res.status));
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const content = []; if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const c of msg.tool_calls || []) { let input = {}; try { input = JSON.parse(c.function.arguments || '{}'); } catch {} const tu = { type: 'tool_use', id: c.id || 'call_' + Math.random().toString(36).slice(2), name: c.function.name, input }; if (c.extra_content) tu.extra_content = c.extra_content; content.push(tu); }
    return { content, stop_reason: (msg.tool_calls || []).length ? 'tool_use' : 'end_turn' };
  }
  const needsKey = (provider) => !((PRESETS[provider] || {}).noKey);
  return { PRESETS, call, needsKey };
});
