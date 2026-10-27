// ==UserScript==
// @name         Gemini Auto Jana Gambar (Aset Stor Sukan)
// @namespace    student-manager
// @version      1.1
// @description  Tampal senarai prompt (### nama.png ... / PROMPT-ASET.txt). Skrip hantar satu-satu ke Gemini, tunggu gambar siap, muat turun dengan nama fail yang betul, lalu teruskan prompt seterusnya.
// @match        https://gemini.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      googleusercontent.com
// @connect      google.com
// @connect      gstatic.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Gemini enforces Trusted Types: never use innerHTML here, only createElement/textContent.

  const KEY = 'gag_state_v1';
  const NEW_CHAT_URL = 'https://gemini.google.com/app';
  const defaults = {
    items: [],          // [{name, prompt, status: ''|'ok'|'gagal', tries}]
    idx: 0,
    running: false,
    failStreak: 0,
    opts: { cutWhite: false, prefix: 'Generate an image: ', waitSec: 240, gapSec: 6, newChat: true },
    log: [],
  };
  let S = Object.assign({}, defaults, GM_getValue(KEY, {}));
  S.opts = Object.assign({}, defaults.opts, S.opts);
  const save = () => GM_setValue(KEY, S);

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function log(msg) {
    const t = new Date().toLocaleTimeString();
    S.log.push(`[${t}] ${msg}`);
    if (S.log.length > 200) S.log = S.log.slice(-200);
    save();
    render();
  }

  // ---------- parse prompt list ----------
  // Accepts:  "### nama.png (nisbah...)\nprompt"   or   "12. nama.png   [nisbah ...]\nprompt"
  function parseList(text) {
    const out = [];
    const lines = text.replace(/\r/g, '').split('\n');
    let cur = null;
    const head = /^\s*(?:#{1,6}\s*|\d+\.\s+)([A-Za-z0-9_\-]+\.(?:png|jpe?g|webp))\b/;
    for (const line of lines) {
      const m = line.match(head);
      if (m) {
        if (cur && cur.prompt.trim()) out.push(cur);
        cur = { name: m[1].toLowerCase(), prompt: '', status: '', tries: 0 };
      } else if (cur && line.trim() && !/^=+/.test(line.trim())) {
        cur.prompt += (cur.prompt ? ' ' : '') + line.trim();
      }
    }
    if (cur && cur.prompt.trim()) out.push(cur);
    return out;
  }

  function buildPrompt(item) {
    // The prompts already ask for a magenta/green chroma-key background; send them as they are.
    return (S.opts.prefix || '') + item.prompt;
  }

  // ---------- Gemini DOM helpers ----------
  function findInput() {
    return $('rich-textarea .ql-editor[contenteditable="true"]') ||
      $('div.ql-editor[contenteditable="true"]') ||
      $('div[contenteditable="true"][role="textbox"]') ||
      $('textarea');
  }
  function findSend() {
    const cands = $$('button').filter(b => {
      const a = (b.getAttribute('aria-label') || '') + ' ' + (b.className || '');
      return /send|hantar|kirim|send-button/i.test(a);
    });
    return cands.find(b => !b.disabled && b.getAttribute('aria-disabled') !== 'true') || null;
  }
  function isBusy() {
    return $$('button').some(b => /stop|henti|berhenti/i.test(b.getAttribute('aria-label') || ''));
  }
  function responses() { return $$('model-response'); }
  function imagesIn(root) {
    return $$('img', root).filter(img => {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:image/svg')) return false;
      if (/gstatic\.com\/.*(icon|avatar|logo)/i.test(src)) return false;
      return img.complete && img.naturalWidth >= 300 && img.naturalHeight >= 300;
    });
  }
  async function waitFor(fn, ms, step = 500) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!S.running) return null;
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  async function typePrompt(el, text) {
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (!ok || !el.textContent.trim()) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
    }
  }

  // ---------- image fetch + save ----------
  function gmBlob(url) {
    return new Promise((res, rej) => GM_xmlhttpRequest({
      method: 'GET', url, responseType: 'blob', anonymous: false,
      onload: r => (r.status >= 200 && r.status < 300 && r.response) ? res(r.response) : rej(new Error('HTTP ' + r.status)),
      onerror: () => rej(new Error('network')), ontimeout: () => rej(new Error('timeout')),
    }));
  }
  async function getImageBlob(img) {
    const src = img.currentSrc || img.src;
    if (src.startsWith('blob:') || src.startsWith('data:')) return (await fetch(src)).blob();
    const urls = [];
    // googleusercontent URLs end with a size suffix like "=s1024-rj"; "=s0" asks for the original size.
    if (/googleusercontent\.com/.test(src)) urls.push(src.replace(/=[^/=]*$/, '') + '=s0');
    urls.push(src);
    let lastErr;
    for (const u of urls) {
      try { const b = await gmBlob(u); if (b.size > 5000) return b; } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('gambar tak dapat dimuat');
  }
  function blobToImage(blob) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('decode')); };
      im.src = u;
    });
  }
  // Flood-fill from the edges: near-white / light-grey pixels connected to the border become transparent.
  // The bold dark outlines stop the fill, so white objects (soccer ball, socks) stay intact.
  function cutBackground(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h), p = d.data;
    const isBg = i => {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      return mn > 195 && mx - mn < 22;
    };
    const seen = new Uint8Array(w * h), stack = [];
    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
    while (stack.length) {
      const k = stack.pop();
      if (seen[k]) continue;
      seen[k] = 1;
      if (!isBg(k * 4)) continue;
      p[k * 4 + 3] = 0;
      const x = k % w, y = (k / w) | 0;
      if (x > 0) stack.push(k - 1);
      if (x < w - 1) stack.push(k + 1);
      if (y > 0) stack.push(k - w);
      if (y < h - 1) stack.push(k + w);
    }
    // soften the 1px fringe next to removed pixels
    for (let k = 0; k < w * h; k++) {
      if (p[k * 4 + 3] === 0) continue;
      const x = k % w, y = (k / w) | 0;
      const n = (x > 0 && p[(k - 1) * 4 + 3] === 0) || (x < w - 1 && p[(k + 1) * 4 + 3] === 0) ||
        (y > 0 && p[(k - w) * 4 + 3] === 0) || (y < h - 1 && p[(k + w) * 4 + 3] === 0);
      if (n && isBg(k * 4)) p[k * 4 + 3] = 90;
    }
    ctx.putImageData(d, 0, 0);
  }
  async function saveImage(img, name) {
    const blob = await getImageBlob(img);
    const im = await blobToImage(blob);
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0);
    if (S.opts.cutWhite && !name.startsWith('bg_')) cutBackground(ctx, c.width, c.height);
    const png = await new Promise(r => c.toBlob(r, 'image/png'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(png);
    a.download = name.replace(/\.(jpe?g|webp)$/i, '.png');
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return `${c.width}×${c.height}`;
  }

  // ---------- main loop ----------
  function nextIndex(from) {
    for (let i = from; i < S.items.length; i++) if (S.items[i].status !== 'ok') return i;
    return -1;
  }

  async function runOne() {
    const i = nextIndex(S.idx);
    if (i < 0) { S.running = false; save(); log('✅ SIAP! Semua gambar telah diproses.'); return; }
    S.idx = i; save();
    const item = S.items[i];
    item.tries++; save();
    log(`▶ (${i + 1}/${S.items.length}) ${item.name} — percubaan ${item.tries}`);

    const input = await waitFor(findInput, 30000);
    if (!input) { if (S.running) await fail(item, 'kotak taip Gemini tak dijumpai'); return; }
    await sleep(800);
    const before = responses().length;
    await typePrompt(input, buildPrompt(item));
    const send = await waitFor(findSend, 10000, 300);
    if (!send) { await fail(item, 'butang Hantar tak dijumpai'); return; }
    send.click();

    // wait for a new response that contains a loaded image
    const resp = await waitFor(() => responses().length > before && responses()[responses().length - 1], 60000);
    if (!resp) { if (S.running) await fail(item, 'Gemini tak membalas'); return; }
    let lastSeenBusy = Date.now();
    const img = await waitFor(() => {
      if (isBusy()) lastSeenBusy = Date.now();
      const imgs = imagesIn(responses()[responses().length - 1]);
      if (imgs.length) return imgs[0];
      // finished replying (no stop button for 25 s) and still no picture -> give up early
      if (Date.now() - lastSeenBusy > 25000) return 'noimg';
      return null;
    }, S.opts.waitSec * 1000, 1000);
    if (!S.running) return;
    if (!img || img === 'noimg') {
      const txt = (responses()[responses().length - 1]?.innerText || '').slice(0, 140).replace(/\s+/g, ' ');
      await fail(item, 'tiada gambar' + (txt ? ` (Gemini kata: "${txt}")` : ''));
      return;
    }
    await sleep(2500); // let the full-size version finish loading
    try {
      const size = await saveImage(imagesIn(responses()[responses().length - 1])[0] || img, item.name);
      item.status = 'ok'; S.failStreak = 0; S.idx = i + 1; save();
      log(`💾 ${item.name} dimuat turun (${size})`);
    } catch (e) {
      await fail(item, 'gagal muat turun: ' + e.message);
      return;
    }
    await goNext();
  }

  async function fail(item, why) {
    S.failStreak++;
    log(`⚠ ${item.name}: ${why}`);
    if (item.tries >= 2) { item.status = 'gagal'; S.idx++; log(`⏭ ${item.name} dilangkau (boleh cuba semula nanti)`); }
    save();
    if (S.failStreak >= 4) {
      S.running = false; save();
      log('⛔ 4 kali gagal berturut-turut — dihentikan. Mungkin had harian gambar Gemini dah habis; cuba lagi esok atau tukar akaun.');
      return;
    }
    await goNext();
  }

  async function goNext() {
    if (!S.running) return;
    await sleep(S.opts.gapSec * 1000);
    if (!S.running) return;
    if (nextIndex(S.idx) < 0) { S.running = false; save(); log('✅ SIAP! Semua gambar telah diproses.'); return; }
    if (S.opts.newChat) location.assign(NEW_CHAT_URL); // fresh chat per image; the loop resumes after reload
    else runOne();
  }

  // ---------- panel UI ----------
  function el(tag, props = {}, kids = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of [].concat(kids)) e.append(c);
    return e;
  }
  const css = el('style', { textContent: `
    #gag{position:fixed;right:12px;bottom:12px;z-index:2147483647;width:360px;max-height:85vh;display:flex;flex-direction:column;
      background:#1e1f22;color:#eee;font:12px/1.4 system-ui,sans-serif;border:1px solid #444;border-radius:10px;box-shadow:0 6px 24px #0008}
    #gag.min .body{display:none} #gag .hd{padding:8px 10px;font-weight:600;cursor:pointer;display:flex;justify-content:space-between}
    #gag .body{padding:0 10px 10px;overflow:auto} #gag textarea{width:100%;height:90px;box-sizing:border-box;background:#111;color:#ddd;border:1px solid #444;border-radius:6px;font:11px monospace}
    #gag button{background:#3b6ff5;color:#fff;border:0;border-radius:6px;padding:5px 9px;margin:4px 4px 0 0;cursor:pointer;font:inherit}
    #gag button.g{background:#555} #gag button.r{background:#c0392b}
    #gag label{display:block;margin-top:3px} #gag input[type=number]{width:60px;background:#111;color:#eee;border:1px solid #444}
    #gag .bar{height:8px;background:#333;border-radius:4px;margin:6px 0;overflow:hidden} #gag .bar i{display:block;height:100%;background:#2ecc71}
    #gag .log{background:#111;border-radius:6px;padding:6px;height:140px;overflow:auto;white-space:pre-wrap;font:11px monospace;margin-top:6px}
    #gag .list{max-height:120px;overflow:auto;font:11px monospace;margin-top:6px}
    #gag .list div.ok{color:#2ecc71} #gag .list div.gagal{color:#e74c3c} #gag .list div.cur{color:#f1c40f}` });

  let box, ta, status, bar, logBox, list, startBtn;
  function build() {
    document.head.append(css);
    ta = el('textarea', { placeholder: 'Tampal semua prompt di sini (format "### nama.png ..." atau isi PROMPT-ASET.txt)' });
    status = el('div', { style: 'margin-top:6px' });
    bar = el('i'); logBox = el('div', { className: 'log' }); list = el('div', { className: 'list' });
    const opt = (key, text) => el('label', {}, [el('input', { type: 'checkbox', checked: !!S.opts[key], onchange: e => { S.opts[key] = e.target.checked; save(); } }), ' ' + text]);
    const num = (key, text) => el('label', {}, [text + ' ', el('input', { type: 'number', value: S.opts[key], min: 1, onchange: e => { S.opts[key] = Math.max(1, +e.target.value || defaults.opts[key]); save(); } })]);
    startBtn = el('button', { textContent: '▶ Mula', onclick: start });
    box = el('div', { id: 'gag' }, [
      el('div', { className: 'hd', onclick: () => box.classList.toggle('min') }, [el('span', { textContent: '🎨 Auto Jana Gambar Gemini' }), el('span', { textContent: '▾' })]),
      el('div', { className: 'body' }, [
        ta,
        el('button', { className: 'g', textContent: 'Muat senarai', onclick: load }),
        startBtn,
        el('button', { className: 'g', textContent: '⏸ Henti', onclick: stop }),
        el('button', { className: 'g', textContent: '↻ Cuba semula yg gagal', onclick: retryFailed }),
        el('button', { className: 'r', textContent: 'Reset', onclick: reset }),
        el('div', { style: 'margin-top:6px' }, [
          opt('cutWhite', 'Buang latar PUTIH sendiri (biarkan mati jika guna latar magenta + software sendiri)'),
          opt('newChat', 'Chat baru untuk setiap gambar (disyorkan)'),
          num('waitSec', 'Tunggu maksimum (saat):'),
          num('gapSec', 'Rehat antara gambar (saat):'),
        ]),
        status, el('div', { className: 'bar' }, [bar]), list, logBox,
      ]),
    ]);
    document.body.append(box);
    render();
  }
  function render() {
    if (!box) return;
    const done = S.items.filter(x => x.status === 'ok').length, bad = S.items.filter(x => x.status === 'gagal').length;
    status.textContent = S.items.length
      ? `${S.running ? '⏳ Sedang berjalan' : '⏸ Berhenti'} — siap ${done}/${S.items.length}${bad ? `, gagal ${bad}` : ''}`
      : 'Belum ada senarai. Tampal prompt dan tekan "Muat senarai".';
    bar.style.width = S.items.length ? (100 * done / S.items.length) + '%' : '0';
    startBtn.textContent = done && !S.running ? '▶ Sambung' : '▶ Mula';
    list.replaceChildren(...S.items.map((x, i) => el('div', {
      className: x.status || (S.running && i === S.idx ? 'cur' : ''),
      title: 'Klik untuk mula dari sini',
      style: 'cursor:pointer',
      onclick: () => { if (!S.running) { S.idx = i; save(); log(`Akan mula dari #${i + 1} ${x.name}`); } },
      textContent: `${x.status === 'ok' ? '✔' : x.status === 'gagal' ? '✖' : i === S.idx ? '➜' : '·'} ${i + 1}. ${x.name}`,
    })));
    logBox.textContent = S.log.slice(-60).join('\n');
    logBox.scrollTop = logBox.scrollHeight;
  }
  function load() {
    const items = parseList(ta.value);
    if (!items.length) { alert('Tiada prompt dijumpai. Pastikan setiap prompt bermula dengan baris "### nama.png" atau "1. nama.png".'); return; }
    if (S.items.length && !confirm(`Ganti senarai lama (${S.items.length}) dengan senarai baru (${items.length})?`)) return;
    Object.assign(S, { items, idx: 0, running: false, failStreak: 0 });
    save(); ta.value = '';
    log(`📋 ${items.length} prompt dimuat.`);
  }
  function start() {
    if (!S.items.length) { load(); if (!S.items.length) return; }
    S.running = true; S.failStreak = 0;
    if (nextIndex(S.idx) < 0) S.idx = 0;
    save(); log('Mula. Biarkan tab ini terbuka & kelihatan (jangan minimize).');
    runOne();
  }
  function stop() { S.running = false; save(); log('⏸ Dihentikan oleh pengguna.'); }
  function retryFailed() {
    S.items.forEach(x => { if (x.status === 'gagal') { x.status = ''; x.tries = 0; } });
    S.idx = 0; save(); log('Item gagal ditanda semula untuk dicuba.');
  }
  function reset() {
    if (!confirm('Padam senarai & kemajuan?')) return;
    S = JSON.parse(JSON.stringify(defaults)); save(); render();
  }

  build();
  if (S.running) { log('↪ Sambung selepas muat semula halaman...'); setTimeout(runOne, 3000); }
})();
