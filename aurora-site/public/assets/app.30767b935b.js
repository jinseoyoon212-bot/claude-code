/* Aurora web — 기기 조작 기능 없음 */
/* llm.js */
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

;
/* voice.js */
// 음성 입력 (APK·브라우저·데스크톱 공통)
//  1) 직접 녹음(APK는 네이티브, 그 외는 getUserMedia) + Gemini 받아쓰기   2) APK 전용 폴백: 안드로이드 음성 인식 → 시스템 음성 입력 창
const Voice = (() => {
  const dev = () => null;
  const STT_SYS = '당신은 한국어 음성 받아쓰기 도구입니다. 들린 말을 그대로 한 줄로 적습니다. 설명·따옴표·마침표 장식 없이 말한 내용만 적습니다. 소리가 없거나 알아들을 수 없으면 정확히 (없음) 이라고만 씁니다. 대부분 기기에 시키는 짧은 명령이나 질문입니다.';
  const cur = { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} };
  let wired = false;
  function wire() {}
  const fail = (msg, code) => { const e = new Error(msg); e.code = code; return e; };

  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function wavOf(f32, sr) {
    const buf = new ArrayBuffer(44 + f32.length * 2), v = new DataView(buf), w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, f32.length * 2, true);
    for (let i = 0; i < f32.length; i++) { const x = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  // 웹뷰/브라우저 마이크로 녹음: 말이 시작되면 잡고, 조용해지면 끝낸다
  async function recordJS({ maxMs = 14000, noSpeechMs = 7000, silenceMs = 750 } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AC = window.AudioContext || window.webkitAudioContext; let ctx; try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch {} }
    const src = ctx.createMediaStreamSource(stream), proc = ctx.createScriptProcessor(4096, 1, 1), mute = ctx.createGain(); mute.gain.value = 0;
    const chunks = []; const t0 = performance.now(); let speechStart = 0, lastLoud = 0, floor = 0.006, done = false, finish;
    const stop = () => { if (done) return; done = true; try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); finish(); };
    proc.onaudioprocess = (e) => {
      if (done) return; const d = e.inputBuffer.getChannelData(0), now = performance.now(); chunks.push({ t: now, d: new Float32Array(d) });
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; const rms = Math.sqrt(s / d.length); cur.onLevel(Math.min(1, rms * 9));
      if (now - t0 < 250) { floor = Math.min(0.02, Math.max(floor, rms)); return; }
      if (rms > Math.max(0.018, floor * 2.6)) { if (!speechStart) { speechStart = now; cur.onSpeech(); } lastLoud = now; }
      if (speechStart && now - lastLoud > silenceMs && now - speechStart > 250) stop();
      else if (!speechStart && now - t0 > noSpeechMs) stop();
      else if (now - t0 > maxMs) stop();
    };
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    await new Promise((r) => { finish = r; });
    if (!speechStart) return '';
    const keep = chunks.filter((c) => c.t >= speechStart - 350).map((c) => c.d); let n = 0; keep.forEach((c) => (n += c.length));
    let pcm = new Float32Array(n), o = 0; keep.forEach((c) => { pcm.set(c, o); o += c.length; });
    const sr = ctx.sampleRate;
    if (sr !== 16000) { const r = sr / 16000, m = Math.floor(pcm.length / r), out = new Float32Array(m); for (let i = 0; i < m; i++) { const p = i * r, i0 = Math.floor(p), f = p - i0; out[i] = pcm[i0] * (1 - f) + (pcm[i0 + 1] || pcm[i0]) * f; } pcm = out; }
    return b64(wavOf(pcm, 16000));
  }
  async function recordNative() { return { skip: true }; }
  async function record() {
    const n = await recordNative(); if (n.wav !== undefined) return n.wav;
    try { return await recordJS(); }
    catch (e) { throw new Error((n.err ? '녹음: ' + n.err + ' / ' : '') + '마이크: ' + (e && e.name ? e.name + ' ' : '') + (e && e.message ? e.message : e)); }
  }
  async function geminiStt(wav, s) {
    let hint = ''; try { hint = (await window.PhoneAgent.vocab()).slice(0, 80).join(', '); } catch {}
    const r = await window.LLM.call({ provider: 'gemini', apiKey: s.apiKey, model: s.model, system: STT_SYS, maxTokens: 120,
      messages: [{ role: 'user', content: [{ type: 'text', text: '받아적어줘.' + (hint ? ' 자주 나오는 단어: ' + hint : '') }, { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: wav } }] }] });
    const t = r.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
    return /^\(?\s*없음\s*\)?$/.test(t) ? '' : t;
  }
  async function ensureMic() { return true; }
  async function nativeFallback() { throw new Error("음성 인식을 쓸 수 없어요."); }

  /** hooks: onStatus(text, phase), onLevel(0..1), onSpeech(), onPartial(text) → { text, via } 또는 오류(code: 'mic' | 'silence') */
  async function listen(hooks = {}) {
    Object.assign(cur, { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} }, hooks); wire();
    const D = dev(), s = await window.api.getSettings(), gemini = s.provider === 'gemini' && s.apiKey; let why = '';
    if (D && !(await ensureMic(D))) throw fail('마이크 권한이 필요해요.', 'mic');
    if (gemini) {
      try {
        cur.onStatus('🎤 말씀하세요', 'ready');
        const wav = await record(); if (!wav) throw fail('말소리가 들리지 않았어요.', 'silence');
        cur.onStatus('✍ 받아쓰는 중…', 'transcribing');
        const t = await geminiStt(wav, s); if (!t) throw fail('말소리가 들리지 않았어요.', 'silence');
        return { text: t, via: 'gemini' };
      } catch (e) { if (e.code === 'silence') throw e; why = 'Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e); }
    }
    if (D) return nativeFallback(D, why);
    throw new Error(why || '음성 입력은 Gemini 키가 있을 때 쓸 수 있어요. ⚙ 설정에서 제공자를 Google Gemini(무료)로 바꾸고 키를 넣어 주세요.');
  }

  // ---- 한 번의 호출로 "받아쓰기 + 답변": 말이 끝나면 오디오를 보내 첫 줄은 들린 말, 이어서 답을 스트리밍으로 받는다 ----
  const TURN_SYS = `당신은 "오로라"라는 귀여운 AI입니다. 사용자는 음성으로 말했습니다.
출력 형식(그대로 지킴):
첫 줄: [말] 들린 말을 한국어로 그대로 받아쓴 것
둘째 줄부터:
- 기기 조작(앱 실행, 설정 켜고 끄기, 파일, 전화, 볼륨, 화면 등)을 시키는 말이면 정확히 [도구필요] 만 씁니다.
- 질문이나 대화면 [기분:happy|sad|angry|surprised|thinking|sleepy|love|laugh|neutral] 중 하나로 시작해 한두 문장으로 짧게 답합니다.
소리가 없거나 알아들을 수 없으면 첫 줄을 [말] (없음) 으로 하고 끝냅니다.`;
  // Gemini 한 번의 호출이 실패하면 기존 폴백(안드로이드 음성 인식 → 시스템 음성 입력 창)으로 이어진다
  // 웹사이트 버전: 기기 조작이 없으니 모든 말을 대화로 처리
  const SITE_TURN_SYS = `당신은 "오로라"라는 귀여운 AI입니다. 웹사이트에서 동작하며 사용자의 기기나 파일은 조작할 수 없습니다. 사용자는 음성으로 말했습니다.
출력 형식(그대로 지킴):
첫 줄: [말] 들린 말을 한국어로 그대로 받아쓴 것
둘째 줄부터: [기분:happy|sad|angry|surprised|thinking|sleepy|love|laugh|neutral] 중 하나로 시작해 한두 문장으로 짧게 답합니다. 기기 조작을 시키는 말이면 웹 버전에서는 할 수 없다고 짧게 알려 줍니다.
소리가 없거나 알아들을 수 없으면 첫 줄을 [말] (없음) 으로 하고 끝냅니다.`;
  async function listenAndAnswer(hooks = {}) {
    const s = await window.api.getSettings();
    if (!(s.provider === 'gemini' && s.apiKey)) { const v = await listen(hooks); return { text: v.text }; }       // Gemini가 아니면 기존 방식
    try { return await mergedTurn(hooks, s); }
    catch (e) {
      if (e && (e.code === 'silence' || e.code === 'mic')) throw e;
      const D = dev(), why = /^Gemini/.test(e && e.message) ? e.message : 'Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e);
      if (D) return nativeFallback(D, why);
      throw new Error(why);
    }
  }
  async function mergedTurn(hooks, s) {
    Object.assign(cur, { onLevel() {}, onSpeech() {}, onPartial() {}, onStatus() {} }, hooks); wire();
    const D = dev(); LLM.warm('gemini');                                                                           // 녹음하는 동안 연결을 미리 맺어 둔다
    if (D && !(await ensureMic(D))) throw fail('마이크 권한이 필요해요.', 'mic');
    cur.onStatus('🎤 말씀하세요', 'ready');
    let wav; try { wav = await record(); } catch (e) { throw new Error('Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e)); }
    if (!wav) throw fail('말소리가 들리지 않았어요.', 'silence');
    if (hooks.onRecorded) hooks.onRecorded();
    cur.onStatus('✍ 듣고 있어요…', 'transcribing');
    let hint = ''; try { hint = (await window.PhoneAgent.vocab()).slice(0, 40).join(', '); } catch {}
    const ctrl = new AbortController(); let transcript = '', told = false, aborted = false, lastAns = '';
    const parse = (txt) => { const m = txt.match(/^\s*\[말\]\s*([^\n]*)(\n([\s\S]*))?$/); return m ? { t: m[1].trim(), done: m[2] !== undefined, rest: m[3] || '' } : null; };
    let rs;
    try {
      rs = await LLM.fastStream({ provider: 'gemini', apiKey: s.apiKey, model: s.model, fastModel: s.fastModel, system: window.AURORA_SITE ? SITE_TURN_SYS : TURN_SYS, maxTokens: 360, signal: ctrl.signal,
        messages: [{ role: 'user', content: [{ type: 'text', text: '듣고 처리해줘.' + (hint ? ' 자주 나오는 단어: ' + hint : '') }, { type: 'audio', source: { type: 'base64', media_type: 'audio/wav', data: wav } }] }],
        onDelta: (txt) => {
          const p = parse(txt); if (!p || !p.done) return;
          if (!told) {                                                                                       // 첫 줄(들린 말)이 완성되는 순간
            told = true; transcript = p.t; if (!transcript || /^\(?\s*없음\s*\)?$/.test(transcript)) { aborted = true; ctrl.abort(); return; }
            if (hooks.onTranscript) hooks.onTranscript(transcript);
            const pa = window.PhoneAgent; const cmd = !window.AURORA_SITE && LLM.TOOLISH.test(transcript);
            if (cmd) { aborted = true; ctrl.abort(); return; }                                              // 기기 조작 말이면 답 생성 중단 → 명령 경로로
            if (pa && pa.matchScore) pa.matchScore(transcript).then((sc) => { if (sc >= 2 && !aborted) { aborted = true; ctrl.abort(); } }).catch(() => {});
          }
          const c = LLM.moodSplit(p.rest); if (c.ready && c.text && c.text !== lastAns && !/^\s*\[도구필요/.test(p.rest)) { lastAns = c.text; if (hooks.onDelta) hooks.onDelta(c.text); }
        } });
    } catch (e) {
      if (!(aborted && e && e.name === 'AbortError')) throw new Error('Gemini 받아쓰기 실패: ' + (e && e.message ? e.message : e));
    }
    if (aborted && !transcript) throw fail('말소리가 들리지 않았어요.', 'silence');
    if (aborted) return { text: transcript };                                                                  // 명령: 호출자가 즉시 실행 경로로 처리
    const raw = (rs && rs.content[0] && rs.content[0].text || ''); const p = parse(raw);
    if (!p) {                                                                                                 // 모델이 형식을 안 지켰으면 전체를 받아쓴 말로 취급
      const t = raw.trim().replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '');
      if (!t || /^\(?\s*없음\s*\)?$/.test(t)) throw fail('말소리가 들리지 않았어요.', 'silence');
      if (hooks.onTranscript && !told) hooks.onTranscript(t); return { text: t };
    }
    if (!p.t || /^\(?\s*없음\s*\)?$/.test(p.t)) throw fail('말소리가 들리지 않았어요.', 'silence');
    if (!told && hooks.onTranscript) hooks.onTranscript(p.t);
    if (!p.rest.trim() || /^\s*\[도구필요/.test(p.rest)) return { text: p.t, needTools: true };
    const c = LLM.moodSplit(p.rest.trim()); return { text: p.t, reply: { text: c.text.trim() || p.rest.trim(), mood: c.mood } };
  }

  return { listen, listenAndAnswer, available: () => true };
})();

;
/* fx.js */
// 모션 엔진: 스프링 이징, 젤리(찌그러짐/늘어남), 보내기 → 풍선으로 "쭉 빨려 올라가는" 액체 효과
const FX = (() => {
  const root = document.documentElement;
  const easing = (name = 'spring') => { const v = getComputedStyle(root).getPropertyValue('--' + name).trim(); return v || 'cubic-bezier(.34,1.56,.64,1)'; };
  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function jelly(el, cls = 'jelly') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
  document.addEventListener('animationend', (e) => { if (e.target.classList && e.target.classList.contains('jelly')) e.target.classList.remove('jelly'); });

  /**
   * text를 from(출발 사각형)에서 ubub(위 풍선) 자리로 쭉 빨려 올라가게 한다.
   * 1) 출발 지점에서 살짝 웅크림(예비동작) 2) 위로 가속하며 가늘고 길게 늘어남 3) 도착 때 통통 눌렸다 정착
   * 뒤쪽에는 액체 방울이 따라오며 끈적하게 이어진다(고이 SVG 필터).
   */
  function flyUp(text, from, ubub) {
    return new Promise((resolve) => {
      const done = () => { ubub.style.visibility = ''; ubub.classList.add('in'); resolve(); };
      try {
        ubub.classList.remove('fade', 'in'); ubub.textContent = text;
        if (reduce() || !ubub.animate) { done(); return; }
        ubub.style.visibility = 'hidden'; ubub.classList.add('measure');
        const to = ubub.getBoundingClientRect(); ubub.classList.remove('measure');
        if (!to.width || !to.height) { done(); return; }

        const fx = from.left + from.width / 2, fy = from.top + from.height / 2, tx = to.left + to.width / 2, ty = to.top + to.height / 2;
        const dx = fx - tx, dy = fy - ty, dist = Math.hypot(dx, dy);
        const sx = clamp(from.width / to.width, .22, 2.2), sy = clamp(from.height / to.height, .35, 1.4);
        const side = (dx >= 0 ? -1 : 1) * Math.min(18, dist * .05);                 // 살짝 곡선을 그리며 올라감

        const el = document.createElement('div'); el.className = 'fly'; el.textContent = text;
        Object.assign(el.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
        document.body.appendChild(el);

        // 방울(고이 효과): 출발점에서 같은 길을 시간차로 따라온다
        let fxl = document.getElementById('fx'); if (!fxl) { fxl = document.createElement('div'); fxl.id = 'fx'; document.body.appendChild(fxl); }
        const N = 9, drops = [];
        for (let i = 0; i < N; i++) {
          const d = document.createElement('i'); d.className = 'drop'; const sz = 22 - i * 1.6; d.style.cssText = `left:${fx - sz / 2}px;top:${fy - sz / 2}px;width:${sz}px;height:${sz}px`;
          fxl.appendChild(d); drops.push(d);
          d.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
            { transform: `translate(${(tx - fx) * .5 + side * 1.4}px,${(ty - fy) * .5}px) scale(${1 - i * .05})`, opacity: 1, offset: .6 },
            { transform: `translate(${tx - fx}px,${ty - fy - 4}px) scale(.35)`, opacity: .0, offset: 1 },
          ], { duration: 520 + i * 28, delay: i * 34, easing: 'cubic-bezier(.55,0,.2,1)', fill: 'both' });
        }

        const T = (x, y, a, b) => `translate(${x}px,${y}px) scale(${a},${b})`;
        const dur = clamp(560 + dist * .55, 700, 1100);
        const anim = el.animate([
          { transform: T(dx, dy, sx, sy), opacity: 1, offset: 0, easing: 'cubic-bezier(.3,0,.5,1)' },
          { transform: T(dx, dy + 7, sx * 1.05, sy * .8), offset: .14, easing: 'cubic-bezier(.55,.05,.35,1)' },                  // 웅크림
          { transform: T(dx * .55 + side, dy * .55, .56, 1.7), offset: .46, easing: 'cubic-bezier(.4,0,.2,1)' },                   // 길게 늘어나며 빨려 올라감
          { transform: T(side * .2, -dist * .035 - 8, 1.1, .86), offset: .78, easing: 'cubic-bezier(.3,.9,.4,1)' },               // 도착: 위로 살짝 넘치며 납작
          { transform: T(0, 3, .975, 1.04), offset: .9, easing: 'cubic-bezier(.3,.9,.4,1)' },
          { transform: T(0, 0, 1, 1), opacity: 1, offset: 1 },
        ], { duration: dur, fill: 'both' });
        anim.onfinish = () => { el.remove(); drops.forEach((d) => d.remove()); done(); jelly(ubub, 'land'); };
        anim.oncancel = () => { el.remove(); drops.forEach((d) => d.remove()); done(); };
      } catch { done(); }
    });
  }
  return { easing, jelly, flyUp, clamp };
})();

;
/* site-api.js */
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

;
/* face.js */
// 둥글둥글 무지개 오로라 얼굴 — 스프링 물리 기반의 말랑한 움직임
const Face = (() => {
  const cv = document.getElementById('face'), g = cv.getContext('2d');
  const W = cv.width, C = W / 2, R = 180;
  let mood = 'neutral', t = 0, talking = false, talkLevel = 0, blink = 0, nextBlink = 2, saccadeT = 1;
  const INK = '#3b2358';

  // 스프링: 목표값을 향해 탄력 있게 움직임
  const spring = (x = 0, k = 90, d = 9) => ({ x, v: 0, to: x, k, d });
  const step = (s, dt) => { const a = s.k * (s.to - s.x) - s.d * s.v; s.v += a * dt; s.x += s.v * dt; };
  const B = { dx: spring(0, 60, 7), dy: spring(0, 70, 6), rot: spring(0, 70, 6), sq: spring(0, 120, 8) };
  const gaze = { x: spring(0, 40, 9), y: spring(0, 40, 9) };

  // 표정 파라미터(모두 스프링으로 부드럽게 전환)
  const P = {
    neutral:  { eye: 1,   happy: 0, size: 1,    smile: 0.55, open: 0,    cheek: 0.45, lid: 0,   brow: 0 },
    happy:    { eye: 0.9, happy: 1, size: 1,    smile: 1,    open: 0.35, cheek: 1,    lid: 0,   brow: 0 },
    laugh:    { eye: 0.9, happy: 1, size: 1,    smile: 1,    open: 1,    cheek: 1,    lid: 0,   brow: 0 },
    sad:      { eye: 1,   happy: 0, size: 1.1,  smile: -0.7, open: 0,    cheek: 0.1,  lid: 0.25, brow: -1 },
    angry:    { eye: 0.85, happy: 0, size: 0.95, smile: -0.35, open: 0,   cheek: 0.7,  lid: 0.3, brow: 1 },
    surprised:{ eye: 1.15, happy: 0, size: 1.25, smile: 0,    open: 0.8,  cheek: 0.3,  lid: 0,   brow: 0 },
    thinking: { eye: 1,   happy: 0, size: 1,    smile: 0.1,  open: 0,    cheek: 0.35, lid: 0,   brow: 0 },
    sleepy:   { eye: 0.15, happy: 0, size: 1,   smile: 0.25, open: 0.15, cheek: 0.4,  lid: 0,   brow: 0 },
    love:     { eye: 1,   happy: 0, size: 1,    smile: 1,    open: 0.25, cheek: 1,    lid: 0,   brow: 0 },
  };
  const cur = {}; for (const k in P.neutral) cur[k] = spring(P.neutral[k], 70, 10);

  const RULES = [
    [/사랑|좋아해|하트|♥|❤|고마워|감사|최고/, 'love', 'bounce'],
    [/ㅋㅋ|ㅎㅎ|웃기|재밌|하하|lol/i, 'laugh', 'bounce'],
    [/슬프|우울|힘들|ㅠㅠ|ㅜㅜ|눈물|외로|미안/, 'sad', 'droop'],
    [/화나|짜증|싫어|열받|최악|바보|꺼져/, 'angry', 'shake'],
    [/헉|놀라|대박|우와|와!|진짜\?|뭐\?!|!!/, 'surprised', 'jump'],
    [/졸려|잘자|피곤|굿나잇|zzz/i, 'sleepy', 'sway'],
    [/\?|뭐|왜|어떻게|알려|찾아|검색|실행|열어|만들어|저장|삭제/, 'thinking', 'tilt'],
    [/안녕|하이|반가|hello|hi\b|좋아|기뻐|행복|신나|yay|굿/i, 'happy', 'wave'],
  ];

  function setMood(m) { mood = P[m] ? m : 'neutral'; for (const k in cur) cur[k].to = P[mood][k]; }
  // 움직임은 스프링에 "톡" 힘을 줘서 만든다 → 말랑하고 자연스럽게 흔들렸다 가라앉음
  const timers = [];
  const later = (ms, fn) => timers.push({ at: t + ms / 1000, fn });
  function doMotion(m) {
    timers.length = 0;
    switch (m) {
      case 'bounce': for (let i = 0; i < 3; i++) later(i * 380, () => { B.dy.v = -520 + i * 80; B.sq.v = -2; }); break;
      case 'jump': B.sq.v = 6; later(120, () => { B.dy.v = -900; B.sq.v = -4; }); break;
      case 'shake': for (let i = 0; i < 6; i++) later(i * 90, () => { B.dx.v = (i % 2 ? -1 : 1) * 420; B.rot.v = (i % 2 ? 1 : -1) * 1.2; }); break;
      case 'droop': B.dy.to = 22; B.sq.to = 0.05; later(1800, () => { B.dy.to = 0; B.sq.to = 0; }); break;
      case 'sway': for (let i = 0; i < 3; i++) later(i * 700, () => { B.rot.v = (i % 2 ? -1 : 1) * 1.4; }); break;
      case 'tilt': B.rot.to = 0.2; later(2200, () => (B.rot.to = 0)); gaze.y.to = -0.6; later(2200, () => (gaze.y.to = 0)); break;
      case 'nod': B.dy.v = 220; later(220, () => (B.dy.v = 180)); break;
      case 'wave': for (let i = 0; i < 4; i++) later(i * 220, () => { B.rot.v = (i % 2 ? -1 : 1) * 1.6; B.dy.v = -120; }); break;
    }
  }
  function react(text) {
    for (const [re, m, mo] of RULES) if (re.test(text)) { setMood(m); doMotion(mo); return m; }
    setMood('neutral'); doMotion('nod'); return 'neutral';
  }
  function lookAt(x, y) { gaze.x.to = x; gaze.y.to = y; }
  let mouseOn = 0;
  addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); lookAt(Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / 260)), Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / 260))); mouseOn = t; });

  // ---------- 그리기 ----------
  function blob(cx, cy, r, stops) {
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    stops.forEach(([o, c]) => rg.addColorStop(o, c)); g.fillStyle = rg; g.fillRect(-R, -R, R * 2, R * 2);
  }
  function drawBody() {
    g.beginPath(); g.arc(0, 0, R, 0, 7); g.save(); g.clip();
    const cg = g.createConicGradient(t * 0.35, 0, 0);
    ['#ff9ad0', '#ffd08a', '#fff39a', '#a6ffcf', '#9be7ff', '#b7a6ff', '#e5a6ff', '#ff9ad0'].forEach((c, i, a) => cg.addColorStop(i / (a.length - 1), c));
    g.fillStyle = cg; g.fillRect(-R, -R, R * 2, R * 2);
    blob(0, 0, R, [[0, 'rgba(255,255,255,.55)'], [0.7, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]);   // 파스텔로 부드럽게
    for (let i = 0; i < 3; i++) { const a = t * (0.3 + i * 0.13) + i * 2.1; blob(Math.cos(a) * 90, Math.sin(a * 1.2) * 90, 130, [[0, `hsla(${(t * 40 + i * 120) % 360},100%,85%,.5)`], [1, 'rgba(255,255,255,0)']]); }
    blob(-70, -90, 120, [[0, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);   // 몽글한 하이라이트
    blob(40, 120, 150, [[0, 'rgba(180,130,255,.0)'], [1, 'rgba(150,100,230,.22)']]);
    g.restore();
  }
  function drawEye(x, y, side) {
    const s = cur.size.x, open = cur.eye.x * (1 - blink) , hp = Math.max(0, Math.min(1, cur.happy.x));
    const gx = gaze.x.x * 7, gy = gaze.y.x * 6;
    g.save(); g.translate(x + gx, y + gy);
    if (mood === 'love') { heart(0, 0, 26 * (1 + Math.sin(t * 6) * 0.06)); g.restore(); return; }
    g.strokeStyle = INK; g.lineCap = 'round'; g.lineWidth = 9;
    if (hp > 0.5 || open < 0.2) {                              // ^ ^ 또는 감은 눈 : 둥근 아치
      g.beginPath();
      if (hp > 0.5) g.arc(0, 8, 20, Math.PI * 1.1, Math.PI * 1.9); else { g.moveTo(-18, 0); g.quadraticCurveTo(0, 10, 18, 0); }
      g.stroke(); g.restore(); return;
    }
    const r = 19 * s, sy = Math.max(0.08, open);
    g.fillStyle = INK; g.beginPath(); g.ellipse(0, 0, r, r * sy, 0, 0, 7); g.fill();       // 동글동글 까만 눈
    if (sy > 0.4) {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-r * 0.32, -r * 0.34 * sy, r * 0.36, 0, 7); g.fill();  // 큰 하이라이트
      g.beginPath(); g.arc(r * 0.34, r * 0.3 * sy, r * 0.17, 0, 7); g.fill();                        // 작은 하이라이트
    }
    const lid = cur.lid.x;                                     // 눈꺼풀: 슬픔/화남을 부드럽게
    if (lid > 0.02) {
      g.fillStyle = '#d9b4ff'; g.save(); g.beginPath(); g.ellipse(0, 0, r + 1, r * sy + 1, 0, 0, 7); g.clip();
      g.rotate(cur.brow.x * side * 0.35); g.fillRect(-r - 4, -r - 4, r * 2 + 8, (r * 2 + 8) * lid * 0.9); g.restore();
    }
    g.restore();
  }
  function heart(x, y, s) {
    g.fillStyle = '#ff6fa3'; g.beginPath(); g.moveTo(x, y + s * 0.7);
    g.bezierCurveTo(x - s * 1.3, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.4);
    g.bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.3, y - s * 0.1, x, y + s * 0.7); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x - s * 0.4, y - s * 0.35, s * 0.15, 0, 7); g.fill();
  }
  function drawFace() {
    const ex = 66, ey = -10;
    drawEye(-ex, ey, 1); drawEye(ex, ey, -1);
    // 동글동글 볼터치
    const ck = cur.cheek.x;
    [-1, 1].forEach((sd) => { const cx = sd * 108, cy = 36; const rg = g.createRadialGradient(cx, cy, 0, cx, cy, 30); rg.addColorStop(0, `rgba(255,105,160,${0.25 + ck * 0.5})`); rg.addColorStop(1, 'rgba(255,105,160,0)'); g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, 30, 0, 7); g.fill(); });
    // 동그란 코
    g.fillStyle = '#8a4a78'; g.beginPath(); g.arc(0, 28, 7, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.arc(-2, 26, 2.2, 0, 7); g.fill();
    // 작고 동그란 입
    const target = talking ? (0.35 + (Math.sin(t * 13) * 0.5 + 0.5) * 0.5) * (0.6 + 0.4 * Math.sin(t * 5.3)) : 0;
    talkLevel += (target - talkLevel) * 0.25;
    const open = Math.min(1, cur.open.x + talkLevel), sm = cur.smile.x;
    g.save(); g.translate(0, 56); g.lineWidth = 7; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = INK;
    if (open > 0.1) {                                          // 동그란 입 (ㅇ / D 모양)
      const w = 15 + 14 * Math.max(0, sm) + 5 * open, h = 6 + 24 * open;
      g.beginPath(); g.moveTo(-w, 0); g.quadraticCurveTo(0, sm * 6, w, 0); g.bezierCurveTo(w, h * 1.1, -w, h * 1.1, -w, 0); g.closePath();
      g.fillStyle = '#6a2447'; g.fill(); g.stroke();
      g.save(); g.clip(); g.fillStyle = '#ff8fb0'; g.beginPath(); g.ellipse(0, h, w * 0.6, h * 0.45, 0, 0, 7); g.fill(); g.restore();
    } else {                                                   // 귀여운 작은 미소 (ω 느낌 없이 단순 곡선)
      const w = 20 + 8 * Math.abs(sm);
      g.beginPath(); g.moveTo(-w, -sm * 3); g.quadraticCurveTo(0, sm * 20 + 2, w, -sm * 3); g.stroke();
    }
    g.restore();
    // 말풍선 대신 작은 이펙트
    if (mood === 'thinking') { g.fillStyle = 'rgba(150,128,255,.78)'; [[112, -112, 5], [130, -134, 8], [154, -164, 12]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y + Math.sin(t * 3 + r) * 3, r, 0, 7); g.fill(); }); }
    if (mood === 'sleepy') { g.fillStyle = '#a392ff'; g.font = 'bold 32px sans-serif'; g.fillText('z', 112, -86 + Math.sin(t * 2) * 6); g.font = 'bold 22px sans-serif'; g.fillText('z', 140, -118 + Math.sin(t * 2 + 1) * 6); }
    if (mood === 'sad') { g.fillStyle = '#9bdcff'; const k = (t * 0.6) % 1; g.globalAlpha = 1 - k * 0.6; g.beginPath(); g.ellipse(-ex - 8, ey + 20 + k * 80, 6, 9, 0, 0, 7); g.fill(); g.globalAlpha = 1; }
    if (mood === 'angry') { g.fillStyle = 'rgba(255,100,130,.9)'; g.font = 'bold 30px sans-serif'; g.fillText('💢', 100, -110); }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (t >= timers[i].at) { const f = timers.splice(i, 1)[0].fn; f(); }
    for (const k in B) step(B[k], dt); for (const k in cur) step(cur[k], dt); step(gaze.x, dt); step(gaze.y, dt);
    // 마우스가 오래 가만있으면 시선이 자연스럽게 두리번
    saccadeT -= dt; if (saccadeT < 0 && t - mouseOn > 4) { lookAt((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8); saccadeT = 1.5 + Math.random() * 2.5; }
    // 눈 깜빡임(부드럽게 감았다 뜸)
    nextBlink -= dt; if (nextBlink < 0) { blink = 1; nextBlink = 2.2 + Math.random() * 3.5; if (Math.random() < 0.2) nextBlink = 0.25; }
    blink = Math.max(0, blink - dt * 7);
    // 숨쉬기 + 둥실둥실
    const br = Math.sin(t * 1.9), idleY = Math.sin(t * 1.3) * 7, idleX = Math.sin(t * 0.7) * 3, idleR = Math.sin(t * 0.9) * 0.025;
    const sq = B.sq.x + br * 0.012;                      // 눌림(+)이면 납작하게
    const sx = 1 + sq, sy = 1 - sq * 1.1;
    g.clearRect(0, 0, W, W);
    // 바닥 그림자 (점프하면 작아짐)
    const sh = Math.max(0.5, 1 - (-(B.dy.x + idleY)) / 220);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(C + B.dx.x, C + R + 28, R * 0.6 * sh, 14 * sh, 0, 0, 7); g.fill();
    g.save(); g.translate(C + B.dx.x + idleX, C + B.dy.x + idleY); g.rotate(B.rot.x + idleR); g.scale(sx, sy);
    drawBody(); drawFace(); g.restore();
    requestAnimationFrame(frame);
  }
  setMood('neutral'); requestAnimationFrame(frame);
  // 젤리 포크: 터치/도착 때 통통 눌렸다 튕기는 반응 (얼굴 모양은 그대로, 움직임만)
  const poke = (s = 1) => { B.sq.v = 7 * s; B.dy.v = -300 * s; B.rot.v = (Math.random() - 0.5) * 1.2 * s; };
  return { setMood, doMotion, react, poke, setTalking: (v) => (talking = v), lookAt };
})();

;
/* renderer.js */
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
const toolLabel = {};

api.onEvent((ev) => {
  if (ev.type === 'delta') { streamBubble(ev.text); return; }
  if (ev.type === 'wait') { bubble.textContent = `무료 서버 한도 때문에 ${ev.seconds}초 기다리는 중이에요… ⏳`; Face.setMood('sleepy'); return; }
  if (ev.type === 'tool') { bubble.textContent = '🔧 ' + ((toolLabel[ev.name] || (() => ev.name))(ev.input)) + ' …'; Face.setMood('thinking'); Face.doMotion('nod'); addLog((toolLabel[ev.name] || (() => ev.name))(ev.input)); }
});

// ---- 한 번의 요청(턴): 시작 → (글자가 스트리밍으로 표시) → 끝. 걸린 시간도 기록 ----
let turn = null;
function beginTurn(text, from, t0) {
  busy = true; document.body.classList.add('busy');
  turn = { t0: t0 || performance.now(), tFirst: 0, streamed: false };
  const origin = from === 'face' ? faceRect() : inputRect(text);
  if (from === 'input') { input.value = ''; FX.jelly($('form'), 'jelly'); }
  Face.react(text); setBubble('…');
  history.push({ role: 'user', content: text });
  if (window.AuroraAssist && window.AuroraAssist.onTurnStart) window.AuroraAssist.onTurnStart();
  FX.flyUp(text, origin, ubub).then(() => { Face.poke(0.7); Face.lookAt(0, -0.5); setTimeout(() => Face.lookAt(0, 0), 900); });
}
function streamBubble(text) {                                   // 답이 오는 대로 풍선에 표시 (첫 글자가 나오기까지의 체감 시간을 줄인다)
  if (!turn || !text) return;
  if (!turn.tFirst) turn.tFirst = performance.now();
  if (!turn.streamed) { turn.streamed = true; setBubble(text); } else bubble.textContent = text;
  if (window.AuroraAssist && window.AuroraAssist.onDelta) window.AuroraAssist.onDelta(text);
}
function finishTurn(r) {
  busy = false; document.body.classList.remove('busy');
  fadeT = setTimeout(() => ubub.classList.add('fade'), 7000);
  const now = performance.now(), t = turn; turn = null;
  if (t) addLog('⏱ ' + (r.error ? '' : '첫 응답 ' + (((t.tFirst || now) - t.t0) / 1000).toFixed(1) + '초 · ') + '전체 ' + ((now - t.t0) / 1000).toFixed(1) + '초');
  if (r.error) { Face.setMood('sad'); Face.doMotion('droop'); setBubble('⚠ ' + r.error); history.pop(); if (window.AuroraAssist) window.AuroraAssist.onAnswer({ text: '오류가 났어요. ' + String(r.error).slice(0, 80) }); return; }
  history.push({ role: 'assistant', content: r.text });
  Face.setMood(r.mood); Face.doMotion({ happy: 'wave', laugh: 'bounce', love: 'bounce', sad: 'droop', angry: 'shake', surprised: 'jump', sleepy: 'sway', thinking: 'tilt' }[r.mood] || 'nod');
  if (t && t.streamed) bubble.textContent = r.text; else setBubble(r.text);
  if (window.AuroraAssist) window.AuroraAssist.onAnswer(r);
  Face.setTalking(true); setTimeout(() => Face.setTalking(false), Math.min(4000, 300 + r.text.length * 60));
}
async function sendText(raw, from = 'input') {
  const text = String(raw || '').trim(); if (!text || busy) return;
  beginTurn(text, from);
  let r; try { r = await api.send(history); } catch (e) { r = { error: String(e && e.message || e) }; }
  finishTurn(r);
}
// 음성 한 턴: 말이 끝나면 오디오 한 번으로 "받아쓰기 + 답변"(Gemini). 기기 조작 명령이면 곧바로 명령 경로로
async function voiceTurn(hooks = {}) {
  let began = false, recEnd = 0;
  let v;
  try {
    v = await Voice.listenAndAnswer({ ...hooks, onRecorded: () => { recEnd = performance.now(); if (hooks.onRecorded) hooks.onRecorded(); },
      onTranscript: (t) => { if (!began) { began = true; beginTurn(t, 'face', recEnd || undefined); } }, onDelta: (a) => streamBubble(a) });
  } catch (e) { if (began) finishTurn({ error: e && e.message ? e.message : String(e) }); throw e; }
  if (!began) beginTurn(v.text, 'face', recEnd || undefined);
  let r;
  if (v.reply) r = v.reply; else { try { r = await api.send(history); } catch (e) { r = { error: String(e && e.message || e) }; } }
  finishTurn(r);
}
window.voiceTurn = voiceTurn;
window.sendText = sendText;
window.isBusy = () => busy;
$('form').addEventListener('submit', (e) => { e.preventDefault(); sendText(input.value, 'input'); });
input.addEventListener('input', () => Face.lookAt(0, 0.6));

// 설정: data-k 속성이 붙은 입력칸을 자동으로 읽고 저장 (화면에 보이는 칸만)
const dlg = $('settings');
const prov = $('provider');
Object.entries(LLM.PRESETS).forEach(([k, v]) => { if (v.siteOnly && !window.AURORA_SITE) return; const o = document.createElement('option'); o.value = k; o.textContent = v.label; prov.appendChild(o); });
const modelEl = () => dlg.querySelector('[data-k=model]');
function provChanged(resetModel) {
  const p = LLM.PRESETS[prov.value] || LLM.PRESETS.pollinations, m = modelEl();
  if (resetModel && (!m.value || Object.values(LLM.PRESETS).some((x) => x.model === m.value))) m.value = p.model;
  $('keyHelp').textContent = 'API 키 발급: ' + p.keyUrl + (prov.value === 'pollinations' || prov.value === 'aurora' ? '  (API 키 칸은 비워 두세요)' : prov.value === 'anthropic' ? '' : '  (무료, 카드 등록 없이 가능. 한도 초과 시 잠시 후 재시도)');
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
    await voiceTurn({
      onStatus: (t) => setBubble(t), onSpeech: () => setBubble('🎤 듣고 있어요…'), onPartial: (t) => showUser(t, true),
      onLevel: (l) => root.style.setProperty('--lvl', Number(l).toFixed(2)), onRecorded: () => { document.body.classList.remove('listening'); root.style.setProperty('--lvl', 0); },
    });
    listening = false; document.body.classList.remove('listening'); root.style.setProperty('--lvl', 0);
  } catch (e) {
    listening = false; document.body.classList.remove('listening'); root.style.setProperty('--lvl', 0); Face.setMood('sad'); Face.doMotion('droop');
    setBubble(e.code === 'silence' ? '말소리가 들리지 않았어요. 얼굴을 눌러 다시 말해 주세요.' : e.code === 'mic' ? '마이크 권한이 필요해요. ⚙ 설정에서 마이크 권한을 허용해 주세요.' : '⚠ ' + (e && e.message ? e.message : e));
  }
});

// ---- 설정 시트: 스프링으로 열리고, 닫을 때 부드럽게 접힘 ----
dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); dlg.classList.add('closing'); setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 260); });

// ---- 미리 데우기: AI 서버 연결, 설치된 앱 목록 (첫 요청의 대기 시간 절약) ----
api.getSettings().then((s) => { if (s && (s.apiKey || s.provider === 'pollinations') && window.LLM) LLM.warm(s.provider); if (window.PhoneAgent && PhoneAgent.available && PhoneAgent.available()) PhoneAgent.vocab(); }).catch(() => {});
