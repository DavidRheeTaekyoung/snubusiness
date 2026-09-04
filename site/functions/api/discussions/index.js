import { json, err, getDB, ensureSchema, clean, agentOk } from '../../_lib.js';

const KINDS = ['question', 'request', 'idea', 'issue', 'decision', 'inspection'];
const STATUSES = ['open', 'answered', 'resolved', 'wontfix'];

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureSchema(db);
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  let q = 'SELECT * FROM threads', args = [];
  if (status && STATUSES.includes(status)) { q += ' WHERE status = ?'; args.push(status); }
  q += ' ORDER BY updated_at DESC LIMIT ?'; args.push(limit);
  const { results: threads } = await db.prepare(q).bind(...args).all();
  if (!threads.length) return json({ threads: [] });
  const ids = threads.map(t => t.id);
  const { results: msgs } = await db.prepare(`SELECT * FROM messages WHERE thread_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at ASC`).bind(...ids).all();
  const by = {}; for (const m of msgs) (by[m.thread_id] ||= []).push(m);
  return json({ threads: threads.map(t => ({ ...t, messages: by[t.id] || [] })) });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureSchema(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const title = clean(b.title, 200), body = clean(b.body, 8000), author = clean(b.author, 60) || '익명';
  const kind = KINDS.includes(b.kind) ? b.kind : 'question';
  let role = ['user', 'persona', 'agent', 'system'].includes(b.role) ? b.role : 'user';
  if (role === 'agent' && !agentOk(request, env)) role = 'user';
  if (!title || !body) return err('title and body are required');
  const t = await db.prepare('INSERT INTO threads (title, author, kind) VALUES (?,?,?) RETURNING *').bind(title, author, kind).first();
  const m = await db.prepare('INSERT INTO messages (thread_id, author, role, body) VALUES (?,?,?,?) RETURNING *').bind(t.id, author, role, body).first();
  return json({ thread: { ...t, messages: [m] } }, 201);
}
