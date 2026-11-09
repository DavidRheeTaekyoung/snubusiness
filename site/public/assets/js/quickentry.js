/* 빠른 입력 파서 + 자동 분개 — 회비 정산 화면 공용. 키 없이 브라우저에서만 동작한다.
   QE.parse(text, ctx)  : 자유 문장·은행 거래내역·엑셀 붙여넣기 → 거래 행 배열 (추정 칸은 low 에 표시)
   QE.journal(e, coa)   : 거래 1건의 자동 분개 { dr:{code,name}, cr:{code,name}, how }
   ctx = { coa:[{code,name,kind,rule,active}], entries:[장부 거래], today:'YYYY-MM-DD' } */
(function () {
  const pad = n => String(n).padStart(2, '0');
  const INCOME_KW = /입금|기부|후원|찬조|협찬|회비|참가비|등록비|이자|환급|환불|수입|입회|납부|납입/;
  const EXPENSE_KW = /출금|결제|지급|지출|구입|구매|식대|식사|요금|대관|비용|송금|선물|상품권|강연료|공연료|화환|조화|경조|통신|수수료|지원비|대납|제작/;
  const METHODS = [[/자동이체/, '자동이체'], [/카드|체크|신용/, '카드'], [/계좌이체|이체|송금|인터넷뱅킹|폰뱅킹/, '계좌이체'], [/ATM|에이티엠/i, 'ATM'], [/현금/, '현금'], [/카카오페이|네이버페이|토스|간편결제/, '간편결제']];
  const EVENTS = [[/송년회|송년/, '송년회'], [/골프/, '골프대회'], [/조찬/, '조찬모임'], [/창립총회|총회|준비모임|준비위원회|발족식/, '창립총회 준비']];
  const num = s => Math.round(Number(String(s).replace(/[^0-9.-]/g, ''))) || 0;

  // 날짜 — 2026-09-14 / 2026.9.14 / 26.9.14 / 9/14 / 9월 14일 / 9.14 / 0914(은행) . 연도 없으면 올해, 미래면 작년
  function findDate(text, today) {
    const ty = Number(today.slice(0, 4));
    const pats = [
      { re: /(20\d{2})[.\-\/년]\s*(\d{1,2})[.\-\/월]\s*(\d{1,2})일?/, y: 1, m: 2, d: 3 },
      { re: /(?<![\d.])(\d{2})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})(?![\d])/, y: 1, m: 2, d: 3, yy: true },
      { re: /(?<![\d.\/-])(\d{1,2})\s*[\/.월]\s*(\d{1,2})일?(?![\d.\/])/, m: 1, d: 2 },
    ];
    for (const p of pats) { const m = text.match(p.re); if (!m) continue;
      const mo = Number(m[p.m]), d = Number(m[p.d]); if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      let y = p.y ? Number(m[p.y]) : ty, low = !p.y; if (p.yy) y = 2000 + y;
      let iso = `${y}-${pad(mo)}-${pad(d)}`;
      // 연도 없는 미래 날짜: 두 달 안이면 올해(예정 거래), 그보다 멀면 작년
      if (!p.y && iso > today) { const days = (new Date(iso) - new Date(today)) / 86400000; if (days > 60) { y = ty - 1; iso = `${y}-${pad(mo)}-${pad(d)}`; } }
      return { iso, raw: m[0], low };
    }
    return null;
  }
  // 금액 — 6,887,000원 / 687만원 / 68.7만 / 1천만원 / 1,000만 / 1억 2천만 / 2000000
  function findAmount(text) {
    const cands = [];
    const re = /(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|십만|만|천)?\s*(원)?/g; let m;
    while ((m = re.exec(text))) {
      const base = Number(m[1].replace(/,/g, '')); if (!m[1] || isNaN(base)) continue;
      const unit = { '억': 1e8, '천만': 1e7, '백만': 1e6, '십만': 1e5, '만': 1e4, '천': 1e3 }[m[2]] || 1;
      let v = Math.round(base * unit);
      // "1억 2천만" 처럼 이어지는 단위 합산
      const rest = text.slice(m.index + m[0].length).match(/^\s*(\d[\d,]*)\s*(천만|백만|만|천)\s*(원)?/);
      let raw = m[0]; if (m[2] && rest) { v += Math.round(Number(rest[1].replace(/,/g, '')) * ({ '천만': 1e7, '백만': 1e6, '만': 1e4, '천': 1e3 }[rest[2]])); raw += rest[0]; re.lastIndex += rest[0].length; }
      if (!v) continue;
      const score = (m[3] ? 4 : 0) + (m[2] ? 3 : 0) + (/,/.test(m[1]) ? 2 : 0) + (v >= 1000 ? 1 : 0);
      if (!m[2] && !m[3] && v < 1000) continue; // 단위도 원도 없는 작은 수(인원·번호)는 제외
      cands.push({ v, raw, score, low: !m[2] && !m[3] });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score || b.v - a.v); return cands[0];
  }
  function byRule(coa, kind, text) {
    for (const c of coa.filter(c => c.kind === kind && c.active && c.rule)) { try { if (new RegExp(c.rule).test(text)) return c; } catch (e) {} }
    return null;
  }
  // 장부에 이미 쓰인 항목 이름 → 가장 많이 쓰인 순. 계정 코드별 대표 항목 이름도 만든다
  function catIndex(entries, coa) {
    const cnt = {}; for (const e of entries || []) { if (!e.category) continue; const k = e.type + '|' + e.category; cnt[k] = (cnt[k] || 0) + 1; }
    const names = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k]) => ({ type: k.split('|')[0], name: k.split('|')[1] }));
    const rep = {}; for (const n of names) { const kind = n.type === 'income' ? 'revenue' : 'expense'; const c = byRule(coa, kind, n.name); if (c && !rep[c.code]) rep[c.code] = n.name; }
    // 장부 낱말 사전: 항목·내용에 쓰인 낱말(= 거래처가 아닐 가능성이 큰 말) 과 이미 쓰인 거래처 이름
    const vocab = new Set(), cps = new Set();
    for (const e of entries || []) { String((e.category || '') + ' ' + (e.item || '')).split(/[\s·,()\/\-]+/).forEach(w => { if (w.length >= 2) vocab.add(w); }); if (e.counterparty) cps.add(e.counterparty.trim()); }
    return { names, rep, vocab, cps };
  }
  const nm = (coa, code) => { const c = coa.find(x => x.code === code); return c ? c.name : ''; };

  // 표 형식 한 줄 (탭 또는 2칸 이상 공백 구분)
  function cells(line) { if (/\t/.test(line)) return line.split('\t').map(s => s.trim()); if (/ {2,}/.test(line)) return line.split(/ {2,}/).map(s => s.trim()); return null; }
  const isNum = s => /^[-+]?\d{1,3}(,\d{3})+$|^[-+]?\d+$/.test(String(s).replace(/원$/, '').trim()) && num(s) !== 0 || /^0$/.test(String(s).trim()) || /^-$/.test(String(s).trim());

  function parse(text, ctx) {
    ctx = ctx || {}; const coa = ctx.coa || [], today = ctx.today || new Date().toISOString().slice(0, 10);
    const CI = catIndex(ctx.entries, coa);
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [], skipped = [];
    // 은행 내역 머리글 (일자 적요 입금 출금 잔액 …) 이 있으면 열 위치를 기억한다
    let head = null;
    for (const line of lines) {
      const c = cells(line);
      if (c && c.length >= 3 && !findDate(line, today) && /거래일|일자|날짜|적요|입금|출금|잔액|내용/.test(line)) {
        head = { date: c.findIndex(x => /일|날짜/.test(x)), inn: c.findIndex(x => /입금|수입/.test(x)), out: c.findIndex(x => /출금|지출/.test(x)), bal: c.findIndex(x => /잔액/.test(x)), memo: c.findIndex(x => /적요|내용|거래내용|비고/.test(x)), cp: c.findIndex(x => /거래처|상대|의뢰인|보낸/.test(x)), type: c.findIndex(x => /구분/.test(x)), amt: c.findIndex(x => /금액/.test(x)) };
        continue;
      }
      let row;
      if (c && c.length >= 3) row = fromCells(c, head, today, coa, CI); else row = fromText(line, today, coa, CI);
      if (!row) { skipped.push(line); continue; }
      row.src = line; out.push(row);
    }
    return { rows: out, skipped };
  }

  function base() { return { date: '', type: 'expense', category: '', item: '', amount: 0, method: '', counterparty: '', event: '', memo: '', account: '', low: {} }; }
  function finish(r, coa, CI) {
    // 계정 추정: 항목 → 항목+내용 순으로 규칙 검사. 계정은 저장 시 account 로 들어가지 않고(자동 분개가 같은 규칙) 화면 표시용. 사람이 바꾸면 account 저장
    const kind = r.type === 'income' ? 'revenue' : 'expense';
    const text = [r.category, r.item, r.counterparty].filter(Boolean).join(' ');
    // 장부에 이미 쓰인 항목 이름이 문장에 들어 있으면 그 이름을 쓴다
    if (!r.category) { const hit = CI.names.find(n => n.type === r.type && n.name.length >= 2 && text.includes(n.name)); if (hit) r.category = hit.name; }
    const c = byRule(coa, kind, r.category || '') || byRule(coa, kind, text);
    if (!r.category) { if (c) { r.category = CI.rep[c.code] || c.name; r.low.category = true; } else { r.category = r.type === 'income' ? '기타수입' : '기타 지출'; r.low.category = true; } }
    r.guess = c ? c.code : (kind === 'revenue' ? '409' : '599'); if (!c) r.low.category = true;
    if (!r.event) { for (const [re, ev] of EVENTS) if (re.test(text)) { r.event = ev; r.low.event = true; break; } }
    if (!r.item) { r.item = r.category; r.low.item = true; }
    return r;
  }
  function fromCells(c, head, today, coa, CI) {
    const r = base();
    // 1) 기존 엑셀 가져오기 형식: 날짜, 구분(수입/지출), 항목, 내용, 금액, 결제수단, 거래처, 비고, 행사, 예정
    const d0 = findDate(c[0], today);
    if (d0 && /^(수입|지출|입금|출금|income|expense)$/i.test(c[1] || '') && c.length >= 5) {
      Object.assign(r, { date: d0.iso, type: /수입|입금|income/i.test(c[1]) ? 'income' : 'expense', category: c[2] || '', item: c[3] || '', amount: num(c[4]), method: c[5] || '', counterparty: c[6] || '', memo: c[7] || '', event: c[8] || '', planned: /예정|계획|예산|1|true/i.test(c[9] || '') ? 1 : 0 });
      if (!r.amount) return null; return finish(r, coa, CI);
    }
    // 2) 은행 거래내역: 날짜 칸 + 숫자 칸들(입금/출금/잔액) + 글자 칸(적요)
    const di = c.findIndex(x => findDate(x, today)); if (di < 0) return null;
    const d = findDate(c[di], today); r.date = d.iso; if (d.low) r.low.date = true;
    const nums = c.map((x, i) => ({ i, v: isNum(x) ? num(x) : null, raw: x })).filter(x => x.i !== di && x.v !== null && !/[가-힣]/.test(x.raw) && !/^\d{1,2}:\d{2}/.test(x.raw));
    const texts = c.filter((x, i) => i !== di && !isNum(x) && !/^\d{1,2}:\d{2}(:\d{2})?$/.test(x) && !/^(원|KRW)$/.test(x));
    let inn = 0, outv = 0;
    if (head && (head.inn >= 0 || head.out >= 0)) { inn = head.inn >= 0 ? num(c[head.inn]) : 0; outv = head.out >= 0 ? num(c[head.out]) : 0; if (head.amt >= 0 && !inn && !outv) { const a = num(c[head.amt]); if (head.type >= 0 && /입금|수입/.test(c[head.type])) inn = a; else outv = a; } }
    else {
      const nz = nums.filter(x => x.v); if (!nz.length) return null;
      if (nums.length >= 3) { // 입금 출금 잔액 — 마지막은 잔액
        const a = nums[0].v, b = nums[1].v; if (a && !b) inn = a; else if (b && !a) outv = b; else { outv = a || b; r.low.type = true; }
      } else if (nums.length === 2) { const v = nz[0].v; if (INCOME_KW.test(texts.join(' ')) && !EXPENSE_KW.test(texts.join(' '))) inn = v; else outv = v; r.low.type = true; }
      else { const v = nz[0].v; if (INCOME_KW.test(texts.join(' ')) && !EXPENSE_KW.test(texts.join(' '))) inn = v; else outv = v; r.low.type = true; }
    }
    if (!inn && !outv) return null;
    r.type = inn ? 'income' : 'expense'; r.amount = inn || outv;
    const memo = head && head.memo >= 0 ? (c[head.memo] || '') : texts.join(' ');
    const cp = head && head.cp >= 0 ? (c[head.cp] || '') : '';
    r.item = memo || ''; r.method = '계좌이체'; r.low.method = true;
    for (const [re, mth] of METHODS) if (re.test(memo)) { r.method = mth; delete r.low.method; break; }
    const nameM = memo.match(/([가-힣]{2,4})\s*[-–]?\s*(기부|회비|후원|찬조|참가비)/) || memo.match(/^([가-힣]{2,4})$/);
    if (cp) r.counterparty = cp; else if (r.type === 'income' && nameM) { r.counterparty = nameM[1]; r.low.counterparty = true; }
    if (texts.length > 1 && !cp) r.memo = texts.slice(1).join(' ');
    return finish(r, coa, CI);
  }
  function fromText(line, today, coa, CI) {
    const r = base(); let s = line;
    const d = findDate(s, today); if (d) { r.date = d.iso; if (d.low) r.low.date = true; s = s.replace(d.raw, ' '); } else { r.date = today; r.low.date = true; }
    const a = findAmount(s); if (!a) return null; r.amount = a.v; if (a.low) r.low.amount = true; s = s.replace(a.raw, ' ');
    for (const [re, mth] of METHODS) if (re.test(s)) { r.method = mth; s = s.replace(re, ' '); break; }
    const inc = INCOME_KW.test(line), exp = EXPENSE_KW.test(line);
    if (inc && !exp) r.type = 'income'; else if (exp && !inc) r.type = 'expense'; else if (inc && exp) { r.type = /기부|회비|후원|찬조|참가비|이자|입금/.test(line) && !/지급|결제|구입/.test(line) ? 'income' : 'expense'; r.low.type = true; } else { r.type = 'expense'; r.low.type = true; }
    if (!r.method) { r.method = '계좌이체'; r.low.method = true; }
    // 납부자: "김광일 기부" / "김광일-기부" / "기부 김광일" / "김광일 회비"
    const nm1 = s.match(/([가-힣]{2,4})\s*[-–]?\s*(기부|회비|후원|찬조|참가비|납부)/) || s.match(/(기부|회비|후원|찬조|참가비)\s*[-–:]?\s*([가-힣]{2,4})(?=\s|$)/);
    if (r.type === 'income' && nm1) { const name = nm1[1].length <= 4 && !/기부|회비|후원|찬조|참가비|납부/.test(nm1[1]) ? nm1[1] : nm1[2]; if (name && !/기부|회비|후원|찬조|참가비|납부|입금|이자|수입/.test(name)) { r.counterparty = name; s = s.replace(name, ' '); } }
    for (const [re, ev] of EVENTS) if (re.test(s)) { r.event = ev; break; }
    // 남은 낱말: 항목 후보(장부 항목 이름·규칙) 와 거래처 후보(고유명사)
    s = s.replace(/[()\[\]:,·]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = s.split(' ').filter(Boolean);
    const catHit = CI.names.find(n => n.type === r.type && n.name.length >= 2 && s.includes(n.name));
    if (catHit) r.category = catHit.name;
    const known = words.find(w => CI.cps.has(w)); if (known && !r.counterparty) r.counterparty = known; // 장부에 이미 있는 거래처 이름
    if (r.type === 'expense' && !r.counterparty) {
      // 항목·행사·결제 낱말도, 장부 항목·내용에 이미 쓰인 낱말도 아닌 고유명사 1개를 거래처로 추정 — 보통 식당·업체 이름
      const kw = /식대|식사|비용|행사|진행|지급|결제|구입|구매|선물|상품권|강연|공연|대관|통신|소모품|경조|화환|기념품|지원|찬조|기부|회의|조찬|송년|골프|총회|준비|모임|위원|회장|사무|요금|제작|대금|월|일|년|건|명|분|개|원$/;
      const cand = words.filter(w => !kw.test(w) && !/^\d/.test(w) && w.length >= 2 && !CI.vocab.has(w) && !(catHit && catHit.name.includes(w)));
      if (cand.length === 1 && words.length > 1) { r.counterparty = cand[0]; r.low.counterparty = true; }
    }
    if (r.type === 'income' && !r.counterparty) { // "김광일 10,000,000 입금" — 이름 하나만 남으면 납부자
      const cand = words.filter(w => /^[가-힣]{2,4}$/.test(w) && !/입금|이자|수입|기부|회비|후원|찬조|참가비|납부|결산|환급/.test(w));
      if (cand.length === 1) { r.counterparty = cand[0]; r.low.counterparty = true; }
    }
    r.item = words.filter(w => w !== r.counterparty).join(' ').trim() || line;
    return finish(r, coa, CI);
  }

  // 자동 분개 — books 화면의 counterOf/assetOf 와 같은 규칙
  function journal(e, coa) {
    const asset = /현금/.test(e.method || '') ? '101' : '102';
    const kind = e.type === 'income' ? 'revenue' : 'expense'; let code = '', how = 'default';
    if (e.account && coa.find(c => c.code === e.account)) { code = e.account; how = 'manual'; }
    else { for (const text of [(e.category || '').trim(), ((e.category || '') + ' ' + (e.item || '')).trim()]) { if (!text || code) continue; const c = byRule(coa, kind, text); if (c) { code = c.code; how = 'rule'; } } }
    if (!code) code = kind === 'revenue' ? '409' : '599';
    const A = { code: asset, name: nm(coa, asset) }, C = { code, name: nm(coa, code) };
    return e.type === 'income' ? { dr: A, cr: C, how } : { dr: C, cr: A, how };
  }
  window.QE = { parse, journal, findDate, findAmount };
})();
