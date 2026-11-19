/**
 * `node-fetch` replacement for the browser.
 *
 * Requests the browser can make on its own (regular https on port 443 with a public certificate:
 * file server, SOGS, link previews...) use `fetch` directly.
 *
 * Requests to Session seed nodes and service nodes can't be made from a browser: they use custom
 * ports and pinned / self-signed certificates. Those go through the relay configured at build time
 * (SESSION_WEB_RELAY_URL, see web/relay/). The payloads sent to service nodes are onion-encrypted,
 * the relay only sees the guard node it talks to.
 */
import { WEB_RELAY_URL } from '../network/seedNodes';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function needsRelay(target: URL) {
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return false;
  }
  const nonDefaultPort = target.port !== '' && target.port !== '443';
  return nonDefaultPort || IPV4.test(target.hostname) || target.protocol === 'http:';
}

export class FetchError extends Error {
  public code?: string;

  constructor(
    message: string,
    public type?: string
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export class AbortError extends Error {
  constructor(message = 'The operation was aborted.') {
    super(message);
    this.name = 'AbortError';
  }
}

function headersToObject(headers: any): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (typeof headers.forEach === 'function' && !(headers instanceof Array)) {
    const out: Record<string, string> = {};
    headers.forEach((v: string, k: string) => {
      out[k] = v;
    });
    return out;
  }
  return { ...headers };
}

export default async function nodeFetch(input: any, init: any = {}) {
  const { agent: _agent, timeout, ...rest } = init || {};
  const url = new URL(typeof input === 'string' ? input : input.url);

  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
  if (rest.signal) {
    if (rest.signal.aborted) {
      controller.abort();
    }
    rest.signal.addEventListener?.('abort', () => controller.abort());
  }

  let finalUrl = url.toString();
  let headers = headersToObject(rest.headers);

  if (needsRelay(url)) {
    if (!WEB_RELAY_URL) {
      const err = new FetchError(
        `Session Web has no relay configured, cannot reach ${url.host}`,
        'system'
      );
      err.code = 'EHOSTUNREACH';
      throw err;
    }
    finalUrl = `${WEB_RELAY_URL.replace(/\/+$/, '')}/relay`;
    headers = { ...headers, 'x-session-target': url.toString() };
  }

  try {
    return await fetch(finalUrl, {
      method: rest.method || 'GET',
      headers,
      body: rest.body,
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as any)?.name === 'AbortError') {
      throw new AbortError();
    }
    const err = new FetchError(`request to ${url.host} failed: ${(e as Error)?.message}`, 'system');
    err.code = navigator.onLine ? 'ECONNREFUSED' : 'ENETUNREACH';
    throw err;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const { Headers, Request, Response } = globalThis as any;
