import { handleChat } from '../../../_lib/chat.js';
// POST만 처리한다. (다른 메서드용 onRequest를 같이 두면 라우팅 우선순위가 헷갈릴 수 있어 두지 않는다)
export const onRequestPost = ({ request, env, waitUntil }) => handleChat(request, env, { waitUntil });
