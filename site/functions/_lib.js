// 공용 유틸 — Pages Functions
export const VERSION = '0.1.0';

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
}
export function err(message, status = 400) { return json({ error: message }, status); }

export async function ensureSchema(db) {
  // 멱등 — 매 요청 실행해도 비용이 작다 (CREATE IF NOT EXISTS)
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, author TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'question', status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      author TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at)`),
  ]);
}

export function getDB(env) { return env.DB || null; }

export function clean(s, max = 4000) { return String(s ?? '').trim().slice(0, max); }

export function agentOk(request, env) {
  const key = request.headers.get('x-agent-key');
  return !!(env.AGENT_KEY && key && key === env.AGENT_KEY);
}
