// ==UserScript==
// @name         EduRank — Jana Gambar Gemini
// @namespace    https://bijakmulia.github.io/student-manager/
// @version      1.0
// @description  Jana aset gambar EduRank di Gemini: muat senarai prompt, lampir templat secara automatik, jana satu-satu atau semua, simpan dengan nama fail yang betul.
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      bijakmulia.github.io
// @connect      googleusercontent.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/* Cara guna
   1. Ketik butang 🎨 di bucu kanan bawah Gemini.
   2. Pilih senarai prompt (Stor Sukan / Kad / Seram) → "Muat" (diambil terus dari laman EduRank),
      atau tampal sendiri prompt berformat "### nama.png" di kotak teks.
   3. Prompt yang menyebut "templat_xxx.png" → templat dilampir automatik (diambil dari laman EduRank,
      atau dari fail yang cikgu muat naik dalam bahagian TEMPLAT).
   4. ▶ pada mana-mana baris = jana prompt ITU sahaja. "Jana yang ditanda" = jana semua yang ditanda, satu demi satu.
   5. Gambar disimpan ke Downloads sebagai "edurank__<folder>__<nama>.png". Auto-push memindahkannya
      ke folder aset yang betul dan memprosesnya sendiri.
   Petua: di Edge, matikan "Ask me what to do with each download" (edge://settings/downloads) supaya simpan tanpa ditanya. */

(function () {
  'use strict';
  const SITE = 'https://bijakmulia.github.io/student-manager/';
  const LISTS = {
    stor:  { n: 'Simulasi Stor Sukan', url: SITE + 'assets/stor/PROMPT-ASET.txt' },
    kad:   { n: 'Kad Ilmon (k01–k96)', url: SITE + 'assets/kad/PROMPT-KAD.txt' },
    seram: { n: 'Muka Hantu (Seram)', url: SITE + 'assets/seram/PROMPT-SERAM.txt' }
  };
  const K = { list: 'er_list', folder: 'er_folder', done: 'er_done', sel: 'er_sel', run: 'er_run', opt: 'er_opt', tpl: 'er_tpl' };
  const get = (k, d) => { try { const v = GM_getValue(k); return v === undefined ? d : v; } catch (e) { return d; } };
  const set = (k, v) => GM_setValue(k, v);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

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
      if (/^=+ .* =+$/.test(l.trim())) { cur = null; continue; }              // tajuk bahagian dalam PROMPT-ASET.txt
      cur.text += (cur.text ? '\n' : '') + l;
    }
    return out.map(p => {
      let t = p.text.trim(); const tpl = (t.match(/templat_[a-z0-9_]+\.png/i) || [])[0] || '';
      t = t.replace(/LAMPIRKAN templat \S+?\.png\.?\s*/i, '').trim();               // arahan untuk guru — tidak dihantar ke Gemini
      return { name: p.name, text: t, tpl: tpl.toLowerCase() };
    }).filter(p => p.text);
  }

  /* ---------- keadaan ---------- */
  let list = get(K.list, []), folder = get(K.folder, 'stor'), done = get(K.done, {}), sel = get(K.sel, {});
  let opt = Object.assign({ auto: true, newChat: true, skipDone: true }, get(K.opt, {}));
  const tplCache = {};                                       // nama → Blob
  let running = false, stopReq = false;
  const save = () => { set(K.list, list); set(K.folder, folder); set(K.done, done); set(K.sel, sel); set(K.opt, opt); };
  const doneKey = n => folder + '/' + n;

  /* ---------- UI ---------- */
  GM_addStyle(`
  #erBtn{position:fixed;right:18px;bottom:96px;z-index:99999;width:52px;height:52px;border-radius:50%;border:0;background:#FF6B00;color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}
  #erPan{position:fixed;right:18px;bottom:156px;z-index:99999;width:420px;max-height:76vh;display:none;flex-direction:column;background:#0F172A;color:#E2E8F0;border:2px solid #FF6B00;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.35 system-ui,sans-serif}
  #erPan.on{display:flex}
  #erPan .hd{padding:10px 12px;font-weight:800;display:flex;align-items:center;gap:8px;border-bottom:1px solid #334155}
  #erPan .hd span{margin-left:auto;font-weight:600;font-size:11px;color:#94A3B8}
  #erPan .bd{padding:10px 12px;overflow:auto;display:flex;flex-direction:column;gap:8px}
  #erPan select,#erPan textarea,#erPan button{font:inherit}
  #erPan select,#erPan textarea{background:#1E293B;color:#E2E8F0;border:1px solid #334155;border-radius:8px;padding:6px}
  #erPan textarea{height:70px;resize:vertical}
  #erPan .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  #erPan .b{background:#1E293B;color:#E2E8F0;border:1px solid #475569;border-radius:8px;padding:6px 10px;cursor:pointer}
  #erPan .b.o{background:#FF6B00;border-color:#FF6B00;color:#fff;font-weight:700}
  #erPan .b.r{background:#B91C1C;border-color:#B91C1C;color:#fff}
  #erPan .b:disabled{opacity:.4}
  #erPan label.ck{display:flex;gap:5px;align-items:center;font-size:12px}
  #erPan .lst{border:1px solid #334155;border-radius:8px;max-height:34vh;overflow:auto}
  #erPan .it{display:flex;gap:6px;align-items:center;padding:5px 7px;border-bottom:1px solid #1E293B}
  #erPan .it:hover{background:#1E293B}
  #erPan .it .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,monospace;font-size:12px}
  #erPan .it .tg{font-size:10px;background:#7C3AED;color:#fff;border-radius:99px;padding:0 6px}
  #erPan .it .go{background:#16A34A;border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer}
  #erPan .it.now{background:#422006}
  #erPan .st{font-size:12px;color:#FDE68A;min-height:16px}
  #erPan .tp{display:flex;flex-wrap:wrap;gap:6px}
  #erPan .tp div{font-size:11px;background:#1E293B;border:1px solid #334155;border-radius:6px;padding:3px 6px}
  #erPan .tp div.ok{border-color:#16A34A}
  `);
  const btn = document.createElement('button'); btn.id = 'erBtn'; btn.textContent = '🎨'; btn.title = 'EduRank — Jana Gambar';
  const pan = document.createElement('div'); pan.id = 'erPan';
  document.body.append(btn, pan);
  btn.onclick = () => { pan.classList.toggle('on'); paint(); };

  function tplNames() { return [...new Set(list.map(p => p.tpl).filter(Boolean))]; }
  function paint() {
    const uploaded = get(K.tpl, {});
    const nDone = list.filter(p => done[doneKey(p.name)]).length;
    pan.innerHTML =
      '<div class="hd">🎨 EduRank · Jana Gambar<span>' + nDone + '/' + list.length + ' siap</span></div><div class="bd">' +
      '<div class="row"><select id="erF">' + Object.keys(LISTS).map(k => '<option value="' + k + '"' + (k === folder ? ' selected' : '') + '>' + LISTS[k].n + '</option>').join('') + '</select>' +
        '<button class="b" id="erLoad">⬇ Muat dari EduRank</button></div>' +
      '<textarea id="erTxt" placeholder="…atau tampal prompt di sini (### nama.png + prompt), kemudian tekan Guna teks"></textarea>' +
      '<div class="row"><button class="b" id="erUse">Guna teks</button><button class="b" id="erAll">Tanda semua</button><button class="b" id="erNone">Buang tanda</button><button class="b" id="erTodo">Tanda yang belum siap</button></div>' +
      '<div class="lst">' + (list.length ? list.map((p, i) => {
        const d = done[doneKey(p.name)];
        return '<div class="it' + (running && running.cur === i ? ' now' : '') + '"><input type="checkbox" data-s="' + i + '"' + (sel[p.name] ? ' checked' : '') + '>' +
          '<span>' + (d ? '✅' : running && running.cur === i ? '⏳' : '⬜') + '</span><span class="nm" title="' + esc(p.text) + '">' + p.name + '.png</span>' +
          (p.tpl ? '<span class="tg" title="' + p.tpl + '">📎 templat</span>' : '') +
          '<button class="go" data-g="' + i + '"' + (running ? ' disabled' : '') + '>▶</button></div>';
      }).join('') : '<div class="it">Belum ada senarai — tekan Muat.</div>') + '</div>' +
      (tplNames().length ? '<div><b>TEMPLAT</b> (diambil automatik dari laman EduRank; muat naik untuk ganti)<div class="tp">' +
        tplNames().map(n => '<div class="' + (uploaded[n] || tplCache[n] ? 'ok' : '') + '">' + n + (uploaded[n] ? ' · fail sendiri' : '') + '</div>').join('') + '</div>' +
        '<input type="file" id="erUp" accept="image/png" multiple style="margin-top:6px;font-size:11px"></div>' : '') +
      '<div class="row"><label class="ck"><input type="checkbox" id="erO1"' + (opt.auto ? ' checked' : '') + '>Hantar & simpan automatik</label>' +
        '<label class="ck"><input type="checkbox" id="erO2"' + (opt.newChat ? ' checked' : '') + '>Chat baharu setiap prompt</label>' +
        '<label class="ck"><input type="checkbox" id="erO3"' + (opt.skipDone ? ' checked' : '') + '>Langkau yang siap</label></div>' +
      '<div class="row"><button class="b o" id="erGo"' + (running ? ' disabled' : '') + '>▶▶ Jana yang ditanda (' + list.filter(p => sel[p.name]).length + ')</button>' +
        '<button class="b r" id="erStop"' + (running ? '' : ' disabled') + '>■ Henti</button><button class="b" id="erReset">Set semula ✅</button></div>' +
      '<div class="st" id="erSt"></div></div>';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const status = t => { const s = $('#erSt'); if (s) s.textContent = t; console.log('[EduRank]', t); };

  pan.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'erF') { folder = t.value; save(); paint(); }
    if (t.dataset.s != null) { sel[list[+t.dataset.s].name] = t.checked; save(); }
    if (t.id === 'erO1') opt.auto = t.checked; if (t.id === 'erO2') opt.newChat = t.checked; if (t.id === 'erO3') opt.skipDone = t.checked;
    if (/^erO/.test(t.id)) save();
    if (t.id === 'erUp') {
      const up = get(K.tpl, {});
      Promise.all([...t.files].map(f => new Promise(r => { const fr = new FileReader(); fr.onload = () => { up[f.name.toLowerCase()] = fr.result; r(); }; fr.readAsDataURL(f); })))
        .then(() => { set(K.tpl, up); status('Templat disimpan: ' + [...t.files].map(f => f.name).join(', ')); paint(); });
    }
  });
  pan.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'erLoad') return loadList();
    if (b.id === 'erUse') { const p = parse($('#erTxt').value); if (!p.length) return status('Tiada prompt dijumpai. Pastikan setiap prompt bermula dengan baris "### nama.png".'); list = p; sel = {}; save(); paint(); return status(p.length + ' prompt dimuat dari teks.'); }
    if (b.id === 'erAll') { list.forEach(p => sel[p.name] = true); save(); return paint(); }
    if (b.id === 'erNone') { sel = {}; save(); return paint(); }
    if (b.id === 'erTodo') { sel = {}; list.forEach(p => { if (!done[doneKey(p.name)]) sel[p.name] = true; }); save(); return paint(); }
    if (b.id === 'erReset') { list.forEach(p => delete done[doneKey(p.name)]); save(); return paint(); }
    if (b.id === 'erStop') { stopReq = true; set(K.run, null); return status('Akan berhenti selepas gambar ini…'); }
    if (b.id === 'erGo') { const q = list.map((p, i) => i).filter(i => sel[list[i].name] && !(opt.skipDone && done[doneKey(list[i].name)])); if (!q.length) return status('Tiada prompt ditanda (atau semua sudah siap).'); return startQueue(q); }
    if (b.dataset.g != null) return startQueue([+b.dataset.g], true);
  });

  function loadList() {
    status('Memuat senarai ' + LISTS[folder].n + '…');
    GM_xmlhttpRequest({ method: 'GET', url: LISTS[folder].url + '?t=' + Date.now(), onload: r => {
      const p = parse(r.responseText);
      if (!p.length) return status('Tiada prompt dijumpai dalam senarai itu.');
      list = p; sel = {}; save(); paint(); status(p.length + ' prompt dimuat (' + p.filter(x => x.tpl).length + ' perlukan templat).');
    }, onerror: () => status('Gagal memuat senarai — semak internet.') });
  }

  /* ---------- templat ---------- */
  const b64Blob = d => { const [h, b] = d.split(','), m = h.match(/:(.*?);/)[1], s = atob(b), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: m }); };
  function getTpl(name) {
    const up = get(K.tpl, {});
    if (up[name]) return Promise.resolve(b64Blob(up[name]));
    if (tplCache[name]) return Promise.resolve(tplCache[name]);
    return new Promise((res, rej) => GM_xmlhttpRequest({ method: 'GET', url: SITE + 'tools/template/' + name, responseType: 'blob',
      onload: r => r.status === 200 ? res(tplCache[name] = r.response) : rej(new Error('Templat ' + name + ' tiada di laman')), onerror: () => rej(new Error('Gagal muat ' + name)) }));
  }

  /* ---------- Gemini: kotak prompt, lampiran, hantar, tunggu gambar ---------- */
  const editor = () => $('rich-textarea .ql-editor') || $('div.ql-editor[contenteditable="true"]') || $('[contenteditable="true"][role="textbox"]') || $('rich-textarea [contenteditable="true"]');
  const sendBtn = () => $$('button').find(b => /send|hantar/i.test((b.getAttribute('aria-label') || '') + ' ' + b.className) && !b.disabled && b.offsetParent);
  const busy = () => $$('button').some(b => /stop|henti/i.test(b.getAttribute('aria-label') || '') && b.offsetParent);
  const respImgs = () => $$('model-response img, .model-response img, generated-image img, single-image img').filter(im => /^https?:|^blob:/.test(im.src) && im.naturalWidth >= 256);
  const chips = () => $$('uploader-file-preview, .file-preview-container img, [data-test-id*="file-preview"], .attachment-preview, .uploaded-image-preview, img[src^="blob:"]').filter(x => !x.closest('model-response'));

  async function waitFor(fn, ms, step) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; if (stopReq) return null; await sleep(step || 300); } return null; }
  async function setPrompt(text) {
    const ed = await waitFor(editor, 15000); if (!ed) throw new Error('Kotak prompt Gemini tidak dijumpai');
    ed.focus();
    document.execCommand('selectAll', false, null); document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);
    if (!ed.textContent.trim()) { ed.textContent = text; ed.dispatchEvent(new InputEvent('input', { bubbles: true })); }
    await sleep(300);
  }
  async function attach(blob, name) {
    const ed = editor(); if (!ed) throw new Error('Kotak prompt tidak dijumpai');
    const file = new File([blob], name, { type: blob.type || 'image/png' }), before = chips().length;
    const dt = new DataTransfer(); dt.items.add(file);
    ed.focus();
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));      // cara 1: tampal
    if (await waitFor(() => chips().length > before, 6000)) return;
    const inp = $$('input[type=file]').find(i => !i.disabled);                                                   // cara 2: input fail tersembunyi
    if (inp) { const d2 = new DataTransfer(); d2.items.add(file); inp.files = d2.files; inp.dispatchEvent(new Event('change', { bubbles: true })); if (await waitFor(() => chips().length > before, 6000)) return; }
    for (const ev of ['dragenter', 'dragover', 'drop']) ed.dispatchEvent(new DragEvent(ev, { dataTransfer: dt, bubbles: true, cancelable: true }));   // cara 3: seret & lepas
    if (await waitFor(() => chips().length > before, 6000)) return;
    throw new Error('Templat tidak dapat dilampir automatik — lampirkan ' + name + ' sendiri, kemudian tekan hantar');
  }
  function download(src, file) {
    return new Promise((res, rej) => {
      const full = src.replace(/=s\d+(-[a-z-]+)?$/i, '=s0').replace(/=w\d+-h\d+(-[a-z-]+)?$/i, '=s0');
      GM_xmlhttpRequest({ method: 'GET', url: full, responseType: 'blob', onload: r => {
        if (r.status !== 200 || !r.response) return rej(new Error('Gagal muat turun gambar'));
        const url = URL.createObjectURL(r.response);
        GM_download({ url, name: file, saveAs: false, onload: () => { URL.revokeObjectURL(url); res(); }, onerror: e => rej(new Error('Simpan gagal: ' + (e && e.error))) });
      }, onerror: () => rej(new Error('Gagal muat turun gambar')) });
    });
  }

  async function runOne(p) {
    status('▶ ' + p.name + '.png — menulis prompt…');
    await setPrompt(p.text);
    if (p.tpl) { status('📎 Melampir ' + p.tpl + '…'); await attach(await getTpl(p.tpl), p.tpl); }
    const nBefore = respImgs().length;
    if (!opt.auto) { status('Prompt ' + p.name + ' sedia — semak & tekan hantar sendiri. Gambar akan disimpan bila siap.'); }
    else {
      const sb = await waitFor(sendBtn, 15000); if (!sb) throw new Error('Butang hantar tidak dijumpai');
      sb.click(); status('⏳ Gemini sedang menjana ' + p.name + '…');
    }
    await waitFor(() => busy() || respImgs().length > nBefore, opt.auto ? 30000 : 600000, 500);
    const im = await waitFor(() => !busy() && respImgs().length > nBefore && respImgs()[respImgs().length - 1].complete ? respImgs()[respImgs().length - 1] : null, 240000, 800);
    if (!im) throw new Error(stopReq ? 'Dihentikan' : 'Gambar tidak muncul (had masa)');
    await sleep(1200);
    const name = 'edurank__' + folder + '__' + p.name + '.png';
    status('💾 Menyimpan ' + name + '…'); await download(im.src, name);
    done[doneKey(p.name)] = Date.now(); save();
  }

  /* barisan: berterusan merentas muat semula halaman bila "chat baharu" dipilih */
  async function startQueue(q, single) {
    stopReq = false;
    set(K.run, { q, single: !!single, folder });
    if (opt.newChat && !/\/app\/?$/.test(location.pathname)) { location.href = 'https://gemini.google.com/app'; return; }
    loop();
  }
  async function loop() {
    let st = get(K.run, null);
    while (st && st.q && st.q.length && !stopReq) {
      const i = st.q[0], p = list[i];
      running = { cur: i }; paint();
      try { if (p) await runOne(p); }
      catch (e) { status('❌ ' + (p ? p.name : '?') + ': ' + e.message); running = false; set(K.run, null); paint(); return; }
      st = get(K.run, null); if (!st) break;
      st.q.shift(); set(K.run, st.q.length ? st : null);
      if (st.q.length && opt.newChat && !stopReq){ status('Chat baharu untuk prompt seterusnya…'); await sleep(1500); location.href = 'https://gemini.google.com/app'; return; }
      paint();
    }
    running = false; set(K.run, null); paint();
    status(stopReq ? '■ Dihentikan.' : '✅ Selesai. Gambar ada dalam Downloads — auto-push akan memprosesnya.');
  }
  // sambung barisan selepas halaman dimuat semula (chat baharu)
  if (get(K.run, null)) { pan.classList.add('on'); paint(); setTimeout(loop, 4000); }
  else paint();
})();
