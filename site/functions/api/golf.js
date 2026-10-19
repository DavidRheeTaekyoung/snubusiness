import { json, err, getDB, clean } from '../_lib.js';
import { liveSession } from '../_auth.js';

// 골프 행사 운영 — 참가자 · 조편성 · 스코어 · 정산 (로그인한 준비위원 누구나, 입력자 기록)
// GET  /api/golf                → 행사 전체 상태 { event, players, teams, scores, ledger }
// POST /api/golf  { r, ... }    → r = event|player|players(일괄)|team|teams(조편성 일괄)|score|ledger  (id 있으면 수정)
// DELETE /api/golf?r=player|ledger|score&id=
export const EVENT = 'hillmaru-2026-10-24';
const SEED_TEAMS = [
  ['시그니처A', '07:34'], ['시그니처A', '07:41'], ['시그니처A', '07:48'],
  ['시그니처B', '07:34'], ['시그니처B', '07:41'], ['시그니처B', '07:48'],
  ['브리즈', '07:41'], ['브리즈', '07:48'],
  ['선샤인', '07:34'], ['선샤인', '07:41'], ['선샤인', '07:48'],
  ['네스트', '07:34'], ['네스트', '07:41'], ['네스트', '07:48'],
];

export async function ensureGolf(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS golf_event (id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, place TEXT NOT NULL DEFAULT '', fee INTEGER NOT NULL DEFAULT 0, info TEXT NOT NULL DEFAULT '', awards TEXT NOT NULL DEFAULT '{}', updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS golf_players (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, name TEXT NOT NULL, cohort TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', avg INTEGER, handicap INTEGER NOT NULL DEFAULT 0, pref TEXT NOT NULL DEFAULT '', team INTEGER, fee INTEGER, paid INTEGER NOT NULL DEFAULT 0, paid_at TEXT, cart INTEGER NOT NULL DEFAULT 0, dinner INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', created_by TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS golf_teams (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, seq INTEGER NOT NULL, course TEXT NOT NULL, tee TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS golf_scores (player_id INTEGER PRIMARY KEY, event_id TEXT NOT NULL, gross INTEGER, holes TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_by TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS golf_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, type TEXT NOT NULL, item TEXT NOT NULL, amount INTEGER NOT NULL, memo TEXT NOT NULL DEFAULT '', created_by TEXT, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
  ]);
  const ev = await db.prepare('SELECT id FROM golf_event WHERE id = ?').bind(EVENT).first();
  if (!ev) {
    const info = `[힐마루 골프앤리조트 포천] 골프예약완료
예약자명: 서울대경영대 님 · 예약일자: 2026-10-24(토)
시그니처A 07:34 / 07:41 / 07:48 · 시그니처B 07:34 / 07:41 / 07:48 · 브리즈 07:41 / 07:48 · 선샤인 07:34 / 07:41 / 07:48 · 네스트 07:34 / 07:41 / 07:48 (14팀)
취소기한: 2026-10-18(일) 17:00
Eco Front(프론트 방문 없이 체크인): https://eco-front.pocheon.hillmaru.com/sign-in?enc=891CF4C83B52D6D6CBC41DF39C50A2E1&redirect=/reservations/318787
알파메일 디너 사전예약: BBQ 플래터 + 짬뽕탕과 식사`;
    await db.prepare('INSERT INTO golf_event (id, title, date, place, fee, info) VALUES (?,?,?,?,?,?)').bind(EVENT, '준비모임 골프', '2026-10-24', '힐마루 골프앤리조트 포천', 0, info).run();
    await db.batch(SEED_TEAMS.map((t, i) => db.prepare('INSERT INTO golf_teams (event_id, seq, course, tee) VALUES (?,?,?,?)').bind(EVENT, i + 1, t[0], t[1])));
  }
}

async function who(request, env, db) { const s = await liveSession(request, env, db); return s ? s.name : null; }
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.round(n) : null; };
const bool = v => (v === true || v === 1 || v === '1' || v === 'true' || v === 'Y' || v === 'y' || v === 'O' || v === 'o') ? 1 : 0;

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureGolf(db);
  const [event, players, teams, scores, ledger] = await Promise.all([
    db.prepare('SELECT * FROM golf_event WHERE id = ?').bind(EVENT).first(),
    db.prepare('SELECT * FROM golf_players WHERE event_id = ? ORDER BY cohort, name').bind(EVENT).all().then(r => r.results),
    db.prepare('SELECT * FROM golf_teams WHERE event_id = ? ORDER BY seq').bind(EVENT).all().then(r => r.results),
    db.prepare('SELECT * FROM golf_scores WHERE event_id = ?').bind(EVENT).all().then(r => r.results),
    db.prepare('SELECT * FROM golf_ledger WHERE event_id = ? ORDER BY id').bind(EVENT).all().then(r => r.results),
  ]);
  const photos = await db.prepare('SELECT COUNT(*) AS n FROM golf_photos WHERE event_id = ?').bind(EVENT).first().catch(() => ({ n: 0 }));
  return json({ event, players, teams, scores, ledger, photos: photos.n, me: await who(request, env, db) });
}

function playerRow(b) {
  return { name: clean(b.name, 40), cohort: clean(b.cohort, 10).replace(/학번/g, ''), phone: clean(b.phone, 30), avg: num(b.avg), handicap: num(b.handicap) ?? 0, pref: clean(b.pref, 200), team: num(b.team), fee: num(b.fee), paid: bool(b.paid), cart: bool(b.cart), dinner: bool(b.dinner), note: clean(b.note, 300) };
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureGolf(db);
  const me = await who(request, env, db); if (!me) return err('login required', 401);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const r = clean(b.r, 20), now = new Date().toISOString();

  if (r === 'event') {
    await db.prepare('UPDATE golf_event SET title=?, date=?, place=?, fee=?, info=?, awards=?, updated_at=? WHERE id=?')
      .bind(clean(b.title, 80) || '준비모임 골프', clean(b.date, 10) || '2026-10-24', clean(b.place, 80), num(b.fee) ?? 0, clean(b.info, 4000), JSON.stringify(b.awards || {}).slice(0, 2000), now, EVENT).run();
    return json({ ok: true });
  }
  if (r === 'player') {
    const p = playerRow(b); if (!p.name) return err('이름이 필요합니다');
    if (b.id) {
      await db.prepare('UPDATE golf_players SET name=?, cohort=?, phone=?, avg=?, handicap=?, pref=?, team=?, fee=?, paid=?, paid_at=CASE WHEN ?=1 AND paid=0 THEN ? WHEN ?=0 THEN NULL ELSE paid_at END, cart=?, dinner=?, note=?, updated_at=? WHERE id=? AND event_id=?')
        .bind(p.name, p.cohort, p.phone, p.avg, p.handicap, p.pref, p.team, p.fee, p.paid, p.paid, now, p.paid, p.cart, p.dinner, p.note, now, Number(b.id), EVENT).run();
      return json({ ok: true, id: Number(b.id) });
    }
    const ins = await db.prepare('INSERT INTO golf_players (event_id, name, cohort, phone, avg, handicap, pref, team, fee, paid, paid_at, cart, dinner, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id')
      .bind(EVENT, p.name, p.cohort, p.phone, p.avg, p.handicap, p.pref, p.team, p.fee, p.paid, p.paid ? now : null, p.cart, p.dinner, p.note, me).first();
    return json({ ok: true, id: ins.id }, 201);
  }
  if (r === 'players') { // 일괄 추가(엑셀 붙여넣기)
    const rows = (Array.isArray(b.rows) ? b.rows : []).map(playerRow).filter(p => p.name);
    if (!rows.length) return err('추가할 참가자가 없습니다');
    await db.batch(rows.map(p => db.prepare('INSERT INTO golf_players (event_id, name, cohort, phone, avg, handicap, pref, fee, paid, paid_at, cart, dinner, note, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(EVENT, p.name, p.cohort, p.phone, p.avg, p.handicap, p.pref, p.fee, p.paid, p.paid ? now : null, p.cart, p.dinner, p.note, me)));
    return json({ ok: true, inserted: rows.length }, 201);
  }
  if (r === 'team') {
    const id = Number(b.id); if (!id) return err('id required');
    await db.prepare('UPDATE golf_teams SET course=?, tee=?, locked=?, note=? WHERE id=? AND event_id=?').bind(clean(b.course, 30), clean(b.tee, 10), bool(b.locked), clean(b.note, 200), id, EVENT).run();
    return json({ ok: true });
  }
  if (r === 'teams') { // 조편성 일괄 저장: assign = { playerId: teamId|null }
    const a = b.assign || {}; const st = [];
    for (const [pid, tid] of Object.entries(a)) st.push(db.prepare('UPDATE golf_players SET team=?, updated_at=? WHERE id=? AND event_id=?').bind(tid == null ? null : Number(tid), now, Number(pid), EVENT));
    if (st.length) await db.batch(st);
    return json({ ok: true, updated: st.length });
  }
  if (r === 'score') {
    const pid = Number(b.player_id); if (!pid) return err('player_id required');
    const holes = Array.isArray(b.holes) ? JSON.stringify(b.holes.slice(0, 18).map(h => num(h))) : '';
    await db.prepare('INSERT INTO golf_scores (player_id, event_id, gross, holes, note, updated_by, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET gross=excluded.gross, holes=excluded.holes, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at')
      .bind(pid, EVENT, num(b.gross), holes, clean(b.note, 200), me, now).run();
    return json({ ok: true });
  }
  if (r === 'ledger') {
    const type = b.type === 'income' ? 'income' : 'expense', item = clean(b.item, 120), amount = Math.abs(num(b.amount) ?? 0);
    if (!item || !amount) return err('내용과 금액이 필요합니다');
    if (b.id) { await db.prepare('UPDATE golf_ledger SET type=?, item=?, amount=?, memo=?, updated_at=? WHERE id=? AND event_id=?').bind(type, item, amount, clean(b.memo, 300), now, Number(b.id), EVENT).run(); return json({ ok: true }); }
    const ins = await db.prepare('INSERT INTO golf_ledger (event_id, type, item, amount, memo, created_by) VALUES (?,?,?,?,?,?) RETURNING id').bind(EVENT, type, item, amount, clean(b.memo, 300), me).first();
    return json({ ok: true, id: ins.id }, 201);
  }
  return err('unknown resource');
}

export async function onRequestDelete({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureGolf(db);
  const me = await who(request, env, db); if (!me) return err('login required', 401);
  const u = new URL(request.url); const r = u.searchParams.get('r'), id = Number(u.searchParams.get('id'));
  if (!id) return err('id required');
  if (r === 'player') { await db.batch([db.prepare('DELETE FROM golf_players WHERE id=? AND event_id=?').bind(id, EVENT), db.prepare('DELETE FROM golf_scores WHERE player_id=?').bind(id)]); return json({ ok: true }); }
  if (r === 'ledger') { await db.prepare('DELETE FROM golf_ledger WHERE id=? AND event_id=?').bind(id, EVENT).run(); return json({ ok: true }); }
  if (r === 'score') { await db.prepare('DELETE FROM golf_scores WHERE player_id=?').bind(id).run(); return json({ ok: true }); }
  return err('unknown resource');
}
