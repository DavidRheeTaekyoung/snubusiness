/* KO ⇄ EN — 사전 기반 런타임 번역. site.js보다 먼저 로드. */
(function () {
  const KEY = 'snu_lang';
  const q = (location.search.match(/[?&]lang=(en|ko)/) || [])[1];
  let lang = q || (function () { try { return localStorage.getItem(KEY); } catch (e) { return null; } })() || 'ko';
  if (q) { try { localStorage.setItem(KEY, q); } catch (e) {} }
  window.SNU_LANG = lang;
  const html = document.documentElement;
  html.lang = lang;
  let dict = null;
  const norm = s => s.replace(/\s+/g, ' ').trim();
  function tr(s) {
    if (!dict || !s) return null;
    const k = norm(s); if (!k) return null;
    const v = dict[k]; if (v === undefined) return null;
    const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
    return lead + v + trail;
  }
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function walk(root) {
    if (!root || lang !== 'en' || !dict) return;
    if (root.nodeType === 3) { apply(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && (root.tagName === 'SCRIPT' || root.tagName === 'STYLE')) return;
    if (root.nodeType === 1) attrs(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const texts = []; let n;
    while ((n = it.nextNode())) {
      if (n.nodeType === 3) { const p = n.parentNode; if (p && p.tagName !== 'SCRIPT' && p.tagName !== 'STYLE') texts.push(n); }
      else attrs(n);
    }
    texts.forEach(apply);
  }
  function apply(t) { if (t.__ko === undefined) t.__ko = t.nodeValue; const v = tr(t.__ko); if (v !== null && t.nodeValue !== v) t.nodeValue = v; }
  function attrs(el) { for (const a of ATTRS) { if (el.hasAttribute(a)) { const v = tr(el.getAttribute(a)); if (v !== null) el.setAttribute(a, v); } } }
  function translateAll() {
    walk(document.body);
    const t = document.querySelector('title'); if (t) { const v = tr(t.textContent); if (v !== null) t.textContent = v; }
    document.querySelectorAll('meta[name="description"],meta[property="og:title"],meta[property="og:description"]').forEach(m => { const v = tr(m.getAttribute('content') || ''); if (v !== null) m.setAttribute('content', v); });
  }
  window.SNU_I18N = {
    get lang() { return lang; },
    set(l) { try { localStorage.setItem(KEY, l); } catch (e) {} const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.toString(); },
    toggle() { this.set(lang === 'en' ? 'ko' : 'en'); },
    t(obj, field) { if (!obj) return ''; return (lang === 'en' && obj[field + '_en']) ? obj[field + '_en'] : (obj[field] ?? ''); },
    tr(s) { return tr(s) ?? s; },
    walk
  };
  if (lang !== 'en') return;
  html.classList.add('i18n-loading');
  const done = () => html.classList.remove('i18n-loading');
  fetch('/data/i18n.json', { cache: 'force-cache' }).then(r => r.json()).then(d => {
    dict = d; delete dict._meta;
    const start = () => { translateAll(); done();
      new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(walk); if (m.type === 'characterData') apply(m.target); })).observe(document.body, { childList: true, subtree: true, characterData: true }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }).catch(done);
  setTimeout(done, 3000);
})();
