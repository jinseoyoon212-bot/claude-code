import { handleChat } from '../../../_lib/chat.js';
export const onRequestPost = ({ request, env }) => handleChat(request, env);
export const onRequest = () => new Response(JSON.stringify({ error: { message: 'POST만 지원해요.' } }), { status: 405, headers: { 'content-type': 'application/json', allow: 'POST' } });
