import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// 자금(통장) 관리 — 회계(장부)와 분리. 통장관리자(treasury)가 인터넷뱅킹 잔고를 확인해 장부 잔액과 대사하고, 거래별 증빙을 올린다.
//  bank_checks : 잔고 확인 기록 (은행 잔액 vs 그 시점 장부상 보통예금 잔액)
//  evidence    : 거래(ledger) 또는 수동 분개(journal)에 붙는 증빙 — 파일(PDF/이미지, D1 BLOB 2MB) 또는 외부 링크(URL)
// 권한: 읽기 finance·treasury / 잔고 확인 treasury / 증빙 올리기 treasury·finance / 증빙 삭제 올린 사람·오너·에이전트
const MAX = 2_000_000;
let ready = false;
export async function ensureTreasury(db) {
  if (ready) return; ready = true;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS bank_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, bank_balance INTEGER NOT NULL, book_balance INTEGER NOT NULL, diff INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', checked_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY AUTOINCREMENT, ref_kind TEXT NOT NULL DEFAULT 'ledger', ref_id INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'file', name TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, bytes BLOB, note TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_evidence_ref ON evidence(ref_kind, ref_id)'),
  ]);
}
const toU8 = v => v instanceof ArrayBuffer ? new Uint8Array(v) : (Array.isArray(v) ? Uint8Array.from(v) : (v && v.buffer ? new Uint8Array(v.buffer) : new Uint8Array()));
async function guard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (!hasPerm(s, 'finance') && !hasPerm(s, 'treasury')) return [null, err('자금·결산 권한이 없습니다', 403)];
  return [s, null];
}
// 특정 일자 기준 장부상 보통예금(102) 잔액 — 장부 거래(현금 결제 제외, 예정 제외) + 수동 분개의 102 라인
export async function bookBalance(db, date) {
  const [l, j] = await Promise.all([
    db.prepare("SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS b FROM ledger WHERE planned=0 AND date<=? AND method NOT LIKE '%현금%'").bind(date).first().then(r => r.b || 0).catch(() => 0),
    db.prepare('SELECT lines FROM journal WHERE date<=?').bind(date).all().then(r => r.results.reduce((a, x) => { try { for (const ln of JSON.parse(x.lines || '[]')) if (ln.code === '102') a += (ln.dr || 0) - (ln.cr || 0); } catch (e) {} return a; }, 0)).catch(() => 0),
  ]);
  return l + j;
}

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureTreasury(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const u = new URL(request.url); const r = u.searchParams.get('r');
  if (r === 'file') { // 증빙 파일 본문
    const row = await db.prepare("SELECT bytes, mime, name FROM evidence WHERE id = ? AND kind='file'").bind(Number(u.searchParams.get('id'))).first();
    if (!row || !row.bytes) return err('not found', 404);
    const dl = u.searchParams.get('dl') ? 'attachment' : 'inline';
    return new Response(toU8(row.bytes), { headers: { 'content-type': row.mime || 'application/octet-stream', 'content-disposition': `${dl}; filename*=UTF-8''${encodeURIComponent(row.name || 'evidence')}`, 'cache-control': 'private, max-age=86400' } });
  }
  if (r === 'evidence') { // 메타 목록 (파일 본문 제외) — ?ref_kind=&ref_id= 로 한 거래만
    const k = u.searchParams.get('ref_kind'), id = Number(u.searchParams.get('ref_id'));
    const q = k && id ? db.prepare('SELECT id, ref_kind, ref_id, kind, name, url, mime, size, note, created_by, created_at FROM evidence WHERE ref_kind=? AND ref_id=? ORDER BY id').bind(k, id) : db.prepare('SELECT id, ref_kind, ref_id, kind, name, url, mime, size, note, created_by, created_at FROM evidence ORDER BY id');
    const { results } = await q.all();
    return json({ evidence: results, me: s.name, role: s.role });
  }
  const today = new Date().toISOString().slice(0, 10);
  const [checks, bal, ev] = await Promise.all([
    db.prepare('SELECT * FROM bank_checks ORDER BY date DESC, id DESC').all().then(x => x.results),
    bookBalance(db, '9999-12-31'),
    db.prepare('SELECT id, ref_kind, ref_id, kind, name, url, mime, size, note, created_by, created_at FROM evidence ORDER BY id').all().then(x => x.results),
  ]);
  return json({ checks, book_balance: bal, today, evidence: ev, me: s.name, role: s.role, can_check: hasPerm(s, 'treasury'), can_upload: hasPerm(s, 'treasury') || hasPerm(s, 'finance') });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureTreasury(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const ct = request.headers.get('content-type') || '';
  if (!/json/.test(ct)) { // 증빙 파일 업로드 — 본문: 파일 바이트, 헤더 x-ref-kind / x-ref-id / x-filename / x-note (URI 인코딩)
    if (!hasPerm(s, 'treasury') && !hasPerm(s, 'finance')) return err('증빙 업로드 권한이 없습니다', 403);
    const refKind = request.headers.get('x-ref-kind') === 'journal' ? 'journal' : 'ledger'; const refId = Number(request.headers.get('x-ref-id'));
    if (!refId) return err('거래 번호가 없습니다');
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length) return err('빈 파일입니다'); if (buf.length > MAX) return err('파일이 너무 큽니다 (2MB 이하). 이미지는 자동 축소되고, PDF는 용량을 줄여 다시 올려 주세요', 413);
    const mime = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(ct) ? ct : 'application/octet-stream';
    if (mime === 'application/octet-stream') return err('PDF 또는 이미지(JPG·PNG·WEBP)만 올릴 수 있습니다');
    const name = clean(decodeURIComponent(request.headers.get('x-filename') || 'evidence'), 160); const note = clean(decodeURIComponent(request.headers.get('x-note') || ''), 300);
    const r = await db.prepare('INSERT INTO evidence (ref_kind, ref_id, kind, name, mime, size, bytes, note, created_by) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id').bind(refKind, refId, 'file', name, mime, buf.length, buf, note, s.name).first();
    return json({ ok: true, id: r.id }, 201);
  }
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const r = clean(b.r, 20);
  if (r === 'check') { // 잔고 확인: 은행 잔액 입력 → 그 시점 장부 잔액과 비교
    if (!hasPerm(s, 'treasury')) return err('잔고 확인은 자금(통장) 관리자만 기록할 수 있습니다', 403);
    const date = clean(b.date, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('날짜를 확인해 주세요');
    const bank = Math.round(Number(String(b.bank_balance ?? '').replace(/[^0-9.-]/g, ''))); if (!Number.isFinite(bank)) return err('은행 잔액을 숫자로 입력해 주세요');
    const book = await bookBalance(db, date);
    const by = (s.role === 'owner' || s.role === 'agent') && b.checked_by ? clean(b.checked_by, 40) : s.name; // 과거 기록 이관용
    const row = await db.prepare('INSERT INTO bank_checks (date, bank_balance, book_balance, diff, note, checked_by) VALUES (?,?,?,?,?,?) RETURNING *').bind(date, bank, book, bank - book, clean(b.note, 300), by).first();
    return json({ ok: true, check: row }, 201);
  }
  if (r === 'link') { // 외부 링크 증빙 (인터넷뱅킹 캡처 드라이브 링크, 전자영수증 URL 등)
    if (!hasPerm(s, 'treasury') && !hasPerm(s, 'finance')) return err('증빙 등록 권한이 없습니다', 403);
    const refKind = b.ref_kind === 'journal' ? 'journal' : 'ledger'; const refId = Number(b.ref_id); if (!refId) return err('거래 번호가 없습니다');
    const url = clean(b.url, 1000); if (!/^https?:\/\/\S+$/i.test(url)) return err('http(s)로 시작하는 링크를 입력해 주세요');
    let host = ''; try { host = new URL(url).hostname; } catch (e) {}
    const row = await db.prepare('INSERT INTO evidence (ref_kind, ref_id, kind, name, url, note, created_by) VALUES (?,?,?,?,?,?,?) RETURNING id').bind(refKind, refId, 'link', clean(b.name, 160) || host, url, clean(b.note, 300), s.name).first();
    return json({ ok: true, id: row.id }, 201);
  }
  return err('unknown resource');
}

export async function onRequestDelete({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureTreasury(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const u = new URL(request.url); const r = u.searchParams.get('r'); const id = Number(u.searchParams.get('id')); if (!id) return err('id required');
  const boss = s.role === 'owner' || s.role === 'agent';
  if (r === 'check') {
    const row = await db.prepare('SELECT checked_by FROM bank_checks WHERE id = ?').bind(id).first(); if (!row) return err('not found', 404);
    if (!boss && !(hasPerm(s, 'treasury') && row.checked_by === s.name)) return err('본인이 기록한 확인만 지울 수 있습니다', 403);
    await db.prepare('DELETE FROM bank_checks WHERE id = ?').bind(id).run(); return json({ ok: true });
  }
  if (r === 'evidence') {
    const row = await db.prepare('SELECT created_by FROM evidence WHERE id = ?').bind(id).first(); if (!row) return err('not found', 404);
    if (!boss && row.created_by !== s.name) return err('올린 사람과 오너만 지울 수 있습니다', 403);
    await db.prepare('DELETE FROM evidence WHERE id = ?').bind(id).run(); return json({ ok: true });
  }
  return err('unknown resource');
}
