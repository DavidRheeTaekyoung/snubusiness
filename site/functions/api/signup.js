import { json, err, getDB, clean } from '../_lib.js';
import { ensureAccounts, hashPassword, issueSession, cookieHeader, isEmail } from '../_auth.js';

// 회원가입: 명단(committee.json)의 이름과 일치해야 하고, 이름당 1계정
export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureAccounts(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const name = clean(b.name, 40), email = clean(b.email, 120).toLowerCase(), password = String(b.password || '');
  if (!name || !email || !password) return err('이름, 이메일, 비밀번호를 모두 입력해 주세요');
  if (!isEmail(email)) return err('이메일 형식이 올바르지 않습니다');
  if (password.length < 8) return err('비밀번호는 8자 이상이어야 합니다');
  const roster = await fetch(new URL('/data/committee.json', request.url)).then(r => r.json()).catch(() => ({ members: [] }));
  if (!roster.members.includes(name)) return err('준비위원 명단에 없는 이름입니다. 명단은 이태경 위원에게 문의해 주세요', 403);
  const byEmail = await db.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first();
  if (byEmail) return err('이미 가입된 이메일입니다. 로그인해 주세요', 409);
  const byName = await db.prepare('SELECT email FROM accounts WHERE name = ?').bind(name).first();
  if (byName) return err('이 이름으로 이미 가입된 계정이 있습니다. 본인이 맞다면 이태경 위원에게 알려 주세요', 409);
  const { hash, salt } = await hashPassword(password);
  const role = name === '이태경' ? 'owner' : 'member';
  await db.prepare('INSERT INTO accounts (email, name, pass_hash, salt, role, last_login) VALUES (?,?,?,?,?, strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\'))').bind(email, name, hash, salt, role).run();
  const s = await issueSession(env, email, name, role);
  return json({ ok: true, name, email, role }, 201, { 'set-cookie': cookieHeader(s.value, s.exp) });
}
