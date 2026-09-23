// 이메일 발송 (Resend HTTP API). 비밀은 Pages secret RESEND_API_KEY, 발신자는 MAIL_FROM.
// 설정이 없으면 { ok:false, reason:'not_configured' } 를 돌려주고 호출자가 대체 안내를 한다.
export function mailReady(env) { return !!env.RESEND_API_KEY; }

export async function sendMail(env, { to, subject, html, text }) {
  if (!mailReady(env)) return { ok: false, reason: 'not_configured' };
  const from = env.MAIL_FROM || '서울대학교 경영대학 총동문회 <noreply@snubusiness.com>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!r.ok) return { ok: false, reason: 'provider', detail: (await r.text()).slice(0, 300) };
    return { ok: true, id: (await r.json()).id };
  } catch (e) { return { ok: false, reason: 'network', detail: String(e) }; }
}

// 공통 서식 — 버건디/골드, 본문 한 덩어리
export function layout({ title, body, foot }) {
  return `<!doctype html><html lang="ko"><body style="margin:0;background:#F7F4EE;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1c1917">
  <div style="max-width:520px;margin:32px auto;background:#fff;border-top:3px solid #B8952E">
    <div style="background:#3A0A14;color:#F7F4EE;padding:22px 28px;font-size:13px;letter-spacing:.12em">SEOUL NATIONAL UNIVERSITY BUSINESS SCHOOL ALUMNI</div>
    <div style="padding:28px">
      <h1 style="font-size:20px;margin:0 0 14px;color:#3A0A14">${title}</h1>
      <div style="font-size:15px;line-height:1.75">${body}</div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #e7e2d8;font-size:12px;color:#777;line-height:1.6">${foot || '본 메일은 준비위원회 전용 홈페이지 snubusiness.com에서 자동 발송되었습니다.'}</div>
  </div></body></html>`;
}
