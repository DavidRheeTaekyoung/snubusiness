// DART 기업개황(대표전화·주소·홈페이지)을 상장사마다 받아 작업대에 저장 — 국내 PC에서 실행
// 사용: 저장소 루트에서  node site/tools/dart-info.mjs   (dart-scan.mjs 와 같은 키·쿠키를 쓴다)
import { readFileSync } from 'node:fs';

const KEY = process.env.DART_API_KEY;
if (!KEY) { console.error('DART_API_KEY 환경변수가 없습니다.'); process.exit(1); }
const SITE = 'https://snubusiness.com/api/vip';
const cookie = readFileSync('.cf/agent-cookie.txt', 'utf8').split(/\r?\n/).map(l => l.split('\t')).filter(c => c.length >= 7 && c[5] === 'snu_sess').map(c => 'snu_sess=' + c[6])[0];
if (!cookie) { console.error('.cf/agent-cookie.txt 에 작업대 로그인 쿠키가 없습니다.'); process.exit(1); }
const hide = s => String(s).split(KEY).join('***'), sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(body) {
  const r = await fetch(SITE, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('작업대 ' + r.status + ' ' + (j.error || '')); return j;
}

const { corps } = await api({ r: 'corp_todo' }); // 서울대 경영 임원이 나온 회사부터
console.log('대표번호를 받을 회사', corps.length, '곳');
let rows = [];
for (let i = 0; i < corps.length; i++) {
  const j = await (await fetch(`https://opendart.fss.or.kr/api/company.json?crtfc_key=${KEY}&corp_code=${corps[i].corp_code}`)).json().catch(() => ({}));
  await sleep(120);
  if (j.status === '000') rows.push({ corp_code: corps[i].corp_code, phone: (j.phn_no || '').trim(), addr: (j.adres || '').trim(), homepage: (j.hm_url || '').trim() });
  else if (j.status !== '013') { if (rows.length) await api({ r: 'corp_info', rows }); console.error('멈춤: DART', j.status, hide(j.message || ''), '— 다시 실행하면 이어서 합니다.'); process.exit(1); }
  if (rows.length >= 50) { await api({ r: 'corp_info', rows }); rows = []; console.log(`${i + 1}/${corps.length}`); }
}
if (rows.length) await api({ r: 'corp_info', rows });
console.log('완료');
