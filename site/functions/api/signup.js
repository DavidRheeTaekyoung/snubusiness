import { json, err, getDB, clean } from '../_lib.js';
import { ensureAccounts, hashPassword, issueSession, cookieHeader, isEmail } from '../_auth.js';
import { ensureInvites, normName, normPhone, okPhone, cohortNums } from './invites.js';

// 회원가입 두 갈래
// 1) 준비위원·행사기획팀: 명단(committee.json)의 이름과 일치해야 하고, 이름당 1계정. 명단의 perms 는 가입 시 자동 부여.
// 2) 동문(kind=alumni, 제한 오픈): 사전 명단(invites)과 이름+휴대전화가 맞으면 자동 승인, 학번까지 다르거나 명단에 없으면 승인 대기.
//    학번은 "과정 + 입학연도(또는 기수)" 하나만 받는다 — 명단의 여러 소속(경영 83/대학원 87) 중 하나와 숫자가 맞으면 된다.
//    과정은 경영대 학부·대학원·EMBA 셋뿐 — 타학과 학부 출신은 경영대 대학원으로, 학교측 인사도 경영 학부·대학원 학번으로 들어온다(2026-06-16 명단 확인).
//    명단에 학번이 없으면 이름+번호만 본다. 명단에 있는지 없는지는 화면에 드러내지 않는다 — 없으면 "확인 후 승인" 으로만 답한다.
export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('D1 binding "DB" is not configured', 503);
  await ensureAccounts(db);
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const name = clean(b.name, 40), email = clean(b.email, 120).toLowerCase(), password = String(b.password || '');
  if (!name || !email || !password) return err('이름, 이메일, 비밀번호를 모두 입력해 주세요');
  if (!isEmail(email)) return err('이메일 형식이 올바르지 않습니다');
  if (password.length < 8) return err('비밀번호는 8자 이상이어야 합니다');
  if (b.kind === 'alumni') return alumni(request, db, env, b, name, email, password);
  const roster = await fetch(new URL('/data/committee.json', request.url)).then(r => r.json()).catch(() => ({ members: [] }));
  const guest = !roster.members.includes(name) && (roster.guests || {})[name];
  if (!roster.members.includes(name) && !guest) return err('준비위원 명단에 없는 이름입니다. 명단은 이태경 위원에게 문의해 주세요', 403);
  const byEmail = await db.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first();
  if (byEmail) return err('이미 가입된 이메일입니다. 로그인해 주세요', 409);
  const byName = await db.prepare('SELECT email FROM accounts WHERE name = ?').bind(name).first();
  if (byName) return err('이 이름으로 이미 가입된 계정이 있습니다. 본인이 맞다면 이태경 위원에게 알려 주세요', 409);
  const { hash, salt } = await hashPassword(password);
  const role = name === '이태경' ? 'owner' : (guest ? 'guest' : 'member');
  const perms = (((roster.perms || {})[name]) || ((roster.guests || {})[name]) || []).join(',');
  await db.prepare("INSERT INTO accounts (email, name, pass_hash, salt, role, perms, last_login) VALUES (?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(email, name, hash, salt, role, perms).run();
  const s = await issueSession(env, email, name, role);
  return json({ ok: true, name, email, role }, 201, { 'set-cookie': cookieHeader(s.value, s.exp) });
}

async function alumni(request, db, env, b, name, email, password) {
  await ensureInvites(db);
  const phone = normPhone(b.phone), course = clean(b.course, 20), num = clean(b.num, 10), cohort = [course, num].filter(Boolean).join(' ');
  if (!['경영', '대학원', 'EMBA'].includes(course)) return err('과정을 골라 주세요 (경영대 학부·대학원·EMBA)');
  if (!num) return err('입학연도 또는 기수를 입력해 주세요');
  if (!okPhone(phone)) return err('휴대전화 번호를 확인해 주세요 (예: 010-1234-5678)');
  if (!b.consent) return err('개인정보 수집·이용에 동의해 주셔야 가입할 수 있습니다');
  // 같은 곳에서 한 시간에 8번까지 — 이름·번호를 바꿔 가며 명단을 떠보는 일을 막는다
  const ip = request.headers.get('cf-connecting-ip') || '', now = Date.now();
  const n = await db.prepare('SELECT COUNT(*) AS n FROM signup_log WHERE ip = ? AND at > ?').bind(ip, now - 36e5).first();
  if ((n?.n || 0) >= 8) return err('잠시 후 다시 시도해 주세요', 429);
  await db.batch([db.prepare('INSERT INTO signup_log (ip, at) VALUES (?, ?)').bind(ip, now), db.prepare('DELETE FROM signup_log WHERE at < ?').bind(now - 864e5)]);
  if (await db.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first()) return err('이미 가입된 이메일입니다. 로그인해 주세요', 409);
  const inv = await db.prepare('SELECT id, cohort, email FROM invites WHERE nname = ? AND phone = ?').bind(normName(name), phone).first();
  if (inv && inv.email) return err('이 이름과 번호로 이미 가입된 계정이 있습니다. 로그인 화면의 "비밀번호 찾기"를 이용하거나 사무국에 문의해 주세요', 409);
  const have = cohortNums(inv?.cohort), mine = cohortNums(num), cohortOk = !have.length || !mine.length || mine.some(x => have.includes(x));
  const ok = !!inv && cohortOk;
  const note = ok ? `자동 승인 — 사전 명단 #${inv.id}` : inv ? `확인 필요 — 학번 다름 (명단 ${inv.cohort} / 입력 ${cohort})` : '확인 필요 — 사전 명단에 없음';
  const { hash, salt } = await hashPassword(password);
  const stmts = [db.prepare(`INSERT INTO accounts (email, name, pass_hash, salt, role, status, cohort, phone, consent_at, note, last_login) VALUES (?,?,?,?, 'alumni', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ${ok ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'})`).bind(email, name, hash, salt, ok ? 'active' : 'pending', ok && inv.cohort ? inv.cohort : cohort, phone, note)];
  if (inv) stmts.push(db.prepare("UPDATE invites SET email = ?, joined_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(email, inv.id));
  await db.batch(stmts);
  if (!ok) return json({ ok: true, status: 'pending', message: '가입 신청을 받았습니다. 동문회에서 확인한 뒤 승인되면 이 이메일과 비밀번호로 로그인할 수 있습니다.' }, 202);
  const s = await issueSession(env, email, name, 'alumni');
  return json({ ok: true, status: 'active', name, email, role: 'alumni' }, 201, { 'set-cookie': cookieHeader(s.value, s.exp) });
}
