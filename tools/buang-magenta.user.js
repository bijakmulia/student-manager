// ==UserScript==
// @name         Buang Magenta (EduRank)
// @namespace    https://bijakmulia.github.io/student-manager/
// @version      1.0.0
// @description  Butang "✂ Buang Magenta" pada gambar di ChatGPT & Gemini: hantar ke web app Buang Magenta, simpan PNG lutsinar ke folder Downloads/edurank-aset/
// @match        https://chatgpt.com/*
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// @downloadURL  https://bijakmulia.github.io/student-manager/tools/buang-magenta.user.js
// @updateURL    https://bijakmulia.github.io/student-manager/tools/buang-magenta.user.js
// ==/UserScript==
/*
 * PENTING: supaya fail disimpan dalam subfolder (Downloads/edurank-aset/), buka
 * Tampermonkey → Papan Pemuka → Tetapan → (Mod Konfigurasi: Lanjutan) → Muat Turun BETA →
 * "Download Mode" = "Browser API", dan benarkan kebenaran muat turun bila ditanya.
 * Tanpa itu, fail tetap dimuat turun ke folder Downloads biasa.
 *
 * Cara guna: lalukan tetikus pada gambar yang dijana → klik "✂ Buang Magenta" → taip nama aset
 * (cth. bola_sepak). Tab web app dibuka sekali sahaja dan diguna semula.
 */
(function () {
  'use strict';
  const DEF_APP = 'https://bijakmulia.github.io/student-manager/tools/buang-magenta.html';
  const APP = () => GM_getValue('app', DEF_APP);
  const FOLDER = () => GM_getValue('folder', 'edurank-aset');
  let appWin = null, seq = 0;
  const waits = {};

  /* ---------- notifikasi kecil ---------- */
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;font:13px system-ui,sans-serif;pointer-events:none';
  document.documentElement.appendChild(box);
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'padding:9px 12px;border-radius:10px;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.35);max-width:340px;background:' +
      (kind === 'err' ? '#B91C1C' : kind === 'ok' ? '#15803D' : '#1E293B');
    box.appendChild(t);
    setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
  }
  function log(entry) {
    const L = GM_getValue('log', []);
    L.unshift(Object.assign({ t: new Date().toISOString() }, entry));
    GM_setValue('log', L.slice(0, 50));
  }

  /* ---------- hubungan dengan web app ---------- */
  window.addEventListener('message', e => {
    const d = e.data;
    if (!d || typeof d.type !== 'string' || d.type.indexOf('bm:') !== 0) return;
    if (appWin && e.source !== appWin) return;
    const key = d.type === 'bm:pong' ? 'pong' : d.id;
    if (waits[key]) { waits[key](d); delete waits[key]; }
  });
  const origin = () => new URL(APP()).origin;
  function ensureApp() {
    return new Promise((resolve, reject) => {
      if (!appWin || appWin.closed) appWin = window.open(APP(), 'buang-magenta');
      if (!appWin) return reject(new Error('Tetingkap web app disekat. Benarkan pop-up untuk laman ini.'));
      let n = 0;
      const ping = () => {
        if (n++ > 60) { delete waits.pong; return reject(new Error('Web app tidak menjawab. Semak alamat app dalam menu Tampermonkey.')); }
        try { appWin.postMessage({ type: 'bm:ping' }, origin()); } catch (err) { /* masih memuatkan */ }
        pingT = setTimeout(ping, 300);
      };
      let pingT = 0;
      waits.pong = () => { clearTimeout(pingT); resolve(appWin); };
      ping();
    });
  }
  function processInApp(name, dataURL) {
    return ensureApp().then(win => new Promise((resolve, reject) => {
      const id = 'tm' + Date.now() + '_' + (++seq);
      const to = setTimeout(() => { delete waits[id]; reject(new Error('Tamat masa memproses')); }, 120000);
      waits[id] = d => { clearTimeout(to); d.type === 'bm:result' ? resolve(d) : reject(new Error(d.message || 'Gagal')); };
      win.postMessage({ type: 'bm:process', id, name, dataURL }, origin());
    }));
  }

  /* ---------- ambil gambar (elak sekatan CORS) ---------- */
  const blobToDataURL = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
  function fetchImage(src) {
    if (/^(blob|data):/.test(src)) return fetch(src).then(r => r.blob()).then(blobToDataURL);
    return new Promise((res, rej) => GM_xmlhttpRequest({
      method: 'GET', url: src, responseType: 'blob', anonymous: false,
      onload: r => (r.status >= 200 && r.status < 300 && r.response) ? blobToDataURL(r.response).then(res, rej) : rej(new Error('HTTP ' + r.status)),
      onerror: () => rej(new Error('Gagal memuat gambar')), ontimeout: () => rej(new Error('Tamat masa memuat gambar'))
    }));
  }
  const bestSrc = img => {
    // ambil resolusi tertinggi daripada srcset jika ada
    if (img.srcset) {
      const best = img.srcset.split(',').map(s => s.trim().split(/\s+/)).map(([u, w]) => [u, parseInt(w) || 0]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[0]) return best[0];
    }
    return img.currentSrc || img.src;
  };

  /* ---------- simpan ---------- */
  function save(name, dataURL) {
    return new Promise(resolve => {
      const full = FOLDER() ? FOLDER().replace(/[\\/]+$/, '') + '/' + name : name;
      const fallback = () => { const a = document.createElement('a'); a.href = dataURL; a.download = name; document.body.appendChild(a); a.click(); a.remove(); resolve('pelayar'); };
      try { GM_download({ url: dataURL, name: full, saveAs: false, onload: () => resolve(full), onerror: fallback, ontimeout: fallback }); }
      catch (e) { fallback(); }
    });
  }

  /* ---------- aliran kerja ---------- */
  const clean = s => String(s || '').trim().toLowerCase().replace(/\.(png|jpe?g|webp)$/, '').replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
  function askName() {
    const last = GM_getValue('lastName', '');
    const n = clean(prompt('Nama fail aset (tanpa .png), cth. bola_sepak / atl_renang / rak_bola:', last));
    if (n) GM_setValue('lastName', n);
    return n;
  }
  async function handle(img, givenName) {
    const name = givenName || askName();
    if (!name) return false;
    toast('⏳ ' + name + ': memproses…');
    try {
      const dataURL = await fetchImage(bestSrc(img));
      const r = await processInApp(name, dataURL);
      const where = await save(r.name, r.dataURL);
      toast('✅ ' + r.name + ' disimpan (' + r.width + '×' + r.height + ')', 'ok');
      log({ name: r.name, ok: true, where });
      return true;
    } catch (e) {
      toast('❌ ' + name + ': ' + e.message, 'err');
      log({ name, ok: false, err: e.message });
      return false;
    }
  }

  /* ---------- butang pada gambar ---------- */
  const isCandidate = img => img instanceof HTMLImageElement && img.complete && img.naturalWidth >= 256 && img.naturalHeight >= 256 &&
    img.getBoundingClientRect().width >= 120 && !img.closest('#bm-tm-btn');
  const btn = document.createElement('button');
  btn.id = 'bm-tm-btn';
  btn.textContent = '✂ Buang Magenta';
  btn.style.cssText = 'position:fixed;z-index:2147483646;display:none;padding:6px 10px;border:0;border-radius:8px;background:#FF00FF;color:#fff;font:600 12px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer';
  document.documentElement.appendChild(btn);
  let target = null, hideT = 0;
  const place = () => {
    if (!target || !target.isConnected) { btn.style.display = 'none'; return; }
    const r = target.getBoundingClientRect();
    btn.style.left = Math.max(4, r.right - 140) + 'px';
    btn.style.top = Math.max(4, r.top + 8) + 'px';
    btn.style.display = 'block';
  };
  document.addEventListener('mouseover', e => {
    if (e.target === btn) { clearTimeout(hideT); return; }
    const img = e.target instanceof HTMLImageElement ? e.target : null;
    if (img && isCandidate(img)) { clearTimeout(hideT); target = img; place(); }
    else if (target) { clearTimeout(hideT); hideT = setTimeout(() => { btn.style.display = 'none'; target = null; }, 600); }
  }, true);
  window.addEventListener('scroll', place, true);
  btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); if (target) handle(target); });

  /* ---------- menu Tampermonkey ---------- */
  GM_registerMenuCommand('✂ Proses semua gambar di halaman ini', async () => {
    const imgs = [...document.images].filter(isCandidate);
    if (!imgs.length) return toast('Tiada gambar yang dijana dijumpai di halaman ini.', 'err');
    toast(imgs.length + ' gambar dijumpai. Taip nama untuk setiap satu (kosong = langkau).');
    let ok = 0;
    for (const img of imgs) {
      img.scrollIntoView({ block: 'center' });
      img.style.outline = '4px solid #FF00FF';
      const n = askName();
      img.style.outline = '';
      if (n && await handle(img, n)) ok++;
    }
    toast(ok + '/' + imgs.length + ' gambar disimpan.', 'ok');
  });
  GM_registerMenuCommand('⚙ Tetapkan alamat web app', () => {
    const v = prompt('Alamat web app Buang Magenta:', APP());
    if (v) { GM_setValue('app', v.trim()); appWin = null; toast('Alamat disimpan.'); }
  });
  GM_registerMenuCommand('📁 Tukar subfolder simpan', () => {
    const v = prompt('Subfolder dalam Downloads (kosong = terus ke Downloads):', FOLDER());
    if (v !== null) { GM_setValue('folder', v.trim()); toast('Subfolder: ' + (v.trim() || '(Downloads)')); }
  });
  GM_registerMenuCommand('📜 Lihat log', () => {
    const L = GM_getValue('log', []);
    alert(L.length ? L.slice(0, 20).map(x => (x.ok ? '✅ ' : '❌ ') + x.name + '  ' + (x.err || x.where || '') + '  ' + x.t).join('\n') : 'Log kosong.');
  });
})();
