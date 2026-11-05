// ==UserScript==
// @name         EduRank — Jana Gambar (Gemini + ChatGPT)
// @namespace    https://bijakmulia.github.io/student-manager/
// @version      2.0
// @description  Baca senarai prompt aset EduRank (PROMPT-ASET.txt) dan jana gambar satu demi satu di Gemini ATAU ChatGPT (dikesan automatik). Progres disimpan — boleh sambung selepas gagal, muat semula atau tukar laman.
// @match        https://gemini.google.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/* Cara guna
   1. Matikan skrip lama "EduRank — Jana Gambar Gemini" di Tampermonkey (skrip ini menggantikannya).
   2. Buka Gemini ATAU ChatGPT (log masuk dahulu). Ketik butang 🎨 di bucu kanan bawah.
   3. Pilih senarai (cth. "Dunia Ilmu") → "Muat dari EduRank". Atau tampal prompt sendiri berformat "### nama.png".
   4. Tekan "▶▶ Mula / Sambung". Skrip menjana semua yang belum siap, satu demi satu, dan menyimpan sebagai
      "edurank__<folder>__<nama>.png" dalam Downloads. Auto-push memindahkannya ke assets\<folder> dan memprosesnya.
   5. PROGRES DISIMPAN. Tutup tab, muat semula, atau tukar antara Gemini ↔ ChatGPT: tekan "Sambung" (atau ia
      menyambung sendiri jika barisan sedang berjalan). Gambar yang gagal dilangkau dan boleh dicuba semula kemudian.
      Progres hanya hilang jika skrip ini dipadam/ditampal baru — guna "Salin progres" untuk simpan salinan dahulu.
   Petua: di Edge/Chrome matikan "Ask where to save each file" supaya simpan tanpa ditanya. */

(function () {
  'use strict';
  const SITE = 'https://bijakmulia.github.io/student-manager/';
  const LISTS = {
    dunia:  { n: 'Dunia Ilmu (70 aset)',  url: SITE + 'assets/dunia/PROMPT-ASET.txt' },
    stor:   { n: 'Simulasi Stor Sukan',   url: SITE + 'assets/stor/PROMPT-ASET.txt' },
    klinik: { n: 'Klinik Remaja',         url: SITE + 'assets/klinik/PROMPT-ASET.txt' },
    kad:    { n: 'Kad Ilmon (k01–k96)',   url: SITE + 'assets/kad/PROMPT-KAD.txt' },
    seram:  { n: 'Muka Hantu (Seram)',    url: SITE + 'assets/seram/PROMPT-SERAM.txt' },
    taikun: { n: 'Taikun Ilmu',           url: SITE + 'assets/taikun/PROMPT-TAIKUN.txt' }
  };
  const K = { list: 'ej_list', folder: 'ej_folder', done: 'ej_done', fail: 'ej_fail', run: 'ej_run', opt: 'ej_opt', tpl: 'ej_tpl', lock: 'ej_lock', pend: 'ej_pend' };
  const get = (k, d) => { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (e) {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const TAB = Math.random().toString(36).slice(2);

  /* ---------- penghurai prompt ---------- */
  // Menerima "### nama.png", "1. nama.png   [nisbah ...]" atau "nama.png" pada baris sendiri, diikuti teks prompt.
  function parse(txt) {
    const lines = String(txt || '').replace(/\r/g, '').split('\n'), out = [];
    let cur = null;
    const head = l => { const m = l.match(/^\s*(?:###\s*|\d+\.\s+)?([a-z0-9_]+)\.png\b/i); return m && (/^\s*(###|\d+\.)/.test(l) || /^\s*[a-z0-9_]+\.png\s*$/i.test(l)) ? m[1].toLowerCase() : null; };
    for (const l of lines) {
      const h = head(l);
      if (h) { cur = { name: h, text: '' }; out.push(cur); continue; }
      if (!cur) continue;
      if (/^(=+|-+)\s.*\s(=+|-+)$/.test(l.trim())) { cur = null; continue; }      // tajuk bahagian dalam PROMPT-ASET.txt
      cur.text += (cur.text ? '\n' : '') + l;
    }
    return out.map(p => {
      let t = p.text.trim(); const tpl = (t.match(/templat_[a-z0-9_]+\.png/i) || [])[0] || '';
      t = t.replace(/LAMPIRKAN templat \S+?\.png\.?\s*/i, '').trim();               // arahan untuk guru — tidak dihantar
      return { name: p.name, text: t, tpl: tpl.toLowerCase() };
    }).filter(p => p.text);
  }

  /* ---------- penyesuai laman ---------- */
  const ID = window.__EJG_SITE || (/gemini\.google/.test(location.hostname) ? 'gemini' : 'chatgpt');
  const ADAPT = {
    gemini: {
      name: 'Gemini', home: 'https://gemini.google.com/app', prefix: 'Create an image: ',
      isHome: () => /\/app\/?$/.test(location.pathname),
      editor: () => $('rich-textarea .ql-editor') || $('div.ql-editor[contenteditable="true"]') || $('[contenteditable="true"][role="textbox"]') || $('rich-textarea [contenteditable="true"]'),
      send: () => $$('button').find(b => /send|hantar/i.test((b.getAttribute('aria-label') || '') + ' ' + b.className) && !b.disabled && b.offsetParent),
      busy: () => $$('button').some(b => /stop|henti/i.test(b.getAttribute('aria-label') || '') && b.offsetParent),
      imgs: () => $$('model-response img, .model-response img, generated-image img, single-image img').filter(im => /^https?:|^blob:/.test(im.src) && im.naturalWidth >= 256),
      lastText: () => { const r = $$('model-response, .model-response'); return r.length ? r[r.length - 1].innerText : ''; }
    },
    chatgpt: {
      name: 'ChatGPT', home: 'https://chatgpt.com/', prefix: 'Generate this image right away — no questions, no commentary: ',
      isHome: () => location.pathname === '/',
      editor: () => $('#prompt-textarea') || $('div.ProseMirror[contenteditable="true"]') || $('textarea[name="prompt-textarea"]') || $('form [contenteditable="true"]') || $('form textarea'),
      send: () => $('button[data-testid="send-button"]:not([disabled])') || $$('button').find(b => /send (prompt|message)|hantar/i.test(b.getAttribute('aria-label') || '') && !b.disabled && b.offsetParent),
      busy: () => !!($('button[data-testid="stop-button"]') || $$('button').find(b => /stop (streaming|generating)|henti/i.test(b.getAttribute('aria-label') || '') && b.offsetParent)),
      imgs: () => $$('main img').filter(im => !im.closest('[data-message-author-role="user"]') && !/avatar|profile/i.test(im.src + ' ' + im.alt) && im.naturalWidth >= 256 && /^https?:|^blob:/.test(im.src)),
      lastText: () => { const r = $$('[data-message-author-role="assistant"]'); return r.length ? r[r.length - 1].innerText : ''; }
    }
  };
  const A = () => ADAPT[ID];
  const HOME = () => window.__EJG_HOME || A().home;
  const isHome = () => window.__EJG_HOME ? location.href.split('#')[0] === window.__EJG_HOME : A().isHome();   // __EJG_*: cangkuk ujian sahaja
  const IDLE = window.__EJG_IDLE || 30000, RESUME = window.__EJG_RESUME || 4500;
  const LIMIT_RX = /(reached|hit|exceeded).{0,50}limit|usage limit|too many (requests|images)|try again (later|in|after|tomorrow)|image generation.{0,40}(limit|unavailable)|had (penjanaan|jana)|terlalu banyak|cuba lagi (nanti|selepas)/i;

  /* ---------- keadaan ---------- */
  let list = get(K.list, []), folder = get(K.folder, 'dunia'), done = get(K.done, {}), fail = get(K.fail, {}), pend = get(K.pend, {});
  let opt = Object.assign({ auto: true, newChat: true, cont: true, prefix: true, gap: 8, pre: '', dir: true }, get(K.opt, {}));
  const tplCache = {};
  let running = null, looping = false, stopReq = false, lastStatus = '', draft = '';
  const save = () => { set(K.list, list); set(K.folder, folder); set(K.done, done); set(K.fail, fail); set(K.pend, pend); set(K.opt, opt); };
  const dk = n => folder + '/' + n;

  /* ---------- UI (tanpa innerHTML: laman ini menyekat Trusted Types) ---------- */
  GM_addStyle(`
  #ejBtn{position:fixed;right:18px;bottom:96px;z-index:2147483000;width:52px;height:52px;border-radius:50%;border:0;background:#FF6B00;color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}
  #ejPan{position:fixed;right:18px;bottom:156px;z-index:2147483000;width:430px;max-width:96vw;max-height:78vh;display:none;flex-direction:column;background:#0F172A;color:#E2E8F0;border:2px solid #FF6B00;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.35 system-ui,sans-serif}
  #ejPan.on{display:flex}
  #ejPan .hd{padding:10px 12px;font-weight:800;display:flex;align-items:center;gap:8px;border-bottom:1px solid #334155}
  #ejPan .hd span{margin-left:auto;font-weight:600;font-size:11px;color:#94A3B8}
  #ejPan .site{font-size:11px;background:#16A34A;color:#fff;border-radius:99px;padding:1px 8px;font-weight:700}
  #ejPan .bd{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
  #ejPan select,#ejPan textarea,#ejPan input[type=text],#ejPan input[type=number],#ejPan button{font:inherit}
  #ejPan select,#ejPan textarea,#ejPan input[type=text],#ejPan input[type=number]{background:#1E293B;color:#E2E8F0;border:1px solid #334155;border-radius:8px;padding:5px 6px}
  #ejPan textarea{height:64px;resize:vertical}
  #ejPan .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  #ejPan .b{background:#1E293B;color:#E2E8F0;border:1px solid #475569;border-radius:8px;padding:6px 10px;cursor:pointer}
  #ejPan .b.o{background:#FF6B00;border-color:#FF6B00;color:#fff;font-weight:700}
  #ejPan .b.r{background:#B91C1C;border-color:#B91C1C;color:#fff}
  #ejPan .b:disabled{opacity:.4;cursor:default}
  #ejPan label.ck{display:flex;gap:5px;align-items:center;font-size:12px}
  #ejPan .lst{border:1px solid #334155;border-radius:8px;max-height:32vh;overflow:auto}
  #ejPan .it{display:flex;gap:6px;align-items:center;padding:4px 7px;border-bottom:1px solid #1E293B}
  #ejPan .it:hover{background:#1E293B}
  #ejPan .it .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px}
  #ejPan .it .go{background:#16A34A;border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
  #ejPan .it .go:disabled{opacity:.35}
  #ejPan .it.now{background:#422006}
  #ejPan .it.bad .nm{color:#FCA5A5}
  #ejPan .st{font-size:12px;color:#FDE68A;min-height:16px;white-space:pre-wrap}
  #ejPan .bar{height:8px;background:#1E293B;border-radius:5px;overflow:hidden}
  #ejPan .bar i{display:block;height:100%;background:#22C55E}
  `);
  const btn = document.createElement('button'); btn.id = 'ejBtn'; btn.textContent = '🎨'; btn.title = 'EduRank — Jana Gambar (Gemini + ChatGPT)';
  const pan = document.createElement('div'); pan.id = 'ejPan';
  document.body.append(btn, pan);
  btn.onclick = () => { pan.classList.toggle('on'); paint(); };

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v === false || v == null) return; if (k === 'cls') e.className = v; else if (k === 'text') e.textContent = v; else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v); });
    kids.flat().forEach(k => { if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k))); });
    return e;
  }
  const status = t => { lastStatus = t; const s = $('#ejSt'); if (s) s.textContent = t; console.log('[EduRank]', t); };
  const counts = () => { const nd = list.filter(p => done[dk(p.name)]).length, nf = list.filter(p => !done[dk(p.name)] && fail[dk(p.name)]).length, np = list.filter(p => done[dk(p.name)] && pend[dk(p.name)]).length; return { nd, nf, np, n: list.length }; };
  const queued = () => { const st = get(K.run, null); return st && st.q ? st.q.length : 0; };

  function paint() {
    if (!pan.classList.contains('on')) return;
    const c = counts(), pct = c.n ? Math.round(c.nd / c.n * 100) : 0, q = queued();
    const B = (id, txt, cls, dis) => el('button', { cls: 'b' + (cls ? ' ' + cls : ''), id, disabled: !!dis }, txt);
    const CK = (id, on, txt) => el('label', { cls: 'ck' }, el('input', { type: 'checkbox', id, checked: !!on }), txt);
    const rows = list.length ? list.map((p, i) => {
      const d = done[dk(p.name)], f = fail[dk(p.name)], now = running === p.name;
      return el('div', { cls: 'it' + (now ? ' now' : '') + (!d && f ? ' bad' : '') },
        el('span', { text: d ? (pend[dk(p.name)] ? '⚠️' : '✅') : now ? '⏳' : f ? '❌' : '⬜' }),
        el('span', { cls: 'nm', title: (f && !d ? f.msg + ' — ' : '') + (d && pend[dk(p.name)] ? 'Belum disahkan disimpan (dialog Simpan Sebagai?) — ' : '') + p.text, text: p.name + '.png' }),
        el('button', { cls: 'go', 'data-g': String(i), disabled: !!(looping || running), title: 'Jana yang ini sahaja' }, '▶'));
    }) : [el('div', { cls: 'it', text: 'Belum ada senarai — tekan "Muat dari EduRank".' })];
    pan.replaceChildren(
      el('div', { cls: 'hd' }, '🎨 EduRank · Jana Gambar', el('span', { cls: 'site', text: A().name }), el('span', { text: c.nd + '/' + c.n + ' siap' + (c.nf ? ' · ' + c.nf + ' gagal' : '') + (c.np ? ' · ' + c.np + ' ⚠' : '') })),
      el('div', { cls: 'bd' },
        el('div', { cls: 'bar' }, el('i', { style: 'width:' + pct + '%' })),
        el('div', { cls: 'row' }, el('select', { id: 'ejF' }, Object.keys(LISTS).map(k => el('option', { value: k, selected: k === folder }, LISTS[k].n))), B('ejLoad', '⬇ Muat dari EduRank')),
        el('div', { cls: 'row' },
          dirH && dirPerm === 'granted' ? el('span', { text: '📁 ' + dirH.name + ' ✓' }) : null,
          dirH && dirPerm !== 'granted' ? B('ejAllow', '🔓 Benarkan folder ' + dirH.name) : null,
          B('ejDir', dirH ? '📁 Tukar folder' : '📁 Pilih folder simpan (tanpa dialog)'),
          CK('ejO5', opt.dir, 'Simpan terus ke folder')),
        el('textarea', { id: 'ejTxt', placeholder: '…atau tampal prompt (### nama.png + prompt) → "Guna teks"; atau tampal progres JSON → "Import progres"', value: draft }),
        el('div', { cls: 'row' }, B('ejUse', 'Guna teks'), B('ejExp', 'Salin progres'), B('ejImp', 'Import progres')),
        el('div', { cls: 'lst' }, rows),
        el('div', { cls: 'row' }, CK('ejO1', opt.auto, 'Hantar automatik'), CK('ejO2', opt.newChat, 'Chat baharu setiap gambar'), CK('ejO3', opt.cont, 'Teruskan jika gagal'), CK('ejO4', opt.prefix, 'Awalan "jana gambar"')),
        el('div', { cls: 'row' }, 'Jeda (saat):', el('input', { type: 'number', id: 'ejGap', min: 0, max: 120, value: opt.gap, style: 'width:60px' }), 'Hanya bermula dengan:', el('input', { type: 'text', id: 'ejPre', value: opt.pre, placeholder: 'cth. bg_tex_, ico_', style: 'width:110px' })),
        el('div', { cls: 'row' }, B('ejGo', (q ? '▶▶ Sambung (' + q + ' lagi)' : '▶▶ Mula / Sambung'), 'o', looping), B('ejStop', '■ Henti', 'r', !looping), B('ejRetry', 'Cuba semula yang gagal', '', looping || !c.nf), B('ejRegen', 'Jana semula ⚠ (' + c.np + ')', '', looping || !c.np), B('ejReset', 'Set semula ✅', '', looping)),
        el('div', { cls: 'st', id: 'ejSt', text: lastStatus })));
  }
  pan.addEventListener('input', e => { if (e.target.id === 'ejTxt') draft = e.target.value; });
  pan.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'ejF') { folder = t.value; list = []; save(); paint(); dirLoad(); loadList(); return; }
    if (t.id === 'ejO5') { opt.dir = t.checked; save(); }
    if (t.id === 'ejO1') opt.auto = t.checked; if (t.id === 'ejO2') opt.newChat = t.checked; if (t.id === 'ejO3') opt.cont = t.checked; if (t.id === 'ejO4') opt.prefix = t.checked;
    if (t.id === 'ejGap') opt.gap = Math.max(0, Math.min(120, +t.value || 0));
    if (t.id === 'ejPre') opt.pre = t.value.trim();
    if (/^ej(O|Gap|Pre)/.test(t.id)) save();
  });
  pan.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'ejLoad') return loadList();
    if (b.id === 'ejUse') { const p = parse(draft); if (!p.length) return status('Tiada prompt dijumpai. Setiap prompt mesti bermula dengan baris "### nama.png".'); list = p; save(); paint(); return status(p.length + ' prompt dimuat dari teks.'); }
    if (b.id === 'ejExp') { GM_setClipboard(JSON.stringify({ v: 1, folder, done, fail })); return status('Progres disalin ke papan klip. Tampal & simpan di mana-mana fail teks.'); }
    if (b.id === 'ejImp') { try { const o = JSON.parse(draft); if (o.done) Object.assign(done, o.done); if (o.fail) Object.assign(fail, o.fail); save(); paint(); return status('Progres diimport (' + Object.keys(o.done || {}).length + ' siap).'); } catch (er) { return status('Teks bukan progres JSON yang sah.'); } }
    if (b.id === 'ejReset') { list.forEach(p => { delete done[dk(p.name)]; delete fail[dk(p.name)]; }); save(); return paint(); }
    if (b.id === 'ejStop') { stopReq = true; set(K.lock, null); return status('Akan berhenti selepas gambar ini… (progres disimpan; tekan Sambung nanti)'); }
    if (b.id === 'ejRetry') { list.forEach(p => { delete fail[dk(p.name)]; }); save(); return startQueue(false); }
    if (b.id === 'ejDir') return dirPick();
    if (b.id === 'ejAllow') return dirAllow();
    if (b.id === 'ejRegen') { list.forEach(p => { if (done[dk(p.name)] && pend[dk(p.name)]) { delete done[dk(p.name)]; delete pend[dk(p.name)]; } }); save(); return startQueue(false); }
    if (b.id === 'ejGo') return startQueue(false);
    if (b.dataset.g != null) return startQueue(list[+b.dataset.g].name);
  });

  function loadList() {
    status('Memuat senarai ' + LISTS[folder].n + '…');
    GM_xmlhttpRequest({ method: 'GET', url: LISTS[folder].url + '?t=' + Date.now(), onload: r => {
      const p = parse(r.responseText);
      if (!p.length) return status('Tiada prompt dijumpai dalam senarai itu (fail belum diterbitkan di laman?).');
      list = p; save(); paint(); status(p.length + ' prompt dimuat · ' + counts().nd + ' sudah siap.');
    }, onerror: () => status('Gagal memuat senarai — semak internet.') });
  }

  /* ---------- templat (jika prompt menyebut templat_xxx.png) ---------- */
  const b64Blob = d => { const [h, b] = d.split(','), m = h.match(/:(.*?);/)[1], s = atob(b), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: m }); };
  function getTpl(name) {
    const up = get(K.tpl, {}); if (up[name]) return Promise.resolve(b64Blob(up[name]));
    if (tplCache[name]) return Promise.resolve(tplCache[name]);
    return new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url: SITE + 'tools/template/' + name, responseType: 'blob',
      onload: r => r.status === 200 ? res(tplCache[name] = r.response) : rej(new Error('Templat ' + name + ' tiada di laman')), onerror: () => rej(new Error('Gagal muat ' + name)) }));
  }

  /* ---------- operasi laman ---------- */
  async function waitFor(fn, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; if (stopReq) return null; await sleep(step || 300); } return null; }
  async function setPrompt(text) {
    const ed = await waitFor(A().editor, 20000); if (!ed) throw new Error('Kotak prompt ' + A().name + ' tidak dijumpai (log masuk dahulu?)');
    ed.focus();
    if (ed.tagName === 'TEXTAREA' || ed.tagName === 'INPUT') {
      const setter = Object.getOwnPropertyDescriptor(ed.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
      setter.call(ed, text); ed.dispatchEvent(new Event('input', { bubbles: true })); await sleep(300); return;
    }
    document.execCommand('selectAll', false, null); document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    if (!ed.textContent.trim()) { ed.textContent = text; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    await sleep(400);
  }
  const chips = () => $$('uploader-file-preview, .file-preview-container img, [data-test-id*="file-preview"], .attachment-preview, [data-testid*="attachment"], [data-testid*="file-thumbnail"], img[src^="blob:"]').filter(x => !x.closest('model-response, [data-message-author-role]'));
  async function attach(blob, name) {
    const ed = A().editor(); if (!ed) throw new Error('Kotak prompt tidak dijumpai');
    const file = new File([blob], name, { type: blob.type || 'image/png' }), before = chips().length, dt = new DataTransfer(); dt.items.add(file);
    ed.focus(); ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    if (await waitFor(() => chips().length > before, 6000)) return;
    const inp = $$('input[type=file]').find(i => !i.disabled);
    if (inp) { const d2 = new DataTransfer(); d2.items.add(file); inp.files = d2.files; inp.dispatchEvent(new Event('change', { bubbles: true })); if (await waitFor(() => chips().length > before, 6000)) return; }
    for (const ev of ['dragenter', 'dragover', 'drop']) ed.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));
    if (await waitFor(() => chips().length > before, 6000)) return;
    throw new Error('Templat tidak dapat dilampir automatik — lampirkan ' + name + ' sendiri');
  }
  async function toPng(blob) {                       // pastikan PNG sebenar (ChatGPT kadangkala beri WebP) supaya auto-push dapat membacanya
    try { const bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); return await new Promise(r => c.toBlob(r, 'image/png')) || blob; } catch (e) { return blob; }
  }
  function fetchBlob(src) {
    const full = src.replace(/=s\d+(-[a-z-]+)?$/i, '=s0').replace(/=w\d+-h\d+(-[a-z-]+)?$/i, '=s0');
    return new Promise(async (res, rej) => {
      try { const u = new URL(full, location.href); if (u.origin === location.origin || u.protocol === 'blob:') { const r = await fetch(full, { credentials: 'include' }); if (r.ok) return res(await r.blob()); } } catch (e) { /* guna GM */ }
      GM_xmlhttpRequest({ method: 'GET', url: full, responseType: 'blob', onload: r => r.status === 200 && r.response ? res(r.response) : rej(new Error('Gagal muat turun gambar (' + r.status + ')')), onerror: () => rej(new Error('Gagal muat turun gambar')) });
    });
  }
  /* ---------- simpan terus ke folder projek (File System Access) — tiada dialog "Save As", tiada Downloads ---------- */
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('ej_dir', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbGet = async k => { try { const d = await idb(); return await new Promise(res => { const q = d.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } };
  const idbSet = async (k, v) => { try { const d = await idb(); await new Promise(res => { const t = d.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch (e) {} };
  let dirH = null, dirPerm = '';
  async function dirLoad() {
    dirH = (window.__EJG_DIRP ? await window.__EJG_DIRP : null) || await idbGet('dir:' + folder); dirPerm = '';
    if (dirH) { try { dirPerm = await dirH.queryPermission({ mode: 'readwrite' }); } catch (e) { dirPerm = 'denied'; } }
    paint();
  }
  async function dirPick() {
    try {
      const h = await window.showDirectoryPicker({ id: 'ej_' + folder, mode: 'readwrite' }); await idbSet('dir:' + folder, h); dirH = h;
      dirPerm = await h.queryPermission({ mode: 'readwrite' }); if (dirPerm !== 'granted') dirPerm = await h.requestPermission({ mode: 'readwrite' });
      status('Folder dipilih: ' + h.name + ' (' + dirPerm + '). Pilih folder assets\\' + folder + ' dalam projek EduRank — gambar akan disimpan terus ke situ.');
    } catch (e) { status('Pilih folder dibatalkan / pelayar tidak menyokong (guna Chrome atau Edge): ' + (e && e.message)); }
    paint();
  }
  async function dirAllow() { try { dirPerm = await dirH.requestPermission({ mode: 'readwrite' }); } catch (e) { dirPerm = 'denied'; } paint(); }
  const DLWAIT = window.__EJG_DLWAIT || 12000;
  /* Pulangkan 'dir' (tulis terus ke folder), 'saved' (muat turun disahkan), 'pending' (dialog Simpan Sebagai masih terbuka — JANGAN tunggu, teruskan) atau 'error:...' */
  async function saveFile(blob, p) {
    if (opt.dir && dirH && dirPerm === 'granted') {
      try { const fh = await dirH.getFileHandle(p.name + '.png', { create: true }), w = await fh.createWritable(); await w.write(blob); await w.close(); return 'dir'; }
      catch (e) { status('Simpan ke folder gagal (' + (e && e.message) + ') — guna muat turun biasa.'); }
    }
    return new Promise(res => {
      const url = URL.createObjectURL(blob), name = 'edurank__' + folder + '__' + p.name + '.png'; let settled = false;
      const fin = r => { if (!settled) { settled = true; res(r); } };
      GM_download({ url, name, saveAs: false,
        onload: () => { URL.revokeObjectURL(url); if (pend[dk(p.name)]) { delete pend[dk(p.name)]; save(); paint(); } fin('saved'); },
        onerror: e => fin('error:' + (e && (e.error || e.details || 'tidak diketahui'))) });
      setTimeout(() => fin('pending'), DLWAIT);
    });
  }

  async function runOne(p) {
    status('▶ ' + p.name + '.png — menulis prompt…');
    await setPrompt((opt.prefix ? A().prefix : '') + p.text);
    if (p.tpl) { status('📎 Melampir ' + p.tpl + '…'); await attach(await getTpl(p.tpl), p.tpl); }
    const nBefore = A().imgs().length;
    if (!opt.auto) status('Prompt ' + p.name + ' sedia — semak & tekan hantar sendiri. Gambar disimpan bila siap.');
    else {
      const sb = await waitFor(A().send, 20000);
      if (sb) sb.click(); else { const ed = A().editor(); ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); }
      status('⏳ ' + A().name + ' sedang menjana ' + p.name + '…');
    }
    await waitFor(() => A().busy() || A().imgs().length > nBefore, opt.auto ? 40000 : 600000, 500);
    let im = null, idleSince = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 420000 && !stopReq) {                       // maks ~7 minit satu gambar
      const imgs = A().imgs();
      if (!A().busy()) {
        if (imgs.length > nBefore) { const last = imgs[imgs.length - 1]; if (last.complete) { await sleep(2500); const l2 = A().imgs(); const f = l2[l2.length - 1]; if (!A().busy() && f && f.complete) { im = f; break; } } }
        else { if (!idleSince) idleSince = Date.now(); if (Date.now() - idleSince > IDLE) break; }      // tiada gambar selepas 30s senyap
      } else idleSince = 0;
      await sleep(800);
    }
    if (stopReq) { const e = new Error('Dihentikan'); e.stop = true; throw e; }
    if (!im) {
      const txt = (A().lastText() || '').slice(0, 300);
      if (LIMIT_RX.test(txt)) { const e = new Error('Had penjanaan dicapai: ' + txt.replace(/\s+/g, ' ').slice(0, 120)); e.limit = true; throw e; }
      throw new Error('Tiada gambar' + (txt ? ' — jawapan: ' + txt.replace(/\s+/g, ' ').slice(0, 100) : ''));
    }
    status('💾 Menyimpan ' + p.name + '.png…');
    const r = await saveFile(await toPng(await fetchBlob(im.src)), p);
    if (/^error:/.test(r)) throw new Error('Simpan gagal: ' + r.slice(6));
    if (r === 'pending') { pend[dk(p.name)] = Date.now(); save(); }
    else if (pend[dk(p.name)]) { delete pend[dk(p.name)]; save(); }
  }

  /* ---------- barisan (tahan muat semula & tukar laman; satu tab sahaja memegang kunci) ---------- */
  function lockOk() { const l = get(K.lock, null); return !l || l.tab === TAB || Date.now() - l.t > 20000; }
  const beat = () => set(K.lock, { tab: TAB, t: Date.now() });
  function startQueue(only) {
    stopReq = false;
    let q;
    if (typeof only === 'string') q = [only];
    else {
      const pre = opt.pre.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      q = list.filter(p => !done[dk(p.name)] && (!pre.length || pre.some(x => p.name.indexOf(x) === 0))).map(p => p.name);
    }
    if (!q.length) return status('Tiada yang perlu dijana (semua siap' + (opt.pre ? ' untuk awalan itu' : '') + ').');
    set(K.run, { q, folder, r: {}, site: ID, single: typeof only === 'string' }); beat();
    status('Barisan: ' + q.length + ' gambar.'); loop();
  }
  async function loop() {
    if (looping) return; if (!lockOk()) { status('Tab lain sedang menjana. Tutup/Henti di sana dahulu.'); return; }
    looping = true; stopReq = false; paint();
    const hb = setInterval(beat, 5000);
    try {
      while (!stopReq) {
        let st = get(K.run, null); if (!st || !st.q || !st.q.length) break;
        folder = st.folder || folder;
        const name = st.q[0], p = list.find(x => x.name === name);
        if (!p) { st.q.shift(); set(K.run, st.q.length ? st : null); continue; }
        if (opt.newChat && !isHome()) { status('Membuka chat baharu…'); clearInterval(hb); looping = false; set(K.lock, null); location.href = HOME(); return; }
        running = name; paint(); beat();
        try {
          await runOne(p);
          done[dk(name)] = Date.now(); delete fail[dk(name)]; save();
          st = get(K.run, null) || st; st.q.shift(); set(K.run, st.q.length ? st : null); running = null; paint();
          status((pend[dk(name)] ? '⚠️ ' + name + '.png dijana TETAPI dialog "Simpan Sebagai" belum disimpan — simpan failnya (atau pilih folder / matikan "Ask where to save"). ' : '✅ ' + name + '.png siap ') + '(' + counts().nd + '/' + counts().n + ')');
          if (st.single || !st.q.length) break;
          if (opt.gap) { status('✅ ' + name + ' siap — jeda ' + opt.gap + 's…'); await sleep(opt.gap * 1000); }
          if (opt.newChat) { clearInterval(hb); looping = false; set(K.lock, null); location.href = HOME(); return; }
        } catch (e) {
          running = null;
          if (e.stop) break;
          if (e.limit) { status('⏸ ' + e.message + '\nProgres disimpan. Tekan Sambung bila had dibuka semula (atau cuba di ' + (ID === 'gemini' ? 'ChatGPT' : 'Gemini') + ').'); break; }
          st = get(K.run, null) || st; st.r = st.r || {};
          if (!st.r[name]) {                                         // cuba semula sekali
            st.r[name] = 1; set(K.run, st); status('↻ ' + name + ': ' + e.message + ' — cuba semula…');
            if (opt.newChat) { await sleep(2000); clearInterval(hb); looping = false; set(K.lock, null); location.href = HOME(); return; }
            continue;
          }
          fail[dk(name)] = { msg: e.message, t: Date.now() }; save();
          st.q.shift(); set(K.run, st.q.length ? st : null); paint();
          status('❌ ' + name + ': ' + e.message + (opt.cont && st.q.length ? '\nDilangkau — menyambung dengan gambar seterusnya.' : ''));
          if (!opt.cont || st.single) break;
          if (opt.newChat && st.q.length) { await sleep(1500); clearInterval(hb); looping = false; set(K.lock, null); location.href = HOME(); return; }
        }
      }
    } finally { clearInterval(hb); }
    looping = false; running = null;
    const left = queued();
    if (stopReq) { set(K.lock, null); status('■ Dihentikan. Progres disimpan' + (left ? ' (' + left + ' lagi dalam barisan — tekan Sambung).' : '.')); }
    else if (!left) { set(K.run, null); set(K.lock, null); const c = counts(); status((c.nf ? '✅ Selesai, ' + c.nf + ' gagal — tekan "Cuba semula yang gagal". ' : '✅ Selesai semua. ') + (c.np ? '⚠️ ' + c.np + ' fail belum disahkan disimpan (dialog "Simpan Sebagai" tidak disimpan?) — semak, atau tekan "Jana semula ⚠". ' : '') + (opt.dir && dirH && dirPerm === 'granted' ? 'Gambar disimpan terus ke folder ' + dirH.name + ' — auto-push akan memprosesnya.' : 'Gambar yang disimpan ada dalam Downloads — auto-push akan memprosesnya.')); }
    else set(K.lock, null);
    paint();
  }

  dirLoad();
  /* sambung sendiri selepas halaman dimuat (chat baharu / tukar laman) jika barisan masih aktif */
  if (get(K.run, null) && lockOk()) { pan.classList.add('on'); paint(); status('Menyambung barisan…'); setTimeout(loop, RESUME); }
  else if (get(K.run, null)) { paint(); }
  window.__ejg = { parse, startQueue, get list() { return list; }, get done() { return done; }, get fail() { return fail; } };    // untuk ujian
})();
