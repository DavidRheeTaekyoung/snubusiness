import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// 동문 연락 할당 — VIP 후보를 준비위원·학번대표에게 나눈 배정표. 명단은 D1 에만 둔다(공개 저장소 금지).
// 열람·적재: event2027 또는 vip 권한(오너·에이전트 포함).
let ready = false;
async function ensure(db) {
  if (ready) return; ready = true;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS call_callers (no TEXT PRIMARY KEY, name TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '', cohort TEXT NOT NULL DEFAULT '', file TEXT NOT NULL DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS call_people (vid TEXT PRIMARY KEY, caller TEXT NOT NULL, name TEXT NOT NULL, info TEXT NOT NULL DEFAULT '{}', result TEXT NOT NULL DEFAULT '{}', updated_by TEXT, updated_at TEXT)`),
  ]);
}
const ok = s => hasPerm(s, 'event2027') || hasPerm(s, 'vip');

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  if (!ok(await liveSession(request, env, db))) return err('권한이 없습니다', 403);
  const [c, p] = await Promise.all([db.prepare('SELECT * FROM call_callers ORDER BY no').all(), db.prepare('SELECT vid, caller, name, info, result FROM call_people ORDER BY vid').all()]);
  return json({ callers: c.results, people: p.results.map(x => ({ ...x, info: JSON.parse(x.info || '{}'), result: JSON.parse(x.result || '{}') })) });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!ok(s)) return err('권한이 없습니다', 403);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  if (b.r === 'load') { // 배정표 통째로 교체: { callers: [...], people: [...] } — 이미 적힌 결과(result)는 번호가 같으면 지킨다
    const old = new Map((await db.prepare('SELECT vid, result FROM call_people').all()).results.map(x => [x.vid, x.result]));
    const st = [db.prepare('DELETE FROM call_callers'), db.prepare('DELETE FROM call_people')];
    for (const c of b.callers || []) st.push(db.prepare('INSERT INTO call_callers (no, name, grp, cohort, file) VALUES (?,?,?,?,?)').bind(clean(c.no, 4), clean(c.name, 40), clean(c.grp, 20), clean(c.cohort, 40), clean(c.file, 120)));
    for (const p of b.people || []) st.push(db.prepare('INSERT INTO call_people (vid, caller, name, info, result) VALUES (?,?,?,?,?)').bind(clean(p.vid, 10), clean(p.caller, 4), clean(p.name, 40), JSON.stringify(p.info || {}), old.get(p.vid) || '{}'));
    for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
    return json({ ok: true, callers: (b.callers || []).length, people: (b.people || []).length });
  }
  return err('unknown request');
}
