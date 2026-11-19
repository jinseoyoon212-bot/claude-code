/**
 * Seed nodes used by the web build.
 *
 * Browsers can't talk to the Session seed nodes / service nodes directly (non-443 ports, pinned
 * or self-signed certificates). The web build therefore goes through a relay, configured at build
 * time with SESSION_WEB_RELAY_URL. See web/README.md, "Networking".
 */
declare const __SESSION_WEB_RELAY_URL__: string;

export const WEB_RELAY_URL: string = __SESSION_WEB_RELAY_URL__;

export const WEB_SEED_NODES = [
  'https://seed1.getsession.org:4443/',
  'https://seed2.getsession.org:4443/',
  'https://seed3.getsession.org:4443/',
];
