// 준비위원 전용 계정 인증: 회원가입(명단 이름 검증) + 이메일/비밀번호 로그인. 세션은 HMAC 서명 쿠키.
const COOKIE = 'snu_sess';
const DAYS = 90;
const enc = new TextEncoder();

function b64u(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64uStr(s) { return b64u(enc.encode(s)); }
function fromB64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// 비밀번호: PBKDF2-SHA256 100k, 16바이트 솔트
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { hash: b64u(bits), salt: b64u(salt) };
}
export async function verifyPassword(password, hash, salt) { const h = await hashPassword(password, salt); return h.hash === hash; }

export async function ensureAccounts(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
    email TEXT PRIMARY KEY, name TEXT NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), last_login TEXT, note TEXT)`).run();
}

export async function issueSession(env, email, name, role) {
  const exp = Date.now() + DAYS * 864e5;
  const payload = b64uStr(JSON.stringify({ u: email, n: name, r: role || 'member', e: exp }));
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
  return { email: p.u || null, name: p.n, role: p.r || 'member', exp: p.e };
}
// 세션이 있어도 계정이 차단됐으면 무효
export async function liveSession(request, env, db) {
  const s = await readSession(request, env); if (!s) return null;
  if (db && s.email) { try { await ensureAccounts(db); const a = await db.prepare('SELECT status, role, name FROM accounts WHERE email = ?').bind(s.email).first(); if (!a || a.status !== 'active') return null; s.role = a.role; s.name = a.name; } catch (e) {} }
  return s;
}
export function cookieHeader(value, exp) { return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(exp).toUTCString()}`; }
export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

// 보호 예외 경로
export const OPEN = ['/enter', '/api/login', '/api/signup', '/api/logout', '/api/health', '/assets/', '/data/committee.json', '/favicon', '/robots.txt', '/sitemap.xml'];
export function isOpen(path) { return OPEN.some(p => path === p || path.startsWith(p) || path === p + '/'); }
