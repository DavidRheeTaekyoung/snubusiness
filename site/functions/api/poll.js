import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// 의견 조사(투표) — 로그인 없이 링크(토큰)로 응답. 첫 쓰임: 창립총회 초청연사 선호도 조사(준비위원 + 학번대표).
// 문항·후보 내용은 D1(polls.body)에만 둔다 — 공개 저장소에 후보 평가 문구가 올라가지 않게.
// 응답은 이름+학번 숫자로 한 사람 한 표, 다시 내면 덮어쓴다. 결과는 event2027 권한자(오너·에이전트 포함)만.
let ready = false;
async function ensure(db) {
  if (ready) return; ready = true;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS polls (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}', token TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 1, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS poll_votes (poll_id TEXT NOT NULL, voter TEXT NOT NULL, name TEXT NOT NULL, cohort TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', answers TEXT NOT NULL DEFAULT '{}', ip TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (poll_id, voter))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS poll_log (ip TEXT NOT NULL, at INTEGER NOT NULL)`),
  ]);
}
const voterKey = (name, cohort) => String(name || '').replace(/\s/g, '') + '|' + [...String(cohort || '').matchAll(/\d+/g)].map(m => m[0].length === 4 ? m[0].slice(2) : String(Number(m[0]))).join('/');
const staff = async (request, env, db) => { const s = await liveSession(request, env, db); return hasPerm(s, 'event2027') ? s : null; };

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const u = new URL(request.url), id = clean(u.searchParams.get('id'), 40);
  if (u.searchParams.get('r') === 'active') { // 홈 화면 카드: 로그인한 준비위원에게만 진행 중인 조사 링크를 준다 (링크 열쇠를 공개 저장소의 정적 파일에 박지 않으려고)
    const s = await liveSession(request, env, db); if (!s || s.role === 'alumni' || s.role === 'guest') return json({ polls: [] });
    const { results } = await db.prepare('SELECT id, title, body, token FROM polls WHERE open = 1 ORDER BY updated_at DESC').all();
    return json({ polls: results.map(p => { const b = JSON.parse(p.body || '{}'); return { id: p.id, title: p.title, subtitle: b.subtitle || '', card: b.card || '', url: `/poll/?id=${p.id}&k=${p.token}` }; }) });
  }
  const p = await db.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first();
  if (u.searchParams.get('r') === 'results') {
    if (!(await staff(request, env, db))) return err('결과는 행사기획팀 권한자만 볼 수 있습니다', 403);
    if (!p) return err('없는 조사입니다', 404);
    const { results } = await db.prepare('SELECT voter, name, cohort, role, answers, created_at, updated_at FROM poll_votes WHERE poll_id = ? ORDER BY updated_at DESC').bind(id).all();
    return json({ poll: { id: p.id, title: p.title, body: JSON.parse(p.body || '{}'), token: p.token, open: !!p.open }, votes: results.map(v => ({ ...v, answers: JSON.parse(v.answers || '{}') })) });
  }
  if (!p || u.searchParams.get('k') !== p.token) return err('링크가 맞지 않습니다. 받으신 링크 전체를 그대로 열어 주세요', 404);
  return json({ id: p.id, title: p.title, body: JSON.parse(p.body || '{}'), open: !!p.open });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  if (b.r === 'delvote') { // 장난·중복 응답 지우기
    if (!(await staff(request, env, db))) return err('권한이 없습니다', 403);
    await db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND voter = ?').bind(clean(b.id, 40), String(b.voter || '')).run(); return json({ ok: true });
  }
  if (b.r === 'save' || b.r === 'open') { // 조사 만들기·고치기·열고 닫기 — 행사기획팀 권한
    if (!(await staff(request, env, db))) return err('권한이 없습니다', 403);
    const id = clean(b.id, 40); if (!/^[a-z0-9-]+$/.test(id)) return err('id 형식');
    if (b.r === 'open') { await db.prepare('UPDATE polls SET open = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?').bind(b.open ? 1 : 0, id).run(); return json({ ok: true }); }
    const old = await db.prepare('SELECT token FROM polls WHERE id = ?').bind(id).first();
    const token = old?.token || [...crypto.getRandomValues(new Uint8Array(9))].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
    await db.prepare("INSERT INTO polls (id, title, body, token, open, updated_at) VALUES (?,?,?,?,1, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT (id) DO UPDATE SET title = excluded.title, body = excluded.body, updated_at = excluded.updated_at").bind(id, clean(b.title, 120), JSON.stringify(b.body || {}), token).run();
    return json({ ok: true, id, token });
  }
  // 응답
  const id = clean(b.id, 40), p = await db.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first();
  if (!p || b.k !== p.token) return err('링크가 맞지 않습니다', 404);
  if (!p.open) return err('응답을 마감했습니다');
  const name = clean(b.name, 40), cohort = clean(b.cohort, 40), role = clean(b.role, 20);
  if (!name) return err('이름을 적어 주세요'); if (!/\d/.test(cohort)) return err('학번(예: 경영 89, EMBA 3기)을 적어 주세요');
  const body = JSON.parse(p.body || '{}'), A = {}, Q = body.questions || [];
  for (const q of Q) {
    const v = b.answers?.[q.id];
    if (q.type === 'text') { A[q.id] = clean(v, 2000); continue; }
    const opts = q.type === 'pick' ? (body.candidates || []).map(c => c.no) : (q.options || []);
    if (v == null || v === '') { if (q.required) return err(`${q.label.split('.')[0]} 문항에 답해 주세요`); continue; }
    if (!opts.includes(v)) return err('선택지가 맞지 않습니다');
    A[q.id] = v;
  }
  for (const q of Q) if (q.notSame && A[q.id] && A[q.id] === A[q.notSame]) return err(`${q.label.split('.')[0]} 은(는) ${q.notSame.toUpperCase()}과 다른 인물로 골라 주세요`);
  const ip = request.headers.get('cf-connecting-ip') || '', now = Date.now();
  const n = await db.prepare('SELECT COUNT(*) AS n FROM poll_log WHERE ip = ? AND at > ?').bind(ip, now - 36e5).first();
  if ((n?.n || 0) >= 30) return err('잠시 후 다시 시도해 주세요', 429);
  const key = voterKey(name, cohort), had = await db.prepare('SELECT 1 FROM poll_votes WHERE poll_id = ? AND voter = ?').bind(id, key).first();
  await db.batch([
    db.prepare('INSERT INTO poll_log (ip, at) VALUES (?, ?)').bind(ip, now),
    db.prepare("INSERT INTO poll_votes (poll_id, voter, name, cohort, role, answers, ip) VALUES (?,?,?,?,?,?,?) ON CONFLICT (poll_id, voter) DO UPDATE SET name = excluded.name, cohort = excluded.cohort, role = excluded.role, answers = excluded.answers, ip = excluded.ip, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id, key, name, cohort, role, JSON.stringify(A), ip),
  ]);
  return json({ ok: true, updated: !!had });
}
