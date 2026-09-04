/* SNU Business Alumni — shared shell (header / footer / nav / motion) */
(function () {
  const NAV = [
    { label: '동문회 소개', href: '/about/', sub: [
      ['회장 인사말', '/about/#greeting'], ['연혁', '/about/#history'], ['회칙', '/about/#bylaws'],
      ['임원 · 조직', '/about/#officers'], ['사무국 안내', '/about/#office'] ] },
    { label: '소식', href: '/news/', sub: [
      ['공지사항', '/news/#notice'], ['동문회 소식', '/news/#news'], ['동문 경조사', '/news/#family'], ['언론 속 동문', '/news/#press'] ] },
    { label: '행사', href: '/events/', sub: [
      ['행사 일정', '/events/#calendar'], ['정기총회 · 신년하례회', '/events/#assembly'], ['홈커밍데이', '/events/#homecoming'], ['산행 · 골프 · 바둑', '/events/#clubs'] ] },
    { label: '동문', href: '/members/', sub: [
      ['동문 찾기', '/members/#directory'], ['기별 동문회', '/members/#classes'], ['동문 기업', '/members/#companies'], ['동문 이야기', '/members/#stories'], ['멘토링', '/members/#mentoring'] ] },
    { label: '장학 · 기부', href: '/giving/', sub: [
      ['장학사업', '/giving/#scholarship'], ['동문회비 납부', '/giving/#dues'], ['기부 안내', '/giving/#donate'], ['기부자 예우', '/giving/#honor'] ] },
    { label: '자료실', href: '/media/', sub: [
      ['동문회보', '/media/#newsletter'], ['행사 갤러리', '/media/#gallery'], ['동문 명부', '/media/#directory'], ['서식 다운로드', '/media/#forms'] ] },
  ];

  const SEAL = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="50" cy="50" r="41" fill="none" stroke="currentColor" stroke-width=".6" opacity=".7"/>
    <path d="M50 14 L54 24 L50 21 L46 24 Z" fill="currentColor"/>
    <text x="50" y="58" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="30" font-weight="600" letter-spacing="1" fill="currentColor">SNU</text>
    <text x="50" y="72" text-anchor="middle" font-family="Cormorant Garamond, Georgia, serif" font-size="7.2" letter-spacing="2.4" fill="currentColor">BUSINESS</text>
    <path d="M22 78 Q50 90 78 78" fill="none" stroke="currentColor" stroke-width=".8"/>
    <circle cx="50" cy="83.5" r="1.4" fill="currentColor"/>
  </svg>`;

  const PATH = location.pathname;
  const isActive = (href) => href !== '/' && PATH.startsWith(href);

  function brand(light) {
    return `<a class="brand" href="/" aria-label="서울대학교 경영대학 총동문회 홈">
      <span class="seal" style="color:${light ? '#DCC392' : '#0B1F3A'}">${SEAL}</span>
      <span class="name"><span class="ko">서울대학교 경영대학 총동문회</span><span class="en">SNU Business Alumni</span></span>
    </a>`;
  }

  function header() {
    const items = NAV.map(n => `
      <li class="${isActive(n.href) ? 'active' : ''}"><a href="${n.href}">${n.label}</a>
        <ul class="sub">${n.sub.map(s => `<li><a href="${s[1]}">${s[0]}</a></li>`).join('')}</ul>
      </li>`).join('');
    return `
    <div class="topbar"><div class="container">
      <div class="links"><a href="https://cba.snu.ac.kr" target="_blank" rel="noopener">서울대학교 경영대학</a><a href="https://www.snua.or.kr" target="_blank" rel="noopener">서울대학교 총동창회</a><a href="http://www.sangdae.com" target="_blank" rel="noopener">상과대학 총동창회</a></div>
      <div class="links"><a href="/members/#directory">동문 찾기</a><a href="/login/">로그인</a><a href="/admin/" title="개발 작업대">Workbench</a></div>
    </div></div>
    <header class="header"><div class="container">
      ${brand(false)}
      <nav aria-label="주 메뉴"><ul class="nav">${items}</ul></nav>
      <div class="header-actions">
        <a class="btn gold sm" href="/giving/#dues">동문회비 납부</a>
        <button class="icon-btn burger" aria-label="메뉴 열기" data-open-nav><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7h18M3 12h18M3 17h18"/></svg></button>
      </div>
    </div></header>
    <div class="mobile-nav" id="mobileNav" aria-hidden="true">
      <button class="icon-btn close" aria-label="메뉴 닫기" data-close-nav><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
      <ul>${NAV.map(n => `<li><a href="${n.href}">${n.label}</a><ul class="sub">${n.sub.map(s => `<li><a href="${s[1]}">${s[0]}</a></li>`).join('')}</ul></li>`).join('')}
        <li><a href="/login/">로그인</a></li></ul>
    </div>`;
  }

  function footer() {
    return `<footer class="footer"><div class="container">
      <div class="cols">
        <div>${brand(true)}
          <p style="margin-top:22px;max-width:360px;line-height:1.8">서울대학교 경영대학 동문의 우의를 다지고 모교의 발전에 기여합니다.<br>08826 서울특별시 관악구 관악로 1 서울대학교 경영대학<br>Tel 02-880-0000 · alumni@snubusiness.com</p></div>
        <div><h4>About</h4><ul><li><a href="/about/#greeting">회장 인사말</a></li><li><a href="/about/#history">연혁</a></li><li><a href="/about/#bylaws">회칙</a></li><li><a href="/about/#officers">임원 · 조직</a></li><li><a href="/about/#office">사무국 안내</a></li></ul></div>
        <div><h4>Connect</h4><ul><li><a href="/news/">소식</a></li><li><a href="/events/">행사</a></li><li><a href="/members/#directory">동문 찾기</a></li><li><a href="/members/#mentoring">멘토링</a></li><li><a href="/media/#newsletter">동문회보</a></li></ul></div>
        <div><h4>Support</h4><ul><li><a href="/giving/#dues">동문회비 납부</a></li><li><a href="/giving/#scholarship">장학사업</a></li><li><a href="/giving/#donate">기부 안내</a></li><li><a href="/media/#forms">서식 다운로드</a></li><li><a href="/admin/">Workbench</a></li></ul></div>
      </div>
      <div class="legal"><div><a href="/privacy/">개인정보처리방침</a><a href="/terms/">이용약관</a><a href="/email-policy/">이메일무단수집거부</a></div>
      <div>© ${new Date().getFullYear()} SNU Business Alumni Association. All rights reserved.</div></div>
    </div></footer>`;
  }

  function mount() {
    const h = document.getElementById('site-header'); if (h) h.innerHTML = header();
    const f = document.getElementById('site-footer'); if (f) f.innerHTML = footer();
    document.querySelectorAll('[data-seal]').forEach(el => { el.innerHTML = SEAL; });
    const mn = document.getElementById('mobileNav');
    document.querySelectorAll('[data-open-nav]').forEach(b => b.addEventListener('click', () => { mn.classList.add('open'); mn.setAttribute('aria-hidden', 'false'); }));
    document.querySelectorAll('[data-close-nav]').forEach(b => b.addEventListener('click', () => { mn.classList.remove('open'); mn.setAttribute('aria-hidden', 'true'); }));
    // reveal on scroll
    const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
    // subnav active by hash
    const sync = () => { document.querySelectorAll('.subnav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === location.hash || (!location.hash && a.dataset.default !== undefined))); };
    window.addEventListener('hashchange', sync); sync();
  }

  window.SNU = { NAV, SEAL,
    fmtDate(s) { const d = new Date(s); if (isNaN(d)) return s; return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; },
    async json(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); },
    esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
