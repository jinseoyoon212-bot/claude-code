/**
 * Values of `CONSTANTS` exported by the native `libsession_util_nodejs` addon (v0.7.5), copied
 * from libsession-util's headers (see libsession_util_nodejs/src/constants.cpp).
 */
const BASE_URL_MAX_LENGTH = 267;
const ROOM_MAX_LENGTH = 64;
const QS_PUBKEY_LENGTH = '?public_key='.length;

export const CONSTANTS = {
  CONTACT_MAX_NAME_LENGTH: 100,
  BASE_GROUP_MAX_NAME_LENGTH: 100,
  GROUP_INFO_MAX_NAME_LENGTH: 100,
  GROUP_INFO_DESCRIPTION_MAX_LENGTH: 600,
  // BASE_URL_MAX_LENGTH + '/r/' + ROOM_MAX_LENGTH + qs_pubkey.size() + hex pubkey + null terminator
  COMMUNITY_FULL_URL_MAX_LENGTH: BASE_URL_MAX_LENGTH + 3 + ROOM_MAX_LENGTH + QS_PUBKEY_LENGTH + 64 + 1,
  MESSAGE_CHARACTER_LIMIT_STANDARD: 2000,
  MESSAGE_CHARACTER_LIMIT_PRO: 10000,
  LIBSESSION_PRO_URLS: {
    roadmap: 'https://getsession.org/pro#roadmap',
    privacy_policy: 'https://getsession.org/pro-privacy',
    terms_of_service: 'https://getsession.org/pro-terms',
    pro_access_not_found: 'https://getsession.org/pro-recover',
    support_url: 'https://getsession.org/pro-support',
    faq: 'https://getsession.org/pro#faq',
    pro_page: 'https://getsession.org/pro',
    upgrade: 'https://getsession.org/pro#upgrade',
  },
  LIBSESSION_PRO_BACKEND_URL: 'https://pro.session.codes',
  LIBSESSION_PRO_BACKEND_PUBKEY_HEX:
    '479ffca8bcec7b4a0f0f7afe48b8a6d15635a8c7ff15ad16add05752c19414d4',
  LIBSESSION_PRO_BACKEND_PUBKEY_X25519_HEX:
    'ce5a75f64b6c43db6c1374d362c3ea9d85951c4f42a3d04cf94f87822d4f803b',
  LIBSESSION_UTIL_VERSION: 'libsession-wasm',
  LIBSESSION_NODEJS_VERSION: 'web',
  LIBSESSION_NODEJS_COMMIT: 'web',
};
