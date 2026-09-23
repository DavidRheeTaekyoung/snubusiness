import { json, err, getDB, clean } from '../_lib.js';
import { ensureAccounts, hashPassword, issueSession, cookieHeader, isEmail } from '../_auth.js';
import { sendMail, mailReady, layout } from '../_mail.js';

// 비밀번호 재설정: (1) POST {email} → 1시간짜리 링크 메일 발송  (2) GET ?t= → 토큰 확인  (3) POST {token,password} → 변경 + 로그인
const TTL = 60 * 60 * 1000;
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async s => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function ensureResets(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS resets (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, exp INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`).run();
}

// 오너 패널·메일 양쪽에서 쓰는 토큰 발급
export async function makeResetLink(db, origin, email) {
  await ensureResets(db);
  await db.prepare('DELETE FROM resets WHERE exp < ?').bind(Date.now()).run();
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT INTO resets (token_hash, email, exp) VALUES (?,?,?)').bind(await sha(token), email, Date.now() + TTL).run();
  return origin + '/enter/reset/?t=' + token;
}

async function lookup(db, token) {
  if (!token || token.length < 20) return null;
  await ensureResets(db);
  const r = await db.prepare('SELECT email, exp FROM resets WHERE token_hash = ?').bind(await sha(token)).first();
  if (!r || r.exp < Date.now()) return null;
  const a = await db.prepare('SELECT email, name, status FROM accounts WHERE email = ?').bind(r.email).first();
  return a && a.status === 'active' ? a : null;
}

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureAccounts(db);
  const a = await lookup(db, new URL(request.url).searchParams.get('t') || '');
  if (!a) return err('링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요', 410);
  return json({ ok: true, name: a.name, email: a.email });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensureAccounts(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }

  // (3) 토큰으로 비밀번호 변경
  if (b.token) {
    const password = String(b.password || '');
    if (password.length < 8) return err('비밀번호는 8자 이상이어야 합니다');
    const a = await lookup(db, String(b.token));
    if (!a) return err('링크가 만료되었거나 올바르지 않습니다. 다시 요청해 주세요', 410);
    const { hash, salt } = await hashPassword(password);
    await db.batch([
      db.prepare("UPDATE accounts SET pass_hash = ?, salt = ?, last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE email = ?").bind(hash, salt, a.email),
      db.prepare('DELETE FROM resets WHERE email = ?').bind(a.email),
    ]);
    const full = await db.prepare('SELECT role FROM accounts WHERE email = ?').bind(a.email).first();
    const s = await issueSession(env, a.email, a.name, full.role);
    return json({ ok: true, name: a.name }, 200, { 'set-cookie': cookieHeader(s.value, s.exp) });
  }

  // (1) 재설정 메일 요청 — 계정 유무는 알려주지 않는다
  const email = clean(b.email, 120).toLowerCase();
  if (!isEmail(email)) return err('이메일 형식이 올바르지 않습니다');
  if (!mailReady(env)) return err('이메일 발송이 아직 설정되지 않았습니다. 이태경 위원에게 재설정 링크를 요청해 주세요', 503);
  const a = await db.prepare('SELECT email, name, status FROM accounts WHERE email = ?').bind(email).first();
  const generic = { ok: true, message: '가입된 이메일이면 재설정 링크를 보내드렸습니다. 받은편지함(스팸함 포함)을 확인해 주세요. 링크는 1시간 동안 유효합니다.' };
  if (!a || a.status !== 'active') return json(generic);
  await ensureResets(db);
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM resets WHERE email = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')").bind(email).first();
  if (recent.n >= 3) return json(generic);
  const link = await makeResetLink(db, new URL(request.url).origin, email);
  const r = await sendMail(env, {
    to: email,
    subject: '[서울대 경영대 총동문회] 비밀번호 재설정',
    text: `${a.name} 위원님, 아래 링크에서 새 비밀번호를 설정해 주세요 (1시간 유효).\n${link}\n\n본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.`,
    html: layout({ title: '비밀번호 재설정', body: `<p><b>${a.name}</b> 위원님, 아래 버튼을 눌러 새 비밀번호를 설정해 주세요. 링크는 <b>1시간</b> 동안 유효합니다.</p>
      <p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#5C1424;color:#F7F4EE;text-decoration:none;padding:14px 26px;font-weight:600;letter-spacing:.04em">새 비밀번호 설정하기</a></p>
      <p style="font-size:13px;color:#666">버튼이 눌리지 않으면 이 주소를 브라우저에 붙여 넣으세요:<br><span style="word-break:break-all">${link}</span></p>
      <p style="font-size:13px;color:#666">본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.</p>` }),
  });
  if (!r.ok) return err('메일 발송에 실패했습니다. 잠시 후 다시 시도하거나 이태경 위원에게 알려 주세요', 502);
  return json(generic);
}
