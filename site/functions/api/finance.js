import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';
import { ensureTreasury } from './treasury.js';

// 결산 관리 장부 — 쓰기는 finance(회계담당), 읽기는 finance·treasury(자금관리자). 오너/에이전트는 전부
// 분개 번호: 거래마다 연도별 일련번호(seq)를 저장 → "2026-0153" 처럼 표시. 증빙(evidence)도 이 번호로 관리
let ready = false;
export async function ensureLedger(db) {
  if (ready) return; ready = true; // 워커가 뜰 때 한 번만 (D1 왕복 절약)
  await db.prepare(`CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', item TEXT NOT NULL,
    amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date)').run();
  // 행사 구분 · 예정(계획) 여부 — 2026-10-19 추가 / 상대계정(account) · 분개 번호(seq) — 2026-11-09 추가
  for (const sql of ["ALTER TABLE ledger ADD COLUMN event TEXT NOT NULL DEFAULT ''", 'ALTER TABLE ledger ADD COLUMN planned INTEGER NOT NULL DEFAULT 0', "ALTER TABLE ledger ADD COLUMN account TEXT NOT NULL DEFAULT ''", 'ALTER TABLE ledger ADD COLUMN seq INTEGER']) { try { await db.prepare(sql).run(); } catch (e) {} }
  // 번호가 없는 기존 거래에 연도별 일련번호 부여 (날짜·id 순)
  const miss = await db.prepare('SELECT COUNT(*) AS n FROM ledger WHERE seq IS NULL').first();
  if (miss && miss.n) {
    const { results } = await db.prepare('SELECT id, date FROM ledger ORDER BY date, id').all(); const cnt = {}; const st = [];
    for (const r of results) { const y = r.date.slice(0, 4); cnt[y] = (cnt[y] || 0) + 1; st.push(db.prepare('UPDATE ledger SET seq = ? WHERE id = ?').bind(cnt[y], r.id)); }
    for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
  }
  await ensureTreasury(db);
}
export async function readGuard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (!hasPerm(s, 'finance') && !hasPerm(s, 'treasury')) return [null, err('결산 관리 권한이 없습니다', 403)];
  return [s, null];
}
async function writeGuard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (!hasPerm(s, 'finance')) return [null, err('장부 입력은 회계담당(결산 관리 권한)만 할 수 있습니다', 403)];
  return [s, null];
}
function row(b, who) {
  const type = b.type === 'income' ? 'income' : 'expense';
  const amount = Math.round(Number(String(b.amount ?? '').replace(/[^0-9.-]/g, '')));
  return { date: clean(b.date, 10), type, category: clean(b.category, 40), item: clean(b.item, 120), amount, method: clean(b.method, 30), counterparty: clean(b.counterparty, 60), memo: clean(b.memo, 500), event: clean(b.event, 60), planned: (b.planned === true || b.planned === 1 || b.planned === '1' || /예정|계획|예산/.test(String(b.planned || ''))) ? 1 : 0, account: /^\d{3,6}$/.test(String(b.account || '')) ? String(b.account) : '', who };
}
const csvEsc = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export const ledgerNo = r => r.date.slice(0, 4) + '-' + String(r.seq || 0).padStart(4, '0');
// 같은 연도 안에서 다음 일련번호 (INSERT 안의 서브쿼리 — batch 가 순서대로 실행되므로 일괄 등록에도 안전)
const NEXT_SEQ = "(SELECT COALESCE(MAX(seq),0)+1 FROM ledger WHERE substr(date,1,4)=?)";

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureLedger(db);
  const [s, e] = await readGuard(request, env, db); if (e) return e;
  const u = new URL(request.url); const year = u.searchParams.get('year');
  let q = 'SELECT * FROM ledger', args = [];
  if (year && /^\d{4}$/.test(year)) { q += ' WHERE date LIKE ?'; args.push(year + '-%'); }
  q += ' ORDER BY date ASC, id ASC';
  const [{ results }, ev] = await Promise.all([db.prepare(q).bind(...args).all(), db.prepare("SELECT ref_id, COUNT(*) AS n FROM evidence WHERE ref_kind='ledger' GROUP BY ref_id").all().then(r => Object.fromEntries(r.results.map(x => [x.ref_id, x.n])))]);
  for (const r of results) { r.no = ledgerNo(r); r.ev = ev[r.id] || 0; }
  if (u.searchParams.get('export') === 'csv') {
    const head = ['번호', '날짜', '구분', '항목', '내용', '금액', '결제수단', '거래처', '비고', '행사', '예정', '계정', '증빙', '입력자'];
    const lines = [head.join(',')].concat(results.map(r => [r.no, r.date, r.type === 'income' ? '수입' : '지출', r.category, r.item, r.amount, r.method, r.counterparty, r.memo, r.event, r.planned ? '예정' : '', r.account, r.ev || '', r.created_by].map(csvEsc).join(',')));
    return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ledger-${year || 'all'}.csv"` } });
  }
  return json({ entries: results, me: s.name, can_write: hasPerm(s, 'finance'), can_treasury: hasPerm(s, 'treasury'), ai: !!env.ANTHROPIC_API_KEY });
}

// 빠른 입력 — 영수증 사진·PDF·문장을 Claude 에 보내 거래 배열로 받는다. 키(ANTHROPIC_API_KEY)가 없으면 503 → 화면은 규칙 파서만 쓴다.
// 보내는 내용은 사용자가 방금 올린 파일·문장과 계정과목·항목 이름 목록뿐 (장부 거래 자체는 보내지 않는다)
const AI_MODEL = 'claude-sonnet-5-5';
const AI_SCHEMA = { type: 'object', additionalProperties: false, required: ['transactions'], properties: { transactions: { type: 'array', items: { type: 'object', additionalProperties: false,
  required: ['date', 'type', 'category', 'item', 'amount', 'counterparty', 'method', 'event', 'confidence', 'file'],
  properties: { date: { type: 'string', description: 'YYYY-MM-DD. 모르면 빈 문자열' }, type: { type: 'string', enum: ['income', 'expense'] }, category: { type: 'string', description: '항목 — 주어진 항목 이름 중 하나, 없으면 짧은 새 이름' }, item: { type: 'string', description: '내용 한 줄' }, amount: { type: 'integer', description: '원 단위 양수' }, counterparty: { type: 'string', description: '거래처 또는 납부자 이름, 모르면 빈 문자열' }, method: { type: 'string', description: '계좌이체/카드/현금/자동이체/간편결제/ATM 중 하나 또는 빈 문자열' }, event: { type: 'string', description: '행사 이름(주어진 목록 중) 또는 빈 문자열' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, file: { type: 'integer', description: '근거가 된 파일 번호(0부터), 문장에서 나왔으면 -1' } } } } } };
async function aiParse(env, b) {
  if (!env.ANTHROPIC_API_KEY) return err('사진·PDF 읽기는 오너가 `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name snubusiness` 로 키를 넣으면 켜집니다', 503);
  const text = clean(b.text, 6000); const files = (Array.isArray(b.files) ? b.files : []).slice(0, 8); const hints = b.hints || {};
  let total = 0; const content = [];
  files.forEach((f, i) => { const data = String(f.data || '').replace(/^data:[^,]*,/, ''); total += data.length; if (!data) return;
    const mime = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/.test(f.mime) ? f.mime : 'image/jpeg';
    content.push({ type: 'text', text: `[파일 ${i}] ${clean(f.name, 120)}` });
    content.push(mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: mime, data } } : { type: 'image', source: { type: 'base64', media_type: mime, data } }); });
  if (total > 9_000_000) return err('파일이 너무 큽니다 (한 번에 6MB 이하)', 413);
  if (!text && !content.length) return err('읽을 문장이나 파일이 없습니다');
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  content.push({ type: 'text', text: (text ? `[문장]\n${text}\n\n` : '') + `위 문장과 파일(영수증·이체확인증·거래내역)에 적힌 거래를 전부 추출해 transactions 로 답하세요. 오늘은 ${today} (KST). 연도가 없으면 올해로, 두 달 넘게 미래면 작년으로. 한 파일에 여러 거래가 있으면 각각. 영수증은 보통 지출(expense), 기부·회비·참가비·이자 입금은 수입(income). 금액은 원 단위 정수. 항목 이름은 가능한 한 다음 중에서 고르세요: ${(hints.categories || []).slice(0, 60).join(', ') || '(없음)'}. 행사 이름은 다음 중에서: ${(hints.events || []).slice(0, 20).join(', ') || '(없음)'}. 확실하지 않은 칸은 빈 문자열로 두고 confidence 를 낮추세요.` });
  const payload = { model: AI_MODEL, max_tokens: 8000, output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_SCHEMA } }, fallbacks: 'default',
    system: '당신은 비영리 동문회의 회계 보조입니다. 영수증·이체확인증·은행 거래내역·자유 문장에서 거래(날짜·수입/지출·항목·내용·금액·거래처·결제수단·행사)를 추출해 JSON 으로만 답합니다. 추측한 값은 confidence 를 낮춥니다.',
    messages: [{ role: 'user', content }] };
  const call = async (p, beta) => fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21', ...(beta ? { 'anthropic-beta': beta } : {}) }, body: JSON.stringify(p) });
  let r, j; try {
    r = await call(payload, 'server-side-fallback-2026-07-01'); j = await r.json().catch(() => ({}));
    if (r.status === 400 && /fallback/i.test(j.error && j.error.message || '')) { const { fallbacks, ...p2 } = payload; r = await call(p2); j = await r.json().catch(() => ({})); } // 거절 대비 폴백을 못 쓰는 환경이면 빼고 다시
  } catch (e) { return err('Claude 연결 실패: ' + e.message, 502); }
  if (!r.ok) return err('Claude 오류: ' + (j.error && j.error.message || r.status), 502);
  if (j.stop_reason === 'refusal') return err('Claude 가 이 내용의 처리를 거절했습니다', 422);
  const txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  let out; try { out = JSON.parse(txt); } catch { return err('Claude 응답을 읽지 못했습니다' + (j.stop_reason === 'max_tokens' ? ' (내용이 너무 깁니다)' : ''), 502); }
  const tx = (out.transactions || []).map(t => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : '', type: t.type === 'income' ? 'income' : 'expense', category: clean(t.category, 40), item: clean(t.item, 120), amount: Math.abs(Math.round(Number(t.amount) || 0)), counterparty: clean(t.counterparty, 60), method: clean(t.method, 30), event: clean(t.event, 60), confidence: ['high', 'medium', 'low'].includes(t.confidence) ? t.confidence : 'low', file: Number.isInteger(t.file) ? t.file : -1 })).filter(t => t.amount);
  return json({ ok: true, transactions: tx, model: j.model || AI_MODEL, usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens } : null });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureLedger(db);
  const [s, e] = await writeGuard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  if (b.r === 'parse') return aiParse(env, b);
  // 일괄 등록(CSV·빠른 입력): { rows: [...] } — account(상대계정 코드)도 같이 받는다
  const rows = Array.isArray(b.rows) ? b.rows : [b];
  const stmts = [];
  for (const rb of rows) {
    const r = row(rb, s.name);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.item || !Number.isFinite(r.amount) || r.amount === 0) continue;
    stmts.push(db.prepare(`INSERT INTO ledger (date, type, category, item, amount, method, counterparty, memo, event, planned, account, created_by, seq) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,${NEXT_SEQ}) RETURNING id, date, seq, type, account`).bind(r.date, r.type, r.category, r.item, Math.abs(r.amount), r.method, r.counterparty, r.memo, r.event, r.planned, r.account, r.who, r.date.slice(0, 4)));
  }
  if (!stmts.length) return err('저장할 수 있는 항목이 없습니다 (날짜 YYYY-MM-DD, 내용, 금액 필요)');
  const ins = []; // 저장된 거래의 id·번호 — 화면이 "분개: 차 ○○ / 대 ○○, 번호 2026-0034" 를 보여 주고 증빙을 붙이는 데 쓴다
  for (let i = 0; i < stmts.length; i += 90) { const res = await db.batch(stmts.slice(i, i + 90)); for (const x of res) for (const r of (x.results || [])) ins.push({ id: r.id, no: ledgerNo(r), type: r.type, account: r.account }); }
  return json({ ok: true, inserted: stmts.length, rows: ins }, 201);
}

export async function onRequestPut({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureLedger(db);
  const [s, e] = await writeGuard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const id = Number(b.id); if (!id) return err('id required');
  const r = row(b, s.name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.item || !r.amount) return err('날짜, 내용, 금액을 확인해 주세요');
  const old = await db.prepare('SELECT date, account FROM ledger WHERE id = ?').bind(id).first(); if (!old) return err('not found', 404);
  const account = b.account === undefined ? old.account : r.account; // 수정 폼에 계정 칸이 없으면 기존 계정 유지
  if (old.date.slice(0, 4) !== r.date.slice(0, 4)) // 연도가 바뀌면 그 연도의 새 번호
    await db.prepare(`UPDATE ledger SET date=?, type=?, category=?, item=?, amount=?, method=?, counterparty=?, memo=?, event=?, planned=?, account=?, seq=${NEXT_SEQ}, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(r.date, r.type, r.category, r.item, Math.abs(r.amount), r.method, r.counterparty, r.memo, r.event, r.planned, account, r.date.slice(0, 4), id).run();
  else await db.prepare("UPDATE ledger SET date=?, type=?, category=?, item=?, amount=?, method=?, counterparty=?, memo=?, event=?, planned=?, account=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(r.date, r.type, r.category, r.item, Math.abs(r.amount), r.method, r.counterparty, r.memo, r.event, r.planned, account, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureLedger(db);
  const [s, e] = await writeGuard(request, env, db); if (e) return e;
  const id = Number(new URL(request.url).searchParams.get('id')); if (!id) return err('id required');
  const ev = await db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE ref_kind='ledger' AND ref_id=?").bind(id).first();
  if (ev && ev.n) return err('증빙이 붙어 있는 거래는 삭제할 수 없습니다. 증빙을 먼저 지우거나 내용을 수정하세요');
  await db.prepare('DELETE FROM ledger WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
