// GET /api/search?q=...  → { query, provider, results:[{title,url,source,snippet}], limited, failed }
import { cachedSearch, cleanQuery } from '../_lib/search.js';
import { originOk, rateOk } from '../_lib/chat.js';
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
export const onRequestGet = async ({ request, env }) => {
  if (!originOk(request, env || {})) return json(403, { error: { message: '허용되지 않은 출처예요.' } });
  const wait = rateOk('search:' + (request.headers.get('cf-connecting-ip') || 'local'), Number(env && env.SEARCH_PER_MIN) || 30);
  if (wait) return json(429, { error: { message: `검색 요청이 너무 많아요. Retry after ${wait}s` } }, { 'retry-after': String(wait) });
  const q = cleanQuery(new URL(request.url).searchParams.get('q')); if (!q) return json(400, { error: { message: '검색어가 비었어요.' } });
  try { return json(200, await cachedSearch(q, env || {})); } catch (e) { return json(502, { error: { message: '검색 중 오류가 났어요: ' + String((e && e.message) || e).slice(0, 120) } }); }
};
