import { json, err, getDB, clean } from '../_lib.js';
import { ensureAuthTable, sha256, normCode, issueSession, cookieHeader } from '../_auth.js';

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureAuthTable(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const name = clean(b.name, 40), code = normCode(b.code);
  if (!name || code.length < 6) return err('이름과 입장코드를 입력해 주세요');
  const row = await db.prepare('SELECT name, hash, role FROM access_codes WHERE name = ?').bind(name).first();
  if (!row) return err('명단에 없는 이름입니다', 401);
  const h = await sha256(code + '|' + name);
  if (h !== row.hash) return err('입장코드가 맞지 않습니다', 401);
  await db.prepare("UPDATE access_codes SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = ?").bind(name).run();
  const s = await issueSession(env, row.name, row.role);
  return json({ ok: true, name: row.name, role: row.role }, 200, { 'set-cookie': cookieHeader(s.value, s.exp) });
}
