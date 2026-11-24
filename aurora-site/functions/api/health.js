// 배포 확인용
//   /api/health         → AI 연결 상태, 사용 중인 모델, 샘플 응답
//   /api/health?deep=1  → "두 번째 질문" 상황(대화가 이어진 상태)을 그대로 시험: 모델이 생각(<think>)을 하는지, 보이는 답이 나오는지, 걸린 시간
import { runModel, makeThinkFilter } from '../_lib/chat.js';
import { apiProvider, searchAll } from '../_lib/search.js';
export const onRequestGet = async ({ request, env }) => {
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (!env || !env.AI) return new Response(JSON.stringify({ ok: false, problem: 'Workers AI 바인딩 "AI"가 없어요. Pages 설정 → Bindings에서 추가하고 다시 배포하세요.' }), { status: 503, headers: h });
  let deep = false; try { deep = new URL(request.url).searchParams.get('deep') === '1'; } catch {}
  const t0 = Date.now(), key = apiProvider(env);
  const searchInfo = { provider: key || 'keyless', note: key ? `범용 웹 검색 연결됨(${key})` : '키 없음: 날씨·환율·뉴스·위키만 검색돼요. 범용 웹 검색은 TAVILY_API_KEY(또는 BRAVE_API_KEY / SERPER_API_KEY)를 비밀값으로 추가하세요.' };
  const messages = deep
    ? [{ role: 'system', content: '당신은 "오로라"라는 귀여운 AI입니다. 한국어로 한두 문장으로 짧게 답합니다.' }, { role: 'user', content: '안녕' }, { role: 'assistant', content: '안녕하세요! 저는 오로라예요.' }, { role: 'user', content: '지구에서 달까지 거리는 얼마야? 한 문장으로 답해줘.' }]
    : [{ role: 'user', content: '한국어로 "안녕"이라고만 답해.' }];
  try {
    if (new URL(request.url).searchParams.get('search') === '1') { const r = await searchAll('서울 날씨', env); return new Response(JSON.stringify({ ok: r.results.length > 0, search: { ...searchInfo, test: '서울 날씨', 건수: r.results.length, 소스: r.sources, 실패: r.failed, 첫결과: r.results[0] ? r.results[0].snippet.slice(0, 80) : null }, ms: Date.now() - t0 }), { headers: h }); }
    const { model, out } = await runModel(env, messages, { stream: false, maxTokens: deep ? 400 : 24 });
    const choice = out && out.choices && out.choices[0], msg = (choice && choice.message) || {};
    const raw = typeof out === 'string' ? out : (out && (out.response || msg.content)) || '';
    const reasoning = msg.reasoning_content || msg.reasoning || '';
    const visible = makeThinkFilter()(String(raw), true).trim();
    return new Response(JSON.stringify({ ok: !!visible, mode: deep ? 'deep(두 번째 질문 시험)' : 'basic', model, ms: Date.now() - t0, visibleChars: visible.length, search: searchInfo, thinkDetected: /<think>/.test(String(raw)) || !!reasoning, sample: visible || null, shape: Object.keys(out || {}), problem: visible ? undefined : '보이는 답이 비어 있어요(생각만 하고 끝남). AI_MODEL 환경변수로 다른 모델을 지정해 보세요.' }), { status: visible ? 200 : 502, headers: h });
  } catch (e) { return new Response(JSON.stringify({ ok: false, ms: Date.now() - t0, problem: String((e && e.message) || e) }), { status: 502, headers: h }); }
};
