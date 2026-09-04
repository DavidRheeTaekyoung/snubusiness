import { json, err, getDB, ensureSchema, clean } from '../_lib.js';

// 회의 결정 · 입력 현황 저장소 — key/value
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
  const value = clean(b.value, 200), note = clean(b.note, 2000), by = clean(b.by, 60) || '회의';
  const r = await db.prepare(`INSERT INTO decisions (key, value, note, by) VALUES (?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, note = excluded.note, by = excluded.by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING *`).bind(key, value, note, by).first();
  return json({ decision: r });
}
