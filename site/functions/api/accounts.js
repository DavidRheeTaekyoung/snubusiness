import { json, err, getDB, clean } from '../_lib.js';
import { ensureAccounts, hashPassword, liveSession } from '../_auth.js';

// 회원 관리 (오너 전용): 목록 · 차단/해제 · 임시 비밀번호 · 삭제
async function owner(request, env, db) { const s = await liveSession(request, env, db); return s && s.role === 'owner' ? s : null; }
function tempPassword() { const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; const b = crypto.getRandomValues(new Uint8Array(10)); return [...b].map(x => a[x % a.length]).join(''); }

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureAccounts(db);
  if (!(await owner(request, env, db))) return err('owner only', 403);
  const { results } = await db.prepare('SELECT email, name, role, status, created_at, last_login, note, perms FROM accounts ORDER BY created_at').all();
  const roster = await fetch(new URL('/data/committee.json', request.url)).then(r => r.json()).catch(() => ({ members: [] }));
  const joined = new Set(results.map(r => r.name));
  return json({ accounts: results, not_joined: roster.members.filter(n => !joined.has(n)) });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureAccounts(db);
  const me = await owner(request, env, db); if (!me) return err('owner only', 403);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const email = clean(b.email, 120).toLowerCase(), action = clean(b.action, 20);
  if (!email) return err('email required');
  if (email === me.email && ['block', 'delete'].includes(action)) return err('본인 계정은 차단·삭제할 수 없습니다');
  if (action === 'block' || action === 'unblock') { await db.prepare('UPDATE accounts SET status = ? WHERE email = ?').bind(action === 'block' ? 'blocked' : 'active', email).run(); return json({ ok: true }); }
  if (action === 'delete') { await db.prepare('DELETE FROM accounts WHERE email = ?').bind(email).run(); return json({ ok: true }); }
  if (action === 'reset') { const pw = tempPassword(); const { hash, salt } = await hashPassword(pw); await db.prepare('UPDATE accounts SET pass_hash = ?, salt = ? WHERE email = ?').bind(hash, salt, email).run(); return json({ ok: true, temp_password: pw }); }
  if (action === 'perm') { const p = clean(b.perm, 20); const a = await db.prepare('SELECT perms FROM accounts WHERE email = ?').bind(email).first(); if (!a) return err('not found', 404); const set = new Set((a.perms || '').split(',').filter(Boolean)); b.on ? set.add(p) : set.delete(p); await db.prepare('UPDATE accounts SET perms = ? WHERE email = ?').bind([...set].join(','), email).run(); return json({ ok: true, perms: [...set] }); }
  if (action === 'note') { await db.prepare('UPDATE accounts SET note = ? WHERE email = ?').bind(clean(b.note, 200), email).run(); return json({ ok: true }); }
  return err('unknown action');
}
