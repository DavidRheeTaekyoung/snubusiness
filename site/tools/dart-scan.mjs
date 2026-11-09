// DART 상장사 임원현황 스캔 — 국내 PC에서 실행 (OpenDART가 클라우드 접속을 막아서 서버에서는 못 돈다)
// 사용: 저장소 루트에서  node site/tools/dart-scan.mjs
// 키는 환경변수 DART_API_KEY 에서 읽고 화면에 찍지 않는다. 작업대 로그인은 .cf/agent-cookie.txt 를 쓴다.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const KEY = process.env.DART_API_KEY;
if (!KEY) { console.error('DART_API_KEY 환경변수가 없습니다.'); process.exit(1); }
const SITE = 'https://snubusiness.com/api/vip';
const cookie = readFileSync('.cf/agent-cookie.txt', 'utf8').split(/\r?\n/).map(l => l.split('\t')).filter(c => c.length >= 7 && c[5] === 'snu_sess').map(c => 'snu_sess=' + c[6])[0];
if (!cookie) { console.error('.cf/agent-cookie.txt 에 작업대 로그인 쿠키가 없습니다.'); process.exit(1); }

const SNU = /서울대(?:학교)?\s*\(?\s*(?:경영|상과|상대)|Seoul National Univ[^.]{0,40}(?:Business|Commerce)/i;
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const hide = s => String(s).split(KEY).join('***');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(body) {
  const r = await fetch(SITE, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('작업대 ' + r.status + ' ' + (j.error || '')); return j;
}

// 1. 상장사 목록 (corpCode.xml zip → 종목코드 있는 회사만)
async function corps() {
  const buf = Buffer.from(await (await fetch('https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=' + KEY)).arrayBuffer());
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) throw new Error('회사 목록이 zip이 아닙니다: ' + hide(buf.subarray(0, 200).toString()));
  const cd = buf.readUInt32LE(e + 16), method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lo = buf.readUInt32LE(cd + 42);
  const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), data = buf.subarray(start, start + csize);
  const xml = (method === 0 ? data : inflateRawSync(data)).toString('utf8'), out = [];
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) { const g = t => (m[1].match(new RegExp('<' + t + '>([^<]*)</' + t + '>')) || [])[1]?.trim() || ''; if (/^\d{6}$/.test(g('stock_code'))) out.push({ corp_code: g('corp_code'), name: g('corp_name'), stock_code: g('stock_code') }); }
  return out;
}

// 2. 임원현황 — 올해 3분기 → 반기 → 작년 사업보고서 순으로 처음 있는 것
const Y = new Date().getFullYear(), REPORTS = [[Y, '11014'], [Y, '11012'], [Y - 1, '11011']], RN = { '11011': '사업보고서', '11012': '반기보고서', '11014': '3분기보고서' };
async function execs(cc) {
  for (const [year, code] of REPORTS) {
    const j = await (await fetch(`https://opendart.fss.or.kr/api/exctvSttus.json?crtfc_key=${KEY}&corp_code=${cc}&bsns_year=${year}&reprt_code=${code}`)).json().catch(() => ({}));
    await sleep(120);
    if (j.status === '000') return (j.list || []).map(x => ({ ...x, year, code }));
    if (['010', '011', '012', '020', '021', '100', '101', '800', '900'].includes(j.status)) throw new Error('DART ' + j.status + ' ' + hide(j.message || ''));
  }
  return [];
}

const { corps: saved } = await api({ r: 'dart_todo' });
let todo = saved;
if (!todo.length) {
  const list = await corps(); console.log('상장사', list.length, '곳');
  for (let i = 0; i < list.length; i += 100) await api({ r: 'dart_corps', corps: list.slice(i, i + 100) });
  todo = (await api({ r: 'dart_todo' })).corps;
}
console.log('스캔할 회사', todo.length, '곳');
let hits = [], done = [], total = 0;
const flush = async () => { if (!done.length) return; const r = await api({ r: 'dart_import', hits, done }); total += r.added; hits = []; done = []; };
for (let i = 0; i < todo.length; i++) {
  const c = todo[i];
  let list; try { list = await execs(c.corp_code); } catch (x) { await flush(); console.error('멈춤:', x.message, '— 다시 실행하면 이어서 합니다.'); process.exit(1); }
  const found = list.filter(x => SNU.test(x.main_career || ''));
  for (const x of found) hits.push({ key: `dart:${c.corp_code}:${x.nm}`, name: x.nm, url: x.rcept_no ? 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + x.rcept_no : 'https://dart.fss.or.kr/',
    title: `${x.nm} · ${c.name} ${x.ofcps || ''}`.trim(), snippet: `${strip(x.main_career)}${x.chrg_job ? ' / 담당: ' + strip(x.chrg_job) : ''}${x.birth_ym ? ' / 출생 ' + x.birth_ym : ''} (${x.year} ${RN[x.code]})`,
    date: '', org: c.name, position: x.ofcps || '' });
  done.push([c.corp_code, found.length]);
  if (done.length >= 25) { await flush(); console.log(`${i + 1}/${todo.length} · 새 발견 누적 ${total}명`); }
}
await flush(); console.log('완료 · 새 발견', total, '명');
