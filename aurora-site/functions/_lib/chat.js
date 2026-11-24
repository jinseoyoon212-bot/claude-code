// Cloudflare Workers AI 중계: 방문자는 API 키가 필요 없다. 키 대신 서버의 AI 바인딩(env.AI)을 쓴다.
// 응답은 OpenAI 호환 형식(스트리밍 SSE 포함)으로 바꿔 돌려주므로 브라우저 쪽은 기존 코드를 그대로 쓴다.

// 사용 모델: 환경변수 AI_MODEL(쉼표로 여러 개 가능)이 있으면 그것, 없으면 아래 순서로 시도한다 (앞 모델이 없거나 실패하면 다음 모델)
export const DEFAULT_MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.1-8b-instruct-fp8-fast'];
const MAX_MESSAGES = 12, MAX_CONTENT = 2000, MAX_TOTAL = 9000, MAX_TOKENS = 900;

const json = (status, error, extra = {}) => new Response(JSON.stringify({ error: { message: error } }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

// ---- IP별 분당 요청 제한 (isolate 메모리 기준의 보조 장치. 엄격한 제한은 Cloudflare WAF 속도 제한 규칙을 함께 쓰세요) ----
const hits = new Map();
export function rateOk(ip, limit, now = Date.now()) {
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= limit) { hits.set(ip, arr); return Math.max(1, Math.ceil((60000 - (now - arr[0])) / 1000)); }
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k);
  return 0;
}

export function originOk(request, env) {
  const origin = request.headers.get('origin'); if (!origin) return true;            // 브라우저의 fetch(POST)는 항상 Origin을 보낸다
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  try { return new URL(origin).host === new URL(request.url).host || allowed.includes(origin); } catch { return false; }
}

// 입력 정리: 역할/길이/개수 제한 (이미지·오디오·도구 호출은 받지 않는다)
export function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null; const out = []; let total = 0;
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role)) continue;
    let c = m.content; if (Array.isArray(c)) c = c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n');
    if (typeof c !== 'string' || !c.trim()) continue;
    c = c.slice(0, MAX_CONTENT); total += c.length; if (total > MAX_TOTAL) break; out.push({ role: m.role, content: c });
  }
  return out.some((m) => m.role === 'user') ? out : null;
}

// <think>…</think> 같은 "생각" 구간은 사용자에게 보이지 않게 제거 (조각 경계에 걸쳐도 동작)
export function makeThinkFilter() {
  let inThink = false, buf = '', dropped = 0;
  const f = (chunk, flush = false) => {
    buf += chunk; let out = '';
    for (;;) {
      if (inThink) { const i = buf.indexOf('</think>'); if (i < 0) { dropped += Math.max(0, buf.length - 8); buf = buf.slice(-8); return out; } dropped += i; buf = buf.slice(i + 8); inThink = false; }
      else {
        const i = buf.indexOf('<think>'); if (i >= 0) { out += buf.slice(0, i); buf = buf.slice(i + 7); inThink = true; continue; }
        const keep = flush ? 0 : (() => { for (let k = Math.min(6, buf.length); k > 0; k--) if ('<think>'.startsWith(buf.slice(-k))) return k; return 0; })();
        out += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); return out;
      }
    }
  };
  Object.defineProperty(f, 'dropped', { get: () => dropped });          // 지금까지 버린 "생각" 글자 수
  return f;
}

const textOf = (d) => {                         // 모델마다 다른 응답 모양을 한 가지로
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (typeof d.response === 'string') return d.response;
  const c = d.choices && d.choices[0]; if (c) { const m = c.delta || c.message || {}; if (typeof m.content === 'string') return m.content; if (typeof c.text === 'string') return c.text; }
  if (d.result) return textOf(d.result);
  return '';
};

// 생각(reasoning)을 끈다. Workers AI 문서: chat_template_kwargs.enable_thinking 의 기본값은 true라서, 끄지 않으면 모델이 매번 길게 생각해 답이 10초 넘게 걸린다.
// 지원하지 않는 모델이면 아래 runModel에서 설정 없이 다시 시도한다.
function prepare(model, messages, strict) {
  const msgs = messages.map((m) => ({ ...m })), extra = { chat_template_kwargs: { enable_thinking: false } };
  if (/qwen3/i.test(model)) for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { msgs[i].content += ' /no_think'; break; }   // Qwen3의 소프트 스위치도 함께
  if (strict) msgs.unshift({ role: 'system', content: '생각 과정이나 설명은 쓰지 말고, 바로 한국어로 짧게 답만 하세요.' });
  return { msgs, extra };
}

const isQuota = (e) => /neuron|daily|allocation|quota|4006|exceeded/i.test(String((e && e.message) || e));

export async function runModel(env, messages, { stream, maxTokens, strict = false }) {
  const models = String(env.AI_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean); const list = models.length ? models : DEFAULT_MODELS;
  let lastErr;
  for (const model of list) {
    const { msgs, extra } = prepare(model, messages, strict), base = { messages: msgs, max_tokens: maxTokens, stream, temperature: 0.7 };
    try { return { model, out: await env.AI.run(model, { ...base, ...extra }) }; }
    catch (e) {
      lastErr = e; if (isQuota(e)) throw e;
      if (Object.keys(extra).length) { try { return { model, out: await env.AI.run(model, base) }; } catch (e2) { lastErr = e2; if (isQuota(e2)) throw e2; } }   // 생각 끄기 설정을 못 받는 모델이면 설정 없이
    }
  }
  throw lastErr || new Error('사용할 수 있는 모델이 없어요.');
}

const FALLBACK_TEXT = '죄송해요, 답을 만들지 못했어요. 한 번만 더 물어봐 주실래요?';

export async function handleChat(request, env) {
  if (!env || !env.AI) return json(503, 'AI 연결(Workers AI 바인딩 "AI")이 설정되지 않았어요. 사이트 관리자에게 알려 주세요.');
  if (!originOk(request, env)) return json(403, '허용되지 않은 출처예요.');
  const wait = rateOk(request.headers.get('cf-connecting-ip') || 'local', Number(env.RATE_PER_MIN) || 100);
  if (wait) return json(429, `요청이 너무 많아요. Retry after ${wait}s`, { 'retry-after': String(wait) });
  let body; try { body = await request.json(); } catch { return json(400, '요청 형식이 올바르지 않아요.'); }
  const messages = cleanMessages(body && body.messages); if (!messages) return json(400, '대화 내용이 비었어요.');
  const strict = body.strict === true;                  // 브라우저가 "생각만 길어져서" 다시 요청할 때 보내는 표시: 스트림 없이, 생각 없이
  const stream = !strict && body.stream === true, maxTokens = Math.max(16, Math.min(Number(body.max_tokens) || 400, MAX_TOKENS));

  let run;
  try { run = await runModel(env, messages, { stream, maxTokens, strict }); }
  catch (e) {
    if (isQuota(e)) return json(429, '오늘의 무료 AI 사용량을 모두 썼어요. 내일 오전 9시(한국 시간)에 다시 채워져요.');
    return json(502, 'AI 서버에서 오류가 났어요: ' + String((e && e.message) || e).slice(0, 160));
  }
  const { out } = run;
  const hdr = { 'cache-control': 'no-store', 'x-aurora-model': run.model };

  if (!stream) {                                    // 한 번만 해석하는 비스트림(strict 재시도 포함): 생각 구간 제거, 비면 생각 없이 한 번 더
    let text = makeThinkFilter()(textOf(out), true).trim();
    if (!text && !strict) { try { const r2 = await runModel(env, messages, { stream: false, maxTokens: 400, strict: true }); text = makeThinkFilter()(textOf(r2.out), true).trim(); } catch { /* 아래 대체 문구 */ } }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text || FALLBACK_TEXT } }] }), { headers: { ...hdr, 'content-type': 'application/json; charset=utf-8' } });
  }
  // 스트리밍: Workers AI의 스트림을 **그대로 통과**시킨다. (이벤트마다 해석하면 무료 플랜의 요청당 CPU 10ms 한도를 넘어 응답이 중간에 끊긴다)
  // 모양 변환·생각 제거는 브라우저(llm.js)가 한다.
  const passthrough = (out && typeof out.getReader === 'function') ? out
    : new ReadableStream({ start(ctl) { const e = new TextEncoder(); ctl.enqueue(e.encode('data: ' + JSON.stringify({ response: textOf(out) }) + '\n\ndata: [DONE]\n\n')); ctl.close(); } });
  return new Response(passthrough, { headers: { ...hdr, 'content-type': 'text/event-stream; charset=utf-8', 'x-accel-buffering': 'no' } });
}
