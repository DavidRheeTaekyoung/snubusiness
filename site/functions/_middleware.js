import { liveSession, isOpen } from './_auth.js';

// 사이트 전체 입장 통제 (준비 단계). 공개 전환 시 GATE_MODE=admin 으로 바꾸면 /admin/·/api/ 만 보호.
// 게스트(준비위원이 아닌 행사기획팀원 등)는 허용된 경로만 — 그 밖은 자기 페이지로 보낸다.
const GUEST_PATHS = { event2027: ['/admin/event2027', '/api/event2027'] };
const GUEST_COMMON = ['/api/me', '/api/logout', '/assets/', '/data/committee.json', '/favicon'];

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const mode = env.GATE_MODE || 'all';
  if (mode === 'off' || isOpen(path)) return next();
  if (mode === 'admin' && !path.startsWith('/admin') && !path.startsWith('/api/')) return next();
  const sess = await liveSession(request, env, env.DB);
  if (sess && sess.role === 'guest') {
    const allowed = (sess.perms || []).flatMap(p => GUEST_PATHS[p] || []).concat(GUEST_COMMON);
    if (allowed.some(p => path === p || path.startsWith(p))) return next();
    if (path.startsWith('/api/')) return new Response(JSON.stringify({ error: '이 계정은 지정된 페이지만 이용할 수 있습니다' }), { status: 403, headers: { 'content-type': 'application/json' } });
    const home = (sess.perms || []).map(p => GUEST_PATHS[p]).find(Boolean);
    return Response.redirect(url.origin + (home ? home[0] + '/' : '/enter/'), 302);
  }
  if (sess) return next();
  if (path.startsWith('/api/')) return new Response(JSON.stringify({ error: 'login required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  return Response.redirect(url.origin + '/enter/?next=' + encodeURIComponent(path + url.search), 302);
}
