import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// 회의실 · 회의록 — 모든 회의(운영위원회 · 창립총회 행사기획 …)를 한곳에.
// 회의실: 진행 중인 회의(status '진행')를 표로 함께 적는다. '회의 마치기'를 누르면 정리된 글(summary)과 함께 '완료'가 되어 회의록 게시판으로 옮겨진다.
// 표는 ev_meetings · ev_minutes(창립총회 행사기획 페이지와 같은 테이블). 명단·금액이 있어 D1 에만 둔다.
let ready = false;
async function ensure(db) {
  if (ready) return; ready = true;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ev_meetings (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', held_at TEXT NOT NULL DEFAULT '', place TEXT NOT NULL DEFAULT '', attendees TEXT NOT NULL DEFAULT '', updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ev_minutes (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'topic', block TEXT NOT NULL DEFAULT '', seq REAL NOT NULL DEFAULT 0, mins INTEGER NOT NULL DEFAULT 0, topic TEXT NOT NULL DEFAULT '', prep TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', decision TEXT NOT NULL DEFAULT '', updated_by TEXT, updated_at TEXT)`),
  ]);
  for (const c of ["grp TEXT NOT NULL DEFAULT ''", "status TEXT NOT NULL DEFAULT '진행'", "summary TEXT NOT NULL DEFAULT ''", "day TEXT NOT NULL DEFAULT ''", "src TEXT NOT NULL DEFAULT ''", "closed_by TEXT", "closed_at TEXT", "files TEXT NOT NULL DEFAULT ''"])
    try { await db.prepare('ALTER TABLE ev_meetings ADD COLUMN ' + c).run(); } catch {}
}
const ok = s => hasPerm(s, 'event2027') || hasPerm(s, 'meeting');
const MF = ['title', 'held_at', 'place', 'attendees', 'grp', 'day', 'summary', 'files']; // files: 한 줄에 「이름 | 주소」

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('login required', 401); if (!ok(s)) return err('권한이 없습니다', 403);
  const [m, r] = await Promise.all([db.prepare('SELECT * FROM ev_meetings ORDER BY day DESC, id DESC').all(),
    db.prepare('SELECT * FROM ev_minutes WHERE meeting_id > 0 ORDER BY meeting_id, seq, id').all()]);
  return json({ meetings: m.results, minutes: r.results, me: s.name, role: s.role });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('login required', 401); if (!ok(s)) return err('권한이 없습니다', 403);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const now = new Date().toISOString(), lead = ['owner', 'agent'].includes(s.role);

  if (b.r === 'new') { // 회의실에 새 회의 열기
    const r = await db.prepare("INSERT INTO ev_meetings (title, held_at, place, attendees, grp, day, status, updated_by, updated_at) VALUES (?,?,?,?,?,?,'진행',?,?)")
      .bind(clean(b.title, 300) || '새 회의', clean(b.held_at, 300), clean(b.place, 300), clean(b.attendees, 300), clean(b.grp, 40), clean(b.day, 10), s.name, now).run();
    const id = r.meta.last_row_id, rows = Array.isArray(b.rows) && b.rows.length ? b.rows : [{ kind: 'section', mins: 10, topic: '1. 안건' }, { kind: 'topic', topic: '' }];
    await db.batch(rows.map((x, i) => db.prepare('INSERT INTO ev_minutes (meeting_id, kind, seq, mins, topic, prep, note, decision, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, x.kind === 'section' ? 'section' : 'topic', i + 1, Number(x.mins) || 0, clean(x.topic, 300), clean(x.prep, 4000), clean(x.note, 4000), clean(x.decision, 4000), s.name, now)));
    return json({ ok: true, id });
  }
  if (b.r === 'meet') { // 회의 머리 칸 하나 저장
    if (!MF.includes(b.field)) return err('bad field');
    await db.prepare(`UPDATE ev_meetings SET ${b.field} = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(clean(b.value, ['summary', 'files'].includes(b.field) ? 20000 : 300), s.name, now, Number(b.id)).run();
    return json({ ok: true });
  }
  if (b.r === 'close') { // 회의 마치기 → 회의록 게시판으로
    await db.prepare("UPDATE ev_meetings SET status = '완료', summary = ?, closed_by = ?, closed_at = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(clean(b.summary, 20000), s.name, now, s.name, now, Number(b.id)).run();
    return json({ ok: true });
  }
  if (b.r === 'reopen') { // 회의록을 다시 회의실로 (PM만)
    if (!lead) return err('PM만 할 수 있습니다', 403);
    await db.prepare("UPDATE ev_meetings SET status = '진행', updated_by = ?, updated_at = ? WHERE id = ?").bind(s.name, now, Number(b.id)).run();
    return json({ ok: true });
  }
  if (b.r === 'del') { // 회의 통째로 지우기 (PM만)
    if (!lead) return err('PM만 할 수 있습니다', 403);
    const id = Number(b.id); await db.batch([db.prepare('DELETE FROM ev_minutes WHERE meeting_id = ?').bind(id), db.prepare('DELETE FROM ev_meetings WHERE id = ?').bind(id)]);
    return json({ ok: true });
  }
  if (b.r === 'min') { // 안건 행 — 칸 단위 저장이라 여럿이 동시에 써도 다른 칸을 덮어쓰지 않음
    if (!b.id) { const r = await db.prepare('INSERT INTO ev_minutes (meeting_id, kind, seq, mins, topic, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)').bind(Number(b.meeting_id), b.kind === 'section' ? 'section' : 'topic', Number(b.seq) || 0, Number(b.mins) || 0, clean(b.topic, 300), s.name, now).run(); return json({ ok: true, id: r.meta.last_row_id }); }
    if (!['topic', 'prep', 'note', 'decision', 'mins'].includes(b.field)) return err('bad field');
    await db.prepare(`UPDATE ev_minutes SET ${b.field} = ?, updated_by = ?, updated_at = ? WHERE id = ?`).bind(b.field === 'mins' ? (parseInt(b.value, 10) || 0) : clean(b.value, 4000), s.name, now, Number(b.id)).run();
    return json({ ok: true });
  }
  if (b.r === 'min_del') { const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean); if (ids.length) await db.batch(ids.map(id => db.prepare('DELETE FROM ev_minutes WHERE id = ?').bind(id))); return json({ ok: true }); }
  if (b.r === 'import') { // 지난 회의를 회의록 글로 들여오기·고치기 (에이전트·PM) — id 가 있으면 그 회의, 같은 src 가 있으면 그 글을 고친다
    if (!lead) return err('PM만 할 수 있습니다', 403);
    const out = [], upd = 'UPDATE ev_meetings SET title=?, held_at=?, place=?, attendees=?, grp=?, day=?, summary=?, status=?, updated_by=?, updated_at=? WHERE id=?';
    for (const p of b.posts || []) {
      const v = [clean(p.title, 300), clean(p.held_at, 300), clean(p.place, 300), clean(p.attendees, 300), clean(p.grp, 40), clean(p.day, 10), clean(p.summary, 20000), clean(p.status, 10) || '완료'];
      const ex = p.id ? { id: Number(p.id) } : p.src ? await db.prepare('SELECT id FROM ev_meetings WHERE src = ?').bind(clean(p.src, 200)).first() : null;
      if (ex) { await db.prepare(upd).bind(...v, s.name, now, ex.id).run(); out.push(ex.id); continue; }
      const r = await db.prepare('INSERT INTO ev_meetings (title, held_at, place, attendees, grp, day, summary, status, src, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(...v, clean(p.src, 200), s.name, now).run(); out.push(r.meta.last_row_id);
    }
    return json({ ok: true, ids: out });
  }
  return err('unknown request');
}
