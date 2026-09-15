// 이름 + 개인 입장코드 인증 (준비위원 21인). 세션은 HMAC 서명 쿠키.
const COOKIE = 'snu_sess';
const DAYS = 90;
const enc = new TextEncoder();

function b64u(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64uStr(s) { return b64u(enc.encode(s)); }
function fromB64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return atob(s); }

export async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
export function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

export async function ensureAuthTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS access_codes (
    name TEXT PRIMARY KEY, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_login TEXT)`).run();
}

export async function issueSession(env, name, role) {
  const exp = Date.now() + DAYS * 864e5;
  const payload = b64uStr(JSON.stringify({ n: name, r: role || 'member', e: exp }));
  const sig = await hmac(env.SESSION_SECRET || 'dev-secret', payload);
  return { value: payload + '.' + sig, exp };
}
export async function readSession(request, env) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const [payload, sig] = m[1].split('.'); if (!payload || !sig) return null;
  const good = await hmac(env.SESSION_SECRET || 'dev-secret', payload); if (good !== sig) return null;
  let p; try { p = JSON.parse(fromB64u(payload)); } catch { return null; }
  if (!p.n || !p.e || Date.now() > p.e) return null;
  return { name: p.n, role: p.r || 'member', exp: p.e };
}
export function cookieHeader(value, exp) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(exp).toUTCString()}`;
}
export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }

// 보호 예외 경로
export const OPEN = ['/enter', '/api/login', '/api/logout', '/api/health', '/assets/', '/data/committee.json', '/favicon', '/robots.txt', '/sitemap.xml'];
export function isOpen(path) { return OPEN.some(p => path === p || path.startsWith(p) || path === p + '/'); }
