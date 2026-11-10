// Aurora 브리지 서버: 웹/APK가 PC의 에이전트(명령·파일 도구)를 원격으로 쓰게 해준다.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { runAgent } = require('./agent');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,x-aurora-token', 'access-control-allow-methods': 'GET,POST,OPTIONS' };

function createBridge({ getSettings, wwwDir, token }) {
  const pending = new Map();
  const json = (res, code, obj) => { res.writeHead(code, { ...CORS, 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const readBody = (req) => new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
  const authed = (req) => {
    const a = Buffer.from(String(req.headers['x-aurora-token'] || '')), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (url.pathname === '/api/ping') return json(res, 200, { ok: true, app: 'aurora' });
    if (url.pathname.startsWith('/api/')) {
      if (!authed(req)) return json(res, 401, { error: '토큰이 올바르지 않아요.' });

      if (url.pathname === '/api/confirm' && req.method === 'POST') {
        const { id, ok } = await readBody(req); const r = pending.get(id);
        if (r) { pending.delete(id); r(!!ok); }
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/send' && req.method === 'POST') {
        const { history } = await readBody(req);
        const settings = getSettings();
        if (!Array.isArray(history) || !history.length) return json(res, 400, { error: '대화 내용이 비었어요.' });
        if (!settings.apiKey) return json(res, 200, { type: 'done', error: 'PC의 Aurora Agent 설정에 API 키가 없어요. PC 앱의 ⚙ 설정에서 입력해 주세요.' });
        res.writeHead(200, { ...CORS, 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
        const mine = new Set(); let closed = false;
        res.on('close', () => { closed = true; for (const id of mine) { const r = pending.get(id); pending.delete(id); if (r) r(false); } });
        const write = (o) => { if (!closed) res.write(JSON.stringify(o) + '\n'); };
        const confirm = (title, detail) => {
          if (settings.autoApprove) return Promise.resolve(true);
          return new Promise((resolve) => {
            const id = crypto.randomBytes(8).toString('hex'); mine.add(id); pending.set(id, resolve);
            write({ type: 'confirm', id, title, detail: String(detail).slice(0, 1500) });
            setTimeout(() => { if (pending.delete(id)) resolve(false); }, 120000);
          });
        };
        try { const r = await runAgent({ settings, history, confirm, notify: write }); write({ type: 'done', ...r }); }
        catch (e) { write({ type: 'done', error: String((e && e.message) || e) }); }
        return res.end();
      }
      return json(res, 404, { error: 'not found' });
    }

    // 정적 파일: 같은 화면(웹 UI)을 폰 브라우저에서도 열 수 있게
    let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!p) p = 'index.html';
    const file = path.join(wwwDir, p);
    if (!file.startsWith(wwwDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return {
    start: (port) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); }),
    stop: () => new Promise((resolve) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
module.exports = { createBridge };
