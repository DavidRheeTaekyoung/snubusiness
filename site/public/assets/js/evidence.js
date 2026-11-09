/* 증빙(evidence) 공용 — 거래(ledger)·수동 분개(journal)에 붙는 파일/링크 증빙의 표시(배지 + 호버 팝업)와 추가·삭제.
   회비 정산 · 분개장 · 자금 페이지가 같이 쓴다. 번호(2026-0153)로 관리한다. 이모지 없이 단순 기호만. */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let list = [], me = '', role = '', canUpload = false, onChange = null, pinned = null, hideT = null;
  const css = `
.ev-badge{font:inherit;font-size:12px;line-height:1;padding:3px 7px;border:1px solid var(--line-2,#ddd);background:var(--paper,#fff);color:var(--ink-3,#777);border-radius:999px;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums}
.ev-badge.has{border-color:var(--navy-800,#1B2A4A);color:var(--navy-800,#1B2A4A);background:#EEF2F8;font-weight:600}
.ev-badge:hover{border-color:var(--gold-500,#B8952E)}
#ev-pop{position:absolute;z-index:1200;width:320px;max-width:calc(100vw - 24px);background:var(--paper,#fff);border:1px solid var(--line-2,#ddd);box-shadow:0 10px 30px rgba(0,0,0,.14);border-radius:4px;font-size:13px;color:var(--ink,#222);display:none}
#ev-pop.on{display:block}
#ev-pop .h{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--line,#eee);background:var(--ivory,#FAF7F0)}
#ev-pop .h b{font-family:var(--mono,monospace);font-size:12.5px;color:var(--navy-800,#1B2A4A)}
#ev-pop .h span{color:var(--ink-3,#777);font-size:12px}
#ev-pop .it{display:grid;grid-template-columns:64px 1fr auto;gap:10px;padding:9px 12px;border-bottom:1px solid var(--line,#eee);align-items:center}
#ev-pop .it .th{width:64px;height:64px;object-fit:cover;border:1px solid var(--line,#eee);background:#f6f6f6;display:block}
#ev-pop .it .ph{width:64px;height:64px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line,#eee);background:var(--ivory,#FAF7F0);color:var(--ink-3,#777);font-size:11px;letter-spacing:.06em;font-weight:600}
#ev-pop .it .nm{font-weight:500;word-break:break-all;line-height:1.35}
#ev-pop .it .sub{color:var(--ink-3,#777);font-size:11.5px;margin-top:3px;line-height:1.4}
#ev-pop .it a.open{font:inherit;font-size:12px;padding:4px 9px;border:1px solid var(--line-2,#ddd);border-radius:999px;color:var(--navy-800,#1B2A4A);text-decoration:none;white-space:nowrap}
#ev-pop .it button.del{font:inherit;font-size:11px;padding:2px 6px;border:0;background:none;color:var(--ink-3,#777);cursor:pointer;margin-top:4px;text-decoration:underline}
#ev-pop .f{display:flex;gap:6px;padding:9px 12px;flex-wrap:wrap}
#ev-pop .f button{font:inherit;font-size:12px;padding:5px 10px;border:1px solid var(--line-2,#ddd);background:var(--paper,#fff);border-radius:999px;cursor:pointer;color:var(--ink-2,#444)}
#ev-pop .f button:hover{border-color:var(--navy-800,#1B2A4A);color:var(--navy-800,#1B2A4A)}
#ev-pop .none{padding:14px 12px;color:var(--ink-3,#777)}
#ev-modal{position:fixed;inset:0;background:rgba(20,20,30,.45);z-index:1300;display:none;align-items:center;justify-content:center;padding:16px}
#ev-modal.on{display:flex}
#ev-modal .box{background:var(--paper,#fff);width:440px;max-width:100%;border-radius:4px;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,.3)}
#ev-modal h3{margin:0 0 4px;font-size:17px}
#ev-modal .no{font-family:var(--mono,monospace);font-size:12.5px;color:var(--ink-3,#777);margin-bottom:14px}
#ev-modal label{display:block;font-size:12.5px;color:var(--ink-3,#777);margin:10px 0 4px}
#ev-modal input{font:inherit;font-size:14px;padding:9px 10px;border:1px solid var(--line-2,#ddd);border-radius:2px;width:100%;background:var(--paper,#fff)}
#ev-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;align-items:center}
#ev-modal .row .msg{margin-right:auto;font-size:12.5px;color:var(--ink-3,#777)}
#ev-modal .tabs{display:flex;gap:4px;margin-bottom:6px}
#ev-modal .tabs button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid var(--line-2,#ddd);background:var(--paper,#fff);cursor:pointer;border-radius:2px}
#ev-modal .tabs button.on{background:var(--navy-800,#1B2A4A);color:#fff;border-color:var(--navy-800,#1B2A4A)}
`;
  function mount() {
    if (document.getElementById('ev-pop')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const pop = document.createElement('div'); pop.id = 'ev-pop'; document.body.appendChild(pop);
    const md = document.createElement('div'); md.id = 'ev-modal'; document.body.appendChild(md);
    pop.addEventListener('mouseenter', () => clearTimeout(hideT)); pop.addEventListener('mouseleave', () => { if (!pinned) hideSoon(); });
    document.addEventListener('mouseover', e => { const b = e.target.closest('.ev-badge'); if (b && !pinned) show(b); });
    document.addEventListener('mouseout', e => { const b = e.target.closest('.ev-badge'); if (b && !pinned) hideSoon(); });
    document.addEventListener('click', e => {
      const b = e.target.closest('.ev-badge');
      if (b) { e.preventDefault(); if (pinned === b) { pinned = null; hide(); } else { pinned = b; show(b); } return; }
      if (e.target.closest('#ev-pop')) return;
      if (pinned) { pinned = null; hide(); }
    });
    pop.addEventListener('click', async e => {
      const d = e.target.closest('[data-ev-del]'); if (d) { if (!confirm('이 증빙을 삭제할까요?')) return; try { await WB.api('/treasury?r=evidence&id=' + d.dataset.evDel, { method: 'DELETE' }); WB.toast('증빙을 삭제했습니다'); await load(); refresh(); } catch (err) { WB.toast('실패: ' + err.message); } return; }
      const a = e.target.closest('[data-ev-add]'); if (a) { openAdd(pop.dataset.kind, Number(pop.dataset.id), pop.dataset.no, pop.dataset.label, a.dataset.evAdd); }
    });
    md.addEventListener('click', e => { if (e.target === md) md.classList.remove('on'); });
  }
  const hideSoon = () => { clearTimeout(hideT); hideT = setTimeout(hide, 220); };
  const hide = () => { document.getElementById('ev-pop').classList.remove('on'); };
  const of = (kind, id) => list.filter(x => x.ref_kind === kind && x.ref_id === Number(id));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const fileUrl = x => '/api/treasury?r=file&id=' + x.id;
  const when = ts => (ts || '').replace('T', ' ').slice(0, 16);
  const canDel = x => role === 'owner' || role === 'agent' || x.created_by === me;
  function item(x) {
    const isImg = x.kind === 'file' && /^image\//.test(x.mime), isPdf = x.kind === 'file' && x.mime === 'application/pdf';
    const url = x.kind === 'link' ? x.url : fileUrl(x);
    const th = isImg ? `<a href="${url}" target="_blank" rel="noopener"><img class="th" src="${url}" alt="" loading="lazy"></a>` : `<a href="${url}" target="_blank" rel="noopener" class="ph">${isPdf ? 'PDF' : x.kind === 'link' ? 'LINK' : 'FILE'}</a>`;
    const sub = [x.kind === 'link' ? host(x.url) : (x.size ? (x.size / 1024).toFixed(0) + ' KB' : ''), x.note, (x.created_by || '') + ' · ' + when(x.created_at)].filter(Boolean).join(' · ');
    return `<div class="it">${th}<div><div class="nm">${esc(x.name || (x.kind === 'link' ? host(x.url) : '파일'))}</div><div class="sub">${esc(sub)}</div>${canDel(x) ? `<button class="del" data-ev-del="${x.id}">삭제</button>` : ''}</div><a class="open" href="${url}" target="_blank" rel="noopener">열기 ↗</a></div>`;
  }
  function show(b) {
    clearTimeout(hideT); const pop = document.getElementById('ev-pop');
    const kind = b.dataset.evKind, id = b.dataset.evId, no = b.dataset.evNo || '', label = b.dataset.evLabel || '';
    Object.assign(pop.dataset, { kind, id, no, label });
    const items = of(kind, id);
    pop.innerHTML = `<div class="h"><b>${esc(no)}</b><span>${esc(label).slice(0, 28)}${items.length ? ' · 증빙 ' + items.length + '건' : ''}</span></div>` + (items.map(item).join('') || '<div class="none">아직 증빙이 없습니다. 주요 거래와 이체 건 위주로 올리면 됩니다.</div>') + (canUpload ? '<div class="f"><button data-ev-add="file">+ 파일 (PDF·이미지)</button><button data-ev-add="link">+ 링크</button></div>' : '');
    pop.classList.add('on');
    const r = b.getBoundingClientRect(); const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.left + window.scrollX - w + r.width; if (left < 8) left = 8; if (left + w > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - w - 8;
    let top = r.bottom + window.scrollY + 6; if (r.bottom + h + 12 > window.innerHeight && r.top - h - 6 > 0) top = r.top + window.scrollY - h - 6;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function refresh() { if (pinned && document.body.contains(pinned)) show(pinned); else { pinned = null; hide(); } if (onChange) onChange(); }
  async function load() { try { const d = await WB.api('/treasury?r=evidence'); list = d.evidence || []; me = d.me || ''; role = d.role || ''; } catch (e) { list = []; } return list; }
  function badge(kind, id, no, label) { const n = of(kind, id).length; return `<button type="button" class="ev-badge ${n ? 'has' : ''}" data-ev-kind="${kind}" data-ev-id="${id}" data-ev-no="${esc(no)}" data-ev-label="${esc(label || '')}" title="${n ? '증빙 ' + n + '건 — 올려 놓으면 보임' : '증빙 없음 — 클릭해서 추가'}">${n ? '▣ ' + n : '▢'}</button>`; }
  // 이미지는 브라우저에서 긴 변 1600px JPEG 로 축소, PDF 는 그대로 (2MB 제한)
  function shrink(file) {
    return new Promise((res, rej) => { const img = new Image(); const u = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(u); const m = 1600, sc = Math.min(1, m / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => b ? res(b) : rej(new Error('이미지 변환 실패')), 'image/jpeg', 0.85); }; img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('이미지를 읽지 못했습니다')); }; img.src = u; });
  }
  async function upload(kind, id, file, note) {
    let blob = file, name = file.name, mime = file.type;
    if (/^image\//.test(file.type) && file.type !== 'image/gif') { blob = await shrink(file); mime = 'image/jpeg'; name = name.replace(/\.[^.]+$/, '') + '.jpg'; }
    if (!/^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(mime)) throw new Error('PDF 또는 이미지만 올릴 수 있습니다');
    if (blob.size > 2_000_000) throw new Error('2MB 를 넘습니다 (' + (blob.size / 1048576).toFixed(1) + 'MB)');
    const r = await fetch('/api/treasury', { method: 'POST', headers: { 'content-type': mime, 'x-ref-kind': kind, 'x-ref-id': String(id), 'x-filename': encodeURIComponent(name), 'x-note': encodeURIComponent(note || '') }, body: blob });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  }
  function openAdd(kind, id, no, label, tab) {
    const md = document.getElementById('ev-modal'); tab = tab || 'file';
    md.innerHTML = `<div class="box"><h3>증빙 추가</h3><div class="no">${esc(no)} · ${esc(label || '')}</div>
      <div class="tabs"><button data-t="file" class="${tab === 'file' ? 'on' : ''}">파일 (PDF·이미지)</button><button data-t="link" class="${tab === 'link' ? 'on' : ''}">외부 링크</button></div>
      <div data-p="file" ${tab === 'file' ? '' : 'hidden'}><label>파일 — 영수증·이체확인증 PDF 또는 사진 (이미지는 자동 축소, 2MB 이하)</label><input type="file" id="ev-file" accept="application/pdf,image/*"></div>
      <div data-p="link" ${tab === 'link' ? '' : 'hidden'}><label>링크 URL — 인터넷뱅킹 거래내역 캡처가 있는 드라이브 링크, 전자영수증 주소 등</label><input id="ev-url" placeholder="https://"><label>표시 이름 (비우면 도메인)</label><input id="ev-name" placeholder="예: 11/27 송년회 대관료 이체확인증"></div>
      <label>메모</label><input id="ev-note" placeholder="예: 통장 사본 3쪽, 비서 계좌 이체">
      <div class="row"><span class="msg" id="ev-msg"></span><button class="btn sm ghost" type="button" id="ev-cancel">취소</button><button class="btn sm" type="button" id="ev-ok">저장</button></div></div>`;
    md.classList.add('on');
    md.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; tab = b.dataset.t; md.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); md.querySelectorAll('[data-p]').forEach(p => p.hidden = p.dataset.p !== tab); });
    md.querySelector('#ev-cancel').onclick = () => md.classList.remove('on');
    md.querySelector('#ev-ok').onclick = async () => {
      const msg = md.querySelector('#ev-msg'); const note = md.querySelector('#ev-note').value;
      try {
        msg.textContent = '저장 중…';
        if (tab === 'file') { const f = md.querySelector('#ev-file').files[0]; if (!f) throw new Error('파일을 선택해 주세요'); await upload(kind, id, f, note); }
        else { await WB.api('/treasury', { method: 'POST', body: { r: 'link', ref_kind: kind, ref_id: id, url: md.querySelector('#ev-url').value.trim(), name: md.querySelector('#ev-name').value, note } }); }
        md.classList.remove('on'); WB.toast('증빙을 추가했습니다'); await load(); refresh();
      } catch (err) { msg.textContent = '실패: ' + err.message; }
    };
  }
  window.EV = { load, badge, of, openAdd, setup(o) { mount(); canUpload = !!o.canUpload; onChange = o.onChange || null; }, get list() { return list; }, host, fileUrl, when };
})();
