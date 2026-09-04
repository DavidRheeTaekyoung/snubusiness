import { json, err, getDB, ensureSchema, clean, agentOk } from '../../_lib.js';

const STATUSES = ['open', 'answered', 'resolved', 'wontfix'];

async function load(db, id) {
  const thread = await db.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
  if (!thread) return null;
  const { results: messages } = await db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC').bind(id).all();
  return { thread, messages };
}

export async function onRequestGet({ params, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureSchema(db);
  const r = await load(db, Number(params.id)); if (!r) return err('not found', 404);
  return json(r);
}

export async function onRequestPost({ params, request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureSchema(db);
  const id = Number(params.id);
  const t = await db.prepare('SELECT id, status FROM threads WHERE id = ?').bind(id).first(); if (!t) return err('not found', 404);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const body = clean(b.body, 8000), author = clean(b.author, 60) || '익명';
  let role = ['user', 'persona', 'agent', 'system'].includes(b.role) ? b.role : 'user';
  if (role === 'agent' && !agentOk(request, env)) return err('agent key required for role=agent', 403);
  if (!body) return err('body is required');
  const m = await db.prepare('INSERT INTO messages (thread_id, author, role, body) VALUES (?,?,?,?) RETURNING *').bind(id, author, role, body).first();
  // 에이전트가 답하면 answered, 사용자가 다시 쓰면 open
  const next = role === 'agent' ? 'answered' : (t.status === 'answered' ? 'open' : t.status);
  await db.prepare("UPDATE threads SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(next, id).run();
  return json({ message: m, status: next }, 201);
}

export async function onRequestPatch({ params, request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureSchema(db);
  const id = Number(params.id);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const sets = [], args = [];
  if (b.status && STATUSES.includes(b.status)) { sets.push('status = ?'); args.push(b.status); }
  if (b.title) { sets.push('title = ?'); args.push(clean(b.title, 200)); }
  if (!sets.length) return err('nothing to update');
  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"); args.push(id);
  const r = await db.prepare(`UPDATE threads SET ${sets.join(', ')} WHERE id = ? RETURNING *`).bind(...args).first();
  if (!r) return err('not found', 404);
  return json({ thread: r });
}
