import { json, err, getDB, clean } from '../_lib.js';
import { liveSession } from '../_auth.js';
import { EVENT } from './golf.js';

// 골프 사진 보관 — 브라우저에서 축소(긴 변 1600px)한 JPEG 를 D1 BLOB 으로 저장 (R2 미사용)
// GET  /api/golf-photo            → 목록(메타)
// GET  /api/golf-photo?id=N       → 원본 JPEG   /  ?id=N&t=1 → 썸네일
// POST /api/golf-photo            → 본문: JPEG 바이트, 헤더 x-filename / x-caption(URI 인코딩) / x-thumb-size(썸네일 바이트 수, 본문 앞부분)
// DELETE /api/golf-photo?id=N     → 올린 사람 또는 오너
const MAX = 1_500_000;

async function ensure(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS golf_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '', mime TEXT NOT NULL DEFAULT 'image/jpeg', size INTEGER NOT NULL, bytes BLOB NOT NULL, thumb BLOB, created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run();
}
const toU8 = v => v instanceof ArrayBuffer ? new Uint8Array(v) : (Array.isArray(v) ? Uint8Array.from(v) : (v && v.buffer ? new Uint8Array(v.buffer) : new Uint8Array()));

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('login required', 401);
  const u = new URL(request.url); const id = Number(u.searchParams.get('id'));
  if (id) {
    const col = u.searchParams.get('t') ? 'thumb' : 'bytes';
    const row = await db.prepare(`SELECT ${col} AS b, mime FROM golf_photos WHERE id = ? AND event_id = ?`).bind(id, EVENT).first();
    if (!row || !row.b) return err('not found', 404);
    return new Response(toU8(row.b), { headers: { 'content-type': row.mime || 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
  }
  const { results } = await db.prepare('SELECT id, name, caption, size, created_by, created_at FROM golf_photos WHERE event_id = ? ORDER BY id DESC').bind(EVENT).all();
  return json({ photos: results });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('login required', 401);
  const buf = new Uint8Array(await request.arrayBuffer());
  const tsize = Number(request.headers.get('x-thumb-size') || 0);
  if (!buf.length || buf.length > MAX + 200000) return err('사진이 너무 큽니다 (1.5MB 이하, 브라우저에서 자동 축소됩니다)', 413);
  const thumb = tsize > 0 && tsize < buf.length ? buf.slice(0, tsize) : null;
  const main = thumb ? buf.slice(tsize) : buf;
  const name = decodeURIComponent(request.headers.get('x-filename') || 'photo.jpg').slice(0, 120);
  const caption = clean(decodeURIComponent(request.headers.get('x-caption') || ''), 200);
  const r = await db.prepare('INSERT INTO golf_photos (event_id, name, caption, mime, size, bytes, thumb, created_by) VALUES (?,?,?,?,?,?,?,?) RETURNING id').bind(EVENT, name, caption, 'image/jpeg', main.length, main, thumb, s.name).first();
  return json({ ok: true, id: r.id }, 201);
}

export async function onRequestPut({ request, env }) { // 캡션 수정
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('login required', 401);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  await db.prepare('UPDATE golf_photos SET caption = ? WHERE id = ? AND event_id = ?').bind(clean(b.caption, 200), Number(b.id), EVENT).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const s = await liveSession(request, env, db); if (!s) return err('login required', 401);
  const id = Number(new URL(request.url).searchParams.get('id')); if (!id) return err('id required');
  const row = await db.prepare('SELECT created_by FROM golf_photos WHERE id = ? AND event_id = ?').bind(id, EVENT).first();
  if (!row) return err('not found', 404);
  if (row.created_by !== s.name && !['owner', 'agent'].includes(s.role)) return err('올린 사람만 지울 수 있습니다', 403);
  await db.prepare('DELETE FROM golf_photos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
