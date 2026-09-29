import { json, err, getDB, ensureSchema, clean } from '../_lib.js';
import { identity } from './me.js';

// 회의 결정 · 입력 현황 저장소 — key/value
// 회의가 끝나면 'lock:<prefix>' 행을 두어 그 회의 키(<prefix>:*)를 잠근다 → 이후 수정 불가(오너가 PUT으로 해제)
async function ensure(db) {
  await ensureSchema(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS decisions (
    key TEXT PRIMARY KEY, value TEXT, note TEXT, by TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run();
}

export async function onRequestGet({ env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensure(db);
  const { results } = await db.prepare('SELECT * FROM decisions').all();
  const map = {}; for (const r of results) map[r.key] = r;
  return json({ decisions: map });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensure(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const key = clean(b.key, 80); if (!key) return err('key required');
  if (key.startsWith('lock:')) return err('reserved key', 400);
  const pfx = key.includes(':') && /^[a-z0-9-]+:(dec|input|rep|disc|by):/.test(key) ? key.split(':')[0] : '';
  if (pfx && await db.prepare('SELECT key FROM decisions WHERE key = ?').bind('lock:' + pfx).first()) return err('회의가 종료되어 기록이 잠겼습니다. 수정이 필요하면 서기에게 요청해 주세요', 423);
  const id = await identity(request, env);
  const value = clean(b.value, 200), note = clean(b.note, 4000), by = id.name || clean(b.by, 60) || '회의';
  const r = await db.prepare(`INSERT INTO decisions (key, value, note, by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note, by = excluded.by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING *`).bind(key, value, note, by).first();
  return json({ decision: r });
}

// 오너·에이전트 전용: 기록 이관/복원(작성자·시각 보존), 삭제, 잠금/해제
export async function onRequestPut({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503);
  await ensure(db);
  const id = await identity(request, env);
  if (!['owner', 'agent'].includes(id.role)) return err('owner only', 403);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const st = [];
  for (const r of b.rows || []) st.push(db.prepare(`INSERT INTO decisions (key, value, note, by, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note, by = excluded.by, updated_at = excluded.updated_at`).bind(clean(r.key, 80), String(r.value ?? ''), String(r.note ?? ''), String(r.by ?? ''), String(r.updated_at || new Date().toISOString())));
  for (const k of b.delete || []) st.push(db.prepare('DELETE FROM decisions WHERE key = ?').bind(clean(k, 80)));
  if (b.lock) st.push(db.prepare(`INSERT INTO decisions (key, value, note, by) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note, by = excluded.by`).bind('lock:' + clean(b.lock, 20), 'locked', String(b.lockNote || ''), id.name || ''));
  if (b.unlock) st.push(db.prepare('DELETE FROM decisions WHERE key = ?').bind('lock:' + clean(b.unlock, 20)));
  if (st.length) await db.batch(st);
  return json({ ok: true, ops: st.length });
}
