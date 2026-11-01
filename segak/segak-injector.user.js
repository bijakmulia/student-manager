// ==UserScript==
// @name         SEGAK Injector (SPPB)
// @namespace    bijakmulia.segak.injector
// @version      1.2.0
// @description  Isi skor SEGAK & BMI ke SPPB dengan 6 nombor setiap murid, termasuk autopilot sekelas. Percuma — Bijak Mulia.
// @author       Bijak Mulia (Arif Aziz)
// @match        https://moeissppb.moe.gov.my/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @downloadURL  https://bijakmulia.github.io/student-manager/segak/segak-injector.user.js
// @updateURL    https://bijakmulia.github.io/student-manager/segak/segak-injector.user.js
// @run-at       document-idle
// @noframes
// ==/UserScript==
/* Versi Tampermonkey bagi extension SEGAK Injector v1.2.0 (Edge Android / mana-mana pelayar dengan Tampermonkey).
   Penyesuai kecil di bawah menggantikan API chrome.* extension dengan fungsi GM_* Tampermonkey. */
/* globals GM_getValue, GM_setValue, GM_listValues, GM_notification, GM_registerMenuCommand */
const chrome = {
  runtime: {
    onMessage: { addListener() {} },
    sendMessage(m) { if (m && m.type === 'notify') try { GM_notification({ title: String(m.title || 'SEGAK Injector'), text: String(m.text || ''), timeout: 20000 }); } catch (e) {} }
  },
  storage: { local: {
    get(_, cb) { const d = {}; try { GM_listValues().forEach(k => { d[k] = GM_getValue(k); }); } catch (e) {} cb(d); },
    set(o) { Object.keys(o || {}).forEach(k => GM_setValue(k, o[k])); }
  } }
};

/* ============================================================
   TETAPAN PENJUAL — ubah fail ini sahaja sebelum muat naik
   ============================================================ */
self.SEGAK_CONFIG = {
  // Edisi percuma Bijak Mulia: semua ciri (termasuk autopilot sekelas) dibuka tanpa kod lesen.
  FREE_ALL: true,

  // Kunci awam RSA untuk semak kod lesen. JANGAN ubah kecuali awk jana kunci baharu dalam penjana-lesen.html.
  PUBLIC_KEY: {"kty":"RSA","n":"pVosMLuYyPkt5PskU_Uzr05ssSWZMkIjGmX8KHU7Oup_Ik6VaEhGDP2cB5IGTqyM1_Vpeq1edc6KMmvU5dOZ_dF7ECpoKlyzBYCsGJolORSqtNXQ6XRrKTfLq1ImgG4tp7nPmOrXtonmSANxZPRjvFQgqNCZEQ8RR53UcTeRmmUzL_Ws_3mJFExEiiIVtqGM6gUf3FnFQTbi5RkhY80YGP-18o_BO61gW7yrTeW-lXNRk2v8N2C1_gJS8h55CKIpmNqgMeqhLl6zLcMp7asVZMOGPLAnhklKQfPjdQhDIaLMZEw-h57EVVCOtUuhNtEFAf5V-Xi-tOC8qQtbxOOLUQ","e":"AQAB"},

  // URL kedai (Google Apps Script web app, berakhir dengan /exec).
  // Contoh: 'https://script.google.com/macros/s/AKfycb.../exec'
  // Boleh juga WhatsApp: 'https://wa.me/60123456789'
  BUY_URL: 'https://script.google.com/macros/s/AKfycbxTy_w9-P1pAkeYr3nCon09JcJ1KZPbyyCIbdyp1Y_s2y4VTEnkFZmQPjKV46pdEjwL/exec',

  // Teks harga pada butang Beli (kosongkan '' jika tak nak papar)
  PRICE: 'dari RM5',

  // Pakej dipapar dalam tab ⭐ Pro (harga sebenar ditetapkan di kedai Apps Script)
  PLANS: [
    { harga: 'RM5', tempoh: '1 minggu' },
    { harga: 'RM10', tempoh: '1 tahun' },
    { harga: 'RM29', tempoh: 'seumur hidup', best: true }
  ],

  // Cubaan percuma autopilot (jumlah murid sepanjang hayat pemasangan). 0 = tiada cubaan.
  TRIAL_STUDENTS: 5
};

/*!
 * SEGAK Injector — Chrome extension
 * (c) Arif Aziz. Hak cipta terpelihara.
 * Edisi percuma Bijak Mulia: semua ciri dibuka (FREE_ALL dalam config.js).
 */
(() => {
  'use strict';
  if (window.__sgkLoaded) return;
  window.__sgkLoaded = true;

  const __menu = [];
  chrome.runtime.onMessage.addListener(m => {
    if (m && m.type === 'open' && __menu[0]) __menu[0].fn();
  });

  // Muat semua data tersimpan dulu, kemudian jalankan panel (API sama seperti versi Tampermonkey)
  chrome.storage.local.get(null, data => {
    const __c = data || {};
    const GM_getValue = (k, d) => (Object.prototype.hasOwnProperty.call(__c, k) && __c[k] !== undefined ? __c[k] : d);
    const GM_setValue = (k, v) => {
      __c[k] = v;
      try { chrome.storage.local.set({ [k]: v }); } catch (e) { /* extension dimuat semula */ }
    };
    const GM_registerMenuCommand = (name, fn) => { __menu.push({ name, fn }); };
    const GM_notification = o => {
      try { chrome.runtime.sendMessage({ type: 'notify', title: o.title, text: o.text }); } catch (e) { /* abai */ }
    };

    (function () {
      'use strict';

      /* ================= KONFIGURASI =================
         Format data: BERAT TINGGI NTB TT RTS JM   (contoh: 63 155 120 20 14 46) */
      const FIELDS = [
        { k: 'berat',  s: 'Berat',  l: 'Berat (kg)',              re: /berat|weight/i,           min: 15, max: 200 },
        { k: 'tinggi', s: 'Tinggi', l: 'Tinggi (m)',              re: /tinggi|height/i,          min: 90, max: 220 },
        { k: 'ntb',    s: 'NTB',    l: 'Naik Turun Bangku',       re: /bangku|ntb|denyut|step/i, min: 40, max: 220, test: true },
        { k: 'tt',     s: 'TT',     l: 'Tekan Tubi',              re: /tekan|push/i,             min: 0,  max: 40,  test: true },
        { k: 'rts',    s: 'RTS',    l: 'Ringkuk Tubi Separa',     re: /ringkuk|curl|sit.?up/i,   min: 0,  max: 25,  test: true },
        { k: 'jm',     s: 'JM',     l: 'Jangkauan Melunjur (cm)', re: /jangkau|melunjur|reach/i, min: 0,  max: 60,  test: true }
      ];
      const HOST = location.hostname;
      const S = { get: (k, d) => GM_getValue(k, d), set: (k, v) => GM_setValue(k, v) };
      const pad = n => String(n).padStart(2, '0');
      const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

      let map     = S.get('map_' + HOST, {});
      let opts    = Object.assign({ tinggiM: true, fillDate: true, tarikh: '', autoSave: false, clamp: true, sound: true }, S.get('opts', {}));
      let classes = S.get('classes', {});
      let sel     = S.get('selCls', '');
      let run     = S.get('run', null);
      if (run && (!Array.isArray(run.q) || typeof run.q[0] !== 'object')) run = null;   // format lama v2.0
      let lim     = S.get('lim', {});   // had nilai SPPB (unit borang; tinggi dalam meter)
      if (!lim.tt || lim.tt.max == null || lim.tt.max === '') { lim.tt = Object.assign({}, lim.tt, { max: 40 }); S.set('lim', lim); }   // had SPPB: tekan tubi maks 40
      if (!lim.rts || lim.rts.max == null || lim.rts.max === '') { lim.rts = Object.assign({}, lim.rts, { max: 25 }); S.set('lim', lim); }   // had SPPB: ringkuk tubi separa maks 25
      if (!lim.jm || lim.jm.max == null || lim.jm.max === '' || +lim.jm.max > 60) { lim.jm = Object.assign({}, lim.jm, { max: 60 }); S.set('lim', lim); }   // had: jangkauan melunjur maks 60 cm
      /* Migrasi: kunci kelas lama (path) → ID kelas */
      Object.keys(classes).forEach(k => {
        const m = k.match(/\/keputusan\/(?:segak|bmi)\/(\d+)/i);
        if (m && m[1] !== k) { classes[m[1]] = classes[k]; delete classes[k]; if (sel === k) sel = m[1]; }
      });
      if (run) run.q.forEach(x => { const m = String(x.k).match(/(\d+)$/); if (m) x.k = m[1]; });
      S.set('classes', classes); S.set('selCls', sel);
      let pos     = S.get('pos', null);
      let mini    = S.get('mini', false);
      let picking = null;
      /* Kelas baru belum ditarik: senarai dikosongkan supaya data tak tersilap masuk kelas lain */
      let pend = '', pendSkip = '', baruN = 0;

      /* ================= UTIL ================= */
      const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const norm = s => String(s).toUpperCase().replace(/\s+/g, ' ').trim();
      const digits = t => String(t).replace(/[-\s]/g, '');
      const qs = sel => { try { return document.querySelector(sel); } catch (e) { return null; } };
      const shown = el => !!el && el.getClientRects().length > 0;
      const visible = el => shown(el) && !el.disabled && !el.readOnly;
      const tarikh = () => opts.tarikh || today();
      const saveClasses = () => S.set('classes', classes);
      const cls = () => (pend ? null : classes[sel]);

      function pageText() {
        return [...document.body.children].filter(c => c !== root).map(c => c.innerText || '').join('\n');
      }
      function pageType() {
        const p = location.pathname;
        if (/(segak|bmi)-skor\//i.test(p)) return 'form';
        if (/\/keputusan\/(segak|bmi)\/\d+/i.test(p)) return 'list';
        return 'other';
      }
      /* ID kelas sama untuk modul SEGAK & BMI: /keputusan/segak/1398048 = /keputusan/bmi/1398048 */
      const pathId = p => { const m = String(p).match(/\/keputusan\/(?:segak|bmi)\/(\d+)/i); return m ? m[1] : ''; };
      // No. KP murid yang tersenarai dalam jadual halaman SPPB
      function pageICs() {
        const out = new Set();
        document.querySelectorAll('tr').forEach(tr => {
          if (root.contains(tr)) return;
          [...tr.children].forEach(td => { const v = digits((td.innerText || '').trim()); if (/^\d{12}$/.test(v)) out.add(v); });
        });
        return [...out];
      }

      function parse(str) {
        const p = String(str).trim().split(/[\s,;\t]+/).filter(Boolean);
        if (p.length !== 6) return { err: `Perlu 6 nombor (ada ${p.length})` };
        const n = p.map(Number);
        if (n.some(isNaN)) return { err: 'Ada nilai bukan nombor' };
        return { vals: n };
      }
      const toCm = t => (t < 3 ? t * 100 : t);
      function fmt(v) {
        const cm = toCm(v[1]);
        return {
          berat: String(v[0]),
          tinggi: opts.tinggiM ? (cm / 100).toFixed(2) : String(Math.round(cm * 10) / 10),
          ntb: String(v[2]), tt: String(v[3]), rts: String(v[4]), jm: String(v[5])
        };
      }
      function warnings(v) {
        const w = [];
        FIELDS.forEach((f, i) => {
          const x = f.k === 'tinggi' ? toCm(v[i]) : v[i];
          if (x < f.min || x > f.max) w.push(`${f.s} ${v[i]} luar biasa`);
        });
        return w;
      }

      function cssPath(el) {
        const badId = id => /\d{2,}$|^(mat|cdk|ng|input|v)-/.test(id);
        if (el.id && !badId(el.id)) {
          const s = '#' + CSS.escape(el.id);
          if (document.querySelectorAll(s).length === 1) return s;
        }
        for (const a of ['name', 'formcontrolname', 'placeholder', 'aria-label']) {
          const v = el.getAttribute(a);
          if (v) {
            const s = `${el.tagName.toLowerCase()}[${a}="${v.replace(/"/g, '\\"')}"]`;
            if (document.querySelectorAll(s).length === 1) return s;
          }
        }
        const parts = [];
        let n = el;
        while (n && n.nodeType === 1 && n !== document.body) {
          if (n.id && !badId(n.id)) { parts.unshift('#' + CSS.escape(n.id)); n = null; break; }
          let s = n.tagName.toLowerCase();
          const p = n.parentElement;
          if (p) {
            const sib = [...p.children].filter(c => c.tagName === n.tagName);
            if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(n) + 1})`;
          }
          parts.unshift(s);
          n = p;
        }
        if (n === document.body) parts.unshift('body');
        return parts.join(' > ');
      }

      function nearText(el) {
        const b = [el.id, el.name, el.placeholder, el.title, el.getAttribute('aria-label'), el.getAttribute('formcontrolname')];
        if (el.labels) [...el.labels].forEach(l => b.push(l.innerText));
        if (el.id) { const lb = qs(`label[for="${CSS.escape(el.id)}"]`); if (lb) b.push(lb.innerText); }
        const ps = el.previousElementSibling, ns = el.nextElementSibling;
        if (ps) b.push((ps.innerText || '').slice(0, 40));
        if (ns && ns.tagName === 'LABEL') b.push(ns.innerText);
        const p = el.parentElement;
        if (p) { const t = (p.innerText || '').trim(); if (t.length < 40) b.push(t); }
        return b.filter(Boolean).join(' ');
      }
      function farText(el) {
        const b = [];
        const g = el.closest('tr, .form-group, .v-input, .form-outline, .form-floating, mat-form-field, .input-group');
        if (g) b.push(g.innerText.slice(0, 140));
        let p = el.parentElement;
        for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
          const t = (p.innerText || '').trim();
          if (t && t.length < 80) { b.push(t); break; }
        }
        return b.join(' ');
      }
      /* Pengesanan ikut struktur borang SPPB (paling tepat, tak kira borang kosong atau berisi) */
      const isDataInput = i => !root.contains(i) && shown(i) && !i.readOnly && !i.disabled &&
        !/^(hidden|date|checkbox|radio|button|submit)$/i.test(i.type || '') &&
        !/dd|yyyy|tarikh/i.test([i.placeholder, i.name].join(' '));
      /* Kotak milik label: label[for], input dalam label, atau satu-satunya kotak dalam bekas kecil yang sama.
         (SPPB guna label terapung — label diletak SELEPAS kotak dalam kod, jadi jangan ikut "kotak selepas label") */
      function inputOfLabel(lab, used) {
        if (lab.tagName === 'LABEL') {
          const byFor = lab.htmlFor && document.getElementById(lab.htmlFor);
          if (byFor && isDataInput(byFor) && !used.has(byFor)) return byFor;
          const inner = lab.querySelector('input');
          if (inner && isDataInput(inner) && !used.has(inner)) return inner;
        }
        let box = lab.parentElement;
        for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
          const ins = [...box.querySelectorAll('input')].filter(x => isDataInput(x) && !used.has(x));
          if (ins.length === 1) return ins[0];
          if (ins.length > 1) return null;            // bekas terlalu besar (ada kotak lain) → tak pasti, jangan teka
        }
        return null;
      }
      function sppbDetect() {
        const out = {};
        // Jadual Norma Ujian: lajur pertama = nama ujian, kotak Dapatan = input bukan-tarikh dalam baris itu
        document.querySelectorAll('tr').forEach(tr => {
          if (root.contains(tr) || !tr.cells || !tr.cells[0]) return;
          const name = tr.cells[0].innerText || '';
          const f = FIELDS.find(x => x.test && x.re.test(name));
          if (!f || out[f.k]) return;
          const inp = [...tr.querySelectorAll('input')].find(isDataInput);
          if (inp) out[f.k] = inp;
        });
        // Tinggi / Berat: kotak yang berkongsi bekas kecil dengan labelnya
        const used = new Set(Object.values(out));
        ['tinggi', 'berat'].forEach(k => {
          const f = FIELDS.find(x => x.k === k);
          const labs = [...document.querySelectorAll('label, span, div, p, th, td, legend')].filter(e =>
            !root.contains(e) && e.children.length === 0 && f.re.test(e.innerText || '') && (e.innerText || '').trim().length < 30);
          for (const lab of labs) {
            const inp = inputOfLabel(lab, used);
            if (inp) { out[k] = inp; used.add(inp); break; }
          }
        });
        return out;
      }

      function autoDetect() {
        const sp = sppbDetect();
        const h = heurDetect(new Set(Object.values(sp)));
        const out = { _src: {} };
        FIELDS.forEach(f => {
          if (sp[f.k]) { out[f.k] = sp[f.k]; out._src[f.k] = 'sppb'; }
          else if (h[f.k]) { out[f.k] = h[f.k]; out._src[f.k] = 'heur'; }
        });
        return out;
      }

      function heurDetect(taken) {
        const inputs = [...document.querySelectorAll('input, select, textarea')].filter(el => !taken.has(el) &&
          !root.contains(el) && visible(el) &&
          !/^(hidden|checkbox|radio|submit|button|file|date|datetime-local|password)$/i.test(el.type || '') &&
          !/dd|yyyy|tarikh|tapis|cari|search/i.test([el.placeholder, el.name].join(' ')));
        const near = inputs.map(nearText), far = inputs.map(farText);
        const used = new Set(), out = {};
        FIELDS.forEach(f => {
          let i = inputs.findIndex((el, j) => !used.has(el) && f.re.test(near[j]));
          if (i < 0) i = inputs.findIndex((el, j) => !used.has(el) && f.re.test(far[j]) &&
            FIELDS.filter(g => g.re.test(far[j])).length === 1);
          if (i >= 0) { used.add(inputs[i]); out[f.k] = inputs[i]; }
        });
        return out;
      }
      function getEl(k, det) {
        if (det && det._src && det._src[k] === 'sppb') return det[k];   // struktur SPPB paling tepat
        const el = map[k] ? qs(map[k]) : null;
        if (el && visible(el)) return el;           // pemetaan manual hanya dipakai jika kotak itu boleh diisi
        return det ? det[k] : null;
      }
      /* Hidupkan suis "Ditaksir" jika OFF (kotak borang dikunci bila OFF) */
      function ensureDitaksir() {
        const cands = [...document.querySelectorAll('input[type=checkbox], [role=switch]')].filter(x => !root.contains(x));
        const sw = cands.find(x => {
          const lab = x.labels && x.labels.length ? [...x.labels].map(l => l.innerText).join(' ') : '';
          let p = x.parentElement, txt = '';
          for (let i = 0; i < 3 && p; i++, p = p.parentElement) { const t = (p.innerText || '').trim(); if (t.length < 40) txt = t; else break; }
          return /DITAKSIR/i.test(lab + ' ' + txt + ' ' + (x.getAttribute('aria-label') || ''));
        });
        if (!sw) return false;
        const on = sw.type === 'checkbox' ? sw.checked : sw.getAttribute('aria-checked') === 'true';
        if (on) return false;
        clickEl(sw.type === 'checkbox' && !shown(sw) && sw.labels && sw.labels[0] ? sw.labels[0] : sw);
        return true;
      }
      const lockedInputs = () => [...document.querySelectorAll('input')].filter(i => !root.contains(i) && shown(i) && (i.disabled || i.readOnly) && i.type !== 'hidden').length;

      function findBtn(txt) {
        return [...document.querySelectorAll('button, a, [role=button], input[type=submit], input[type=button]')]
          .find(b => !root.contains(b) && shown(b) && norm(b.innerText || b.value || '') === txt);
      }
      const saveBtn = () => (map.save && qs(map.save)) || findBtn('SIMPAN');

      /* Ganti nilai: padam isi lama dulu, kemudian taip nilai baru (macam papan kekunci) */
      function setVal(el, v) {
        v = String(v);
        el.focus();
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
          : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        // 1. Kosongkan kotak
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        // 2. Taip nilai baru — paling serasi dengan borang Vue/React SPPB
        let ok = false;
        if (!(el instanceof HTMLSelectElement) && el.type !== 'date') {
          try { el.select(); ok = document.execCommand('insertText', false, v) && el.value === v; } catch (e) { ok = false; }
        }
        // 3. Jika cara taip tak jalan, set terus
        if (!ok) { setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }
        ['change', 'keyup'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      function flash(el, color) {
        if (!el) return;
        const o = el.style.outline;
        el.style.outline = `3px solid ${color || '#16a34a'}`;
        setTimeout(() => { el.style.outline = o; }, 1200);
      }
      function fillDate(dapEl) {
        const row = dapEl.closest('tr');
        if (!row) return;
        const d = [...row.querySelectorAll('input')].find(i => i !== dapEl && !i.disabled &&
          (i.type === 'date' || /dd|yyyy|tarikh|date/i.test([i.placeholder, i.name, i.id].join(' '))));
        if (!d) return;
        const [y, m, dd] = tarikh().split('-');
        const val = d.type === 'date' ? `${y}-${m}-${dd}` : (/mm\/dd/i.test(d.placeholder || '') ? `${m}/${dd}/${y}` : `${dd}/${m}/${y}`);
        setVal(d, val);
        flash(d, '#0ea5e9');
      }
      /* Klik walaupun butang terlindung (zoom / scroll mendatar) — tak perlu nampak di skrin */
      function clickEl(el) {
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) { /* abai */ }
        const tgt = el.closest('a, button, [role=button]') || el;
        if (typeof tgt.click === 'function') tgt.click();
        else tgt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }

      /* ================= UMUR & KADAR NADI MAKSIMUM =================
         NTB (denyutan seminit) tak boleh melebihi kadar nadi maksimum murid = 220 − umur.
         Umur diambil dari: borang murid ("Umur :") → lajur UMUR senarai kelas → tahun lahir dalam MyKid. */
      const thisYear = () => new Date().getFullYear();
      function ageFromIC(ic) {
        const m = String(ic || '').match(/^(\d{2})(\d{2})(\d{2})/);
        if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
        const yy = +m[1], cur = thisYear() % 100;
        const a = thisYear() - ((yy <= cur ? 2000 : 1900) + yy);
        return a >= 5 && a <= 25 ? a : null;
      }
      function ageFromPage() {
        if (pageType() !== 'form') return null;
        const n = parseInt(infoVal(pageText(), 'Umur'), 10);
        return n >= 5 && n <= 25 ? n : null;
      }
      const ageOf = s => (s && ((+s.age >= 5 && +s.age <= 25 ? +s.age : null) || ageFromIC(s.ic))) || null;
      const maxHR = age => (age ? 220 - age : null);
      let curAge = null;   // umur murid bagi borang yang sedang diisi

      /* ================= HAD NILAI (RALAT) ================= */
      // Had datang dari 4 sumber: atribut min/max kotak SPPB, mesej ralat SPPB (dipelajari), jadual Tetapan, dan nadi maks ikut umur (NTB).
      function clampField(k, num, el, age = curAge) {
        if (!opts.clamp) return num;
        let mn = lim[k] && lim[k].min != null && lim[k].min !== '' ? +lim[k].min : null;
        let mx = lim[k] && lim[k].max != null && lim[k].max !== '' ? +lim[k].max : null;
        if (k === 'ntb' && age) mx = mx == null ? maxHR(age) : Math.min(mx, maxHR(age));
        if (el) {
          if (el.min !== '' && el.min != null && !isNaN(+el.min)) mn = mn == null ? +el.min : Math.max(mn, +el.min);
          if (el.max !== '' && el.max != null && !isNaN(+el.max)) mx = mx == null ? +el.max : Math.min(mx, +el.max);
        }
        let r = num;
        if (mx != null && r > mx) r = mx;
        if (mn != null && r < mn) r = mn;
        return r;
      }
      /* Pengawal: kotak Tinggi mesti di bawah label "Tinggi", kotak Berat di bawah label "Berat". Kalau tertukar, tukar balik. */
      // Label sebenar sesuatu kotak = teks dalam bekas kecilnya sendiri (bekas yang hanya ada kotak itu)
      function labelOf(el) {
        if (el.labels && el.labels.length) {
          const t = [...el.labels].map(l => l.innerText).join(' ');
          if (/tinggi/i.test(t)) return 'tinggi';
          if (/berat/i.test(t)) return 'berat';
        }
        let box = el.parentElement;
        for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
          const ins = [...box.querySelectorAll('input')].filter(x => !root.contains(x) && shown(x) && x.type !== 'hidden');
          if (ins.length > 1) break;
          const t = box.innerText || '';
          if (/tinggi/i.test(t) && !/berat|bmi/i.test(t)) return 'tinggi';
          if (/berat/i.test(t) && !/tinggi|bmi/i.test(t)) return 'berat';
          if (/bmi|taksiran/i.test(t)) return 'lain';
        }
        return null;
      }
      function fixTB(els) {
        const t = els.tinggi, b = els.berat;
        if (t && b && t !== b && labelOf(t) === 'berat' && labelOf(b) === 'tinggi') { els.tinggi = b; els.berat = t; return; }
        // Kotak yang labelnya jelas bukan miliknya → jangan isi (lebih baik ⚠ semak daripada simpan salah tempat)
        if (t && ['berat', 'lain'].includes(labelOf(t))) els.tinggi = null;
        if (b && ['tinggi', 'lain'].includes(labelOf(b))) els.berat = null;
      }
      function plan(vals, det) {
        const v = fmt(vals), els = {}, miss = [], notes = [], out = {};
        FIELDS.forEach(f => { els[f.k] = getEl(f.k, det); });
        fixTB(els);
        FIELDS.forEach(f => {
          const el = els[f.k];
          if (!el) { miss.push(f.s); return; }
          const num = parseFloat(v[f.k]);
          const c = clampField(f.k, num, el);
          if (c !== num) notes.push(`${f.s} ${v[f.k]}→${f.k === 'tinggi' ? c.toFixed(2) : c}` +
            (f.k === 'ntb' && curAge && c === maxHR(curAge) ? ` (nadi maks, umur ${curAge})` : ''));
          out[f.k] = c === num ? v[f.k] : (f.k === 'tinggi' ? c.toFixed(2) : String(c));
        });
        return { els, miss, notes, out };
      }
      function fieldErrors(det) {
        const res = [];
        FIELDS.forEach(f => {
          const el = getEl(f.k, det);
          if (!el) return;
          const box = el.closest('td, .v-input, .form-group, .form-outline, mat-form-field') || el.parentElement;
          const msgs = [...box.querySelectorAll('.invalid-feedback, .error--text, .v-messages__message, .text-danger, .error, small, span, div')]
            .filter(m => !m.contains(el) && shown(m) && !m.querySelector('input'))
            .map(m => (m.innerText || '').trim())
            .filter(t => t && t.length < 120 && /maks|max|melebihi|minim|\bmin\b|kurang|antara|ralat|tidak sah|invalid|julat|hingga|had/i.test(t));
          const bad = el.classList.contains('is-invalid') || el.getAttribute('aria-invalid') === 'true' || (el.validity && (el.validity.rangeOverflow || el.validity.rangeUnderflow));
          if (msgs.length || bad) res.push({ f, msg: [...new Set(msgs)].join(' ') });
        });
        return res;
      }
      function learn(f, t) {
        const nums = (String(t).match(/\d+(?:[.,]\d+)?/g) || []).map(x => parseFloat(x.replace(',', '.')));
        if (!nums.length) return false;
        const L = lim[f.k] || (lim[f.k] = {});
        if (nums.length >= 2 && /antara|hingga|julat|between|\d\s*-\s*\d/i.test(t)) { L.min = Math.min(nums[0], nums[1]); L.max = Math.max(nums[0], nums[1]); }
        else if (/maks|max|melebihi|lebih/i.test(t)) L.max = nums[nums.length - 1];
        else if (/minim|\bmin\b|kurang/i.test(t)) L.min = nums[nums.length - 1];
        else return false;
        S.set('lim', lim);
        renderLim();
        return true;
      }
      function learnFromPopup(tx) {
        const hit = FIELDS.filter(f => f.re.test(tx));
        return hit.length === 1 ? learn(hit[0], tx) : false;
      }

      /* ================= ISI BORANG ================= */
      function fillForm(vals, quiet) {
        const det = autoDetect();
        const p = plan(vals, det);
        if (p.miss.length) {
          if (!quiet) st(`Kotak tak jumpa: ${p.miss.join(', ')}. Pastikan "Ditaksir" ON, atau Tetapan → Pilih.`, 'err');
          return false;
        }
        FIELDS.forEach(f => {
          setVal(p.els[f.k], p.out[f.k]);
          flash(p.els[f.k], p.notes.some(n => n.startsWith(f.s + ' ')) ? '#f59e0b' : '#16a34a');
          if (f.test && opts.fillDate) fillDate(p.els[f.k]);
        });
        if (!quiet) st(`✓ Diisi: ${FIELDS.map(f => p.out[f.k]).join(' · ')}${p.notes.length ? ' · dibetulkan: ' + p.notes.join(', ') : ''}`, p.notes.length ? 'warn' : 'ok');
        return { notes: p.notes };
      }
      function formHas(vals) {
        const det = autoDetect(), p = plan(vals, det);
        return !p.miss.length && FIELDS.every(f => parseFloat(p.els[f.k].value) === parseFloat(p.out[f.k]));
      }
      function inject(vals, age) {
        curAge = ageFromPage() || age || null;
        if (!fillForm(vals)) return false;
        setTimeout(() => {
          const errs = fieldErrors(autoDetect());
          if (errs.length) {
            const learned = errs.map(e => learn(e.f, e.msg)).some(Boolean);
            if (learned && opts.clamp) { fillForm(vals); st('Had baru dipelajari & nilai dibetulkan. Semak, kemudian Simpan.', 'warn'); }
            else st('⚠ Ralat: ' + errs.map(e => e.f.s + (e.msg ? ` (${e.msg})` : '')).join(', '), 'err');
            return;
          }
          if (opts.autoSave) {
            const b = saveBtn();
            if (b) b.click(); else st('Data diisi, tapi butang Simpan tak jumpa.', 'warn');
          }
        }, 900);
        return true;
      }
      /* Popup SweetAlert / dialog laman */
      function popup() {
        return [...document.querySelectorAll('.swal2-popup, .modal.show, [role=dialog], [role=alertdialog], .v-dialog--active')]
          .find(d => !root.contains(d) && shown(d) && (d.innerText || '').trim());
      }
      function clickPopupBtn(pop, re) {
        const btns = [...pop.querySelectorAll('button')].filter(shown);
        const b = btns.find(x => (re || /^(OK|BAIK|TUTUP|YA)$/).test(norm(x.innerText))) ||
          (!re && (pop.querySelector('.swal2-confirm') || btns[0]));
        if (b) { b.click(); return true; }
        return false;
      }

      /* ================= KELAS ================= */
      const TK = { SATU: 1, DUA: 2, TIGA: 3, EMPAT: 4, LIMA: 5, ENAM: 6 };
      function infoVal(txt, label) {
        const m = txt.match(new RegExp(label + '\\s*:\\s*([^\\n]+)', 'i'));
        return m ? m[1].trim() : '';
      }
      function shortName(tk, kelas) {
        let s = norm(tk);
        const m = s.match(/(TINGKATAN|TAHUN)\s+(\w+)/);
        if (m) s = (m[1] === 'TINGKATAN' ? 'T' : 'Thn ') + (TK[m[2]] || m[2]);
        return (s + ' ' + norm(kelas)).trim();
      }
      function rowStatus(tr) { return /BELUM DITAKSIR/.test(norm(tr.innerText)) ? 'belum' : 'ada'; }
      function findRow(ic) {
        return [...document.querySelectorAll('tr')].find(tr => !root.contains(tr) && digits(tr.innerText || '').includes(ic));
      }
      function clickEdit(row) {
        const c = row.querySelector('a[href*="skor"]') ||
          [...row.querySelectorAll('a, button, [role=button]')].pop() ||
          [...row.querySelectorAll('svg, i, .mdi, .fa, [class*=pencil], [class*=edit]')].pop();
        if (!c) return false;
        clickEl(c);
        return true;
      }

      function grabClass() {
        if (pageType() !== 'list') { st('Buka halaman senarai kelas dulu (klik kad kelas di Dashboard).', 'err'); return; }
        const txt = pageText();
        const name = shortName(infoVal(txt, 'Tahun\\s*\\/\\s*Tingkatan'), infoVal(txt, 'Nama Kelas')) || 'Kelas';
        const studs = [];
        const umurCol = new Map();   // indeks lajur "UMUR" bagi setiap jadual
        const colOf = tbl => {
          if (!tbl) return -1;
          if (!umurCol.has(tbl)) {
            const h = [...tbl.querySelectorAll('tr')].find(r => r.querySelector('th') && /UMUR/i.test(r.innerText || ''));
            umurCol.set(tbl, h ? [...h.children].findIndex(c => /^\s*UMUR\s*$/i.test(c.innerText || '')) : -1);
          }
          return umurCol.get(tbl);
        };
        document.querySelectorAll('tr').forEach(tr => {
          if (root.contains(tr)) return;
          const cells = [...tr.children].map(td => (td.innerText || '').replace(/\s+/g, ' ').trim());
          const i = cells.findIndex(c => /^\d{12}$/.test(digits(c)));
          if (i < 1) return;
          const ic = digits(cells[i]);
          const ui = colOf(tr.closest('table'));
          const a = ui >= 0 ? parseInt(cells[ui], 10) : NaN;
          const age = a >= 5 && a <= 25 ? a : ageFromIC(ic);
          if (!studs.some(s => s.ic === ic)) studs.push({ ic, name: cells[i - 1], page: rowStatus(tr), age });
        });
        if (!studs.length) { st('Senarai murid tak jumpa di halaman ini.', 'err'); return; }
        const key = pathId(location.pathname), old = classes[key];
        classes[key] = {
          name: old ? old.name : name,
          url: location.href,
          students: studs.map(s => Object.assign({ vals: null, status: '' }, old && old.students.find(x => x.ic === s.ic), s))
        };
        saveClasses();
        sel = key; S.set('selCls', sel);
        pend = ''; pendSkip = ''; baruN = 0;
        renderClasses();
        st(`📋 ${classes[key].name}: ${studs.length} murid disimpan. Cari nama & isi data.`, 'ok');
      }

      /* ================= LESEN PRO =================
         Percuma : suntik seorang demi seorang (Mod Pantas & "Isi borang ini")
         Pro     : autopilot pukal (Suntik kelas ini / Suntik semua kelas)
         Kod lesen = data.tandatangan (RSA-SHA256 atas teks "data"). Hanya penjual (kunci peribadi) boleh jana kod sah. Semakan tanpa internet. */
      const CFG = self.SEGAK_CONFIG || {};
      let pro = { ok: false, ready: false, why: '', d: null };
      function b64u(s) {
        s = String(s).replace(/-/g, '+').replace(/_/g, '/');
        s += '='.repeat((4 - s.length % 4) % 4);
        return Uint8Array.from(atob(s), c => c.charCodeAt(0));
      }
      async function checkLicense(code) {
        code = String(code || '').replace(/\s+/g, '');
        if (!code) return { ok: false, why: '' };
        try {
          const [p, sg] = code.split('.');
          if (!p || !sg) return { ok: false, why: 'Format kod lesen salah' };
          const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
          const key = await crypto.subtle.importKey('jwk', CFG.PUBLIC_KEY, alg, false, ['verify']);
          const good = await crypto.subtle.verify(alg, key, b64u(sg), new TextEncoder().encode(p));
          if (!good) return { ok: false, why: 'Kod lesen tidak sah' };
          const d = JSON.parse(new TextDecoder().decode(b64u(p)));
          if (d.e && d.e < today()) return { ok: false, why: `Lesen tamat pada ${d.e}`, d };
          return { ok: true, d };
        } catch (e) { return { ok: false, why: 'Kod lesen tidak sah' }; }
      }
      // Nama akaun SPPB di penjuru atas, contoh "FARHANA BINTI ILIAS (SMA TARBIAH ISLAMIAH)"
      function accountName() {
        const els = [...document.querySelectorAll('header *, nav *, .navbar *, .v-toolbar *, .topbar *, span, div, a, p')]
          .filter(e => !root.contains(e) && e.children.length === 0);
        for (const e of els) {
          const t = (e.innerText || '').trim();
          const m = t.match(/^([A-Z][A-Z@'.\/ -]{4,})\s*\(([^)]+)\)$/);
          if (m && t.length < 140) { const r = e.getBoundingClientRect(); if (r.top < 160) return norm(m[1]); }
        }
        return '';
      }
      const licFor = d => (!d || !d.n || d.n === '*') ? 'semua akaun' : d.n;
      const daysLeft = e => (e ? Math.ceil((new Date(e + 'T23:59:59') - new Date()) / 864e5) : null);
      function proOK() {
        if (!pro.ok) return false;
        const n = pro.d && pro.d.n;
        if (!n || n === '*') return true;
        const acc = accountName();
        return acc ? acc === norm(n) : norm(pageText()).includes(norm(n));
      }
      const trialLeft = () => Math.max(0, (+CFG.TRIAL_STUDENTS || 0) - (+S.get('trialUsed', 0) || 0));
      function showPro(msg) {
        setMini(false);
        const tb = root.querySelector('[data-t="pro"]');
        if (tb) tb.click();
        st(msg || '🔒 Autopilot pukal ialah ciri Pro. Suntik seorang demi seorang kekal percuma.', 'warn');
      }
      function renderPro() {
        const box = $('sgk-prost');
        if (!box) return;
        const acc = accountName();
        let h;
        if (pro.ok) {
          h = `<b>⭐ PRO aktif</b><br><small>Untuk: ${esc(licFor(pro.d))} · ${pro.d.e ? 'sah hingga ' + esc(pro.d.e) : 'seumur hidup'}</small>`;
          const left = daysLeft(pro.d.e);
          if (left != null && left <= 3) h += `<br><small class="w">⏳ Lesen tamat dalam ${left} hari — perbaharui di bawah.</small>`;
          if (!proOK() && acc) h += `<br><small class="w">⚠ Akaun SPPB sekarang (${esc(acc)}) bukan pemilik lesen ini.</small>`;
        } else {
          h = `<b>Versi Percuma</b><br><small>Cubaan autopilot: <b>${trialLeft()}</b> murid lagi.</small>` +
            (pro.why ? `<br><small class="w">${esc(pro.why)}</small>` : '');
        }
        h += `<div class="acc">Nama akaun SPPB: <b>${acc ? esc(acc) : '— buka SPPB dulu —'}</b>${acc ? ' <button class="btn" data-a="copyacc">Salin</button>' : ''}</div>`;
        box.innerHTML = h;
        const buy = $('sgk-buy');
        const left = pro.ok ? daysLeft(pro.d.e) : null;
        const showBuy = !pro.ok || (left != null && left <= 3);
        if (buy) { buy.hidden = !showBuy; buy.textContent = (pro.ok ? '🔁 Perbaharui Pro' : '🛒 Beli Pro') + (CFG.PRICE ? ` — ${CFG.PRICE}` : ''); }
        const pl = $('sgk-plans');
        if (pl) {
          pl.hidden = !showBuy;
          pl.innerHTML = (CFG.PLANS || []).map(x => `<div class="plan ${x.best ? 'best' : ''}"><b>${esc(x.harga)}</b>${esc(x.tempoh)}</div>`).join('');
        }
        $('sgk-licoff').hidden = !pro.ok;
        root.classList.toggle('is-pro', pro.ok);
      }

      /* ================= AUTOPILOT ================= */
      /* Fasa: open → opening → filled → saving → leaving → (murid seterusnya) */
      const saveRun = () => S.set('run', run);
      function setPh(ph) { run.ph = ph; run.t = Date.now(); run.conf = false; run.backed = false; run.tutup = false; run.nav = 0; if (ph === 'open') run.dit = false; saveRun(); }
      function advance() { run.i++; run.fix = 0; if (run.stop) run.i = run.q.length; }
      function nextStu() { advance(); setPh('open'); renderList(); }
      const curItem = () => run && run.q[run.i];
      const pendingOf = k => (classes[k] ? classes[k].students.filter(s => s.vals && s.status !== 'done') : []);

      function startRun(all) {
        if (!all && pend) { st('⚠ Kelas ini belum ditarik. Tekan 📋 Ambil kelas dulu.', 'warn'); return; }
        const keys = all ? Object.keys(classes) : [sel];
        const pt = pageType(), d = pt === 'form' ? digits(pageText()) : '';
        let q = [];
        keys.forEach(k => pendingOf(k).forEach(s => q.push({ k, ic: s.ic })));
        if (!q.length) { st('Tiada murid yang ada data untuk disuntik.', 'err'); return; }
        // Mula dari tempat awk berada: kelas semasa dulu, murid semasa dulu
        const curK = pt === 'list' ? pathId(location.pathname) : (pt === 'form' ? (q.find(x => d.includes(x.ic)) || {}).k : null);
        if (curK) q = [...q.filter(x => x.k === curK), ...q.filter(x => x.k !== curK)];
        if (pt === 'form') { const j = q.findIndex(x => d.includes(x.ic)); if (j > 0) q.unshift(q.splice(j, 1)[0]); }
        let trial = false, left = 0;
        if (!pro.ready) { st('Menyemak lesen… cuba lagi sebentar.', 'warn'); return; }
        if (!proOK()) {
          if (pro.ok) { showPro(`🔒 Lesen Pro ini untuk akaun ${licFor(pro.d)}. Akaun SPPB sekarang lain.`); return; }
          left = trialLeft();
          if (!left) { showPro(); return; }
          trial = true;
          if (q.length > left) q = q.slice(0, left);
        }
        const nCls = new Set(q.map(x => x.k)).size;
        const w = q.filter(x => { const s = classes[x.k].students.find(y => y.ic === x.ic); return warnings(s.vals).length; }).length;
        if (!confirm((trial ? `🎁 CUBAAN PERCUMA PRO — baki ${left} murid.\nSelepas ini autopilot perlukan lesen Pro (suntik seorang demi seorang kekal percuma).\n\n` : '') +
          `Suntik ${q.length} murid dalam ${nCls} kelas?\n\nSkrip akan pilih kelas, buka borang murid, isi, Simpan, tutup borang dan teruskan sendiri.` +
          (w ? `\n\n⚠ ${w} murid ada nilai luar biasa.` : '') + '\n\nTekan ■ Henti untuk berhenti (borang akan ditutup dulu).')) return;
        run = { q, i: 0, f: 0, lastK: q[0].k, trial };
        setPh('open');
        renderList();
        setMini(true);                     // kecilkan jadi butang terapung ▶ merah semasa autopilot
      }
      let lastWasTrial = false;
      function stopRun(msg, type, alertUser) {
        lastWasTrial = !!(run && run.trial);
        run = null; S.set('run', null);
        if (lastWasTrial && !pro.ok && !trialLeft()) msg = (msg || '') + ' · Cubaan percuma habis — dapatkan ⭐ Pro untuk autopilot seterusnya.';
        renderList();
        st(msg || '■ Dihentikan', type || 'warn');
        if (alertUser) alertDone(msg, type);
      }

      /* ================= BUNYI & AMARAN SIAP ================= */
      let actx = null;
      function unlockAudio() {
        try {
          actx = actx || new (window.AudioContext || window.webkitAudioContext)();
          if (actx.state === 'suspended') actx.resume();
        } catch (e) { actx = null; }
      }
      // Bunyi loceng: siap = naik ceria (diulang 3x), ralat = turun
      function chime(ok) {
        unlockAudio();
        if (!actx) return;
        const seq = ok ? [523, 659, 784, 1047] : [622, 466, 349];
        let t = actx.currentTime + 0.05;
        for (let r = 0; r < (ok ? 3 : 2); r++) {
          seq.forEach(f => {
            const o = actx.createOscillator(), g = actx.createGain();
            o.type = 'sine'; o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
            o.connect(g); g.connect(actx.destination);
            o.start(t); o.stop(t + 0.3);
            t += 0.17;
          });
          t += 0.45;
        }
      }
      let flashT = null;
      function flashTitle(txt) {
        clearInterval(flashT);
        const orig = document.title;
        let n = 0;
        flashT = setInterval(() => {
          document.title = n++ % 2 ? orig : txt;
          if (n > 60 || (document.hasFocus() && n > 8)) { clearInterval(flashT); document.title = orig; }
        }, 700);
      }
      function alertDone(msg, type) {
        const ok = type === 'ok';
        if (!pro.ok && !(run && run.trial) && !lastWasTrial) return;
        if (opts.sound) chime(ok);
        flashTitle(ok ? '✅ SEGAK SIAP!' : '⚠ SEGAK BERHENTI');
        try {
          if (typeof GM_notification === 'function') {
            GM_notification({ title: ok ? '✅ SEGAK siap disuntik' : '⚠ SEGAK berhenti', text: String(msg || '').slice(0, 180), timeout: 20000, onclick: () => window.focus() });
          }
        } catch (e) { /* abai */ }
      }
      /* Tamatkan dengan kemas: tutup borang & kembali ke senarai murid dulu, baru berhenti */
      function endRun(msg, type) {
        run.endMsg = msg; run.endType = type;
        run.i = run.q.length;
        setPh('leaving'); renderList();
      }
      function requestStop() {
        if (!run) return;
        if (run.stop) { stopRun('■ Dihentikan serta-merta'); return; }   // tekan kali kedua = henti terus
        run.stop = true; saveRun();
        st('■ Menghentikan… menutup borang & kembali ke senarai', 'warn');
        renderInfo();
      }
      function saveFailed(s, why) {
        s.status = 'semak'; s.note = why; run.f++; saveClasses();
        if (run.f >= 3) { endRun(`⚠ 3 murid berturut gagal (${why}). Semak satu borang secara manual.`, 'err'); return true; }
        advance(); setPh('leaving'); renderList();
        return false;
      }

      // Pergi ke senarai murid kelas k: klik kad kelas di Dashboard kalau ada, kalau tak buka terus URL
      function goClass(k) {
        const c = classes[k];
        if (!c || Date.now() - run.t < 1200) return;
        const a = [...document.querySelectorAll('a[href]')].find(x => !root.contains(x) && pathId(x.pathname) === k);
        run.nav = (run.nav || 0) + 1; run.t = Date.now(); saveRun();
        if (a && run.nav <= 2) clickEl(a); else location.href = c.url;
      }
      // Tutup borang murid: OK popup → Tutup → "Adakah anda pasti?" → Ya
      function leaveForm(k) {
        const el = Date.now() - run.t;
        if (el < 500) return;
        const p = popup();
        if (p) {
          if (/PASTI/.test(norm(p.innerText))) { clickPopupBtn(p, /^(YA|YES)$/); run.backed = true; }
          else clickPopupBtn(p, /^(OK|BAIK|TUTUP)$/) || clickPopupBtn(p);
          saveRun();
          return;
        }
        if (!run.tutup) { const b = findBtn('TUTUP'); if (b) { b.click(); run.tutup = true; run.t = Date.now(); saveRun(); return; } }
        if (el > 6000 && !run.backed) { run.backed = true; saveRun(); history.back(); }
        else if (el > 12000) goClass(k);
      }

      function tick() {
        if (!run) return;
        if (!pro.ready) return;                                     // tunggu semakan lesen selesai
        updIcon();
        if (!run.trial && !pro.ok && run.i < run.q.length && !run.endMsg) { endRun('🔒 Autopilot perlukan lesen Pro.', 'err'); return; }
        const pt = pageType();

        // Diminta berhenti: habiskan simpanan yang sedang berjalan, selain itu terus tutup borang
        if (run.stop && run.i < run.q.length && !['saving', 'leaving'].includes(run.ph)) {
          run.i = run.q.length;
          setPh('leaving');
        }

        /* --- Tamat: pastikan borang ditutup & berada di senarai murid --- */
        if (run.i >= run.q.length) {
          if (pt === 'form') { leaveForm(run.lastK); return; }
          if (run.lastK && classes[run.lastK] && !(pt === 'list' && pathId(location.pathname) === run.lastK) && (run.nav || 0) < 3) {
            goClass(run.lastK); return;
          }
          if (run.endMsg) { stopRun(run.endMsg, run.endType, true); return; }
          const d = run.q.filter(x => { const s = classes[x.k] && classes[x.k].students.find(y => y.ic === x.ic); return s && s.status === 'done'; }).length;
          stopRun(run.stop ? `■ Dihentikan (${d} murid disuntik). Borang ditutup.`
            : `✅ Selesai: ${d}/${run.q.length} murid disuntik. Semak senarai, kemudian tekan Hantar sendiri.`, run.stop ? 'warn' : 'ok', true);
          return;
        }

        const it = curItem(), c = classes[it.k], s = c && c.students.find(x => x.ic === it.ic);
        if (!s) { nextStu(); return; }
        if (sel !== it.k) { sel = it.k; S.set('selCls', sel); renderClasses(); }
        if (run.lastK !== it.k) { run.lastK = it.k; saveRun(); }
        const el = Date.now() - run.t;
        if (!run.stop) st(`▶ ${run.i + 1}/${run.q.length} · ${c.name}: ${s.name}`, 'run');

        if (run.ph === 'leaving' && pt !== 'form') { setPh('open'); return; }

        /* --- Halaman borang murid --- */
        if (pt === 'form') {
          const mine = digits(pageText()).includes(s.ic);
          if (run.ph === 'leaving') { leaveForm(it.k); return; }
          if (run.ph === 'open' || run.ph === 'opening') {
            // Borang murid lain terbuka → tutup dulu
            if (!mine) { if (el > 3000) setPh('leaving'); return; }
            if (el < 1500) return;                                   // tunggu borang siap dimuat
            curAge = ageFromPage() || ageOf(s);
            const r = fillForm(s.vals, true);
            if (r) { s.note = r.notes.length ? 'dibetulkan: ' + r.notes.join(', ') : ''; saveClasses(); setPh('filled'); return; }
            // Kotak tak boleh diisi → cuba hidupkan suis "Ditaksir" (sekali)
            if (el > 2500 && !run.dit) { run.dit = true; if (ensureDitaksir()) { run.t = Date.now() - 1000; st(`🔓 Hidupkan "Ditaksir" untuk ${s.name}`, 'run'); } saveRun(); return; }
            if (el > 12000) {
              const miss = plan(s.vals, autoDetect()).miss;
              const why = `kotak tak dikesan: ${miss.join(', ')} — guna Tetapan → Pilih`;
              saveFailed(s, why);                                    // langkau murid ini, tutup borang, teruskan
            }
            return;
          }
          if (run.ph === 'filled') {
            if (el < 900) return;
            const errs = fieldErrors(autoDetect());
            if (errs.length) {                                       // SPPB tunjuk ralat pada kotak
              const learned = errs.map(e => learn(e.f, e.msg)).some(Boolean);
              if (learned && opts.clamp && (run.fix || 0) < 3) { run.fix = (run.fix || 0) + 1; setPh('opening'); return; }
              saveFailed(s, 'ralat ' + errs.map(e => e.f.s + (e.msg ? ` (${e.msg})` : '')).join(', '));
              return;
            }
            if (!formHas(s.vals)) { setPh('opening'); return; }      // nilai tertimpa, isi semula
            const b = saveBtn();
            if (!b) { endRun('Butang Simpan tak jumpa.', 'err'); return; }
            b.click();
            setPh('saving');
            return;
          }
          if (run.ph === 'saving') {
            const p = popup();
            if (p) {
              const tx = norm(p.innerText);
              if (/TIDAK BERJAYA|GAGAL|RALAT|ERROR|MAKS|MELEBIHI|MINIMUM|TIDAK SAH/.test(tx)) {
                clickPopupBtn(p);
                if (!run.stop && opts.clamp && learnFromPopup(tx) && (run.fix || 0) < 3) { run.fix = (run.fix || 0) + 1; setPh('opening'); return; }
                saveFailed(s, 'popup: ' + tx.slice(0, 80));
                return;
              }
              if (/BERJAYA/.test(tx)) {
                s.status = 'done'; s.page = 'ada'; run.f = 0; saveClasses();
                if (run.trial) S.set('trialUsed', (+S.get('trialUsed', 0) || 0) + 1);
                clickPopupBtn(p);
                advance(); setPh('leaving'); renderList();
                return;
              }
              if (!run.conf && clickPopupBtn(p, /^(YA|TERUSKAN|SAHKAN|SIMPAN|YES)$/)) { run.conf = true; saveRun(); }
            }
            if (el > 10000) saveFailed(s, 'tiada popup Berjaya');
            return;
          }
          setPh('open');
          return;
        }

        /* --- Halaman senarai murid --- */
        if (pt === 'list' && pathId(location.pathname) === it.k) {
          if (run.ph === 'open') {
            const row = findRow(s.ic);
            if (!row) { if (el > 6000) { s.status = 'tak jumpa'; saveClasses(); nextStu(); } return; }
            if (el < 700) return;
            if (clickEdit(row)) setPh('opening');
            return;
          }
          if (run.ph === 'opening' && el > 8000) setPh('open');     // klik tak jalan, cuba lagi
          return;
        }

        /* --- Dashboard / kelas lain / halaman lain --- */
        goClass(it.k);
      }

      /* ================= UI ================= */
      const root = document.createElement('div');
      root.id = 'sgk';
      root.innerHTML = `
    <style>
    #sgk{position:fixed;right:12px;bottom:12px;width:320px;max-width:calc(100vw - 24px);z-index:2147483000;
     font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;
     border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden}
    #sgk *{box-sizing:border-box;font:inherit}
    #sgk b,#sgk th,#sgk h4{font-weight:700}
    #sgk .hd{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#0f766e;color:#fff;cursor:move;touch-action:none;user-select:none}
    #sgk .hd button{background:rgba(255,255,255,.2);color:#fff;border:0;border-radius:6px;width:26px;height:24px;cursor:pointer}
    /* ---- Butang terapung (mod kecil) ---- */
    #sgk.mini{width:60px;height:60px;border-radius:50%;border:0;overflow:visible;
      background:radial-gradient(circle at 30% 25%,#2dd4bf 0%,#0f766e 55%,#0b4f4a 100%);
      box-shadow:0 0 0 3px #fff,0 10px 24px rgba(15,118,110,.45),inset 0 -4px 10px rgba(0,0,0,.18);
      transition:transform .18s ease,box-shadow .18s ease}
    #sgk.mini:hover{transform:translateY(-2px) scale(1.07);box-shadow:0 0 0 3px #fff,0 14px 30px rgba(15,118,110,.55),inset 0 -4px 10px rgba(0,0,0,.18)}
    #sgk.mini .bd,#sgk.mini .hd button,#sgk.mini .hd .ttl,#sgk.mini .hd .by{display:none!important}
    #sgk.mini .hd{width:100%;height:100%;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:50%;background:transparent}
    #sgk.mini .hd b{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:30px;line-height:1}
    #sgk.mini #sgk-ic{display:block;transform:translateY(1px);filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))}
    #sgk.running.mini{background:radial-gradient(circle at 30% 25%,#fca5a5 0%,#dc2626 55%,#991b1b 100%);animation:sgkp 1.4s infinite}
    #sgk.running.mini #sgk-ic{font-size:24px;color:#fff;transform:translateX(2px)}
    @keyframes sgkp{0%{box-shadow:0 0 0 3px #fff,0 0 0 3px rgba(220,38,38,.6)}70%{box-shadow:0 0 0 3px #fff,0 0 0 18px rgba(220,38,38,0)}100%{box-shadow:0 0 0 3px #fff,0 0 0 3px rgba(220,38,38,0)}}
    #sgk .badge{display:none}
    #sgk.mini.running .badge{display:block;position:absolute;bottom:-9px;left:50%;transform:translateX(-50%);background:#fff;color:#dc2626;
     font-size:10px;font-weight:700;line-height:14px;padding:0 6px;border-radius:8px;border:1px solid #dc2626;white-space:nowrap;pointer-events:none}
    #sgk .bd{padding:8px 10px 10px;max-height:78vh;overflow:auto}
    #sgk .tabs{display:flex;gap:4px;margin-bottom:8px}
    #sgk .tabs button{flex:1;padding:6px;border:1px solid #cbd5e1;background:#f1f5f9;border-radius:6px;cursor:pointer;color:#0f172a}
    #sgk .tabs button.on{background:#0f766e;color:#fff;border-color:#0f766e}
    #sgk .pane[hidden],#sgk [hidden]{display:none!important}
    #sgk input[type=text],#sgk textarea{width:100%;padding:8px;border:1px solid #94a3b8;border-radius:8px;background:#fff;color:#0f172a}
    #sgk input[type=date]{padding:3px 6px;border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#0f172a}
    #sgk select{flex:1;min-width:0;padding:6px;border:1px solid #94a3b8;border-radius:7px;background:#fff;color:#0f172a}
    #sgk #sgk-q{font-size:17px;font-weight:600;letter-spacing:.5px}
    #sgk button{cursor:pointer}
    #sgk .row{display:flex;gap:4px;align-items:center}
    #sgk .btn{padding:6px 10px;border:1px solid #94a3b8;background:#f8fafc;border-radius:7px;margin:4px 4px 0 0;color:#0f172a}
    #sgk .row .btn{margin:0;padding:6px 8px}
    #sgk .wide{width:100%;margin:6px 0 0}
    #sgk .pri{width:100%;margin-top:8px;padding:9px;background:#0f766e;color:#fff;border:0;border-radius:8px;font-weight:600}
    #sgk .pri:disabled{background:#94a3b8;cursor:default}
    #sgk .pri.stop{background:#dc2626}
    #sgk .hint{font-size:11px;color:#64748b;margin-top:4px}
    #sgk .prev{margin-top:6px;font-size:12px;color:#334155;min-height:18px}
    #sgk .w{color:#b45309}
    #sgk .st{margin-top:8px;font-size:12px;padding:6px 8px;border-radius:6px;background:#f1f5f9;min-height:18px}
    #sgk .st.ok{background:#dcfce7;color:#166534}#sgk .st.err{background:#fee2e2;color:#991b1b}
    #sgk .st.warn{background:#fef3c7;color:#92400e}#sgk .st.run{background:#dbeafe;color:#1e3a8a;font-weight:600}
    #sgk .match{padding:8px;border-radius:8px;background:#ccfbf1;margin-bottom:8px;font-size:12px}
    #sgk .list{margin-top:6px;max-height:300px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px}
    #sgk .it{padding:6px 8px;border-bottom:1px solid #f1f5f9}
    #sgk .it .nm{display:flex;justify-content:space-between;gap:6px;align-items:flex-start}
    #sgk .it .nm b{font-size:12px}
    #sgk .it small{color:#64748b;font-size:11px}
    #sgk .bg{font-size:10px;padding:1px 7px;border-radius:9px;background:#e2e8f0;white-space:nowrap}
    #sgk .bg.done{background:#dcfce7;color:#166534}#sgk .bg.semak,#sgk .bg.tak{background:#fef3c7;color:#92400e}
    #sgk .bg.ada{background:#e0e7ff;color:#3730a3}#sgk .bg.now{background:#dbeafe;color:#1e3a8a}
    #sgk .it .v{width:100%;margin-top:4px;padding:5px 7px;font:13px ui-monospace,Consolas,monospace;border:1px solid #cbd5e1;border-radius:6px;color:#0f172a;background:#fff}
    #sgk .it .v.ok{border-color:#16a34a;background:#f0fdf4}#sgk .it .v.bad{border-color:#dc2626;background:#fef2f2}
    #sgk .it.done{opacity:.6}
    #sgk .it:focus-within{background:#ecfeff;box-shadow:inset 3px 0 0 #0f766e;opacity:1}
    #sgk .it .v:focus{outline:2px solid #0f766e;outline-offset:0}
    #sgk .mp{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #f1f5f9}
    #sgk .mp .y{color:#16a34a}#sgk .mp .n{color:#dc2626}
    #sgk .mp button{padding:3px 8px;border:1px solid #94a3b8;border-radius:6px;background:#f8fafc;color:#0f172a}
    #sgk .mp button.act{background:#f59e0b;color:#fff;border-color:#f59e0b}
    #sgk label{display:flex;gap:6px;align-items:center;margin-top:6px;font-size:12px}
    #sgk .cnt{font-size:11px;color:#64748b;margin-top:6px}
    #sgk h4{margin:10px 0 2px;font-size:12px;font-weight:700;color:#0f766e}
    #sgk .lr{display:grid;grid-template-columns:1fr 64px 64px;gap:4px;align-items:center;margin-top:3px;font-size:12px}
    #sgk .lr input{width:100%;padding:3px 5px;border:1px solid #94a3b8;border-radius:5px;background:#fff;color:#0f172a;font-size:12px}
    #sgk .lr.h{font-size:10px;color:#64748b}
    #sgk .it .nt{display:block;margin-top:2px;color:#b45309;font-size:11px}
    #sgk .tabs .tpro{flex:0 0 auto;padding:6px 8px;background:#fef3c7;border-color:#f59e0b;color:#92400e}
    #sgk .tabs .tpro.on{background:#f59e0b;color:#fff}
    #sgk.is-pro .tabs .tpro{background:#dcfce7;border-color:#16a34a;color:#166534}
    #sgk.is-pro .tabs .tpro.on{background:#16a34a;color:#fff}
    #sgk textarea#sgk-lic{width:100%;height:64px;padding:6px;border:1px solid #94a3b8;border-radius:8px;font:11px ui-monospace,Consolas,monospace;color:#0f172a;background:#fff}
    #sgk .cmp{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px}
    #sgk .cmp th,#sgk .cmp td{border-bottom:1px solid #e2e8f0;padding:4px 3px;text-align:center}
    #sgk .cmp td:first-child,#sgk .cmp th:first-child{text-align:left}
    #sgk .cmp th:last-child,#sgk .cmp td:last-child{color:#166534;font-weight:700}
    #sgk .acc{margin-top:6px;padding-top:6px;border-top:1px dashed #94a3b8;font-size:11px}
    #sgk .acc .btn{margin:0 0 0 4px;padding:1px 6px;font-size:11px}
    #sgk .hd .ttl{display:inline-flex;flex-direction:column;line-height:1.1;vertical-align:middle}
    #sgk .hd .by{font-size:9px;font-weight:400;opacity:.85;letter-spacing:.3px}
    #sgk.mini .hd .by{display:none}
    #sgk .wm{margin-top:8px;text-align:center;font-size:10px;color:#94a3b8;letter-spacing:.3px;user-select:none}
    #sgk .wm b{color:#0f766e;font-weight:700}
    #sgk .newcls{margin:6px;padding:10px;border-radius:8px;background:#fef3c7;color:#92400e;font-size:12px;line-height:1.45}
    #sgk .newcls .pri{margin:8px 0 4px}#sgk .newcls small{display:block;color:#78350f}
    #sgk .age{font-size:10px;color:#64748b;font-weight:400;white-space:nowrap}
    #sgk .plans{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
    #sgk .plan{border:1px solid #e2e8f0;border-radius:8px;padding:6px 4px;text-align:center;font-size:11px;color:#334155;background:#f8fafc}
    #sgk .plan b{display:block;font-size:15px;color:#0f766e}
    #sgk .plan.best{border-color:#f59e0b;background:#fffbeb}
    #sgk .lock{font-size:10px;background:#f59e0b;color:#fff;border-radius:6px;padding:0 5px;margin-left:4px}
    </style>
    <div class="hd"><b><span id="sgk-ic">⚡</span> <span class="ttl">SEGAK Injector<small class="by">by gelanggangdigital</small></span></b><span class="badge" id="sgk-bdg"></span><button data-a="min" title="Kecilkan">–</button></div>
    <div class="bd">
      <div id="sgk-match" class="match" hidden></div>
      <div class="tabs"><button data-t="k" class="on">Kelas</button><button data-t="p">Pantas</button><button data-t="s">Tetapan</button><button data-t="pro" class="tpro">⭐ Pro</button></div>

      <div class="pane" data-p="k">
        <div class="row">
          <select id="sgk-cls"></select>
          <button class="btn" data-a="ren" title="Tukar nama kelas">✏️</button>
          <button class="btn" data-a="del" title="Padam kelas">🗑</button>
        </div>
        <button class="btn wide" data-a="grab">📋 Ambil kelas dari halaman ini</button>
        <div id="sgk-info" class="cnt"></div>
        <input id="sgk-find" type="text" placeholder="🔍 Cari nama murid..." autocomplete="off" style="margin-top:6px">
        <div id="sgk-list" class="list"></div>
        <div class="hint">Format: Berat Tinggi(cm) NTB TT RTS JM · ↑↓ pilih murid · Enter simpan · Esc ke carian</div>
        <button class="pri" id="sgk-run" data-a="run">▶ Suntik kelas ini</button>
        <button class="pri" id="sgk-runall" data-a="runall" style="background:#1e40af">▶▶ Suntik semua kelas</button>
      </div>

      <div class="pane" data-p="p" hidden>
        <input id="sgk-q" type="text" placeholder="63 155 120 20 14 46" autocomplete="off">
        <div class="hint">Isi borang yang sedang dibuka. Berat · Tinggi(cm) · NTB · TT · RTS · JM</div>
        <div id="sgk-prev" class="prev"></div>
        <button class="pri" data-a="inj">Suntik Data ⏎</button>
      </div>

      <div class="pane" data-p="s" hidden>
        <h4>Kotak borang (buka borang murid dulu)</h4>
        <div id="sgk-map"></div>
        <button class="btn" data-a="auto">🔍 Auto-kesan</button><button class="btn" data-a="test">Uji</button><button class="btn" data-a="reset">Reset</button>
        <h4>Pilihan</h4>
        <label><input type="checkbox" data-o="tinggiM"> Tinggi dalam meter (155 → 1.55)</label>
        <label><input type="checkbox" data-o="fillDate"> Isi Tarikh Ujian: <input type="date" id="sgk-date"></label>
        <label><input type="checkbox" data-o="autoSave"> Mod Pantas: auto-klik Simpan</label>
        <label><input type="checkbox" data-o="clamp"> Auto betulkan nilai ralat ke had SPPB</label>
        <label><input type="checkbox" data-o="sound"> 🔔 Bunyi bila autopilot siap <button class="btn" data-a="testsound" style="margin:0 0 0 auto;padding:2px 8px">Uji bunyi</button></label>
        <h4>Had nilai SPPB (auto-belajar)</h4>
        <div id="sgk-lim"></div>
        <div class="hint">Dipelajari sendiri dari mesej ralat SPPB, atau taip sendiri. Kosong = tiada had. Tinggi dalam meter.</div>
      </div>
      <div class="pane" data-p="pro" hidden>
        <div id="sgk-prost" class="match"></div>
        <table class="cmp">
          <tr><th></th><th>Percuma</th><th>⭐ Pro</th></tr>
          <tr><td>Suntik seorang (Mod Pantas / Isi borang ini)</td><td>✓</td><td>✓</td></tr>
          <tr><td>Simpan senarai kelas &amp; data murid</td><td>✓</td><td>✓</td></tr>
          <tr><td>Had nilai auto (NTB ikut umur, TT 40, RTS 25, JM 60)</td><td>✓</td><td>✓</td></tr>
          <tr><td>Autopilot sekelas — isi, Simpan, tutup, seterusnya</td><td>–</td><td>✓</td></tr>
          <tr><td>Autopilot semua kelas sekali jalan</td><td>–</td><td>✓</td></tr>
          <tr><td>Bunyi &amp; notifikasi bila siap</td><td>–</td><td>✓</td></tr>
        </table>
        <div class="plans" id="sgk-plans"></div>
        <button class="pri" id="sgk-buy" data-a="buy">🛒 Beli Pro</button>
        <h4>Ada kod lesen?</h4>
        <textarea id="sgk-lic" placeholder="Tampal kod lesen Pro di sini"></textarea>
        <button class="pri" data-a="licon" style="background:#1e40af">Aktifkan Pro</button>
        <button class="btn" id="sgk-licoff" data-a="licoff" hidden>Buang lesen dari pelayar ini</button>
        <div class="hint">Lesen terikat pada nama akaun SPPB. Semasa membeli, hantar nama akaun di atas kepada penjual.</div>
      </div>
      <div id="sgk-st" class="st">Sedia.</div>
      <div class="wm">⚡ SEGAK Injector · by <b>gelanggangdigital</b></div>
    </div>`;
      document.body.appendChild(root);

      const $ = id => root.querySelector('#' + id);
      const qIn = $('sgk-q'), prev = $('sgk-prev'), stEl = $('sgk-st'), dIn = $('sgk-date');
      const clsSel = $('sgk-cls'), findIn = $('sgk-find'), listEl = $('sgk-list');
      function st(msg, type) { stEl.textContent = msg; stEl.className = 'st ' + (type || ''); }

      if (pos) Object.assign(root.style, { left: pos.x + 'px', top: pos.y + 'px', right: 'auto', bottom: 'auto' });
      if (mini) root.classList.add('mini');
      root.querySelectorAll('[data-o]').forEach(c => { c.checked = !!opts[c.dataset.o]; });
      dIn.value = tarikh();
      dIn.addEventListener('change', () => { opts.tarikh = dIn.value; S.set('opts', opts); st(`Tarikh ujian: ${dIn.value}`, 'ok'); });

      /* ---- Kelas ---- */
      function renderClasses() {
        const keys = Object.keys(classes);
        if (!classes[sel]) sel = keys[0] || '';
        clsSel.innerHTML = keys.length
          ? keys.map(k => `<option value="${esc(k)}" ${k === sel ? 'selected' : ''}>${esc(classes[k].name)} (${classes[k].students.length})</option>`).join('')
          : '<option value="">— Belum ada kelas —</option>';
        if (pend) clsSel.innerHTML = '<option value="" selected>⚠ Kelas baru — belum ditarik</option>' + (keys.length ? clsSel.innerHTML.replace(' selected', '') : '');
        renderList();
      }
      function badge(s) {
        const it = curItem();
        if (it && it.k === sel && it.ic === s.ic) return '<span class="bg now">▶ sedang</span>';
        if (s.status === 'done') return '<span class="bg done">✓ disuntik</span>';
        if (s.status === 'semak') return '<span class="bg semak">⚠ semak</span>';
        if (s.status === 'tak jumpa') return '<span class="bg tak">tak jumpa</span>';
        if (s.page === 'ada') return '<span class="bg ada">ada skor</span>';
        return '<span class="bg">belum</span>';
      }
      /* Ikon butang terapung: ⚡ biasa, ▶ merah semasa autopilot, ■ semasa menutup borang untuk berhenti */
      function updIcon() {
        const ic = root.querySelector('#sgk-ic'), bd = root.querySelector('#sgk-bdg'), hdr = root.querySelector('.hd');
        if (!ic) return;
        root.classList.toggle('running', !!run);
        ic.textContent = run ? (run.stop ? '■' : '▶') : '⚡';
        bd.textContent = run ? (run.stop ? 'berhenti…' : `${Math.min(run.i + 1, run.q.length)}/${run.q.length}`) : '';
        hdr.title = run ? (run.stop ? 'Sedang berhenti… tekan lagi untuk henti serta-merta' : 'Autopilot berjalan — tekan untuk HENTI')
                        : (mini ? 'Tekan untuk buka panel' : '');
      }
      function renderInfo() {
        updIcon();
        const c = cls();
        const runBtn = $('sgk-run'), allBtn = $('sgk-runall');
        root.classList.toggle('running', !!run);
        const allQ = Object.keys(classes).reduce((n, k) => n + pendingOf(k).length, 0);
        const nCls = Object.keys(classes).filter(k => pendingOf(k).length).length;
        if (run) {
          runBtn.textContent = run.stop ? '■ Henti serta-merta' : '■ Henti'; runBtn.classList.add('stop'); runBtn.disabled = false;
          allBtn.hidden = true;
        } else {
          runBtn.classList.remove('stop');
          const q = c ? pendingOf(sel).length : 0;
          const tag = pro.ok ? '' : (trialLeft() ? ' · 🎁 cubaan' : ' · 🔒 PRO');
          runBtn.textContent = `▶ Suntik kelas ini (${q})${tag}`; runBtn.disabled = !q;
          allBtn.hidden = nCls < 2;
          allBtn.textContent = `▶▶ Suntik semua kelas (${allQ} murid, ${nCls} kelas)${tag}`;
        }
        if (!c) { $('sgk-info').textContent = pend ? '0 murid · kelas ini belum ditarik' : ''; return; }
        const withData = c.students.filter(s => s.vals).length;
        const done = c.students.filter(s => s.status === 'done').length;
        $('sgk-info').innerHTML = esc(`${c.students.length} murid · ${withData} ada data · ${done} disuntik`) +
          (baruN ? `<br><span class="w">⚠ ${baruN} murid baru di halaman ini — tekan 📋 Ambil kelas semula.</span>` : '');
      }
      function renderList() {
        const c = cls();
        if (!c && pend) {
          listEl.innerHTML = `<div class="newcls">⚠ <b>Kelas ini belum ditarik.</b><br>Senarai dikosongkan supaya data tidak masuk ke kelas yang salah.` +
            `<button class="pri" data-a="grab">📋 Ambil kelas ini sekarang</button>` +
            (Object.keys(classes).length ? `<small>Mahu isi kelas lain? Pilih kelas dalam senarai di atas.</small>` : '') + `</div>`;
          renderInfo();
          return;
        }
        if (!c) {
          listEl.innerHTML = '<div class="it"><small>Buka senarai kelas di SPPB (klik kad kelas), kemudian tekan 📋 Ambil kelas.</small></div>';
          renderInfo();
          return;
        }
        const f = norm(findIn.value);
        const rows = c.students.filter(s => !f || norm(s.name).includes(f) || s.ic.includes(f));
        listEl.innerHTML = rows.map(s => `<div class="it ${s.status === 'done' ? 'done' : ''}">
            <div class="nm"><b>${esc(s.name)} ${ageOf(s) ? `<span class="age">· ${ageOf(s)} thn · nadi maks ${maxHR(ageOf(s))}</span>` : ''}</b>${badge(s)}</div>
            <input class="v ${s.vals ? 'ok' : ''}" data-ic="${s.ic}" value="${s.vals ? s.vals.join(' ') : ''}" placeholder="B T NTB TT RTS JM" autocomplete="off" ${run ? 'disabled' : ''}>
            ${s.note ? `<span class="nt">${esc(s.note)}</span>` : ''}
          </div>`).join('') || '<div class="it"><small>Tiada nama sepadan.</small></div>';
        renderInfo();
      }
      function commit(inp) {
        const c = cls();
        const s = c && c.students.find(x => x.ic === inp.dataset.ic);
        if (!s) return true;
        const v = inp.value.trim();
        if (s.vals && v.split(/[\s,;\t]+/).join(' ') === s.vals.join(' ')) { inp.className = 'v ok'; return true; }   // tiada perubahan
        if (!v) { s.vals = null; inp.className = 'v'; }
        else {
          const r = parse(v);
          if (r.err) { inp.className = 'v bad'; st(`${s.name}: ${r.err}`, 'err'); return false; }
          // Terus betulkan ikut had (contoh TT 45 → 40) supaya nilai dalam senarai = nilai yang akan disuntik
          const fixed = [];
          FIELDS.forEach((f, i) => {
            if (f.k === 'tinggi') return;                       // tinggi ikut unit borang, dibetulkan semasa suntik
            const age = ageOf(s);
            const c = clampField(f.k, r.vals[i], null, age);
            if (c !== r.vals[i]) { fixed.push(`${f.s} ${r.vals[i]}→${c}` + (f.k === 'ntb' && age && c === maxHR(age) ? ` (nadi maks, umur ${age})` : '')); r.vals[i] = c; }
          });
          if (fixed.length) { inp.value = r.vals.join(' '); s.note = 'dibetulkan: ' + fixed.join(', '); }
          else if (s.note && s.note.startsWith('dibetulkan')) s.note = '';
          const changed = !s.vals || s.vals.join(' ') !== r.vals.join(' ');
          s.vals = r.vals;
          if (changed && s.status !== '') s.status = '';
          inp.className = 'v ok';
          const w = warnings(r.vals);
          if (fixed.length) st(`✏ ${s.name}: dibetulkan ${fixed.join(', ')}`, 'warn');
          else st(w.length ? `⚠ ${s.name}: ${w.join(', ')}` : `✓ ${s.name}: ${fmt(r.vals).tinggi} m`, w.length ? 'warn' : 'ok');
        }
        saveClasses();
        renderInfo();
        return true;
      }
      listEl.addEventListener('input', e => {
        const inp = e.target.closest('.v');
        if (!inp) return;
        const v = inp.value.trim();
        inp.className = 'v' + (!v ? '' : parse(v).err ? ' bad' : ' ok');
      });
      listEl.addEventListener('change', e => { const inp = e.target.closest('.v'); if (inp) commit(inp); });
      /* ---- Navigasi papan kekunci ----
         Kotak cari:  ↓ / Enter = ke murid pertama
         Kotak murid: ↓ = murid bawah · ↑ = murid atas (dari murid pertama → kotak cari)
                      Enter = simpan (& kembali ke kotak cari jika sedang mencari) · Esc = kembali ke kotak cari */
      const rowInputs = () => [...listEl.querySelectorAll('.v')].filter(x => !x.disabled);
      function focusRow(inp) {
        if (!inp) return;
        inp.focus();
        const n = inp.value.length;
        try { inp.setSelectionRange(n, n); } catch (e) { /* abai */ }
        inp.closest('.it').scrollIntoView({ block: 'nearest' });
      }
      function focusFind() { findIn.focus(); findIn.select(); }
      listEl.addEventListener('keydown', e => {
        const inp = e.target.closest('.v');
        if (!inp) return;
        const all = rowInputs(), i = all.indexOf(inp);
        if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(all[i + 1] || inp); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) focusRow(all[i - 1]); else focusFind(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); focusFind(); return; }
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (!commit(inp)) return;
        if (findIn.value.trim()) { focusFind(); return; }
        if (all[i + 1]) focusRow(all[i + 1]);
      });
      findIn.addEventListener('input', renderList);
      findIn.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        focusRow(rowInputs()[0]);
      });
      clsSel.addEventListener('change', () => { if (!clsSel.value) return; if (pend) { pendSkip = pend; pend = ''; } sel = clsSel.value; S.set('selCls', sel); renderClasses(); findIn.value = ''; renderList(); });

      /* ---- Pantas ---- */
      function renderPrev() {
        if (!qIn.value.trim()) { prev.innerHTML = ''; return; }
        const r = parse(qIn.value);
        if (r.err) { prev.innerHTML = `<span class="w">${esc(r.err)}</span>`; return; }
        const v = fmt(r.vals), w = warnings(r.vals);
        prev.innerHTML = FIELDS.map(f => `${f.s} <b>${esc(v[f.k])}</b>`).join(' · ') +
          (w.length ? `<br><span class="w">⚠ ${esc(w.join(', '))}</span>` : '');
      }
      qIn.addEventListener('input', renderPrev);
      qIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doQuick(); } });
      function doQuick() {
        const r = parse(qIn.value);
        if (r.err) { st(r.err, 'err'); return; }
        if (inject(r.vals)) { qIn.value = ''; renderPrev(); }
      }

      /* ---- Imbas halaman ---- */
      function scan() {
        const pt = pageType(), m = $('sgk-match');
        if (pt === 'form' && !run) {
          const d = digits(pageText());
          for (const k in classes) {
            const s = classes[k].students.find(x => d.includes(x.ic));
            if (s) {
              m.hidden = false;
              m.innerHTML = `Borang: <b>${esc(s.name)}</b> <small>(${esc(classes[k].name)})</small><br>` +
                (s.vals ? `<small>${s.vals.join(' ')}</small><button class="pri" data-a="fillcur" data-k="${esc(k)}" data-ic="${s.ic}">Isi borang ini</button>`
                        : '<small>Belum ada data ujian untuk murid ini.</small>');
              return;
            }
          }
          if (Object.keys(classes).length && /(^|[^\d])\d{6}-?\d{2}-?\d{4}([^\d]|$)/.test(pageText())) {
            m.hidden = false;
            m.innerHTML = '⚠ <b>Murid ini tiada dalam senarai yang ditarik.</b><br><small>Kembali ke senarai kelas murid ini dan tekan 📋 Ambil kelas dulu.</small>';
            return;
          }
        }
        m.hidden = true;
        const pid = pathId(location.pathname);
        if (!run) {
          const isNew = pt === 'list' && pid && !classes[pid] && pageICs().length > 0;
          if (isNew && pend !== pid && pendSkip !== pid) {
            pend = pid; baruN = 0;
            setMini(false);
            renderClasses();
            st('⚠ Kelas baru dikesan. Tekan 📋 Ambil kelas dulu sebelum isi data.', 'warn');
          } else if (pend && !isNew) { pend = ''; renderClasses(); }
          if (pendSkip && !(pt === 'list' && pid === pendSkip)) pendSkip = '';
        }
        if (pt === 'list' && classes[pid]) {
          const c = classes[pid];
          let ch = false;
          c.students.forEach(s => {
            const r = findRow(s.ic);
            if (!r) return;
            const p = rowStatus(r);
            if (p !== s.page) { s.page = p; ch = true; }
            if (p === 'ada' && s.status === 'semak' && s.vals) { s.status = 'done'; ch = true; }   // rupanya dah tersimpan
          });
          if (ch) saveClasses();
          const nb = pageICs().filter(ic => !c.students.some(s => s.ic === ic)).length;
          if (nb !== baruN) { baruN = nb; ch = true; }
          if (!run && sel !== pid) { sel = pid; S.set('selCls', sel); renderClasses(); }
          else if (ch && !run && !root.contains(document.activeElement)) renderList();
          else if (ch) renderInfo();
        } else if (baruN) { baruN = 0; renderInfo(); }
      }
      let scanT = null;
      new MutationObserver(muts => {
        if (muts.every(mu => root.contains(mu.target))) return;
        clearTimeout(scanT);
        scanT = setTimeout(scan, 700);
      }).observe(document.body, { childList: true, subtree: true, characterData: true });

      /* ---- Tetapan ---- */
      function renderLim() {
        const box = $('sgk-lim');
        if (!box) return;
        const val = (k, m) => (lim[k] && lim[k][m] != null && lim[k][m] !== '' ? lim[k][m] : '');
        box.innerHTML = '<div class="lr h"><span></span><span>Min</span><span>Maks</span></div>' +
          FIELDS.map(f => `<div class="lr"><span>${esc(f.l)}</span>
            <input data-lk="${f.k}" data-lm="min" value="${val(f.k, 'min')}" inputmode="decimal">
            <input data-lk="${f.k}" data-lm="max" value="${val(f.k, 'max')}" inputmode="decimal"></div>`).join('');
      }
      $('sgk-lim').addEventListener('change', e => {
        const i = e.target.closest('[data-lk]');
        if (!i) return;
        const L = lim[i.dataset.lk] || (lim[i.dataset.lk] = {});
        const v = i.value.trim().replace(',', '.');
        if (v === '' || isNaN(+v)) { delete L[i.dataset.lm]; i.value = ''; } else L[i.dataset.lm] = +v;
        S.set('lim', lim);
        st('Had nilai disimpan', 'ok');
      });
      function renderMap() {
        const det = autoDetect();
        const row = (k, l, el) => `<div class="mp"><span>${esc(l)} <span class="${el ? 'y' : 'n'}">${el ? '✓' : '✗'}</span>
          <small>${map[k] ? 'dipilih' : (el ? 'auto' : '')}</small></span>
          <button data-pick="${k}" class="${picking === k ? 'act' : ''}">${picking === k ? 'Klik…' : 'Pilih'}</button></div>`;
        $('sgk-map').innerHTML = FIELDS.map(f => row(f.k, f.l, getEl(f.k, det))).join('') + row('save', 'Butang Simpan', saveBtn());
      }
      function onPick(e) {
        if (!picking || root.contains(e.target)) return;
        const want = picking === 'save' ? 'button, input[type=submit], input[type=button], a, [role=button]' : 'input, select, textarea';
        const el = e.target.closest(want);
        if (!el) return;
        e.preventDefault(); e.stopPropagation();
        map[picking] = cssPath(el);
        S.set('map_' + HOST, map);
        flash(el);
        st(`✓ ${picking} disimpan`, 'ok');
        stopPick();
      }
      function startPick(k) { picking = k; document.addEventListener('click', onPick, true); st('Klik kotak/butang yang betul di borang… (Esc batal)', 'warn'); renderMap(); }
      function stopPick() { picking = null; document.removeEventListener('click', onPick, true); renderMap(); }

      /* ---- Klik dalam panel ---- */
      // Sentuhan pertama pada panel "membuka kunci" bunyi pelayar (pelayar sekat bunyi tanpa klik pengguna)
      root.addEventListener('pointerdown', unlockAudio, true);
      root.addEventListener('click', e => {
        const t = e.target.closest('button, input[type=checkbox]');
        if (!t) return;
        if (t.dataset.t) {
          root.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b === t));
          root.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.p !== t.dataset.t; });
          if (t.dataset.t === 's') { renderMap(); renderLim(); }
          if (t.dataset.t === 'k') renderList();
          if (t.dataset.t === 'pro') renderPro();
          return;
        }
        if (t.dataset.o) { opts[t.dataset.o] = t.checked; S.set('opts', opts); renderPrev(); return; }
        if (t.dataset.pick) { picking === t.dataset.pick ? stopPick() : startPick(t.dataset.pick); return; }
        switch (t.dataset.a) {
          case 'min': setMini(true); break;
          case 'inj': doQuick(); break;
          case 'testsound': e.preventDefault(); chime(true); break;
          case 'licon': {
            const code = $('sgk-lic').value;
            st('Menyemak lesen…', 'run');
            checkLicense(code).then(r => {
              if (!r.ok) { st('✗ ' + (r.why || 'Kod lesen kosong'), 'err'); return; }
              pro = Object.assign(r, { ready: true });
              S.set('lic', code.replace(/\s+/g, ''));
              $('sgk-lic').value = '';
              renderPro(); renderInfo();
              st(proOK() ? '⭐ Pro diaktifkan. Terima kasih!' : `⭐ Lesen sah, tapi untuk akaun ${licFor(r.d)}. Log masuk SPPB dengan akaun itu.`, proOK() ? 'ok' : 'warn');
            });
            break;
          }
          case 'licoff':
            if (confirm('Buang lesen Pro dari pelayar ini? (Simpan kod lesen awk dulu jika mahu guna semula)')) {
              S.set('lic', ''); pro = { ok: false, ready: true, why: '', d: null }; renderPro(); renderInfo(); st('Lesen dibuang', 'ok');
            }
            break;
          case 'copyacc': {
            const a = accountName();
            try { navigator.clipboard.writeText(a); st('Nama akaun disalin', 'ok'); } catch (err) { prompt('Salin nama akaun:', a); }
            break;
          }
          case 'buy': {
            let u = String(CFG.BUY_URL || '');
            if (!u || /X{4,}/.test(u)) { st('Pautan pembelian belum ditetapkan oleh penjual.', 'err'); break; }
            const msg = `Salam, saya nak beli SEGAK Injector Pro.\nNama akaun SPPB: ${accountName() || '(isi nama akaun)'}`;
            const acc = accountName();
            if (/wa\.me|whatsapp/i.test(u)) u += (u.includes('?') ? '&' : '?') + 'text=' + encodeURIComponent(msg);
            else if (acc) u += (u.includes('?') ? '&' : '?') + 'acc=' + encodeURIComponent(acc);
            window.open(u, '_blank', 'noopener');
            break;
          }
          case 'grab': grabClass(); break;
          case 'run': run ? requestStop() : startRun(false); break;
          case 'runall': if (!run) startRun(true); break;
          case 'fillcur': {
            const c = classes[t.dataset.k], s = c && c.students.find(x => x.ic === t.dataset.ic);
            if (s && s.vals && inject(s.vals, ageOf(s))) { if (opts.autoSave) { s.status = 'done'; saveClasses(); } else st(`✓ ${s.name} diisi — semak & tekan Simpan`, 'ok'); }
            break;
          }
          case 'ren': {
            const c = cls(); if (!c) break;
            const n = prompt('Nama kelas:', c.name);
            if (n && n.trim()) { c.name = n.trim(); saveClasses(); renderClasses(); }
            break;
          }
          case 'del': {
            const c = cls(); if (!c || run) break;
            if (confirm(`Padam kelas ${c.name} dan semua data yang ditaip?`)) { delete classes[sel]; saveClasses(); sel = ''; renderClasses(); st('Kelas dipadam', 'ok'); }
            break;
          }
          case 'auto': {
            const det = autoDetect();
            let n = 0;
            FIELDS.forEach(f => { if (det[f.k]) { map[f.k] = cssPath(det[f.k]); flash(det[f.k]); n++; } });
            S.set('map_' + HOST, map); renderMap();
            st(`Auto-kesan: ${n}/6 kotak dijumpai`, n === 6 ? 'ok' : 'warn');
            break;
          }
          case 'test': {
            const det = autoDetect();
            FIELDS.forEach((f, i) => setTimeout(() => flash(getEl(f.k, det), '#f59e0b'), i * 250));
            setTimeout(() => flash(saveBtn(), '#2563eb'), 1600);
            st('Kotak berkelip oren, butang Simpan biru', 'ok');
            break;
          }
          case 'reset':
            if (confirm('Reset semua pemetaan kotak untuk laman ini?')) { map = {}; S.set('map_' + HOST, map); renderMap(); st('Pemetaan direset', 'ok'); }
            break;
        }
      });

      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && picking) stopPick();   // Esc TIDAK hentikan autopilot (selalu ditekan untuk tutup popup)
        if (e.altKey && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          setMini(false);
          findIn.focus();
        }
      });

      /* ---- Ikon terapung & seret ---- */
      const hd = root.querySelector('.hd');
      let drag = null;
      hd.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        const r = root.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
        hd.setPointerCapture(e.pointerId);
      });
      hd.addEventListener('pointermove', e => {
        if (!drag) return;
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 6) drag.moved = true;
        if (!drag.moved) return;
        const x = Math.max(0, Math.min(innerWidth - 60, e.clientX - drag.dx));
        const y = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy));
        Object.assign(root.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' });
        pos = { x, y };
      });
      hd.addEventListener('pointerup', () => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        if (moved) { S.set('pos', pos); return; }
        if (mini) {
          if (run) requestStop();          // butang ▶ merah: tekan = henti
          else setMini(false);             // butang ⚡: tekan = buka panel
          updIcon();
        }
      });
      function setMini(v) {
        mini = v;
        root.classList.toggle('mini', mini);
        S.set('mini', mini);
        if (!mini) {
          const r = root.getBoundingClientRect();
          if (r.right > innerWidth || r.bottom > innerHeight) Object.assign(root.style, { left: 'auto', top: 'auto', right: '12px', bottom: '12px' });
        }
      }

      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('⚡ Buka panel SEGAK', () => {
          if (!document.body.contains(root)) document.body.appendChild(root);
          Object.assign(root.style, { left: 'auto', top: 'auto', right: '12px', bottom: '12px' });
          setMini(false);
        });
      }
      setInterval(() => { if (!document.body.contains(root)) document.body.appendChild(root); }, 1500);
      setInterval(tick, 600);

      /* edisi percuma Bijak Mulia: semua ciri (termasuk autopilot) dibuka tanpa lesen */
      if (CFG.FREE_ALL){ const tp = root.querySelector('[data-t="pro"]'); if (tp) tp.remove(); }
      (CFG.FREE_ALL ? Promise.resolve({ ok: true, why: '', d: { n: '*', e: '' } }) : checkLicense(S.get('lic', ''))).then(r => {
        pro = Object.assign(r, { ready: true });
        renderInfo(); renderPro();
      });

      renderClasses();
      scan();
      if (run) st('▶ Menyambung autopilot…', 'run');
    })();
  });
})();
