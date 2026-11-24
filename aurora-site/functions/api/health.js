// 배포 확인용
//   /api/health         → AI 연결 상태, 사용 중인 모델, 샘플 응답
//   /api/health?deep=1  → "두 번째 질문" 상황(대화가 이어진 상태)을 그대로 시험: 모델이 생각(<think>)을 하는지, 보이는 답이 나오는지, 걸린 시간
import { runModel, makeThinkFilter } from '../_lib/chat.js';
export const onRequestGet = async ({ request, env }) => {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (!env || !env.AI) return new Response(JSON.stringify({ ok: false, problem: 'Workers AI 바인딩 "AI"가 없어요. Pages 설정 → Bindings에서 추가하고 다시 배포하세요.' }), { status: 503, headers: h });
  let deep = false; try { deep = new URL(request.url).searchParams.get('deep') === '1'; } catch {}
  const t0 = Date.now();
  const messages = deep
    ? [{ role: 'system', content: '당신은 "오로라"라는 귀여운 AI입니다. 한국어로 한두 문장으로 짧게 답합니다.' }, { role: 'user', content: '안녕' }, { role: 'assistant', content: '안녕하세요! 저는 오로라예요.' }, { role: 'user', content: '지구에서 달까지 거리는 얼마야? 한 문장으로 답해줘.' }]
    : [{ role: 'user', content: '한국어로 "안녕"이라고만 답해.' }];
  try {
    const { model, out } = await runModel(env, messages, { stream: false, maxTokens: deep ? 400 : 24 });
    const choice = out && out.choices && out.choices[0], msg = (choice && choice.message) || {};
    const raw = typeof out === 'string' ? out : (out && (out.response || msg.content)) || '';
    const reasoning = msg.reasoning_content || msg.reasoning || '';
    const visible = makeThinkFilter()(String(raw), true).trim();
    return new Response(JSON.stringify({ ok: !!visible, mode: deep ? 'deep(두 번째 질문 시험)' : 'basic', model, ms: Date.now() - t0, visibleChars: visible.length, thinkDetected: /<think>/.test(String(raw)) || !!reasoning, sample: visible || null, shape: Object.keys(out || {}), problem: visible ? undefined : '보이는 답이 비어 있어요(생각만 하고 끝남). AI_MODEL 환경변수로 다른 모델을 지정해 보세요.' }), { status: visible ? 200 : 502, headers: h });
  } catch (e) { return new Response(JSON.stringify({ ok: false, ms: Date.now() - t0, problem: String((e && e.message) || e) }), { status: 502, headers: h }); }
};
