import { json, VERSION, getDB, ensureSchema } from '../_lib.js';

export async function onRequestGet({ env }) {
  const db = getDB(env);
  let ok = false, threads = null;
  if (db) { try { await ensureSchema(db); const r = await db.prepare('SELECT COUNT(*) AS n FROM threads').first(); threads = r?.n ?? 0; ok = true; } catch (e) { ok = false; } }
  return json({ ok: true, version: VERSION, db: ok, threads, agent_key: !!env.AGENT_KEY, time: new Date().toISOString() });
}
