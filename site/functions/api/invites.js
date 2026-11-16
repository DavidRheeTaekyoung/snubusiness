import { json, err, getDB, clean } from '../_lib.js';
import { ensureAccounts, liveSession, hasPerm } from '../_auth.js';

// 동문 사전 명단 (제한 오픈): 준비행사 참석자 명단(이름·학번·휴대전화)을 넣어 두면, 가입 때 이름+휴대전화가 맞는 사람은 자동 승인.
// 명단은 D1 에만 둔다 (공개 저장소에 올리지 않음). 관리는 오너·에이전트 또는 members 권한.
export const normName = s => String(s || '').replace(/\s/g, '');
// 번호: 숫자만, +82 10… → 010…. 해외 번호(+81 등)도 받는다
export function normPhone(s) { let d = String(s || '').split(/\r?\n/)[0].replace(/\D/g, ''); if (/^8210\d{7,8}$/.test(d)) d = '0' + d.slice(2); return d; }
export const okPhone = d => /^\d{9,15}$/.test(d);
// 소속은 여럿일 수 있다 — "경영 83/대학원 87", "EMBA 9기", "경제 85/대학원 89"(타학과 학부 + 경영대 대학원).
// 비교는 첫 줄의 숫자들(입학연도 두 자리 또는 기수)로 한다. 둘째 줄 "9대 EMBA 총동문회장" 같은 직함은 보지 않는다
export function cohortNums(s) { return [...String(s || '').split(/\r?\n/)[0].matchAll(/\d+/g)].map(m => String(Number(m[0].length === 4 ? m[0].slice(2) : m[0]))); }

let ready = false;
export async function ensureInvites(db) {
  if (ready) return; ready = true; await ensureAccounts(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, nname TEXT NOT NULL, cohort TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', email TEXT, joined_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE (nname, phone))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS signup_log (ip TEXT NOT NULL, at INTEGER NOT NULL)`),
  ]);
  for (const c of ["cohort TEXT NOT NULL DEFAULT ''", "phone TEXT NOT NULL DEFAULT ''", 'consent_at TEXT']) { try { await db.prepare('ALTER TABLE accounts ADD COLUMN ' + c).run(); } catch (e) {} }
}

async function guard(request, env, db) { const s = await liveSession(request, env, db); return hasPerm(s, 'members') ? s : null; }

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureInvites(db);
  if (!(await guard(request, env, db))) return err('회원 관리 권한이 없습니다', 403);
  const [inv, acc] = await Promise.all([
    db.prepare('SELECT id, name, cohort, phone, source, email, joined_at, created_at FROM invites ORDER BY id').all(),
    db.prepare("SELECT email, name, cohort, phone, status, note, created_at, last_login, consent_at FROM accounts WHERE role = 'alumni' ORDER BY created_at DESC").all(),
  ]);
  return json({ invites: inv.results, alumni: acc.results });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureInvites(db);
  const me = await guard(request, env, db); if (!me) return err('회원 관리 권한이 없습니다', 403);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const r = clean(b.r, 20);
  if (r === 'import') { // { rows: [{ name, cohort, phone }], source } — 같은 이름+번호는 학번만 갱신
    const src = clean(b.source, 60); const bad = []; const stmts = [];
    for (const x of Array.isArray(b.rows) ? b.rows : []) {
      const name = clean(x.name, 40), phone = normPhone(x.phone), cohort = clean(String(x.cohort || '').split(/\r?\n/)[0], 40);
      if (!name || !okPhone(phone)) { bad.push(name || '(이름 없음)'); continue; }
      stmts.push(db.prepare('INSERT INTO invites (name, nname, cohort, phone, source) VALUES (?,?,?,?,?) ON CONFLICT (nname, phone) DO UPDATE SET cohort = excluded.cohort, name = excluded.name').bind(name, normName(name), cohort, phone, clean(x.source, 60) || src));
    }
    for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
    return json({ ok: true, saved: stmts.length, skipped: bad });
  }
  if (r === 'demote') { // 게스트 등으로 잘못 들어간 계정을 평회원(동문)으로: { name } — 권한을 비우고 사전 명단 번호·학번을 붙인다
    const name = clean(b.name, 40), a = await db.prepare("SELECT email, role FROM accounts WHERE name = ? AND role IN ('guest','member')").bind(name).first(); if (!a) return json({ ok: true, found: false });
    const inv = await db.prepare('SELECT id, cohort, phone FROM invites WHERE nname = ? AND email IS NULL').bind(normName(name)).first();
    await db.batch([db.prepare("UPDATE accounts SET role = 'alumni', perms = '', cohort = ?, phone = ?, note = ? WHERE email = ?").bind(inv?.cohort || '', inv?.phone || '', clean('평회원으로 전환 — ' + me.name, 200), a.email),
      ...(inv ? [db.prepare("UPDATE invites SET email = ?, joined_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(a.email, inv.id)] : [])]);
    return json({ ok: true, found: true, was: a.role, linked: !!inv });
  }
  if (r === 'del') { const id = Number(b.id); const x = await db.prepare('SELECT email FROM invites WHERE id = ?').bind(id).first(); if (!x) return err('not found', 404); if (x.email) return err('이미 가입한 사람은 명단에서 지울 수 없습니다. 계정을 먼저 정리해 주세요'); await db.prepare('DELETE FROM invites WHERE id = ?').bind(id).run(); return json({ ok: true }); }
  const email = clean(b.email, 120).toLowerCase(); if (!email) return err('email required');
  const a = await db.prepare("SELECT email, status FROM accounts WHERE email = ? AND role = 'alumni'").bind(email).first(); if (!a) return err('동문 계정이 아닙니다', 404);
  if (r === 'approve') { await db.prepare("UPDATE accounts SET status = 'active', note = ? WHERE email = ?").bind(clean('수동 승인 — ' + me.name, 200), email).run(); return json({ ok: true }); }
  if (r === 'block') { await db.prepare("UPDATE accounts SET status = 'blocked' WHERE email = ?").bind(email).run(); return json({ ok: true }); }
  if (r === 'reject') { await db.batch([db.prepare('DELETE FROM accounts WHERE email = ?').bind(email), db.prepare('UPDATE invites SET email = NULL, joined_at = NULL WHERE email = ?').bind(email)]); return json({ ok: true }); }
  return err('unknown request');
}
