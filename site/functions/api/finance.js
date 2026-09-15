import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// 결산 관리 장부 — 권한 finance 또는 오너/에이전트만
async function ensure(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL DEFAULT '', item TEXT NOT NULL,
    amount INTEGER NOT NULL, method TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
    created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date)').run();
}
async function guard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (!hasPerm(s, 'finance')) return [null, err('결산 관리 권한이 없습니다', 403)];
  return [s, null];
}
function row(b, who) {
  const type = b.type === 'income' ? 'income' : 'expense';
  const amount = Math.round(Number(String(b.amount ?? '').replace(/[^0-9.-]/g, '')));
  return { date: clean(b.date, 10), type, category: clean(b.category, 40), item: clean(b.item, 120), amount, method: clean(b.method, 30), counterparty: clean(b.counterparty, 60), memo: clean(b.memo, 500), who };
}
const csvEsc = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const u = new URL(request.url); const year = u.searchParams.get('year');
  let q = 'SELECT * FROM ledger', args = [];
  if (year && /^\d{4}$/.test(year)) { q += ' WHERE date LIKE ?'; args.push(year + '-%'); }
  q += ' ORDER BY date ASC, id ASC';
  const { results } = await db.prepare(q).bind(...args).all();
  if (u.searchParams.get('export') === 'csv') {
    const head = ['날짜', '구분', '항목', '내용', '금액', '결제수단', '거래처', '비고', '입력자'];
    const lines = [head.join(',')].concat(results.map(r => [r.date, r.type === 'income' ? '수입' : '지출', r.category, r.item, r.amount, r.method, r.counterparty, r.memo, r.created_by].map(csvEsc).join(',')));
    return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ledger-${year || 'all'}.csv"` } });
  }
  return json({ entries: results, me: s.name });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  // 일괄 등록(CSV 가져오기): { rows: [...] }
  const rows = Array.isArray(b.rows) ? b.rows : [b];
  const stmts = [];
  for (const rb of rows) {
    const r = row(rb, s.name);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.item || !Number.isFinite(r.amount) || r.amount === 0) continue;
    stmts.push(db.prepare('INSERT INTO ledger (date, type, category, item, amount, method, counterparty, memo, created_by) VALUES (?,?,?,?,?,?,?,?,?)').bind(r.date, r.type, r.category, r.item, Math.abs(r.amount), r.method, r.counterparty, r.memo, r.who));
  }
  if (!stmts.length) return err('저장할 수 있는 항목이 없습니다 (날짜 YYYY-MM-DD, 내용, 금액 필요)');
  await db.batch(stmts);
  return json({ ok: true, inserted: stmts.length }, 201);
}

export async function onRequestPut({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const id = Number(b.id); if (!id) return err('id required');
  const r = row(b, s.name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.item || !r.amount) return err('날짜, 내용, 금액을 확인해 주세요');
  await db.prepare("UPDATE ledger SET date=?, type=?, category=?, item=?, amount=?, method=?, counterparty=?, memo=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(r.date, r.type, r.category, r.item, Math.abs(r.amount), r.method, r.counterparty, r.memo, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const id = Number(new URL(request.url).searchParams.get('id')); if (!id) return err('id required');
  await db.prepare('DELETE FROM ledger WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
