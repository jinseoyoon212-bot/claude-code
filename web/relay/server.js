/**
 * Session Web relay.
 *
 * Browsers can't open connections to Session seed / service nodes (custom ports, pinned or
 * self-signed certificates). The web app sends those requests here instead, with the real
 * destination in the `x-session-target` header, and this relay forwards them as-is.
 *
 * What the relay can see: the IP of the guard node / seed node each request goes to, and the size
 * and timing of requests. Message contents are onion-encrypted end to end by the client, exactly
 * like on desktop. Run it yourself if you don't want to trust somebody else's relay.
 *
 * No dependencies. Usage:
 *   ALLOWED_ORIGINS=https://<you>.github.io PORT=8787 node web/relay/server.js
 */
/* eslint-disable no-console */
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PORT || 8787);
/** Tolerate common typos: trailing slash, path, upper case, missing scheme ("foo.pages.dev"). */
function normalizeOrigin(raw) {
  if (raw === '*') {
    return raw;
  }
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  } catch (e) {
    return raw;
  }
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(/[,\s]+/)
  .map(s => s.trim())
  .filter(Boolean)
  .map(normalizeOrigin);
const MAX_BODY_BYTES = 10 * 1024 * 1024; // attachments go to the file server directly
const TIMEOUT_MS = 30_000;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const SEED_HOSTS = new Set(['seed1.getsession.org', 'seed2.getsession.org', 'seed3.getsession.org']);

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Only Session infrastructure can be reached through the relay, never internal hosts. */
function validateTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    return { error: 'invalid target url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'unsupported protocol' };
  }
  const host = url.hostname;
  if (SEED_HOSTS.has(host)) {
    return { url };
  }
  if (IPV4.test(host) && !isPrivateIPv4(host)) {
    const port = Number(url.port || 443);
    if (port < 1024) {
      return { error: 'port not allowed' };
    }
    return { url };
  }
  return { error: 'target host not allowed' };
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed =
    ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin)) ? origin || '*' : '';
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': '*',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const server = http.createServer((req, res) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { ...cors, 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (!req.url.startsWith('/relay')) {
    res.writeHead(404, cors);
    res.end();
    return;
  }

  const { url, error } = validateTarget(String(req.headers['x-session-target'] || ''));
  if (error) {
    res.writeHead(400, { ...cors, 'content-type': 'text/plain' });
    res.end(error);
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413, cors);
      res.end();
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) {
      return;
    }
    const body = Buffer.concat(chunks);
    const headers = { ...req.headers };
    [
      'host',
      'origin',
      'referer',
      'cookie',
      'x-session-target',
      'connection',
      'content-length',
      'accept-encoding',
    ].forEach(h => delete headers[h]);
    Object.keys(headers)
      .filter(h => h.startsWith('sec-') || h.startsWith('x-forwarded') || h === 'user-agent')
      .forEach(h => delete headers[h]);
    if (body.length) {
      headers['content-length'] = String(body.length);
    }

    const lib = url.protocol === 'https:' ? https : http;
    const upstream = lib.request(
      url,
      {
        method: req.method,
        headers,
        timeout: TIMEOUT_MS,
        // Service nodes use self-signed certificates. Like the desktop app, the client relies on
        // the onion encryption layer, not on TLS, to authenticate service nodes.
        rejectUnauthorized: false,
      },
      upstreamRes => {
        const outHeaders = { ...cors };
        const type = upstreamRes.headers['content-type'];
        if (type) {
          outHeaders['content-type'] = type;
        }
        res.writeHead(upstreamRes.statusCode || 502, outHeaders);
        upstreamRes.pipe(res);
      }
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', e => {
      if (!res.headersSent) {
        res.writeHead(502, { ...cors, 'content-type': 'text/plain' });
      }
      res.end(`relay error: ${e.message}`);
    });
    upstream.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`Session Web relay listening on :${PORT} (allowed origins: ${ALLOWED_ORIGINS.join(', ')})`);
});
