// 실시간 검색: 키 없이 되는 안정적인 소스(날씨·환율·뉴스·위키) + (선택) 사이트 주인이 넣은 검색 API 키(Tavily / Brave / Serper)
// 무료 플랜 CPU 10ms 한도를 지키기 위해 큰 응답은 앞부분만 읽고, 결과는 캐시한다.
// 위키 등은 식별 가능한 User-Agent를 요구한다(개인·저장소 정보는 넣지 않는다)
const UA = 'AuroraChatSearch/1.0 (Cloudflare Pages Function; contact: site owner)';
const MAX_Q = 200, TOP = 7;

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = (s) => decode(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const clip = (s, n) => { s = String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function tf(url, init = {}, ms = 4500) {                   // 타임아웃이 있는 fetch
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal, headers: { 'user-agent': UA, ...(init.headers || {}) } }); } finally { clearTimeout(t); }
}
async function jget(url, init, ms) {                             // JSON이 아니거나(429 안내문 등) 오류면 깔끔하게 실패 처리
  const res = await tf(url, init, ms); const ct = res.headers.get('content-type') || '';
  if (!res.ok || !/json/i.test(ct)) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function head(res, bytes) {                                // 응답의 앞부분만 읽는다 (큰 RSS를 통째로 파싱하지 않기 위해)
  if (!res.body || !res.body.getReader) return (await res.text()).slice(0, bytes);
  const rd = res.body.getReader(), dec = new TextDecoder(); let out = '';
  while (out.length < bytes) { const { done, value } = await rd.read(); if (done) break; out += dec.decode(value, { stream: true }); }
  try { await rd.cancel(); } catch {} return out.slice(0, bytes);
}

// ---------- 질문 유형 ----------
export function intents(q) {
  return {
    weather: /(날씨|기온|온도|미세먼지|강수|우산|비\s*(와|올|오)|눈\s*(와|올|오)|추워|더워|weather|temperature|forecast)/i.test(q),
    fx: /(환율|달러|엔화|유로화?|위안|exchange rate|\busd\b|\bkrw\b)/i.test(q),
    news: /(뉴스|속보|기사|소식|이슈|논란|발표|news|headline|breaking)/i.test(q),
  };
}

// ---------- 날씨 (Open-Meteo, 키 없음) ----------
const WMO = { 0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림', 45: '안개', 48: '짙은 안개', 51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비', 56: '어는 이슬비', 57: '강한 어는 이슬비', 61: '약한 비', 63: '비', 65: '강한 비', 66: '어는 비', 67: '강한 어는 비', 71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '싸락눈', 80: '약한 소나기', 81: '소나기', 82: '강한 소나기', 85: '약한 눈 소나기', 86: '강한 눈 소나기', 95: '뇌우', 96: '우박 동반 뇌우', 99: '강한 우박 동반 뇌우' };
export function placeOf(q) {
  const known = Object.keys(CITY).find((n) => q.includes(n)); if (known) return known;
  const t = q.replace(/(오늘|내일|모레|어제|지금|현재|이번\s*주|주말|아침|저녁|밤|낮|날씨|기온|온도|미세먼지|강수\s*확률|강수|예보|어때|어떄|알려\s*줘|알려|검색|해줘|좀|은|는|이|가|의|에|에서|인가요|인가|요|\?|!|\.|,)/g, ' ').replace(/\s+/g, ' ').trim();
  return t.slice(0, 30) || '서울';
}
export function pickPlace(results, hangul) {                      // 도시(PPL*) 우선, 인구 많은 곳, 한국어 질의면 한국 우선
  const rank = (r) => (/^PPL/.test(r.feature_code || '') ? 1000 : 0) + (/^PPLC$/.test(r.feature_code) ? 400 : /^PPLA$/.test(r.feature_code) ? 300 : /^PPLA2$/.test(r.feature_code) ? 200 : 0) + (hangul && r.country_code === 'KR' ? 500 : 0) + Math.log10((r.population || 0) + 1) * 10;
  return [...(results || [])].sort((a, b) => rank(b) - rank(a))[0];
}
// 날씨 서비스의 지역 검색은 "서울", "제주" 같은 짧은 한국어 이름을 못 찾거나 "부산"을 산으로 찾는다 → 주요 도시는 좌표 표로 바로 처리
const CITY = { 서울: [37.5665, 126.978], 부산: [35.1796, 129.0756], 대구: [35.8714, 128.6014], 인천: [37.4563, 126.7052], 광주: [35.1595, 126.8526], 대전: [36.3504, 127.3845], 울산: [35.5384, 129.3114], 세종: [36.48, 127.289], 수원: [37.2636, 127.0286], 성남: [37.4201, 127.1262], 고양: [37.6584, 126.832], 용인: [37.2411, 127.1776], 창원: [35.228, 128.6811], 청주: [36.6424, 127.489], 전주: [35.8242, 127.148], 천안: [36.8151, 127.1139], 제주: [33.4996, 126.5312], 포항: [36.019, 129.3435], 춘천: [37.8813, 127.7298], 강릉: [37.7519, 128.8761], 속초: [38.207, 128.5918], 여수: [34.7604, 127.6622], 목포: [34.8118, 126.3922], 안동: [36.5684, 128.7294], 경주: [35.8562, 129.2247], 김해: [35.2285, 128.8894], 울릉도: [37.4844, 130.9057],
  도쿄: [35.6762, 139.6503], 오사카: [34.6937, 135.5023], 후쿠오카: [33.5902, 130.4017], 삿포로: [43.0618, 141.3545], 베이징: [39.9042, 116.4074], 상하이: [31.2304, 121.4737], 홍콩: [22.3193, 114.1694], 타이베이: [25.033, 121.5654], 방콕: [13.7563, 100.5018], 싱가포르: [1.3521, 103.8198], 하노이: [21.0278, 105.8342], 다낭: [16.0544, 108.2022], 세부: [10.3157, 123.8854], 마닐라: [14.5995, 120.9842], 쿠알라룸푸르: [3.139, 101.6869],
  뉴욕: [40.7128, -74.006], 로스앤젤레스: [34.0522, -118.2437], 샌프란시스코: [37.7749, -122.4194], 시애틀: [47.6062, -122.3321], 호놀룰루: [21.3069, -157.8583], 하와이: [21.3069, -157.8583], 괌: [13.4443, 144.7937], 토론토: [43.6532, -79.3832], 밴쿠버: [49.2827, -123.1207], 런던: [51.5074, -0.1278], 파리: [48.8566, 2.3522], 베를린: [52.52, 13.405], 로마: [41.9028, 12.4964], 이스탄불: [41.0082, 28.9784], 두바이: [25.2048, 55.2708], 모스크바: [55.7558, 37.6173], 시드니: [-33.8688, 151.2093] };
const cityOf = (place) => { const k = Object.keys(CITY).find((n) => place === n || place.startsWith(n) || (place.length > n.length && place.includes(n))); return k ? { name: k, lat: CITY[k][0], lon: CITY[k][1], table: true } : null; };
async function locate(place) {
  const t = cityOf(place); if (t) return t;
  const hangul = /[가-힣]/.test(place);
  for (const name of hangul ? [place, place + '특별시', place + '광역시', place + '시'] : [place]) {            // 정식 명칭으로도 한 번씩 더 찾는다
    const g = await jget(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=8&language=ko`).catch(() => null);
    const p = pickPlace(g && g.results, hangul); if (p) return { name: [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : '', p.country_code === 'KR' ? '' : p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude };
  }
  return null;
}
async function weather(q) {
  const loc = await locate(placeOf(q)); if (!loc) return [];
  const f = await jget(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`);
  const c = f.current, d = f.daily; if (!c || !d) return [];
  const day = (i, name) => `${name} ${WMO[d.weather_code[i]] || ''} 최저 ${Math.round(d.temperature_2m_min[i])}℃/최고 ${Math.round(d.temperature_2m_max[i])}℃, 강수확률 ${d.precipitation_probability_max[i] ?? '?'}%`;
  return [{ title: `${loc.name} 날씨 (실시간)`, url: 'https://open-meteo.com/', source: 'Open-Meteo', snippet: clip(`현재 ${Math.round(c.temperature_2m * 10) / 10}℃(체감 ${Math.round(c.apparent_temperature * 10) / 10}℃), ${WMO[c.weather_code] || ''}, 습도 ${c.relative_humidity_2m}%, 바람 ${c.wind_speed_10m}km/h, 강수 ${c.precipitation}mm. ${day(0, '오늘')}. ${day(1, '내일')}. ${day(2, '모레')}. (관측 시각 ${c.time}, 현지 시간)`, 420) }];
}

// ---------- 환율 (open.er-api.com, 키 없음) ----------
async function fx() {
  const j = await jget('https://open.er-api.com/v6/latest/USD'); const r = j && j.rates; if (!r || !r.KRW) return [];
  const n = (v) => Math.round(v * 100) / 100, krw = r.KRW;
  return [{ title: '원화 환율 (실시간)', url: 'https://www.exchangerate-api.com/', source: 'ExchangeRate-API', snippet: clip(`1달러 = ${n(krw)}원 · 100엔 = ${n(krw / r.JPY * 100)}원 · 1유로 = ${n(krw / r.EUR)}원 · 1위안 = ${n(krw / r.CNY)}원 (기준 시각 ${j.time_last_update_utc || ''}, 매매기준율과 차이가 있을 수 있음)`, 300) }];
}

// ---------- 뉴스 (Google News RSS, 키 없음) ----------
const kst = (d) => { try { return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)); } catch { return ''; } };
export function parseNews(xml, n = 6) {
  const out = []; const re = /<item>([\s\S]*?)<\/item>/g; let m;
  while ((m = re.exec(xml)) && out.length < n) {
    const it = m[1], t = (/<title>([\s\S]*?)<\/title>/.exec(it) || [])[1], l = (/<link>([\s\S]*?)<\/link>/.exec(it) || [])[1], pd = (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(it) || [])[1], src = (/<source[^>]*>([\s\S]*?)<\/source>/.exec(it) || [])[1];
    const url = safeUrl(strip(l)); if (!t || !url) continue;
    const title = strip(t).replace(/\s+-\s+[^-]{1,30}$/, ''), source = strip(src || '');
    out.push({ title: clip(title, 140), url, source: source || host(url), snippet: clip(`${source ? source + ' · ' : ''}${pd ? kst(pd) : ''}`, 80), published: pd || '' });
  }
  return out;
}
async function news(q) {
  const clean = q.replace(/(뉴스|속보|기사|소식|알려\s*줘|검색|해줘|최신|최근|좀)/g, ' ').replace(/\s+/g, ' ').trim() || q;
  return parseNews(await head(await tf(`https://news.google.com/rss/search?q=${encodeURIComponent(clean)}&hl=ko&gl=KR&ceid=KR:ko`), 45000), 6);
}

// ---------- 위키백과 (키 없음) ----------
export const topicOf = (q) => q.replace(/(이란|란|이\s*뭐야|뭐야|뭔가요|무엇인가요|누구야|누구인가요|알려\s*줘|검색|해줘|좀|뜻|의미|\?)/g, ' ').replace(/\s+/g, ' ').trim() || q;
// 위키 검색은 엉뚱한 문서를 줄 때가 있다(예: "영화 개봉일" → 사람 이름). 주제어가 제목이나 요약 앞부분에 없으면 버린다
export function relevant(topic, title, extract) {
  const toks = String(topic).split(/\s+/).filter((t) => t.length >= 2); const head = (title + ' ' + String(extract || '').slice(0, 120));
  if (!toks.length) return String(title).includes(topic);
  return toks.some((t) => (t.length >= 3 ? head.includes(t) : title.includes(t)));
}
async function wiki(q) {
  const topic = topicOf(q);
  for (const lang of /[가-힣]/.test(topic) ? ['ko', 'en'] : ['en', 'ko']) {
    const s = await jget(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=2&format=json&utf8=1`);
    const hit = s && s.query && s.query.search && s.query.search[0]; if (!hit) continue;
    const r = await jget(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
    if (r && r.extract && relevant(topic, r.title, r.extract)) return [{ title: `${r.title} — 위키백과`, url: safeUrl((r.content_urls && r.content_urls.desktop && r.content_urls.desktop.page) || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`), source: `${lang}.wikipedia.org`, snippet: clip(r.extract, 420) }];
  }
  return [];
}

// ---------- 범용 웹 검색 API (사이트 주인이 키를 넣은 경우만) ----------
const API = {
  async tavily(q, env, newsy) {
    const j = await (await tf('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.TAVILY_API_KEY }, body: JSON.stringify({ query: q, search_depth: 'basic', max_results: 6, topic: newsy ? 'news' : 'general', include_answer: false }) }, 7000)).json();
    return (j.results || []).map((r) => ({ title: clip(r.title, 140), url: safeUrl(r.url), source: host(r.url), snippet: clip(r.content, 420), published: r.published_date || '' }));
  },
  async brave(q, env) {
    const j = await (await tf(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=6&country=KR&search_lang=ko`, { headers: { accept: 'application/json', 'x-subscription-token': env.BRAVE_API_KEY } }, 7000)).json();
    return ((j.web && j.web.results) || []).map((r) => ({ title: clip(strip(r.title), 140), url: safeUrl(r.url), source: host(r.url), snippet: clip(strip(r.description), 420) }));
  },
  async serper(q, env) {
    const j = await (await tf('https://google.serper.dev/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.SERPER_API_KEY }, body: JSON.stringify({ q, gl: 'kr', hl: 'ko', num: 6 }) }, 7000)).json();
    return (j.organic || []).map((r) => ({ title: clip(r.title, 140), url: safeUrl(r.link), source: host(r.link), snippet: clip(r.snippet, 420) }));
  },
};
export const apiProvider = (env) => (env && env.TAVILY_API_KEY ? 'tavily' : env && env.BRAVE_API_KEY ? 'brave' : env && env.SERPER_API_KEY ? 'serper' : null);

export function cleanQuery(q) { q = String(q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(); return q.length > MAX_Q ? q.slice(0, MAX_Q) : q; }

// 위키 → (비면, 주제가 충분히 구체적일 때만) 뉴스로 보충. "달" 같은 한 글자 주제로 뉴스를 찾으면 엉뚱한 기사가 섞이므로 보충하지 않는다
async function wikiThenNews(q) {
  let w = []; try { w = await wiki(q); } catch {}
  if (w.length) return w;
  const topic = topicOf(q); if (topic.replace(/\s/g, '').length < 3) return [];
  return news(q);
}

/** 질문 유형에 맞는 소스만 불러 합친다. 하나가 실패해도 나머지는 쓴다 */
export async function searchAll(q, env) {
  const it = intents(q), key = apiProvider(env), jobs = [], names = [];
  const add = (name, p) => { names.push(name); jobs.push(p); };
  if (it.weather) add('weather', weather(q));
  if (it.fx) add('fx', fx());
  if (key) add(key, API[key](q, env, it.news));
  else if (it.news) add('news', news(q));
  else if (!it.weather && !it.fx) add('wiki+', wikiThenNews(q));
  const settled = await Promise.allSettled(jobs); const results = [], failed = [], seen = new Set();
  settled.forEach((s, i) => { if (s.status !== 'fulfilled') { failed.push(names[i]); return; } for (const r of s.value) { if (!r.url || !r.title || seen.has(r.url)) continue; seen.add(r.url); results.push(r); } });
  return { query: q, provider: key || 'keyless', sources: names, failed, limited: !key && !it.weather && !it.fx, results: results.slice(0, TOP) };
}

// ---------- 캐시 (같은 질의를 짧은 시간 동안 재사용: 속도 + CPU/상류 호출 절약) ----------
export async function cachedSearch(q, env) {
  const ttl = intents(q).weather ? 300 : intents(q).news ? 120 : 600; let cache;
  try { cache = typeof caches !== 'undefined' ? caches.default : null; } catch { cache = null; }
  const key = new Request('https://aurora-cache.internal/search?v=1&q=' + encodeURIComponent(q.toLowerCase()));
  if (cache) { try { const hit = await cache.match(key); if (hit) return { ...(await hit.json()), cached: true }; } catch {} }
  const out = await searchAll(q, env);
  if (cache && out.results.length) { try { await cache.put(key, new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } })); } catch {} }
  return out;
}
