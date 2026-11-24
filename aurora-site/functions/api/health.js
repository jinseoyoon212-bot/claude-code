// 배포 확인용: https://<사이트>/api/health  → AI 연결 상태와 사용 중인 모델, 샘플 응답을 보여준다
import { runModel, makeThinkFilter } from '../_lib/chat.js';
export const onRequestGet = async ({ env }) => {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (!env || !env.AI) return new Response(JSON.stringify({ ok: false, problem: 'Workers AI 바인딩 "AI"가 없어요. Pages 설정 → Functions → Bindings에서 추가하세요.' }), { status: 503, headers: h });
  const t0 = Date.now();
  try {
    const { model, out } = await runModel(env, [{ role: 'user', content: '한국어로 "안녕"이라고만 답해.' }], { stream: false, maxTokens: 24 });
    const raw = typeof out === 'string' ? out : (out && (out.response || (out.choices && out.choices[0] && (out.choices[0].message || {}).content))) || '';
    return new Response(JSON.stringify({ ok: true, model, ms: Date.now() - t0, sample: makeThinkFilter()(String(raw), true).trim(), shape: Object.keys(out || {}) }), { headers: h });
  } catch (e) { return new Response(JSON.stringify({ ok: false, ms: Date.now() - t0, problem: String((e && e.message) || e) }), { status: 502, headers: h }); }
};
