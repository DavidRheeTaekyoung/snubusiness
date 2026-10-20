import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';
import { mailReady } from '../_mail.js';

// 2027 창립총회 행사기획 — 대행사 접촉 현황 · 메일 발송(pm@snubusiness.com) · 발송 기록
// 열람: event2027 권한(행사기획팀) 또는 오너/에이전트. 발송: 같은 권한, 발송자 기록.
const VENDORS = [
  ['intercom', 1, '인터컴', 'INTERCOM', '02-566-6339', '', 'intercom@intercom.co.kr', '서울 강남구 봉은사로 225, 스퀘어미빌딩 B1·4~7층', 'https://intercom.co.kr/contact_us/write'],
  ['unione', 2, '유니원커뮤니케이션즈', 'UNIONE', '02-550-2693', '대표 02-550-2500', 'project@unione.co.kr', '서울 서초구 서운로 42, 유니원빌딩', 'https://www.unione.co.kr/main/contact/index.php'],
  ['fm', 3, '에프엠커뮤니케이션즈', 'FM', '02-3498-0800', '', 'contact@promotion.co.kr', '서울 서초구 반포대로22길 34', 'https://www.promotion.co.kr/'],
  ['planworks', 4, '플랜웍스엔터프라이즈', 'PLANWORKS', '02-422-6200', '', 'pwe@pwe.co.kr', '서울 강남구 봉은사로63길 23, 플랜웍스빌딩', 'https://www.pwe.co.kr/page/contact.html'],
  ['ezpmp', 5, '이즈피엠피', 'EZPMP', '02-3475-2600', '', 'ezpmp@ezpmp.co.kr', '서울 서초구 남부순환로 2465, 혜준빌딩 2~6층', 'https://ezpmp.co.kr/o2meet/siteCreateInfo.do'],
  ['peoplex', 6, '피플엑스', 'People-X', '02-566-6031', '02-566-6067', 'pco1@people-x.com', '서울 강남구 역삼로17길 16, 해오름빌딩 1층', 'https://people-x.co.kr/xe/px_contact'],
  ['ido', 7, '이도플래닝', 'IDO Planning', '070-4006-8520', '이메일·주소 전화 재확인 필수', 'ido@idoplanning.co.kr', '서울 영등포구 양산로 57-5, 이노플렉스 403호 (2026 채용공고 기준)', 'http://www.idoplanning.co.kr/'],
];

async function ensure(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ev_vendors (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, name TEXT NOT NULL, en TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', phone2 TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '', direct TEXT NOT NULL DEFAULT '', rfp_email TEXT NOT NULL DEFAULT '', intent TEXT NOT NULL DEFAULT '미확인', docs TEXT NOT NULL DEFAULT '미수령', next_step TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', called_at TEXT, updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ev_mail (id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT, kind TEXT, to_addr TEXT NOT NULL, cc TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, provider_id TEXT, error TEXT, sent_by TEXT, sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ev_scores (vendor TEXT NOT NULL, evaluator TEXT NOT NULL, scores TEXT NOT NULL DEFAULT '{}', comment TEXT NOT NULL DEFAULT '', updated_at TEXT, PRIMARY KEY (vendor, evaluator))`),
  ]);
  const n = await db.prepare('SELECT COUNT(*) AS n FROM ev_vendors').first();
  if (!n.n) await db.batch(VENDORS.map(v => db.prepare('INSERT INTO ev_vendors (id, seq, name, en, phone, phone2, email, address, url) VALUES (?,?,?,?,?,?,?,?,?)').bind(...v)));
}
async function guard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (!hasPerm(s, 'event2027')) return [null, err('행사기획팀만 볼 수 있는 페이지입니다', 403)];
  return [s, null];
}

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const [vendors, mail, scores] = await Promise.all([
    db.prepare('SELECT * FROM ev_vendors ORDER BY seq').all().then(r => r.results),
    db.prepare('SELECT id, vendor, kind, to_addr, cc, subject, status, error, sent_by, sent_at FROM ev_mail ORDER BY id DESC LIMIT 200').all().then(r => r.results),
    db.prepare('SELECT * FROM ev_scores').all().then(r => r.results.map(x => ({ ...x, scores: JSON.parse(x.scores || '{}') }))),
  ]);
  return json({ vendors, mail, scores, me: s.name, role: s.role, mail_ready: mailReady(env) });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const now = new Date().toISOString();

  if (b.r === 'vendor') {
    const F = ['contact', 'direct', 'rfp_email', 'intent', 'docs', 'next_step', 'note', 'phone', 'phone2', 'email'];
    const sets = F.filter(f => f in b); if (!sets.length) return err('nothing to update');
    const called = b.called ? ', called_at = ?' : '';
    const vals = sets.map(f => clean(b[f], 600)); if (b.called) vals.push(now);
    await db.prepare(`UPDATE ev_vendors SET ${sets.map(f => f + ' = ?').join(', ')}${called}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...vals, s.name, now, clean(b.id, 30)).run();
    return json({ ok: true });
  }

  if (b.r === 'score') { // 평가자 본인 점수만 저장
    const vendor = clean(b.vendor, 30); const sc = {}; for (const [k, v] of Object.entries(b.scores || {})) { const n = Number(v); if (Number.isFinite(n)) sc[clean(k, 20)] = n; }
    await db.prepare('INSERT INTO ev_scores (vendor, evaluator, scores, comment, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(vendor, evaluator) DO UPDATE SET scores=excluded.scores, comment=excluded.comment, updated_at=excluded.updated_at')
      .bind(vendor, s.name, JSON.stringify(sc), clean(b.comment, 1000), now).run();
    return json({ ok: true });
  }

  if (b.r === 'send') {
    if (!mailReady(env)) return err('메일 발송 설정(RESEND_API_KEY)이 없습니다', 503);
    const to = String(b.to || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x));
    const cc = String(b.cc || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(x));
    const subject = clean(b.subject, 200), text = String(b.text || '').slice(0, 20000);
    if (!to.length || !subject || !text) return err('받는 사람, 제목, 본문을 확인해 주세요');
    if (to.length + cc.length > 10) return err('한 번에 10명까지 보낼 수 있습니다');
    const attachments = [];
    for (const f of (Array.isArray(b.attach) ? b.attach : []).slice(0, 3)) { // 이 페이지의 첨부 파일만
      const path = '/admin/event2027/files/' + clean(f, 80).replace(/[^\w.\-가-힣]/g, '');
      try { const r = await env.ASSETS.fetch(new Request(new URL(path, request.url))); if (!r.ok) return err('첨부 파일을 찾을 수 없습니다: ' + f);
        const buf = new Uint8Array(await r.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        attachments.push({ filename: path.split('/').pop(), content: btoa(bin) }); } catch (x) { return err('첨부 실패: ' + x.message); }
    }
    const from = env.PM_FROM || '서울대 경영대 창립총회 행사기획팀 <pm@snubusiness.com>';
    const payload = { from, to, cc: cc.length ? cc : undefined, reply_to: 'pm@snubusiness.com', subject, text, attachments: attachments.length ? attachments : undefined };
    let status = 'sent', provider_id = null, error = null;
    try { const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.RESEND_API_KEY }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({})); if (!r.ok) { status = 'failed'; error = (j.message || r.statusText || '').slice(0, 300); } else provider_id = j.id; }
    catch (x) { status = 'failed'; error = String(x).slice(0, 300); }
    await db.prepare('INSERT INTO ev_mail (vendor, kind, to_addr, cc, subject, body, status, provider_id, error, sent_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(clean(b.vendor, 30), clean(b.kind, 20), to.join(', '), cc.join(', '), subject, text, status, provider_id, error, s.name).run();
    if (status !== 'sent') return err('발송 실패: ' + error, 502);
    if (b.vendor) await db.prepare("UPDATE ev_vendors SET next_step = CASE WHEN next_step = '' THEN ? ELSE next_step END, updated_by = ?, updated_at = ? WHERE id = ?").bind('메일 발송 ' + now.slice(5, 10) + ' · 회신 대기', s.name, now, clean(b.vendor, 30)).run();
    return json({ ok: true, id: provider_id });
  }
  return err('unknown resource');
}
