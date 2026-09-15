import { json, err, getDB, clean } from '../_lib.js';
import { ensureAccounts, verifyPassword, issueSession, cookieHeader } from '../_auth.js';

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureAccounts(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const email = clean(b.email, 120).toLowerCase(), password = String(b.password || '');
  if (!email || !password) return err('이메일과 비밀번호를 입력해 주세요');
  const a = await db.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
  if (!a || !(await verifyPassword(password, a.pass_hash, a.salt))) return err('이메일 또는 비밀번호가 맞지 않습니다', 401);
  if (a.status !== 'active') return err('사용이 중지된 계정입니다. 이태경 위원에게 문의해 주세요', 403);
  await db.prepare("UPDATE accounts SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = ?").bind(email).run();
  try { const roster = await fetch(new URL('/data/committee.json', request.url)).then(r => r.json()); const want = (roster.perms || {})[a.name] || []; const have = new Set((a.perms || '').split(',').filter(Boolean)); let ch = false; for (const p of want) if (!have.has(p)) { have.add(p); ch = true; } if (ch) await db.prepare('UPDATE accounts SET perms = ? WHERE email = ?').bind([...have].join(','), email).run(); } catch (e) {}
  const s = await issueSession(env, a.email, a.name, a.role);
  return json({ ok: true, name: a.name, email: a.email, role: a.role }, 200, { 'set-cookie': cookieHeader(s.value, s.exp) });
}
