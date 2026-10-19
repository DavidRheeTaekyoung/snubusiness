import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// 복식부기 장부 — 계정과목표(coa) · 수동 분개(journal) · 거래별 계정 지정
// 회비 정산 장부(ledger)의 단식 거래를 화면에서 자동 분개해 시산표·재무제표를 만든다.
// 권한: finance 또는 오너/에이전트
export const DEFAULT_COA = [
  // [코드, 계정명, 구분, 매핑 규칙(항목/내용 정규식)]
  ['101', '현금', 'asset', ''],
  ['102', '보통예금', 'asset', ''],
  ['103', '정기예금', 'asset', ''],
  ['111', '미수금', 'asset', ''],
  ['121', '선급금', 'asset', ''],
  ['201', '미지급금', 'liability', ''],
  ['202', '예수금', 'liability', ''],
  ['203', '선수회비', 'liability', ''],
  ['301', '순자산', 'net', ''],
  ['401', '회비수익', 'revenue', '회비|연회비|평생회비|임원회비|입회비'],
  ['402', '찬조·기부금수익', 'revenue', '찬조|기부|후원|협찬'],
  ['403', '행사참가비수익', 'revenue', '참가비|등록비|행사.*수입'],
  ['404', '이자수익', 'revenue', '이자'],
  ['409', '기타수익', 'revenue', ''],
  ['501', '행사비', 'expense', '행사비|행사|골프|송년|총회|그린피|캐디|카트'],
  ['502', '회의비·식대', 'expense', '식대|식사|회의|조찬|다과|음료'],
  ['503', '장소대관료', 'expense', '대관|장소|임차'],
  ['504', '인쇄·홍보비', 'expense', '인쇄|홍보|현수막|디자인|촬영|사진'],
  ['505', '사무·운영비', 'expense', '사무|운영|도메인|호스팅|소프트웨어|우편|통신'],
  ['506', '경조사비', 'expense', '경조|조화|화환|부의|축의'],
  ['507', '장학금', 'expense', '장학'],
  ['508', '교통비', 'expense', '교통|택시|주차|유류'],
  ['509', '지급수수료', 'expense', '수수료|이체'],
  ['510', '기념품·시상품', 'expense', '기념품|시상|상품|선물'],
  ['599', '기타비용', 'expense', ''],
];

async function ensure(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS coa (code TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, rule TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '', lines TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'adjust', created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS books_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
  ]);
  try { await db.prepare("ALTER TABLE ledger ADD COLUMN account TEXT NOT NULL DEFAULT ''").run(); } catch (e) {}
  const n = await db.prepare('SELECT COUNT(*) AS n FROM coa').first();
  if (!n.n) await db.batch(DEFAULT_COA.map(c => db.prepare('INSERT INTO coa (code, name, kind, rule) VALUES (?,?,?,?)').bind(...c)));
}
async function guard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (!hasPerm(s, 'finance')) return [null, err('결산 관리 권한이 없습니다', 403)];
  return [s, null];
}
const KINDS = ['asset', 'liability', 'net', 'revenue', 'expense'];

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const [coa, journal, meta] = await Promise.all([
    db.prepare('SELECT * FROM coa ORDER BY code').all().then(r => r.results),
    db.prepare('SELECT * FROM journal ORDER BY date, id').all().then(r => r.results),
    db.prepare('SELECT * FROM books_meta').all().then(r => Object.fromEntries(r.results.map(x => [x.key, x.value]))),
  ]);
  return json({ coa, journal: journal.map(j => ({ ...j, lines: JSON.parse(j.lines || '[]') })), meta, me: s.name });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const r = clean(b.r, 20);
  if (r === 'coa') { // 계정 추가/수정
    const code = clean(b.code, 6), name = clean(b.name, 40), kind = clean(b.kind, 12);
    if (!/^\d{3,6}$/.test(code) || !name || !KINDS.includes(kind)) return err('코드(숫자 3~6자리), 계정명, 구분을 확인해 주세요');
    await db.prepare('INSERT INTO coa (code, name, kind, rule, active) VALUES (?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, kind=excluded.kind, rule=excluded.rule, active=excluded.active')
      .bind(code, name, kind, clean(b.rule, 300), b.active === 0 ? 0 : 1).run();
    return json({ ok: true });
  }
  if (r === 'assign') { // 장부 거래의 상대계정 지정 { id, account } 또는 { ids:[], account }
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean); const acc = clean(b.account, 6);
    if (!ids.length) return err('id required');
    await db.batch(ids.map(id => db.prepare('UPDATE ledger SET account = ? WHERE id = ?').bind(acc, id)));
    return json({ ok: true, updated: ids.length });
  }
  if (r === 'journal') { // 수동 분개 — 차대 일치 필수
    const date = clean(b.date, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('날짜를 확인해 주세요');
    const lines = (Array.isArray(b.lines) ? b.lines : []).map(l => ({ code: clean(l.code, 6), dr: Math.round(Number(String(l.dr || 0).replace(/[^0-9.-]/g, ''))) || 0, cr: Math.round(Number(String(l.cr || 0).replace(/[^0-9.-]/g, ''))) || 0, memo: clean(l.memo, 120) })).filter(l => l.code && (l.dr || l.cr));
    const dr = lines.reduce((a, l) => a + l.dr, 0), cr = lines.reduce((a, l) => a + l.cr, 0);
    if (lines.length < 2 || dr !== cr || !dr) return err(`차변(${dr.toLocaleString()})과 대변(${cr.toLocaleString()}) 합계가 같아야 합니다`);
    const kind = ['adjust', 'opening', 'closing'].includes(b.kind) ? b.kind : 'adjust';
    if (b.id) await db.prepare('UPDATE journal SET date=?, memo=?, lines=?, kind=? WHERE id=?').bind(date, clean(b.memo, 300), JSON.stringify(lines), kind, Number(b.id)).run();
    else await db.prepare('INSERT INTO journal (date, memo, lines, kind, created_by) VALUES (?,?,?,?,?)').bind(date, clean(b.memo, 300), JSON.stringify(lines), kind, s.name).run();
    return json({ ok: true });
  }
  if (r === 'meta') { // 단체명·회계연도 시작월·마감 연도 등
    const st = []; for (const [k, v] of Object.entries(b.meta || {})) st.push(db.prepare('INSERT INTO books_meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(clean(k, 40), clean(v, 500)));
    if (st.length) await db.batch(st);
    return json({ ok: true });
  }
  return err('unknown resource');
}

export async function onRequestDelete({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const u = new URL(request.url); const r = u.searchParams.get('r');
  if (r === 'journal') { await db.prepare('DELETE FROM journal WHERE id = ?').bind(Number(u.searchParams.get('id'))).run(); return json({ ok: true }); }
  if (r === 'coa') { // 사용 중인 계정은 비활성만
    const code = clean(u.searchParams.get('code'), 6);
    const used = await db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE account = ?').bind(code).first();
    if (used.n) { await db.prepare('UPDATE coa SET active = 0 WHERE code = ?').bind(code).run(); return json({ ok: true, deactivated: true }); }
    await db.prepare('DELETE FROM coa WHERE code = ?').bind(code).run(); return json({ ok: true });
  }
  return err('unknown resource');
}
