import { liveSession, isOpen } from './_auth.js';

// 사이트 전체 입장 통제 (준비 단계). 공개 전환 시 GATE_MODE=admin 으로 바꾸면 /admin/·/api/ 만 보호.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const mode = env.GATE_MODE || 'all';
  if (mode === 'off' || isOpen(path)) return next();
  if (mode === 'admin' && !path.startsWith('/admin') && !path.startsWith('/api/')) return next();
  const sess = await liveSession(request, env, env.DB);
  if (sess) return next();
  if (path.startsWith('/api/')) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  return Response.redirect(url.origin + '/enter/?next=' + encodeURIComponent(path + url.search), 302);
}
