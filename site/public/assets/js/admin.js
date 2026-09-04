/* Workbench shell — 책상 위의 서가 */
(function () {
  const MENU = [
    { group: '작업대', items: [ ['', '대시보드', '⌂'] ] },
    { group: '서가 · 매뉴얼', items: [
      ['research', '리서치', '1'], ['overview', '개발개요 · 마스터플랜', '2'], ['data', '데이터정의', '3'], ['dataflow', '데이터흐름도', '4'] ] },
    { group: '협업 · 품질', items: [
      ['discussion', '개발자토론', '5'], ['inspection', '자율점검', '6'], ['history', '개발이력', '7'] ] },
  ];
  const seg = location.pathname.replace(/^\/admin\/?/, '').split('/')[0];

  function side() {
    return `<aside class="admin-side">
      <a class="brand" href="/admin/"><span class="seal" style="color:#DCC392;width:38px;height:38px">${SNU.SEAL}</span><span class="name"><span class="ko">경영대 총동문회 Workbench</span><span class="en">snubusiness.com</span></span></a>
      <nav>${MENU.map(g => `<div class="group">${g.group}</div>${g.items.map(i => `<a href="/admin/${i[0] ? i[0] + '/' : ''}" class="${seg === i[0] ? 'active' : ''}"><span class="n">${i[2]}</span>${i[1]}</a>`).join('')}`).join('')}
        <div class="group">바로가기</div>
        <a href="/" target="_blank"><span class="n">↗</span>공개 홈페이지</a>
        <a href="https://github.com/DavidRheeTaekyoung/snubusiness" target="_blank" rel="noopener"><span class="n">↗</span>GitHub 저장소</a>
      </nav>
      <div class="foot">이 작업대는 개발 에이전트(Claude)의 책상입니다. 개발자토론에 남긴 글은 에이전트가 다음 세션에서 읽고 반영합니다.<br><span id="wb-status" style="color:var(--gold-300)">·</span></div>
    </aside>`;
  }

  async function renderDoc(el, url) {
    try {
      const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(r.status);
      const md = await r.text();
      marked.setOptions({ gfm: true, breaks: false });
      const renderer = new marked.Renderer();
      const origCode = renderer.code.bind(renderer);
      renderer.code = function (token) {
        const code = typeof token === 'string' ? token : token.text; const lang = typeof token === 'string' ? arguments[1] : token.lang;
        if (lang === 'mermaid') return `<pre class="mermaid">${code.replace(/</g,'&lt;')}</pre>`;
        return origCode(token, lang);
      };
      el.innerHTML = marked.parse(md, { renderer });
      // TOC
      const toc = document.getElementById('toc');
      if (toc) { const hs = el.querySelectorAll('h2'); toc.innerHTML = [...hs].map((h, i) => { h.id = h.id || 'sec-' + i; return `<a href="#${h.id}">${h.textContent}</a>`; }).join(''); }
      if (window.mermaid) { mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { primaryColor: '#F3EAD3', primaryBorderColor: '#B8952E', primaryTextColor: '#0B1F3A', lineColor: '#6B7280', secondaryColor: '#E4ECF7', tertiaryColor: '#F7F4EE', fontFamily: 'Noto Sans KR, sans-serif', fontSize: '13px' }, flowchart: { curve: 'basis', htmlLabels: true } }); await mermaid.run({ nodes: el.querySelectorAll('.mermaid') }); }
    } catch (e) { el.innerHTML = `<div class="empty">문서를 불러오지 못했습니다: ${url} (${e.message})</div>`; }
  }

  function toast(msg) { let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2600); }

  async function api(path, opt = {}) {
    const r = await fetch('/api' + path, { headers: { 'content-type': 'application/json' }, ...opt, body: opt.body ? JSON.stringify(opt.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status, data: j });
    return j;
  }

  async function health() {
    const el = document.getElementById('wb-status'); if (!el) return;
    try { const h = await api('/health'); el.textContent = h.db ? '● D1 연결됨 · ' + h.version : '○ D1 미연결 · ' + h.version; el.style.color = h.db ? '#8FD3A6' : '#E5B96A'; }
    catch (e) { el.textContent = '○ API 오프라인 (정적 미리보기)'; el.style.color = '#E5B96A'; }
  }

  function mount() {
    const s = document.getElementById('admin-side'); if (s) s.outerHTML = side();
    document.querySelectorAll('[data-doc]').forEach(el => renderDoc(el, el.dataset.doc));
    health();
  }
  window.WB = { api, toast, renderDoc, fmt(ts) { const d = new Date(ts); return isNaN(d) ? ts : d.toLocaleString('ko-KR', { hour12: false }); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
