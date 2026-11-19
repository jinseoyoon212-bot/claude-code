/**
 * `https` / `http` / `tls` / `net` placeholders. The desktop app uses them to build agents for
 * pinned / self-signed certificates; in the browser all requests go through `fetch` (see
 * web/shims/node-fetch.ts), so agents are inert objects.
 */
export class Agent {
  constructor(public readonly options: unknown = {}) {}

  destroy() {
    /* noop */
  }
}

export function request(): never {
  throw new Error('Raw https requests are not available in the browser');
}
export const get = request;

export function checkServerIdentity() {
  return undefined;
}
export function isIP() {
  return 0;
}
export function connect(): never {
  throw new Error('Raw sockets are not available in the browser');
}

export default { Agent, request, get, checkServerIdentity, isIP, connect };
