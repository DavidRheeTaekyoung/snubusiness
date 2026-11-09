import { json, err, getDB, clean } from '../_lib.js';
import { liveSession, hasPerm } from '../_auth.js';

// VIP 동문 발굴 — 공개 출처(뉴스·웹·DART 임원현황·국회의원 약력)에서 "서울대 경영" 동문 후보를 모으고, 사람이 확인해 명단으로 옮긴다.
// 명단은 D1에만 둔다 (깃·공개 페이지에 올리지 않음). 연락처·사생활은 모으지 않고 공개된 직함과 출처만 기록.
// 출처 키: NAVER_CLIENT_ID/NAVER_CLIENT_SECRET (네이버 검색 API), DART_API_KEY (OpenDART), ASSEMBLY_API_KEY (열린국회정보)
const SNU = /서울대(?:학교)?\s*\(?\s*(?:경영|상과|상대)|Seoul National Univ[^.]{0,40}(?:Business|Commerce)/i;
const TITLES = '대표이사|부회장|회장|부사장|사장|대표|행장|장관|차관|청장|국회의원|의원|총장|원장|이사장|위원장|전무|상무|CEO|CFO|CTO|COO|파트너|대사|검사장|법원장|대법관|감사|변호사|회계사|교수|센터장|본부장|부행장|차관보|실장|국장|처장|기획관|정책관|심의관|비서관|대변인|수석|교육감|단장|총재|사무총장|구청장|원내대표|최고위원|학장|소장|지점장|법인장|이사관|지검장|고검장|부장검사|부장판사|판사|검사|재판관|법관';
// 직함은 앞에 수식이 붙은 겹낱말로도 온다 (기획조정실장, 금융정책국장, 1차관, 총괄사장, 제1부교육감)
const TITLE = `(?:[가-힣A-Za-z0-9]{0,8}?(?:${TITLES}))`;
const SURN = '김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경';
const STOP = new Set(['서울대', '경영학', '경영대', '졸업', '신임', '그룹', '회사', '이번', '올해', '지난', '현재', '전임', '선임', '대학교', '증권', '은행', '금융', '부문', '사업', '본부', '글로벌', '공동', '전략', '최고', '전문', '각자', '대표이', '대한', '한국', '이사', '고문', '차기', '역대', '초대', '기업', '임원', '내정', '발탁', '승진', '인사', '경영', '부사', '사장', '회장', '이후',
  '변호', '변호사', '선출', '경쟁', '기존', '연임', '유임', '재선', '국민', '한공', '전무', '상무', '대표', '행장', '장관', '차관', '위원', '의원', '총장', '원장', '이사장', '감사', '대사', '검사', '법원',
  '신규', '연말', '조직', '교체', '사임', '출신', '후보', '단독', '대행', '직무', '부행', '부장', '전체', '기관', '지주', '계열', '사외', '상임', '상근', '고객', '최초',
  '성과', '수시', '선거', '당선', '동기', '소속', '전년', '우리', '신한', '하나', '농협', '한화', '삼성', '현대', '롯데', '신세계', '포스', '미래', '교보', '동양', '유진투', '다올',
  '공동대', '전문경', '임관', '제약', '한편', '모르', '연달', '강화', '금감원', '금융감', '검찰', '법무', '대법', '고법', '지법', '중앙지', '서울중', '부산지', '수원지', '인천지', '대전지', '대구지', '광주지', '기획재', '공정거', '국세청', '관세청', '조달청', '통계청', '감사원', '차장', '평검', '부부', '수석', '선임', '전직', '현직', '고위', '행정', '사법', '연수', '임명', '내정자', '지명', '외부', '내부', '공식', '취임', '사의', '용퇴', '퇴임', '물러', '맡은', '맡게', '오른', '올라', '도전', '역임', '거친', '지낸', '중심', '세대', '경력', '책무',
  '국회', '기재', '정부', '오늘', '이날', '인선', '최소', '서울', '국무', '기획', '예상', '전망', '함께', '강력', '이와', '여기', '고용', '노동', '경제', '조달', '원주', '임시', '공직', '금감', '이같', '주일', '노조',
  '방통', '국정', '기구', '권한', '전공', '예고', '여성', '한양', '한영', '이노', '한전', '경기', '정책', '공정', '산업', '통상', '외교', '국방', '법제', '인사처', '공무', '대통', '총리', '이재명', '윤석열', '문재인', '국세', '공인', '예산', '기조', '경사노', '지은', '국조', '제주', '주중', '공기', '석좌', '고려대', '연세대', '한동훈', '전북', '전남', '경북', '경남', '충북', '충남', '강원', '부산', '대구', '광주', '인천', '대전', '울산', '최연', '채권', '위반', '해남', '출신',
  '여의도', '전자', '이끄는', '이끈', '최근', '유력한', '위한', '위해', '진용', '기용', '손보', '한은', '서강대', '성료', '장수', '민주당', '박사', '주기적', '연봉', '주미', '한진칼', '여당', '야당', '이로써', '전면', '경험', '남아', '배치', '신화', '임기', '백화점', '정보유', '이같은', '한섬', '기타비', '주식운', '이들', '유력', '주도', '주목', '지명된', '발탁된', '역할', '경제통', '재무통', '전략통', '이젠', '예보', '현역', '구성된', '공석인', '구성', '정치', '마무리', '마지막', '하지만', '그러나', '전보', '관계', '담당', '책임', '대상', '인물', '김앤장',
  '이어', '한때', '이미', '이제', '주요', '모두', '이중', '장차', '유독', '국내', '이달', '이전', '최종', '경우', '전선', '지휘', '구조', '모교', '강조', '표명', '정통', '지내', '한결', '선정', '성향', '기각']);
const NOT_NAME = /[부처청회에를을와과의로날늘며고서는적된할될킨친린낸던든들팀당소단급률량액계해막뷰탄파총련차위켓달됐했였았겠통]$/; // 기관명·조사·어미로 끝나는 말은 이름이 아니다
const NOT_NAME_R = /[된한는인될할온간든킨친낸던들자팀대다이가도]$/; // "직위에 ○○○" 꼴에서는 더 엄하게 (유력한·지명자·전했다)
// 이름과 직위 사이에 올 수 있는 말 — 기관처럼 생긴 낱말만 ("기용 이영 중기부 장관"의 "기용", "이끈 윤병운 대표"의 "이끈"을 걸러낸다)
// 한 글자 접미(부·처·청·원·위·당·서·대·회)는 앞에 두 글자 이상 있어야 기관으로 본다 (기재부·금융위·금감원은 되고 외부·범위·직원·현대는 안 됨)
const ORGW = '(?:[A-Za-z&][가-힣A-Za-z0-9&.]*|\\d{1,2}(?![\\d년월일명개곳회차세억조원시분초번])[가-힣A-Za-z][가-힣A-Za-z0-9&.]{0,10}|[가-힣A-Za-z0-9&]{1,12}(?:증권|은행|금융|지주|생명|화재|보험|캐피탈|카드|운용|그룹|홀딩스|전자|화학|제약|바이오|건설|물산|상사|중공업|에너지|이노베이션|텔레콤|디스플레이|백화점|쇼핑|리테일|플러스|공사|공단|재단|스쿨|학교|법인|파트너스|인베스트먼트|벤처스|컨설팅|코리아|산업|위원회|법원|지검|고검|검찰청|공소청|센터|연구소|협회)|[가-힣A-Za-z0-9&]{2,12}(?:부|처|청|원|위|당|대|회))';
// 기관 이름 뒤에 아무 낱말이 2개까지 더 올 수 있다 ("SK온 트레이딩인터내셔널 CIC 사장") — 기관 이름이 먼저 와야 문을 열고, 조사·어미가 붙은 낱말은 안 된다
const MID = `(?:${ORGW}\\s(?:[가-힣A-Za-z0-9&.]{1,14}(?<![은는이가을를의에로던다고며서])\\s){0,2}?)?`;
const PRE = '(?:(?:신임|총괄|수석|각자|공동|단독|상임|사외|전|前|현|대표|새|차기|제\\d{1,2}대)\\s?)*';
const ORG_STOP = /^(지주사|지주|그룹|회사|계열사|자회사|금융사|증권사|보험사|은행권|금융권|정부|부처|당국|본사|회|전|前|현|제\d{1,2}대|새|신임|차기|새정부|새\s?정부|현정부|정부)$/; // 보통명사는 소속이 아니다
const SKIP = `(?:['"“”‘’]?[가-힣·]{2,8}['"“”‘’]?\\s){0,2}?`; // 직위와 이름 사이의 수식 ("전주 출신", "'노태우 장남'")
// 기사 속 회사 이름 (소속 칸에 넣을 것) — 학교·일반명사는 뺀다
const CORP = /(?<![가-힣A-Za-z0-9&])(?:법무법인|회계법인)\s?[가-힣]{2,4}|(?<![가-힣A-Za-z0-9&])[가-힣A-Za-z0-9&]{1,14}(?:금융지주|금융그룹|투자증권|증권|은행|생명|화재|손해보험|보험|캐피탈|카드|자산운용|그룹|홀딩스|전자|화학|제약|바이오|건설|물산|상사|중공업|에너지|이노베이션|텔레콤|디스플레이|백화점|쇼핑|리테일|유플러스|공사|공단|파트너스|인베스트먼트|벤처스|컨설팅)(?![가-힣])/g;
const CORP_STOP = /^(금융지주|금융그룹|시중은행|인터넷은행|지방은행|국책은행|증권|은행|생명|보험|그룹|대형증권|중형증권|주요그룹|대기업그룹|계열|자회사|보험|손해보험|생명보험|지주)$/;
function nearOrg(text, name) {
  const at = text.indexOf(name); if (at < 0) return '';
  let best = '', bd = 61;
  for (const m of text.matchAll(CORP)) { const o = m[0].trim(); if (CORP_STOP.test(o) || /서울대|연세대|고려대/.test(o)) continue; const d = m.index < at ? at - (m.index + o.length) : m.index - at - name.length + 10; if (d >= 0 && d < bd) { bd = d; best = o; } }
  return best;
}
const Q = s => s.split(' ').map(w => '서울대 경영학과 ' + w.replace(/_/g, ' '));
const NEWS_Q = {
  corp: [...Q('신임_대표이사 신임_사장 회장_취임 부회장_승진 임원_인사 선임 행장 CEO'), '서울대 경영대 동문'],
  gov: Q('장관_후보자 차관_임명 청장_임명 실장_임명 국장_임명 차관보 처장_임명 대사_임명 고위공무원 행정고시 행시_국장 기획재정부 금융위원회 공정거래위원회 국세청 감사원'),
  law: Q('검사장 지검장 고검장 부장검사 검찰_인사 법원장 부장판사 고법_판사 대법관_후보 헌법재판관 법관_인사 판사_출신 검사_출신'),
};
const WEB_Q = ['서울대 경영학과 졸업 대표이사 인사말', '서울대학교 경영학과 졸업 회장 약력', '서울대 경영학과 졸업 사장 프로필'];
const FIELDS = ['name', 'cohort', 'degree', 'org', 'position', 'field', 'tier', 'status', 'link', 'memo', 'hs', 'birth', 'phone'];
let migrated = false;
async function migrate(db) { // 나중에 붙인 칸 — 한 번 조회해서 빠진 칸이 있을 때만 ALTER (요청마다 ALTER를 돌리면 느려짐)
  const have = await db.prepare("SELECT (SELECT COUNT(*) FROM pragma_table_info('vip_hits') WHERE name = 'birth') + (SELECT COUNT(*) FROM pragma_table_info('vip_corps') WHERE name = 'homepage') + (SELECT COUNT(*) FROM pragma_table_info('vip_people') WHERE name = 'phone') AS n").first();
  if (have?.n === 3) return;
  for (const sql of ["ALTER TABLE vip_people ADD COLUMN hs TEXT NOT NULL DEFAULT ''", "ALTER TABLE vip_people ADD COLUMN birth TEXT NOT NULL DEFAULT ''", "ALTER TABLE vip_people ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE vip_hits ADD COLUMN hs TEXT NOT NULL DEFAULT ''", "ALTER TABLE vip_hits ADD COLUMN birth TEXT NOT NULL DEFAULT ''", "ALTER TABLE vip_corps ADD COLUMN phone TEXT NOT NULL DEFAULT ''", "ALTER TABLE vip_corps ADD COLUMN addr TEXT NOT NULL DEFAULT ''", "ALTER TABLE vip_corps ADD COLUMN homepage TEXT NOT NULL DEFAULT ''"]) { try { await db.prepare(sql).run(); } catch {} }
}

// 기사 문장에서 이름 뒤의 소속·직위, 출신 고교, 출생연도를 뽑는다 (자동 추출이라 사람이 확인)
const HS_STOP = /^(최|광|보|참|경|재|사|원|공|제|비|신|중|등|고|마|창|노|폐|잔|하|모|휴|권|선|숙|탈|전|정|연)고$/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEW_POST = '(?:임명|선임|내정|취임|발탁|승진|지명|기용|영입|선출|추천|낙점)';
export function profile(h) {
  const text = h.title + ' ' + h.snippet, name = h.names?.[0] || '', nm = esc(name), y = Number((h.date || '').slice(0, 4)) || new Date().getFullYear();
  let org = h.org || '', position = h.position || '', hs = '', birth = '';
  if (name && !org) {
    // 1) 임명 기사 제목 "(소속) (새) 직위에 … 이름" (고용노동부 장관에 김문수 지명, 제주개발공사 새 사장에 김도영) — 새 자리가 기사의 핵심이라 이것을 먼저
    const rev = new RegExp(`(?:(?<![가-힣])(${ORGW})\\s)?(?:(?:새|신임|차기|제\\d{1,2}대)\\s)?(${TITLE})(?:에|엔|에는|으로|로)\\s(?:(?:새|신임|전|前|현)\\s)?${SKIP}${nm}(?![가-힣])`);
    // 2) "이름 (전) 소속 직위" — 제목에 있으면 제목 것을 먼저 (제목의 첫 인물이 기사 주인공)
    const fwd = new RegExp(nm + `(?![가-힣])(?:·[가-힣]{2,3})*\\s?${PAREN}((?:전|前)\\s)?(${MID})${PRE}(${TITLE})`);
    let m = h.title.match(rev); if (m) { org = m[1] || ''; position = m[2]; }
    else if ((m = h.title.match(fwd) || text.match(fwd))) {
      org = m[2].trim(); position = m[3];
      if (m[1]) { // 전 직장이 잡혔다 — "소속 직위에 … 이름"이나 "소속 직위에 임명"으로 새 자리를 찾는다
        const a = text.match(rev) || text.match(new RegExp(`(?<![가-힣])(${ORGW})\\s(?:(?:새|신임|차기)\\s)?(${TITLE})(?:에|으로|로)\\s${NEW_POST}`));
        if (a) { org = a[1] || ''; position = a[2]; } }
    } else if ((m = text.match(rev))) { org = m[1] || ''; position = m[2]; }
    else { const d = text.match(new RegExp(`(?<![가-힣])(${TITLE})\\s${nm}(?![가-힣])`)); if (d) position = d[1]; }
    // 소속은 기관 이름까지만 — 뒤에 붙은 수식("더불어민주당 수원갑 현역")은 버린다. 법무법인·회계법인은 다음 낱말이 이름
    const tk = org.split(/\s+/).filter(Boolean), orgRe = new RegExp(`^${ORGW}$`); let keep = tk.length ? 1 : 0;
    if (/^(?:법무법인|회계법인|세무법인|법률사무소)$/.test(tk[0]) && tk[1]) keep = 2;
    while (keep < tk.length && (orgRe.test(tk[keep]) || /^[A-Za-z0-9&]/.test(tk[keep]))) keep++;
    org = tk.slice(0, keep).join(' ');
    if (ORG_STOP.test(org)) org = '';
  }
  if (name && new RegExp(nm + '\\s서울대(?:학교)?\\s경영(?:학과|대학?)?\\s(?:석좌|명예|객원)?교수').test(text) || /^서울대/.test(org) && /교수$/.test(position) && new RegExp(nm + '\\s서울대(?:학교)?\\s경영').test(text)) { org = '서울대 경영대학'; position = '교수'; }
  if (name && !position) { const p = text.match(new RegExp(nm + '[^.…]{0,30}?(' + TITLES + ')')); if (p) position = p[1]; }
  // 기사 속 회사 이름으로 소속을 채우는 건 회사 직위일 때만 (검사·판사·장관에게 근처 회사 이름을 붙이지 않는다)
  const corpPos = !/판사|법원|대법관|재판관|법관|검사|지검|고검|장관|차관|청장|국장|실장|처장|차관보|기획관|정책관|심의관|비서관|대변인|수석|교육감|총재|사무총장|구청장|원내대표|최고위원|이사관|대사|의원|총장|학장|교수|변호사/.test(position);
  if (name && corpPos && (!org || /서울대|연세대|고려대/.test(org) && position !== '교수')) org = nearOrg(text, name) || (h.title.match(CORP) || []).map(o => o.trim()).find(o => !CORP_STOP.test(o) && !/서울대|연세대|고려대/.test(o)) || '';
  for (const m of text.matchAll(/([가-힣]{1,6}(?:고등학교|여고|고))\s*(?:와|과|,|·|를|및|△|졸업|졸|\s)*\s*(?:서울대|연세대|고려대)/g)) if (!HS_STOP.test(m[1]) && !/(?:하|되|했|였|이|며|었|았|받|맡|쳐|나)고$/.test(m[1])) { hs = m[1]; break; }
  const b1 = text.match(/(19[3-9]\d|200\d)년생/) || text.match(/출생\s?(19[3-9]\d|200\d)/); if (b1) birth = b1[1];
  else if (name) { const a = text.match(new RegExp(nm + '[^()]{0,30}\\((\\d{2})[·)]')); if (a && +a[1] >= 30 && +a[1] <= 90) birth = (y - +a[1]) + '?'; }
  return { org, position, hs, birth };
}

async function ensure(db) {
  if (migrated) return; migrated = true; // 워커가 뜰 때 한 번만
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cohort TEXT NOT NULL DEFAULT '', degree TEXT NOT NULL DEFAULT '', org TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '',
      field TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '후보', link TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', sources TEXT NOT NULL DEFAULT '[]', updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_hits (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '', names TEXT NOT NULL DEFAULT '[]', org TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '', matched INTEGER NOT NULL DEFAULT 0, query TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', found_at TEXT, reviewed_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_orgs (name TEXT PRIMARY KEY, aliases TEXT NOT NULL DEFAULT '[]', phone TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '')`),
    db.prepare(`CREATE TABLE IF NOT EXISTS vip_corps (corp_code TEXT PRIMARY KEY, name TEXT NOT NULL, stock_code TEXT NOT NULL DEFAULT '', scanned_at TEXT, found INTEGER NOT NULL DEFAULT 0)`),
  ]);
  await migrate(db);
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
const PAREN = '(?:\\((?:\\d{2}(?:[·,][^)]{1,10})?|사진|[가-힣A-Za-z]{1,8})\\)\\s?)?'; // 이름 뒤 괄호: 나이·사진·한자 ("(2021.7.5.)" 같은 날짜는 아님)
const NAME_F = new RegExp(`(?<![가-힣])([${SURN}][가-힣]{1,2})(?![가-힣])(?:·[가-힣]{2,3})*\\s?${PAREN}(?:(?:전|前|현|신임|새)\\s)?(${MID})${PRE}(${TITLE})`, 'g');
const GOV_MID = /(?:부|처|청|위|위원회|원|당)\s$/, GOV_T = /^(?:장관|차관|청장|위원장|부위원장|원장|대표|의원|수석|실장|국장)$/; // "이영 중기부 장관" — 두 글자 이름이라도 부처+직위가 바로 따르면 믿는다
// 임명 기사 꼴: "국무조정실장에 임기근", "산업부 차관에 전주 출신 박동일 임명", "기재 1차관 이형일·외교 1차관 박윤주" — 세 글자 이름만, 뒤는 문장부호·임명 동사
const NAME_R1 = new RegExp(`(?<![가-힣])${TITLE}(?:에|엔|에는|으로|로)\\s(?:(?:새|신임|전|前|현)\\s)?${SKIP}([${SURN}][가-힣]{2})(?=\\s(?:${NEW_POST}|씨|등|전|前|현|신임)|\\s?[,.·…()]|$)`, 'g');
const NAME_R2 = new RegExp(`(?<![가-힣])${TITLE}\\s([${SURN}][가-힣]{2})(?=$|[,.·…()\\[\\]'"“”‘’])`, 'g');
// 사람 이름으로 볼 수 있는지 — 제외어·어미 규칙에 더해 글 안의 쓰임새를 본다
const TITLE_ONLY = new RegExp(`^(?:${TITLE}|(?:${TITLES})[가-힣])$`); // 심의관·지청장·국장이 — 직함 자체(또는 직함+조사)
function isName(n, text, strict, gov) {
  // 제외어 + 조사·접미(임명장·선임안·지명자·기용된)도 제외 — 셋째 글자가 이름에 흔한 글자면(이제영·최종학) 제외어로 시작해도 이름일 수 있다
  if (STOP.has(n) || (STOP.has(n.slice(0, 2)) && /[은는이가을를의에도만자장안급된한할될것됐했]$/.test(n)) || NOT_NAME.test(n) || (strict && NOT_NAME_R.test(n)) || TITLE_ONLY.test(n)) return false;
  const e = esc(n);
  if (new RegExp(e + '(?:에서|으로|부터|까지|마다|처럼|에(?!게)|로)(?![가-힣])').test(text)) return false; // 장소·사물 조사가 붙은 말 (여의도에서, 최근에)
  if (/[한인진]$/.test(n) && new RegExp('(?<![가-힣])' + esc(n.slice(0, 2)) + (n.endsWith('진') ? '[져졌지]' : '(?:[하히해했]|(?:을|를|이|은|는|의)?(?![가-힣]))')).test(text)) return false; // 유력한·지휘한·진심인·이뤄진 — 어간이 따로 쓰였다
  if (/대$/.test(n) && new RegExp(e + '(?:학교|\\s?(?:대학원|경영|법학|석사|박사|졸업|출신|MBA|[가-힣]{0,6}(?:교수|총장|처장|학장|원장)))').test(text)) return false; // 인하대·한양대 — 학교 이름 (박찬대 의원·윤인대 국장은 아님)
  // 두 글자 이름은 드물고 보통명사와 자주 겹친다 (전보·주요·국내) — 부처+직위가 바로 따르거나, 같은 글에서 사람으로 다시 불렸을 때만 (이 장관은·이영씨·이영(52)). 전·현씨는 前·現과 헷갈려 줄임말로 안 본다
  if (n.length === 2 && !gov && !new RegExp((/[전현]/.test(n[0]) ? '' : `(?<![가-힣])${e[0]}\\s(?:신임\\s|전\\s|前\\s)?${TITLE}|`) + `${e}\\s?(?:씨|님|\\(\\d{2})`).test(text)) return false;
  return true;
}
export function guessNames(text) {
  // 이름 바로 뒤에 한글이 이어지면 이름이 아니다 (신영증권 → "신영증", LG유플러스 → "유플러")
  const out = new Set(); let m;
  NAME_F.lastIndex = 0; while ((m = NAME_F.exec(text))) { const n = m[1], t = m[3];
    const skip = (n[0] === '주' && /대사$/.test(t)) || (/대$/.test(n) && /(?:교수|총장|학장|원장)$/.test(t)); // 주미 대사, 한림대 교수
    if (!skip && isName(n, text, false, GOV_MID.test(m[2]) && GOV_T.test(t))) out.add(n); NAME_F.lastIndex = m.index + 1; }
  for (const re of [NAME_R1, NAME_R2]) { re.lastIndex = 0; while ((m = re.exec(text))) { if (isName(m[1], text, true)) out.add(m[1]); re.lastIndex = m.index + 1; } }
  return rankNames([...out], text).slice(0, 6);
}
// 서울대 경영 언급과 가까운 이름을 앞으로 ("김 대표는 서울대 경영학과를…"면 김씨를 먼저)
function rankNames(names, text) {
  const at = [...text.matchAll(new RegExp(SNU.source, 'gi'))].map(m => m.index); if (!at.length || names.length < 2) return names;
  const sur = new Set(); for (const m of text.matchAll(new RegExp(`(?<![가-힣])([${SURN}])\\s(?:신임\\s)?(?:${TITLES})(?:은|는|이|가)[^.]{0,60}?서울대`, 'g'))) sur.add(m[1]);
  const score = n => { let d = 1e6; for (const m of text.matchAll(new RegExp(n, 'g'))) for (const a of at) d = Math.min(d, Math.abs(a - m.index)); return d - (sur.has(n[0]) ? 5000 : 0); };
  return names.map(n => [n, score(n)]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
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
    const rs = await db.batch(hits.slice(i, i + 50).map(h => { const pf = profile(h); // 소속·고교·출생연도는 저장할 때 한 번만 뽑는다
      return db.prepare('INSERT INTO vip_hits (key, source, url, title, snippet, date, names, org, position, hs, birth, matched, query, found_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING')
      .bind(clean(h.key, 500), h.source, clean(h.url, 500), clean(h.title, 300), clean(h.snippet, 1200), clean(h.date, 20), JSON.stringify(h.names || []), clean(pf.org, 120), clean(pf.position, 120), clean(pf.hs, 40), clean(pf.birth, 10), h.matched ? 1 : 0, clean(h.query, 200), now); }));
    n += rs.reduce((a, r) => a + (r.meta?.changes || 0), 0);
  }
  return n;
}


export async function onRequestGet({ request, env }) {
  const db = getDB(env); if (!db) return err('no db', 503); await ensure(db);
  const [s, e] = await guard(request, env, db); if (e) return e;
  // 화면을 빨리 띄우려고 둘로 나눔: 기본은 숫자·명단, ?part=hits 는 수집 결과 목록과 대표번호 표
  if (new URL(request.url).searchParams.get('part') === 'hits') {
    const [hits, orgs, dir] = await Promise.all([
      db.prepare("SELECT id, source, url, title, substr(snippet, 1, 300) AS snippet, date, names, org, position, hs, birth, matched, query, status FROM vip_hits WHERE status != 'dismissed' ORDER BY matched DESC, date DESC, id DESC LIMIT 5000").all().then(r => r.results.map(h => ({ ...h, names: JSON.parse(h.names || '[]') }))),
      db.prepare("SELECT name, phone, addr, homepage FROM vip_corps WHERE phone NOT IN ('', '-')").all().then(r => r.results),
      db.prepare('SELECT * FROM vip_orgs').all().then(r => r.results.map(o => ({ ...o, aliases: JSON.parse(o.aliases || '[]') }))),
    ]);
    return json({ hits, orgs, dir });
  }
  const [people, corps, counts] = await Promise.all([
    db.prepare('SELECT * FROM vip_people ORDER BY id DESC').all().then(r => r.results.map(p => ({ ...p, sources: JSON.parse(p.sources || '[]') }))),
    db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN scanned_at IS NOT NULL THEN 1 ELSE 0 END) AS scanned, SUM(found) AS found FROM vip_corps').first(),
    db.prepare("SELECT source, status, COUNT(*) AS n FROM vip_hits GROUP BY source, status").all().then(r => r.results),
  ]);
  return json({ people, counts, corps, keys: keys(env), presets: { news: NEWS_Q, web: WEB_Q }, me: s.name, role: s.role });
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

  // OpenDART는 해외(클라우드) 접속을 오류 페이지로 돌려보내므로, 스캔은 국내 PC에서 tools/dart-scan.mjs 로 돌리고 결과만 여기로 보낸다
  if (b.r === 'dart_todo') { const { results } = await db.prepare('SELECT corp_code, name FROM vip_corps WHERE scanned_at IS NULL ORDER BY corp_code').all(); return json({ ok: true, corps: results }); }
  if (b.r === 'dart_import') {
    const hits = (Array.isArray(b.hits) ? b.hits : []).slice(0, 300).map(h => ({ ...h, source: 'dart', matched: 1, query: 'DART 임원현황', names: [clean(String(h.name || '').replace(/\(.*?\)/g, '').replace(/\s+/g, ''), 20)] })); // 공시 이름의 각주 표시 "(*2)" 제거
    const done = (Array.isArray(b.done) ? b.done : []).filter(d => /^\d{8}$/.test(d[0])).slice(0, 300);
    const added = await saveHits(db, hits, now);
    if (done.length) await db.batch(done.map(([cc, n]) => db.prepare('UPDATE vip_corps SET scanned_at = ?, found = ? WHERE corp_code = ?').bind(now, Number(n) || 0, cc)));
    return json({ ok: true, added });
  }
  if (b.r === 'dart_corps') { // 상장사 목록 저장 (브라우저가 100곳씩 보냄)
    const list = (Array.isArray(b.corps) ? b.corps : []).filter(c => /^\d{8}$/.test(c.corp_code)).slice(0, 200);
    if (list.length) await db.batch(list.map(c => db.prepare('INSERT INTO vip_corps (corp_code, name, stock_code) VALUES (?,?,?) ON CONFLICT(corp_code) DO UPDATE SET name=excluded.name, stock_code=excluded.stock_code').bind(c.corp_code, clean(c.name, 120), clean(c.stock_code, 10))));
    return json({ ok: true, saved: list.length });
  }
  // 기관 대표번호 — DART 기업개황의 공개 대표전화만 (개인 번호는 모으지 않음). 상장사 전체를 로컬 스크립트가 채운다
  if (b.r === 'corp_todo') { const { results } = await db.prepare("SELECT corp_code, name FROM vip_corps WHERE phone = '' ORDER BY found DESC, corp_code").all(); return json({ ok: true, corps: results }); }
  if (b.r === 'corp_info') {
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter(x => /^\d{8}$/.test(x.corp_code)).slice(0, 300);
    for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50).map(x => db.prepare('UPDATE vip_corps SET phone = ?, addr = ?, homepage = ? WHERE corp_code = ?').bind(clean(x.phone, 40) || '-', clean(x.addr, 200), clean(x.homepage, 200), x.corp_code)));
    return json({ ok: true, saved: rows.length });
  }
  if (b.r === 'orgs_set') { // 부처·법원·검찰·로펌 대표번호 표 (공식 사이트에서 확인한 번호만)
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter(x => clean(x.name, 60) && clean(x.phone, 40)).slice(0, 300);
    for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50).map(x => db.prepare('INSERT INTO vip_orgs (name, aliases, phone, kind, source) VALUES (?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET aliases=excluded.aliases, phone=excluded.phone, kind=excluded.kind, source=excluded.source')
      .bind(clean(x.name, 60), JSON.stringify((Array.isArray(x.aliases) ? x.aliases : []).map(a => clean(a, 40)).filter(Boolean).slice(0, 12)), clean(x.phone, 40), clean(x.kind, 20), clean(x.source, 300))));
    return json({ ok: true, saved: rows.length });
  }
  if (b.r === 'renames') { // 이름 추출 규칙을 고친 뒤 기존 뉴스·웹 결과의 이름 후보를 다시 뽑는다
    const from = Number(b.from) || 0, lim = Math.min(Number(b.n) || 300, 500); // 한 번에 다 돌리면 워커 시간 초과 — 나눠서
    const { results } = await db.prepare("SELECT id, source, title, snippet, date, names, org, position FROM vip_hits WHERE id > ? ORDER BY id LIMIT ?").bind(from, lim).all();
    for (let i = 0; i < results.length; i += 50) await db.batch(results.slice(i, i + 50).map(h => { const dart = h.source === 'dart';
      h.names = dart ? JSON.parse(h.names || '[]').map(n => String(n).replace(/\(.*?\)/g, '').replace(/\s+/g, '')).filter(Boolean) : guessNames(h.title + ' ' + h.snippet); if (!dart) { h.org = ''; h.position = ''; } const pf = profile(h);
      return db.prepare('UPDATE vip_hits SET names = ?, org = ?, position = ?, hs = ?, birth = ? WHERE id = ?').bind(JSON.stringify(h.names), clean(pf.org, 120), clean(pf.position, 120), clean(pf.hs, 40), clean(pf.birth, 10), h.id); }));
    return json({ ok: true, n: results.length, last: results.length ? results[results.length - 1].id : null });
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
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter(x => clean(x.name, 40)).slice(0, 1000); // 수집 결과를 통째로 옮길 때도 쓴다 (출처 링크 포함)
    for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50).map(x => db.prepare(`INSERT INTO vip_people (${FIELDS.join(', ')}, sources, updated_by, updated_at) VALUES (${FIELDS.map(() => '?').join(',')},?,?,?)`)
      .bind(...FIELDS.map(f => f === 'status' ? (clean(x.status, 20) || '후보') : clean(x[f], f === 'memo' ? 2000 : 200)), JSON.stringify(Array.isArray(x.sources) ? x.sources.slice(0, 5).map(o => ({ title: clean(o.title, 200), url: clean(o.url, 500), from: clean(o.from, 20) || 'hits' })) : x.src ? [{ title: clean(x.src, 200), url: '', from: 'paste' }] : []), s.name, now)));
    return json({ ok: true, inserted: rows.length });
  }
  if (b.r === 'person_del') { await db.prepare('DELETE FROM vip_people WHERE id = ?').bind(Number(b.id)).run(); return json({ ok: true }); }
  return err('unknown resource');
}
