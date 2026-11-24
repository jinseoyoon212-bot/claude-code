// Cloudflare Workers AI 중계: 방문자는 API 키가 필요 없다. 키 대신 서버의 AI 바인딩(env.AI)을 쓴다.
// 응답은 OpenAI 호환 형식(스트리밍 SSE 포함)으로 바꿔 돌려주므로 브라우저 쪽은 기존 코드를 그대로 쓴다.

// 사용 모델: 환경변수 AI_MODEL(쉼표로 여러 개 가능)이 있으면 그것, 없으면 아래 순서로 시도한다 (앞 모델이 없거나 실패하면 다음 모델)
export const DEFAULT_MODELS = ['@cf/google/gemma-4-26b-a4b-it', '@cf/qwen/qwen3-30b-a3b-fp8', '@cf/meta/llama-3.1-8b-instruct-fp8-fast'];
const MAX_MESSAGES = 12, MAX_CONTENT = 2000, MAX_TOTAL = 9000, MAX_TOKENS = 600;

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
  let inThink = false, buf = '';
  return (chunk, flush = false) => {
    buf += chunk; let out = '';
    for (;;) {
      if (inThink) { const i = buf.indexOf('</think>'); if (i < 0) { buf = buf.slice(-8); return out; } buf = buf.slice(i + 8); inThink = false; }
      else {
        const i = buf.indexOf('<think>'); if (i >= 0) { out += buf.slice(0, i); buf = buf.slice(i + 7); inThink = true; continue; }
        const keep = flush ? 0 : (() => { for (let k = Math.min(6, buf.length); k > 0; k--) if ('<think>'.startsWith(buf.slice(-k))) return k; return 0; })();
        out += buf.slice(0, buf.length - keep); buf = buf.slice(buf.length - keep); return out;
      }
    }
  };
}

const textOf = (d) => {                         // 모델마다 다른 응답 모양을 한 가지로
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (typeof d.response === 'string') return d.response;
  const c = d.choices && d.choices[0]; if (c) { const m = c.delta || c.message || {}; if (typeof m.content === 'string') return m.content; if (typeof c.text === 'string') return c.text; }
  if (d.result) return textOf(d.result);
  return '';
};

const isQuota = (e) => /neuron|daily|allocation|quota|4006|exceeded/i.test(String((e && e.message) || e));

export async function runModel(env, messages, { stream, maxTokens }) {
  const models = String(env.AI_MODEL || '').split(',').map((s) => s.trim()).filter(Boolean); const list = models.length ? models : DEFAULT_MODELS;
  let lastErr;
  for (const model of list) {
    try { return { model, out: await env.AI.run(model, { messages, max_tokens: maxTokens, stream, temperature: 0.7 }) }; }
    catch (e) { lastErr = e; if (isQuota(e)) throw e; }
  }
  throw lastErr || new Error('사용할 수 있는 모델이 없어요.');
}

export async function handleChat(request, env) {
  if (!env || !env.AI) return json(503, 'AI 연결(Workers AI 바인딩 "AI")이 설정되지 않았어요. 사이트 관리자에게 알려 주세요.');
  if (!originOk(request, env)) return json(403, '허용되지 않은 출처예요.');
  const wait = rateOk(request.headers.get('cf-connecting-ip') || 'local', Number(env.RATE_PER_MIN) || 100);
  if (wait) return json(429, `요청이 너무 많아요. Retry after ${wait}s`, { 'retry-after': String(wait) });
  let body; try { body = await request.json(); } catch { return json(400, '요청 형식이 올바르지 않아요.'); }
  const messages = cleanMessages(body && body.messages); if (!messages) return json(400, '대화 내용이 비었어요.');
  const stream = body.stream === true, maxTokens = Math.max(16, Math.min(Number(body.max_tokens) || 400, MAX_TOKENS));

  let run;
  try { run = await runModel(env, messages, { stream, maxTokens }); }
  catch (e) {
    if (isQuota(e)) return json(429, '오늘의 무료 AI 사용량을 모두 썼어요. 내일 오전 9시(한국 시간)에 다시 채워져요.');
    return json(502, 'AI 서버에서 오류가 났어요: ' + String((e && e.message) || e).slice(0, 160));
  }
  const { out } = run, filter = makeThinkFilter();

  if (!stream) {
    const text = filter(textOf(out), true).trim();
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  // 스트리밍: 어떤 모양의 SSE가 와도 OpenAI 호환 delta로 바꿔 내보낸다
  const enc = new TextEncoder(), dec = new TextDecoder(); let buf = '', sent = false;
  const emit = (c, text) => { if (text) { sent = true; c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n')); } };
  const body2 = (out && out.getReader) ? out : new ReadableStream({ start(c) { c.enqueue(enc.encode('data: ' + JSON.stringify({ response: textOf(out) }) + '\n\n')); c.close(); } });
  const ts = new TransformStream({
    transform(chunk, c) {
      buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (!d || d === '[DONE]') continue;
        let j; try { j = JSON.parse(d); } catch { continue; } emit(c, filter(textOf(j)));
      }
    },
    flush(c) { emit(c, filter('', true)); if (!sent) emit(c, '…'); c.enqueue(enc.encode('data: [DONE]\n\n')); },
  });
  return new Response(body2.pipeThrough(ts), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}
