import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';
import { normName, normPhone } from './invites.js';

// 투표(의견 조사) — 로그인한 투표 자격자만. 첫 쓰임: 창립총회 초청연사 선호도 조사.
// 자격: 준비위원(계정 role owner·member) + 이 조사의 자격 명단(poll_elig, 예: 학번대표 — 동문 계정의 휴대전화, 없으면 이름으로 대조).
// 한 계정 한 표, 다시 내면 덮어쓴다. 문항·후보 내용은 D1(polls.body)에만 — 공개 저장소에 후보 평가 문구가 올라가지 않게.
// 결과·명단 관리는 event2027 권한자(오너·에이전트 포함).
let ready = false;
async function ensure(db) {
  if (ready) return; ready = true;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}', token TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS poll_votes (poll_id TEXT NOT NULL, voter TEXT NOT NULL, name TEXT NOT NULL, cohort TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', answers TEXT NOT NULL DEFAULT '{}', ip TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (poll_id, voter))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS poll_elig (poll_id TEXT NOT NULL, name TEXT NOT NULL, nname TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', grp TEXT NOT NULL DEFAULT '학번대표', cohort TEXT NOT NULL DEFAULT '')`),
  ]);
}
const staff = s => hasPerm(s, 'event2027');
const COMMITTEE = ['owner', 'member'];
// 이 계정이 이 조사에 투표할 수 있나 → 구분(준비위원/학번대표) 또는 null
async function eligible(db, pollId, s) {
  if (!s || !s.email) return null;
  if (COMMITTEE.includes(s.role)) return '준비위원';
  const a = await db.prepare('SELECT phone FROM accounts WHERE email = ?').bind(s.email).first().catch(() => null);
  const ph = normPhone(a?.phone);
  // 동문 계정은 휴대전화로, 휴대전화가 없는 계정(행사기획팀 게스트 등)은 이름으로 대조
  const e = ph ? await db.prepare('SELECT grp FROM poll_elig WHERE poll_id = ? AND phone = ?').bind(pollId, ph).first()
    : await db.prepare('SELECT grp FROM poll_elig WHERE poll_id = ? AND nname = ?').bind(pollId, normName(s.name)).first();
  return e ? e.grp : null;
}
const parse = p => ({ id: p.id, title: p.title, body: JSON.parse(p.body || '{}'), open: !!p.open });

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const u = new URL(request.url), id = clean(u.searchParams.get('id'), 40), r = u.searchParams.get('r');
  const s = await liveSession(request, env, db);
  if (r === 'active') { // 홈 화면 카드: 투표 자격자에게만
    const { results } = await db.prepare('SELECT * FROM polls WHERE open = 1 ORDER BY updated_at DESC').all(); const out = [];
    for (const p of results) { const g = await eligible(db, p.id, s); if (!g) continue; const b = JSON.parse(p.body || '{}'); const v = await db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND voter = ?').bind(p.id, s.email).first(); out.push({ id: p.id, title: p.title, card: b.card || b.subtitle || '', url: `/poll/?id=${p.id}`, voted: !!v }); }
    return json({ polls: out });
  }
  const p = await db.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first(); if (!p) return err('없는 조사입니다', 404);
  if (r === 'results') {
    if (!staff(s)) return err('결과는 행사기획팀 권한자만 볼 수 있습니다', 403);
    const [v, el, cm] = await Promise.all([
      db.prepare('SELECT voter, name, cohort, role, answers, created_at, updated_at FROM poll_votes WHERE poll_id = ? ORDER BY updated_at DESC').bind(id).all(),
      db.prepare('SELECT name, phone, grp, cohort FROM poll_elig WHERE poll_id = ? ORDER BY name').bind(id).all(),
      db.prepare("SELECT name, email FROM accounts WHERE role IN ('owner','member') AND status = 'active' ORDER BY name").all(),
    ]);
    const all = await db.prepare("SELECT name, email, phone, role FROM accounts WHERE status = 'active' AND role <> 'agent'").all();
    const byPhone = new Map(all.results.filter(a => a.phone).map(a => [normPhone(a.phone), a])), byName = new Map(all.results.filter(a => !a.phone).map(a => [normName(a.name), a]));
    const voted = new Set(v.results.map(x => x.voter)), cmNames = new Set(cm.results.map(a => normName(a.name)));
    // 준비위원이면서 학번대표 명단에도 있는 사람은 준비위원으로 한 번만 센다
    const roster = [...cm.results.map(a => ({ name: a.name, grp: '준비위원', joined: true, voted: voted.has(a.email), also: el.results.some(e => e.nname === normName(a.name)) ? '학번대표' : '' })),
      ...el.results.filter(e => !cmNames.has(e.nname)).map(e => { const a = (e.phone && byPhone.get(e.phone)) || byName.get(e.nname); return { name: e.name, grp: e.grp, cohort: e.cohort, joined: !!a, voted: !!a && voted.has(a.email) }; })];
    return json({ poll: parse(p), votes: v.results.map(x => ({ ...x, answers: JSON.parse(x.answers || '{}') })), roster });
  }
  const g = await eligible(db, id, s);
  const mine = s?.email ? await db.prepare('SELECT answers, updated_at FROM poll_votes WHERE poll_id = ? AND voter = ?').bind(id, s.email).first() : null;
  return json({ ...parse(p), me: { name: s?.name || '', group: g, staff: staff(s) }, mine: mine ? JSON.parse(mine.answers) : null, mine_at: mine?.updated_at || null });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('로그인이 필요합니다', 401);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const id = clean(b.id, 40);
  if (['save', 'open', 'delvote', 'voters'].includes(b.r)) {
    if (!staff(s)) return err('권한이 없습니다', 403);
    if (b.r === 'delvote') { await db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND voter = ?').bind(id, String(b.voter || '')).run(); return json({ ok: true }); }
    if (b.r === 'open') { await db.prepare("UPDATE polls SET open = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(b.open ? 1 : 0, id).run(); return json({ ok: true }); }
    if (b.r === 'voters') { // 자격 명단 교체: { rows: [{ name, phone, cohort }], grp }
      const grp = clean(b.grp, 20) || '학번대표', rows = (Array.isArray(b.rows) ? b.rows : []).filter(x => clean(x.name, 40));
      await db.batch([db.prepare('DELETE FROM poll_elig WHERE poll_id = ? AND grp = ?').bind(id, grp),
        ...rows.map(x => db.prepare('INSERT INTO poll_elig (poll_id, name, nname, phone, grp, cohort) VALUES (?,?,?,?,?,?)').bind(id, clean(x.name, 40), normName(x.name), normPhone(x.phone), grp, clean(x.cohort, 40)))]);
      return json({ ok: true, saved: rows.length });
    }
    if (!/^[a-z0-9-]+$/.test(id)) return err('id 형식');
    const old = await db.prepare('SELECT token FROM polls WHERE id = ?').bind(id).first();
    await db.prepare("INSERT INTO polls (id, title, body, token, open, updated_at) VALUES (?,?,?,?,1, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT (id) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at").bind(id, clean(b.title, 120), JSON.stringify(b.body || {}), old?.token || '-').run();
    return json({ ok: true, id });
  }
  // 투표
  const p = await db.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first(); if (!p) return err('없는 조사입니다', 404);
  if (!p.open) return err('투표를 마감했습니다');
  const g = await eligible(db, id, s); if (!g) return err('이 투표는 준비위원·학번대표만 참여할 수 있습니다', 403);
  const body = JSON.parse(p.body || '{}'), A = {}, nos = (body.candidates || []).map(c => c.no);
  for (const q of body.questions || []) {
    const v = b.answers?.[q.id];
    if (q.type === 'multi') { const arr = [...new Set(Array.isArray(v) ? v : [])]; if (arr.some(x => !nos.includes(x))) return err('선택지가 맞지 않습니다'); if (arr.length < (q.min || 1) || arr.length > (q.max || 3)) return err(`${q.label.split('.')[0]}: ${q.min || 1}~${q.max || 3}명을 골라 주세요`); A[q.id] = arr; continue; }
    if (q.type === 'text') { A[q.id] = clean(v, 2000); continue; }
    if (v == null || v === '') { if (q.required) return err(`${q.label.split('.')[0]} 문항에 답해 주세요`); continue; }
    if (!(q.options || nos).includes(v)) return err('선택지가 맞지 않습니다'); A[q.id] = v;
  }
  const had = await db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND voter = ?').bind(id, s.email).first();
  const acc = await db.prepare('SELECT cohort FROM accounts WHERE email = ?').bind(s.email).first().catch(() => null);
  await db.prepare("INSERT INTO poll_votes (poll_id, voter, name, cohort, role, answers, ip) VALUES (?,?,?,?,?,?,?) ON CONFLICT (poll_id, voter) DO UPDATE SET name = excluded.name, role = excluded.role, answers = excluded.answers, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id, s.email, s.name, acc?.cohort || '', g, JSON.stringify(A), request.headers.get('cf-connecting-ip') || '').run();
  return json({ ok: true, updated: !!had });
}
