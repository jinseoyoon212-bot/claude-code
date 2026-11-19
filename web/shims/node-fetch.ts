/**
 * `node-fetch` replacement: the browser's fetch.
 * Node-only options (agent, timeout as a number...) are dropped.
 */
export default async function nodeFetch(url: any, init: any = {}) {
  const { agent: _agent, timeout, ...rest } = init || {};
  const controller = new AbortController();
  const timer = timeout ? setTimeout(() => controller.abort(), timeout) : undefined;
  if (rest.signal) {
    rest.signal.addEventListener?.('abort', () => controller.abort());
  }
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const { Headers, Request, Response } = globalThis as any;

export class FetchError extends Error {
  public code?: string;

  constructor(message: string, public type?: string) {
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
