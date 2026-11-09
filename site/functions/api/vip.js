import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// VIP 동문 발굴 — 공개 출처(뉴스·웹·DART 임원현황·국회의원 약력)에서 "서울대 경영" 동문 후보를 모으고, 사람이 확인해 명단으로 옮긴다.
// 명단은 D1에만 둔다 (깃·공개 페이지에 올리지 않음). 연락처·사생활은 모으지 않고 공개된 직함과 출처만 기록.
// 출처 키: NAVER_CLIENT_ID/NAVER_CLIENT_SECRET (네이버 검색 API), DART_API_KEY (OpenDART), ASSEMBLY_API_KEY (열린국회정보)
const SNU = /서울대(?:학교)?\s*\(?\s*(?:경영|상과|상대)|Seoul National Univ[^.]{0,40}(?:Business|Commerce)/i;
const TITLES = '대표이사|부회장|회장|부사장|사장|대표|행장|장관|차관|청장|국회의원|의원|총장|원장|이사장|위원장|전무|상무|CEO|CFO|파트너|대사|검사장|법원장|대법관|감사|변호사|회계사|교수|센터장|본부장|부행장|차관보|실장|국장|처장|기획관|정책관|지검장|고검장|부장검사|부장판사|판사|검사|재판관|법관';
const SURN = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경';
const STOP = new Set(['서울대', '경영학', '경영대', '졸업', '신임', '그룹', '회사', '이번', '올해', '지난', '현재', '전임', '선임', '대학교', '증권', '은행', '금융', '부문', '사업', '본부', '글로벌', '공동', '전략', '최고', '전문', '각자', '대표이', '대한', '한국', '이사', '고문', '차기', '역대', '초대', '기업', '임원', '내정', '발탁', '승진', '인사', '경영', '부사', '사장', '회장', '이후',
  '변호', '변호사', '선출', '경쟁', '기존', '연임', '유임', '재선', '국민', '한공', '전무', '상무', '대표', '행장', '장관', '차관', '위원', '의원', '총장', '원장', '이사장', '감사', '대사', '검사', '법원',
  '신규', '연말', '조직', '교체', '사임', '출신', '후보', '단독', '대행', '직무', '부행', '부장', '전체', '기관', '지주', '계열', '사외', '상임', '상근', '고객', '최초',
  '성과', '수시', '선거', '당선', '동기', '소속', '전년', '우리', '신한', '하나', '농협', '한화', '삼성', '현대', '롯데', '신세계', '포스', '미래', '교보', '동양', '유진투', '다올',
  '공동대', '전문경', '임관', '제약', '한편', '모르', '연달', '강화', '금감원', '금융감', '검찰', '법무', '대법', '고법', '지법', '중앙지', '서울중', '부산지', '수원지', '인천지', '대전지', '대구지', '광주지', '기획재', '공정거', '국세청', '관세청', '조달청', '통계청', '감사원', '차장', '평검', '부부', '수석', '선임', '전직', '현직', '고위', '행정', '사법', '연수', '임명', '내정자', '지명', '외부', '내부', '공식', '취임', '사의', '용퇴', '퇴임', '물러', '맡은', '맡게', '오른', '올라', '도전', '역임', '거친', '지낸', '중심', '세대', '경력', '책무']);
const Q = s => s.split(' ').map(w => '서울대 경영학과 ' + w.replace(/_/g, ' '));
const NEWS_Q = {
  corp: [...Q('신임_대표이사 신임_사장 회장_취임 부회장_승진 임원_인사 선임 행장 CEO'), '서울대 경영대 동문'],
  gov: Q('장관_후보자 차관_임명 청장_임명 실장_임명 국장_임명 차관보 처장_임명 대사_임명 고위공무원 행정고시 행시_국장 기획재정부 금융위원회 공정거래위원회 국세청 감사원'),
  law: Q('검사장 지검장 고검장 부장검사 검찰_인사 법원장 부장판사 고법_판사 대법관_후보 헌법재판관 법관_인사 판사_출신 검사_출신'),
};
const WEB_Q = ['서울대 경영학과 졸업 대표이사 인사말', '서울대학교 경영학과 졸업 회장 약력', '서울대 경영학과 졸업 사장 프로필'];
const FIELDS = ['name', 'cohort', 'degree', 'org', 'position', 'field', 'tier', 'status', 'link', 'memo'];

async function ensure(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cohort TEXT NOT NULL DEFAULT '', degree TEXT NOT NULL DEFAULT '', org TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '',
      field TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '후보', link TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', sources TEXT NOT NULL DEFAULT '[]', updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '', names TEXT NOT NULL DEFAULT '[]', org TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '', matched INTEGER NOT NULL DEFAULT 0, query TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', found_at TEXT, reviewed_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_corps (corp_code TEXT PRIMARY KEY, name TEXT NOT NULL, stock_code TEXT NOT NULL DEFAULT '', scanned_at TEXT, found INTEGER NOT NULL DEFAULT 0)`),
  ]);
}
async function guard(request, env, db) {
  const s = await liveSession(request, env, db);
  if (!s) return [null, err('login required', 401)];
  if (s.role === 'guest' || !(hasPerm(s, 'event2027') || hasPerm(s, 'vip'))) return [null, err('행사기획팀만 볼 수 있는 페이지입니다', 403)];
  return [s, null];
}
const keys = env => ({ naver: !!(env.NAVER_CLIENT_ID && env.NAVER_CLIENT_SECRET), dart: !!env.DART_API_KEY, assembly: !!env.ASSEMBLY_API_KEY });
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&middot;/g, '·').replace(/\s+/g, ' ').trim();

// 인사 기사 문장에서 "홍길동 ○○ 사장" 꼴의 이름 후보를 뽑는다 (확인은 사람이)
export function guessNames(text) {
  const out = new Set(), re = new RegExp(`(?<![가-힣])([${SURN}][가-힣]{1,2})\\s?(?:\\(\\d{2}\\)\\s?)?(?:[가-힣A-Za-z0-9&·]+\\s){0,2}?(?:신임\\s)?(?:${TITLES})`, 'g');
  let m; while ((m = re.exec(text))) { const n = m[1]; if (!STOP.has(n) && !STOP.has(n.slice(0, 2))) out.add(n); re.lastIndex = m.index + 1; }
  return [...out].slice(0, 6);
}

async function naver(env, kind, q, start = 1) {
  const r = await fetch(`https://openapi.naver.com/v1/search/${kind}.json?query=${encodeURIComponent(q)}&display=100&start=${start}${kind === 'news' ? '&sort=date' : ''}`,
    { headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET } });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('네이버 ' + (j.errorMessage || r.status));
  return (j.items || []).map(it => { const title = strip(it.title), snippet = strip(it.description), url = it.originallink || it.link;
    return { key: url, source: kind === 'news' ? 'news' : 'web', url, title, snippet, date: it.pubDate ? new Date(it.pubDate).toISOString().slice(0, 10) : '', names: guessNames(title + ' ' + snippet), matched: SNU.test(title + ' ' + snippet) ? 1 : 0, query: q }; });
}
async function saveHits(db, hits, now) {
  if (!hits.length) return 0; let n = 0;
  for (let i = 0; i < hits.length; i += 50) {
    const rs = await db.batch(hits.slice(i, i + 50).map(h => db.prepare('INSERT INTO vip_hits (key, source, url, title, snippet, date, names, org, position, matched, query, found_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING')
      .bind(clean(h.key, 500), h.source, clean(h.url, 500), clean(h.title, 300), clean(h.snippet, 1200), clean(h.date, 20), JSON.stringify(h.names || []), clean(h.org, 120), clean(h.position, 120), h.matched ? 1 : 0, clean(h.query, 200), now)));
    n += rs.reduce((a, r) => a + (r.meta?.changes || 0), 0);
  }
  return n;
}

// DART 임원현황: 최근 보고서부터 차례로 시도 (반기 → 직전 사업보고서)
const REPORTS = (() => { const y = new Date().getFullYear(); return [[y, '11014'], [y, '11012'], [y - 1, '11011']]; })();
async function dartExecs(env, corp) {
  for (const [year, code] of REPORTS) {
    const r = await fetch(`https://opendart.fss.or.kr/api/exctvSttus.json?crtfc_key=${env.DART_API_KEY}&corp_code=${corp.corp_code}&bsns_year=${year}&reprt_code=${code}`);
    const j = await r.json().catch(() => ({}));
    if (j.status === '000') return (j.list || []).map(x => ({ ...x, year, code }));
    if (j.status === '020' || j.status === '011' || j.status === '010') throw new Error('DART ' + j.status + ' ' + (j.message || ''));
  }
  return [];
}

export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  const [people, hits, corps] = await Promise.all([
    db.prepare('SELECT * FROM vip_people ORDER BY id DESC').all().then(r => r.results.map(p => ({ ...p, sources: JSON.parse(p.sources || '[]') }))),
    db.prepare("SELECT id, key, source, url, title, substr(snippet, 1, 400) AS snippet, date, names, org, position, matched, query, status, found_at, reviewed_by FROM vip_hits WHERE status != 'dismissed' ORDER BY matched DESC, date DESC, id DESC LIMIT 4000").all().then(r => r.results.map(h => ({ ...h, names: JSON.parse(h.names || '[]') }))),
    db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN scanned_at IS NOT NULL THEN 1 ELSE 0 END) AS scanned, SUM(found) AS found FROM vip_corps').first(),
  ]);
  const counts = await db.prepare("SELECT source, status, COUNT(*) AS n FROM vip_hits GROUP BY source, status").all().then(r => r.results);
  return json({ people, hits, counts, corps, keys: keys(env), presets: { news: NEWS_Q, web: WEB_Q }, me: s.name, role: s.role });
}

export async function onRequestPost({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  let b; try { b = await request.json(); } catch { return err('invalid json'); }
  const now = new Date().toISOString(), k = keys(env);

  if (b.r === 'search') { // 뉴스·웹 검색 — q 하나 또는 프리셋 묶음
    if (!k.naver) return err('네이버 검색 API 키가 아직 등록되지 않았습니다', 503);
    const kind = b.kind === 'web' ? 'webkr' : 'news';
    const group = NEWS_Q[b.group] ? b.group : 'corp';
    const qs = b.q ? [clean(b.q, 120)] : (kind === 'news' ? NEWS_Q[group] : WEB_Q);
    const pages = b.q ? Math.min(Number(b.pages) || 1, 5) : (kind === 'news' && group !== 'corp' ? 2 : 1); // 공공·법조 기사는 드물어 더 깊이 본다
    let all = [], fail = [];
    for (const q of qs) for (let p = 0; p < pages; p++) { try { all = all.concat(await naver(env, kind, q, 1 + p * 100)); } catch (x) { fail.push(q + ': ' + x.message); break; } }
    if (b.only_matched !== false) all = all.filter(h => h.matched);
    const added = await saveHits(db, all, now);
    return json({ ok: true, found: all.length, added, fail });
  }

  if (b.r === 'assembly') { // 국회의원 인적사항 약력에서 서울대 경영 출신
    if (!k.assembly) return err('열린국회정보 API 키가 아직 등록되지 않았습니다', 503);
    const r = await fetch(`https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu?KEY=${env.ASSEMBLY_API_KEY}&Type=json&pIndex=1&pSize=300`);
    const j = await r.json().catch(() => ({})); const rows = (j.nwvrqwxyaytdsfvhu || []).flatMap(x => x.row || []);
    if (!rows.length) return err('국회 API 응답에 의원 목록이 없습니다: ' + JSON.stringify(j).slice(0, 200), 502);
    const hits = rows.filter(m => SNU.test(m.MEM_TITLE || '')).map(m => ({ key: 'assembly:' + (m.MONA_CD || m.HG_NM), source: 'assembly', url: m.HOMEPAGE || 'https://www.assembly.go.kr/portal/assm/search/memberSchPage.do',
      title: `${m.HG_NM} 국회의원 (${m.POLY_NM || ''}, ${m.ORIG_NM || ''})`, snippet: strip(m.MEM_TITLE).slice(0, 1200), names: [m.HG_NM], org: '국회', position: '국회의원' + (m.REELE_GBN_NM ? ' · ' + m.REELE_GBN_NM : ''), matched: 1, query: '국회의원 약력' }));
    const added = await saveHits(db, hits, now);
    return json({ ok: true, members: rows.length, found: hits.length, added });
  }

  if (b.r === 'dart_zip') { // 회사 고유번호 목록(zip)을 그대로 넘겨 브라우저에서 풀게 한다 — 함수 CPU를 아끼려는 것
    if (!k.dart) return err('OpenDART API 키가 아직 등록되지 않았습니다', 503);
    const r = await fetch('https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=' + env.DART_API_KEY);
    if (!r.ok) return err('DART 회사 목록을 받지 못했습니다 ' + r.status, 502);
    return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'application/zip', 'cache-control': 'no-store' } });
  }
  if (b.r === 'dart_corps') { // 상장사 목록 저장 (브라우저가 100곳씩 보냄)
    const list = (Array.isArray(b.corps) ? b.corps : []).filter(c => /^\d{8}$/.test(c.corp_code)).slice(0, 200);
    if (list.length) await db.batch(list.map(c => db.prepare('INSERT INTO vip_corps (corp_code, name, stock_code) VALUES (?,?,?) ON CONFLICT(corp_code) DO UPDATE SET name=excluded.name, stock_code=excluded.stock_code').bind(c.corp_code, clean(c.name, 120), clean(c.stock_code, 10))));
    return json({ ok: true, saved: list.length });
  }
  if (b.r === 'dart_scan') { // 아직 안 본 상장사 몇 곳씩 임원현황을 훑는다 — 페이지가 반복 호출
    if (!k.dart) return err('OpenDART API 키가 아직 등록되지 않았습니다', 503);
    const batch = await db.prepare('SELECT * FROM vip_corps WHERE scanned_at IS NULL ORDER BY corp_code LIMIT ?').bind(Math.min(Number(b.limit) || 6, 10)).all().then(r => r.results);
    const hits = [], done = [];
    for (const c of batch) {
      let execs; try { execs = await dartExecs(env, c); } catch (x) { return json({ ok: false, error: x.message, scanned: done.length }); }
      const found = execs.filter(x => SNU.test(x.main_career || ''));
      found.forEach(x => hits.push({ key: `dart:${c.corp_code}:${x.nm}`, source: 'dart', url: x.rcept_no ? 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + x.rcept_no : 'https://dart.fss.or.kr/',
        title: `${x.nm} · ${c.name} ${x.ofcps || ''}`, snippet: `${strip(x.main_career)}${x.chrg_job ? ' / 담당: ' + strip(x.chrg_job) : ''}${x.birth_ym ? ' / 출생 ' + x.birth_ym : ''} (${x.year} ${({ '11011': '사업보고서', '11012': '반기보고서', '11014': '3분기보고서' })[x.code]})`,
        date: '', names: [x.nm], org: c.name, position: x.ofcps || '', matched: 1, query: 'DART 임원현황' }));
      done.push([c.corp_code, found.length]);
    }
    const added = await saveHits(db, hits, now);
    if (done.length) await db.batch(done.map(([cc, n]) => db.prepare('UPDATE vip_corps SET scanned_at = ?, found = ? WHERE corp_code = ?').bind(now, n, cc)));
    const left = await db.prepare('SELECT COUNT(*) AS n FROM vip_corps WHERE scanned_at IS NULL').first();
    return json({ ok: true, scanned: done.length, found: hits.length, added, left: left.n });
  }
  if (b.r === 'renames') { // 이름 추출 규칙을 고친 뒤 기존 뉴스·웹 결과의 이름 후보를 다시 뽑는다
    const { results } = await db.prepare("SELECT id, title, snippet FROM vip_hits WHERE source IN ('news','web')").all();
    for (let i = 0; i < results.length; i += 50) await db.batch(results.slice(i, i + 50).map(h => db.prepare('UPDATE vip_hits SET names = ? WHERE id = ?').bind(JSON.stringify(guessNames(h.title + ' ' + h.snippet)), h.id)));
    return json({ ok: true, n: results.length });
  }
  if (b.r === 'dart_reset') { await db.prepare('UPDATE vip_corps SET scanned_at = NULL, found = 0').run(); return json({ ok: true }); }

  if (b.r === 'hit') { // 수집 결과 상태: new | kept | dismissed
    if (!['new', 'kept', 'dismissed'].includes(b.status)) return err('bad status');
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean);
    if (ids.length) await db.batch(ids.map(id => db.prepare('UPDATE vip_hits SET status = ?, reviewed_by = ? WHERE id = ?').bind(b.status, s.name, id)));
    return json({ ok: true });
  }

  if (b.r === 'person') { // 명단 — id 없으면 추가, 있으면 보낸 칸만 수정. source를 주면 출처 목록에 덧붙임
    const src = b.source && b.source.url ? { title: clean(b.source.title, 200), url: clean(b.source.url, 500), from: clean(b.source.from, 20) } : null;
    if (!b.id) {
      if (!clean(b.name, 40)) return err('이름을 적어 주세요');
      const v = FIELDS.map(f => clean(b[f], f === 'memo' ? 2000 : 200)); v[7] = v[7] || '후보';
      const r = await db.prepare(`INSERT INTO vip_people (${FIELDS.join(', ')}, sources, updated_by, updated_at) VALUES (${FIELDS.map(() => '?').join(',')},?,?,?)`).bind(...v, JSON.stringify(src ? [src] : []), s.name, now).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
    const id = Number(b.id), sets = FIELDS.filter(f => f in b);
    if (sets.length) await db.prepare(`UPDATE vip_people SET ${sets.map(f => f + ' = ?').join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...sets.map(f => clean(b[f], f === 'memo' ? 2000 : 200)), s.name, now, id).run();
    if (src) { const p = await db.prepare('SELECT sources FROM vip_people WHERE id = ?').bind(id).first(); const list = JSON.parse(p?.sources || '[]');
      if (!list.some(x => x.url === src.url)) { list.push(src); await db.prepare('UPDATE vip_people SET sources = ?, updated_by = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(list.slice(-30)), s.name, now, id).run(); } }
    return json({ ok: true, id });
  }
  if (b.r === 'people') { // 붙여넣기 일괄 추가 (SNU Biz 앱 자료 등)
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter(x => clean(x.name, 40)).slice(0, 500);
    for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50).map(x => db.prepare(`INSERT INTO vip_people (${FIELDS.join(', ')}, sources, updated_by, updated_at) VALUES (${FIELDS.map(() => '?').join(',')},?,?,?)`)
      .bind(...FIELDS.map(f => f === 'status' ? (clean(x.status, 20) || '후보') : clean(x[f], f === 'memo' ? 2000 : 200)), JSON.stringify(x.src ? [{ title: clean(x.src, 200), url: '', from: 'paste' }] : []), s.name, now)));
    return json({ ok: true, inserted: rows.length });
  }
  if (b.r === 'person_del') { await db.prepare('DELETE FROM vip_people WHERE id = ?').bind(Number(b.id)).run(); return json({ ok: true }); }
  return err('unknown resource');
}
