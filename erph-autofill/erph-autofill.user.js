// ==UserScript==
// @name         ERPH Autofill (AppSheet)
// @namespace    arifaziz.erph.autofill
// @version      4.4.0
// @description  Auto isi borang ERPH GURU (AppSheet) ikut jadual waktu + prompt AI + cadangan SK seterusnya. Percuma — Bijak Mulia.
// @author       Bijak Mulia (Arif Aziz)
// @match        *://*.appsheet.com/*
// @match        *://appsheet.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @downloadURL  https://bijakmulia.github.io/student-manager/erph-autofill/erph-autofill.user.js
// @updateURL    https://bijakmulia.github.io/student-manager/erph-autofill/erph-autofill.user.js
// @run-at       document-end
// @noframes
// ==/UserScript==
/* jshint esversion: 11 */
/* eslint-env browser, es2022 */
/* globals GM_getValue, GM_setValue, GM_setClipboard, GM_openInTab */

(function () {
  'use strict';
  if (window.top !== window.self) return;
  try {

  /* ===================== DATA ===================== */
  const KEY = 'erph_autofill_v1';
  const DEF_SCHEDULE = [];

  function load() {
    let d = null;
    try {
      d = typeof GM_getValue === 'function' ? GM_getValue(KEY, null) : localStorage.getItem(KEY);
      if (typeof d === 'string') d = JSON.parse(d);
    } catch (e) { d = null; }
    return Object.assign({
      schedule: DEF_SCHEDULE, done: {}, skLists: {}, lastSK: {}, pjkMode: {},
      minggu: '', weekOffset: 0, bahasa: 'BM', prog: {}, opts: {}, ai: 'chatgpt', mode: 'week', week: null
    }, d || {});
  }
  let S = load();
  try {
    Object.keys(S.skLists || {}).forEach(k => {
      S.skLists[k] = (S.skLists[k] || []).filter(t => String(t).trim().length >= 4);
      if (!S.skLists[k].length) delete S.skLists[k];
    });
  } catch (e) {}
  function save() {
    const s = JSON.stringify(S);
    try { if (typeof GM_setValue === 'function') GM_setValue(KEY, s); else localStorage.setItem(KEY, s); } catch (e) {}
  }

  /* ===================== UTIL ===================== */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normTime = s => norm(s).replace(/\s/g, '').replace(/^0/, '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dmy = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  function monday(off) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7) + 7 * off);
    return t;
  }
  function sessDate(s) { const d = monday(S.weekOffset); d.setDate(d.getDate() + s.day - 1); return d; }
  const wkKey = () => iso(monday(S.weekOffset));
  const doneKey = s => wkKey() + '|' + s.id;
  function mins(t) {
    const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(t || '');
    if (!m) return 0;
    let h = +m[1] % 12;
    if (m[3] && m[3].toLowerCase() === 'pm') h += 12;
    return h * 60 + +m[2];
  }
  const sorted = () => [...S.schedule].sort((a, b) => a.day - b.day || mins(a.mula) - mins(b.mula));
  function subjName(s) {
    if (s.subj === 'SC') return 'SAINS';
    if (s.subj === 'PJK') return S.pjkMode[s.id] === 'PK' ? 'PENDIDIKAN KESIHATAN' : 'PENDIDIKAN JASMANI';
    return s.subj;
  }
  const skKey = s => subjName(s) + '|T' + s.ting;
  function suggestSK(s) {
    const list = S.skLists[skKey(s)] || [];
    if (!list.length) return '';
    const last = S.lastSK[s.kelas + '|' + subjName(s)];
    if (!last) return list[0];
    const i = list.findIndex(x => norm(x) === norm(last));
    return list[Math.min(i + 1, list.length - 1)] || list[0];
  }
  const nextPending = () => sorted().find(s => !S.done[doneKey(s)]);


  /* ===================== LESEN ===================== */
  const TG = 'https://t.me/bijakmulia';
  const LSALT = 'n7oGzSHBoK1VMAiJoLZYfnFjOIbB';
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const normName = n => String(n || '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  function keyFor(name) {
    const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let n = cyrb53(LSALT + '|' + normName(name), 7), out = '';
    for (let i = 0; i < 8; i++) { out += A[n % 31]; n = Math.floor(n / 31); }
    return out;
  }
  const normKey = k => String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ERPH/, '');
  const fmtKey = k => 'ERPH-' + k.slice(0, 4) + '-' + k.slice(4, 8);
  function teacherName() {
    const e = document.querySelector('.FormEntry.Attr_NAMA_GURU') ||
      [...document.querySelectorAll('.FormEntry')].find(x => { const f = x.querySelector('.FieldName'); return f && norm(f.textContent) === 'nama guru'; });
    if (!e) return '';
    const inp = e.querySelector('input,textarea');
    const v = inp ? inp.value : (e.querySelector('.TextTypeDisplay__text') || {}).textContent;
    return String(v || '').trim();
  }
  /* edisi percuma Bijak Mulia: tiada kod lesen diperlukan */
  function licState() { return { ok: true, lic: S.lic || { name: '', key: '' } }; }
  function licStateLama() {
    const lic = S.lic;
    if (!lic || !lic.name || normKey(lic.key) !== keyFor(lic.name)) return { ok: false, why: 'none' };
    const cur = teacherName();
    if (cur && normName(cur) !== normName(lic.name)) return { ok: false, why: 'mismatch', lic, cur };
    return { ok: true, lic };
  }

  /* ===================== DOM HELPERS ===================== */
  let host;
  const LABELS = ['minggu', 'nama guru', 'subjek', 'tarikh', 'hari', 'tahun', 'nama kelas', 'masa mula',
    'masa tamat', 'sk', 'objektif', 'pengembangan', 'refleksi', 'pilih bahasa'];

  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    if (r.right < 0 || r.left > innerWidth) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  function ownText(el) {
    let t = '';
    el.childNodes.forEach(n => { if (n.nodeType === 3) t += n.textContent; });
    return t.replace(/\s+/g, ' ').trim();
  }

  function findDoneBtn(root) {
    for (const el of root.querySelectorAll('*')) {
      if (el === host || el.children.length > 1) continue;
      const t = norm(el.textContent);
      if ((t === 'done' || t === 'selesai' || t === 'ok') && visible(el)) return el;
    }
    return null;
  }
  function getDialog() {
    const c = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].filter(e => e !== host && visible(e));
    if (c.length) return c[c.length - 1];
    const done = findDoneBtn(document);
    if (!done) return null;
    let p = done;
    for (let i = 0; i < 10 && p.parentElement; i++) {
      p = p.parentElement;
      if (p.querySelectorAll('*').length > 15 && p.getBoundingClientRect().height > 200) return p;
    }
    return null;
  }
  async function waitDialog() {
    for (let i = 0; i < 30; i++) { const d = getDialog(); if (d) { await sleep(250); return getDialog() || d; } await sleep(150); }
    return null;
  }

  function scanLabels() {
    const map = {}, dlg = getDialog();
    for (const el of document.body.querySelectorAll('*')) {
      if (el === host || el.children.length > 2) continue;
      if (dlg && dlg.contains(el)) continue;
      const t = norm(el.textContent);
      if (LABELS.includes(t) && !map[t] && visible(el)) map[t] = el;
    }
    return map;
  }
  function region(label) {
    const map = scanLabels(), want = norm(label), lab = map[want];
    if (!lab) return null;
    let next = null;
    for (const k in map) {
      if (k === want) continue;
      const l = map[k];
      if (lab.contains(l) || l.contains(lab)) continue;
      if (lab.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) {
        if (!next || (l.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING)) next = l;
      }
    }
    const nodes = []; let on = false;
    for (const el of document.body.querySelectorAll('*')) {
      if (!on) { if (el === lab) on = true; continue; }
      if (lab.contains(el) || el === host) continue;
      if (next && (el === next || el.contains(next))) break;
      nodes.push(el);
      if (nodes.length > 500) break;
    }
    return { lab, nodes };
  }
  const ATTR = {
    'minggu': 'Attr_ID_MINGGU', 'subjek': 'Attr_Subjek', 'tarikh': 'Attr_Tarikh', 'tahun': 'Attr_Tahun',
    'nama kelas': 'Attr_Nama_Kelas', 'masa mula': 'Attr_Masa_Mula', 'masa tamat': 'Attr_Masa_Tamat',
    'sk': 'Attr_SK', 'objektif': 'Attr_Objektif', 'pengembangan': 'Attr_Pengembangan',
    'refleksi': 'Attr_Refleksi', 'pilih bahasa': 'Attr_Pilih_Bahasa',
    'tema': 'Attr_Tema', 'standard pembelajaran': 'Attr_SP'
  };
  function field(label) {
    const want = norm(label);
    let entries = ATTR[want] ? [...document.querySelectorAll('.FormEntry.' + ATTR[want])] : [];
    const ALIAS = { 'tema': /^(tema|bidang|tajuk)/, 'standard pembelajaran': /^standard pembelajaran/, 'sk': /^standard kandungan/ };
    if (!entries.length) entries = [...document.querySelectorAll('.FormEntry')].filter(e => {
      if (host.contains(e)) return false;
      const fn = e.querySelector('.FieldName');
      if (!fn) return false;
      const n = norm(fn.textContent);
      return n === want || (ALIAS[want] && ALIAS[want].test(n));
    });
    for (const e of entries) {
      const btn = e.querySelector('.ListSelect:not(.ListSelect--read-only) .ListSelect__button');
      if (btn) return { entry: e, kind: 'list', ctl: btn };
      const ta = e.querySelector('textarea:not([disabled])');
      if (ta) return { entry: e, kind: 'text', ctl: ta };
      const inp = e.querySelector('input:not([disabled]):not([type=checkbox]):not([type=radio]):not([type=hidden])');
      if (inp) return { entry: e, kind: inp.type === 'date' ? 'date' : 'text', ctl: inp };
      const ce = e.querySelector('[contenteditable=true]');
      if (ce) return { entry: e, kind: 'text', ctl: ce };
      const tapEl = e.querySelector('.FormEntryValue [role=button], .FormEntryValue .ASTappable');
      if (tapEl) return { entry: e, kind: 'list', ctl: tapEl };
    }
    return entries.length ? { entry: entries[0], kind: 'readonly' } : null;
  }
  const curText = el => {
    if (!el) return '';
    const sp = [...el.querySelectorAll('.TextTypeDisplay__text')].map(x => x.textContent.trim()).filter(Boolean);
    return sp.length ? sp.join(', ') : String(el.innerText || el.textContent || '').trim();
  };
  function textCtl(nodes) {
    return nodes.find(e =>
      e.tagName === 'TEXTAREA' ||
      (e.tagName === 'INPUT' && !/^(checkbox|radio|hidden|button|submit)$/i.test(e.type)) ||
      e.getAttribute('contenteditable') === 'true');
  }
  function clickTarget(nodes) {
    const sel = nodes.find(e => e.tagName === 'SELECT');
    if (sel) return { select: sel };
    let t = nodes.find(e => /^(button|combobox|listbox)$/i.test(e.getAttribute('role') || '') && visible(e));
    if (!t) {
      let best = null, area = 0;
      for (const e of nodes) {
        if (!visible(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.height < 25 || r.height > 220) continue;
        const a = r.width * r.height;
        if (a > area) { area = a; best = e; }
      }
      t = best;
    }
    return { el: t };
  }

  function pt(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 };
  }
  function hitTarget(el, x, y) {
    let t = document.elementFromPoint(x, y);
    if (!t || !(el.contains(t) || t.contains(el)) || host.contains(t)) t = el;
    return t;
  }
  function reactProps(el) {
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      let k = null;
      try { k = Object.keys(n).find(q => q.startsWith('__reactProps$') || q.startsWith('__reactEventHandlers$')); } catch (e) {}
      if (k && n[k]) {
        const p = n[k];
        if (p.onClick || p.onMouseUp || p.onTouchEnd || p.onPointerUp || p.onKeyDown || p.onMouseDown || p.onTouchStart) return { node: n, p };
      }
    }
    return null;
  }
  function reactInfo(el) {
    const out = [];
    for (let n = el, i = 0; n && i < 5; n = n.parentElement, i++) {
      let keys = [];
      try { keys = Object.keys(n).filter(q => q.startsWith('__react')); } catch (e) {}
      const hs = [];
      keys.forEach(k => { const v = n[k]; if (v && typeof v === 'object') Object.keys(v).forEach(h => { if (/^on[A-Z]/.test(h)) hs.push(h); }); });
      out.push(n.tagName + '.' + String(n.className).slice(0, 40) + ' keys=' + keys.map(k => k.split('$')[0]).join('/') + ' handlers=' + hs.join(','));
    }
    return out.join('\n');
  }
  function fakeEv(el, type, x, y) {
    const t = { identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
    return {
      type, target: el, currentTarget: el, button: 0, buttons: 1, detail: 1,
      clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
      touches: type === 'touchend' ? [] : [t], changedTouches: [t], targetTouches: type === 'touchend' ? [] : [t],
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13,
      nativeEvent: { type, target: el, preventDefault() {}, stopPropagation() {} },
      timeStamp: performance.now(), defaultPrevented: false,
      isDefaultPrevented: () => false, isPropagationStopped: () => false,
      preventDefault() {}, stopPropagation() {}, persist() {}
    };
  }
  function fire(t, Ctor, type, o) { try { t.dispatchEvent(new Ctor(type, o)); return true; } catch (e) { return false; } }
  const STRATS = {
    async react(el) {
      const r = reactProps(el);
      if (!r) return false;
      const p = r.p, { x, y } = pt(el), n = r.node;
      if (p.onClick) { p.onClick(fakeEv(n, 'click', x, y)); return true; }
      if (p.onTouchStart || p.onTouchEnd) {
        if (p.onTouchStart) p.onTouchStart(fakeEv(n, 'touchstart', x, y));
        await sleep(80);
        if (p.onTouchEnd) p.onTouchEnd(fakeEv(n, 'touchend', x, y));
        return true;
      }
      if (p.onMouseDown || p.onMouseUp) {
        if (p.onMouseDown) p.onMouseDown(fakeEv(n, 'mousedown', x, y));
        await sleep(80);
        if (p.onMouseUp) p.onMouseUp(fakeEv(n, 'mouseup', x, y));
        return true;
      }
      if (p.onPointerDown || p.onPointerUp) {
        if (p.onPointerDown) p.onPointerDown(fakeEv(n, 'pointerdown', x, y));
        await sleep(80);
        if (p.onPointerUp) p.onPointerUp(fakeEv(n, 'pointerup', x, y));
        return true;
      }
      if (p.onKeyDown) { p.onKeyDown(fakeEv(n, 'keydown', x, y)); return true; }
      return false;
    },
    async mouse(el) {
      const { x, y } = pt(el), t = hitTarget(el, x, y);
      const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerType: 'mouse', isPrimary: true, pointerId: 1 };
      fire(t, PointerEvent, 'pointerdown', o); fire(t, MouseEvent, 'mousedown', o);
      await sleep(60);
      fire(t, PointerEvent, 'pointerup', o); fire(t, MouseEvent, 'mouseup', o);
      if (!fire(t, MouseEvent, 'click', o)) t.click();
      return true;
    },
    async touch(el) {
      const { x, y } = pt(el), t = hitTarget(el, x, y);
      try {
        const tc = new Touch({ identifier: 7, target: t, clientX: x, clientY: y, pageX: x, pageY: y });
        t.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, composed: true, touches: [tc], targetTouches: [tc], changedTouches: [tc] }));
        await sleep(80);
        t.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, composed: true, touches: [], targetTouches: [], changedTouches: [tc] }));
      } catch (e) { return false; }
      return true;
    },
    async key(el) {
      try { el.focus(); } catch (e) {}
      const o = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
      fire(el, KeyboardEvent, 'keydown', o); fire(el, KeyboardEvent, 'keypress', o); fire(el, KeyboardEvent, 'keyup', o);
      return true;
    },
    async plain(el) { el.click(); return true; }
  };
  let bestStrat = null;
  async function waitFor(fn, ms) {
    for (let i = 0; i < ms / 100; i++) { if (fn()) return true; await sleep(100); }
    return !!fn();
  }
  async function tapSmart(el, verify) {
    el.scrollIntoView({ block: 'center' });
    await sleep(200);
    const order = [bestStrat, 'react', 'mouse', 'plain', 'touch', 'key'].filter((v, i, a) => v && a.indexOf(v) === i);
    if (!verify) {
      for (const name of order) { try { if (await STRATS[name](el)) return true; } catch (e) {} }
      return false;
    }
    for (let round = 0; round < 2; round++) {
      for (const name of order) {
        if (verify()) return true;
        let ran = false;
        try { ran = await STRATS[name](el); } catch (e) { ran = false; }
        if (!ran) continue;
        if (await waitFor(verify, name === bestStrat ? 3500 : 1500)) { bestStrat = name; return true; }
      }
      await sleep(1500);
    }
    return false;
  }
  async function tap(el) { return tapSmart(el); }
  function setText(el, val) {
    el.focus();
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
      el.textContent = val;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.dispatchEvent(new FocusEvent('blur'));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.blur();
  }

  const SKIP_OPT = ['done', 'select all', 'selesai', 'search', 'cancel', 'clear', 'kelas', 'tema', 'tingkatan', 'masa', 'hingga',
    'standard kandungan', 'standard pembelajaran', 'objektif pembelajaran', 'aktiviti pdpc', ...LABELS];
  function dialogOptions(dlg) {
    const inp = dlg.querySelector('input');
    const top = inp ? inp.getBoundingClientRect().top : -1e9;
    const sc = scroller(dlg);
    const out = [], seen = new Set();
    const fnames = new Set([...document.querySelectorAll('.FormEntry .FieldName')].map(x => norm(x.textContent)));
    for (const el of dlg.querySelectorAll('*')) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') continue;
      if (fnames.has(norm(ownText(el)))) continue;
      const t = ownText(el);
      if (!t) continue;
      const n = norm(t);
      if (SKIP_OPT.includes(n) || seen.has(n) || !visible(el)) continue;
      if (inp && el.getBoundingClientRect().bottom <= top + 2 && !(sc && sc.contains(el))) continue; // tajuk dialog
      seen.add(n); out.push({ el, text: t });
    }
    return out;
  }
  function pick(opts, target, mode) {
    const T = norm(target);
    if (!T) return null;
    if (mode === 'time') {
      const tt = normTime(target), core = tt.replace(/(am|pm)$/, '');
      return opts.find(o => normTime(o.text) === tt) || opts.find(o => normTime(o.text).startsWith(core));
    }
    let m = opts.find(o => norm(o.text) === T);
    if (m) return m;
    if (mode === 'num') {
      const re = new RegExp('(^|\\D)' + T + '(\\D|$)');
      return opts.find(o => re.test(norm(o.text)));
    }
    return opts.find(o => norm(o.text).startsWith(T)) ||
      opts.find(o => norm(o.text).includes(T)) ||
      opts.find(o => norm(o.text).length > 6 && T.includes(norm(o.text)));
  }
  function scroller(dlg) {
    let best = null;
    for (const el of dlg.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
    }
    return best;
  }
  async function findOption(dlg, target, mode) {
    const sc = scroller(dlg);
    if (sc) { sc.scrollTop = 0; await sleep(150); }
    for (let i = 0; i < 60; i++) {
      const m = pick(dialogOptions(dlg), target, mode);
      if (m) return m;
      if (!sc) break;
      const b = sc.scrollTop;
      sc.scrollTop += sc.clientHeight * 0.7;
      await sleep(180);
      if (sc.scrollTop === b) break;
    }
    return null;
  }
  async function collectAll(dlg) {
    const map = new Map(), sc = scroller(dlg);
    if (sc) { sc.scrollTop = 0; await sleep(150); }
    for (let i = 0; i < 100; i++) {
      dialogOptions(dlg).forEach(o => { const n = norm(o.text); if (!map.has(n)) map.set(n, o.text); });
      if (!sc) break;
      const b = sc.scrollTop;
      sc.scrollTop += sc.clientHeight * 0.7;
      await sleep(180);
      if (sc.scrollTop === b) break;
    }
    return [...map.values()];
  }
  async function closeDialog() {
    const dlg = getDialog();
    if (!dlg) return;
    const d = findDoneBtn(dlg) || findDoneBtn(document);
    if (d) await tapSmart(d, () => !getDialog());
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
  }

  /* ===================== FILL ACTIONS ===================== */
  let LOG = [], DIAG = [];
  const note = (mark, label, msg) => LOG.push(`${mark} ${label}: ${msg}`);
  function regionHTML(rg) {
    let c = rg.lab;
    for (let i = 0; i < 3 && c.parentElement; i++) c = c.parentElement;
    return c.outerHTML.slice(0, 6000);
  }
  const keep = (label, why, htmlStr) => DIAG.push(`### ${label} — ${why}\n${htmlStr}`);

  let optStrat = null;
  const STRAT_ORDER = () => [optStrat, 'react', 'mouse', 'plain', 'touch', 'key'].filter((v, i, arr) => v && arr.indexOf(v) === i);
  function sameVal(cur, want, mode) {
    if (mode === 'time') return normTime(cur).includes(normTime(want).replace(/(am|pm)$/, ''));
    const c = norm(cur), w = norm(want);
    if (!c || !w) return false;
    if (mode === 'num') return new RegExp('(^|\\D)' + w + '(\\D|$)').test(c);
    return c === w || c.includes(w) || (c.length > 6 && w.includes(c));
  }
  async function openDlg(label, el, entryHTML) {
    if (getDialog()) await closeDialog();
    const opened = await tapSmart(el, () => !!getDialog());
    const dlg = opened ? await waitDialog() : null;
    if (!dlg) keep(label, 'dropdown tak terbuka (strat=' + bestStrat + ')\n' + reactInfo(el), entryHTML);
    return dlg;
  }
  async function openAndPick(label, target, mode) {
    for (const sname of STRAT_ORDER()) {
      const f = field(label);
      if (!f || !f.ctl) { note('✗', label, 'medan hilang'); return false; }
      const html0 = f.entry.outerHTML.slice(0, 6000);
      const dlg = await openDlg(label, f.ctl, html0);
      if (!dlg) { note('✗', label, 'dropdown tak terbuka'); return false; }
      const m = await findOption(dlg, target, mode);
      if (!m) {
        keep(label, `pilihan "${target}" tak jumpa`, dlg.outerHTML.slice(0, 8000));
        await closeDialog(); note('✗', label, `pilihan "${target}" tiada dalam senarai`); return false;
      }
      m.el.scrollIntoView({ block: 'center' });
      await sleep(200);
      try { await STRATS[sname](m.el); } catch (e) {}
      await sleep(600);
      if (getDialog()) await closeDialog();
      await sleep(700);
      const f2 = field(label);
      const cur = f2 && f2.ctl ? curText(f2.ctl) : '';
      if (sameVal(cur, m.text, mode)) { optStrat = sname; note('✓', label, m.text); return true; }
    }
    const f3 = field(label);
    keep(label, 'pilihan ditekan tapi AppSheet tak terima', f3 ? f3.entry.outerHTML.slice(0, 6000) : '');
    note('✗', label, `tak dapat pilih "${target}"`);
    return false;
  }
  async function dropdown(label, target, mode) {
    if (!target) return true;
    const f = field(label);
    if (!f) { note('–', label, 'tiada di skrin ini'); return true; }
    if (f.kind === 'readonly') { note('–', label, 'medan kunci (auto)'); return true; }
    if (f.kind !== 'list') { keep(label, 'bukan dropdown', f.entry.outerHTML.slice(0, 6000)); note('✗', label, 'bukan dropdown'); return false; }
    if (sameVal(curText(f.ctl), target, mode)) { note('✓', label, 'dah betul'); return true; }
    return openAndPick(label, target, mode);
  }
  async function fillDate(label, d) {
    const f = field(label);
    if (f && f.ctl && (f.kind === 'date' || f.kind === 'text')) {
      const v = f.ctl.type === 'date' ? iso(d) : dmy(d);
      if (f.ctl.value === v) return note('✓', label, 'dah betul');
      setText(f.ctl, v); await sleep(500);
      return note('✓', label, dmy(d));
    }
    if (f && f.kind === 'readonly') return note('–', label, 'medan kunci (auto)');
    const rg = region(label);
    if (!rg) return note('–', label, 'tiada di skrin ini');
    const el = textCtl(rg.nodes);
    if (!el) { keep(label, 'kotak tarikh tak jumpa', regionHTML(rg)); return note('✗', label, 'kotak tarikh tak jumpa'); }
    const v = el.type === 'date' ? iso(d) : dmy(d);
    if (el.value === v) return note('✓', label, 'dah betul');
    setText(el, v);
    await sleep(400);
    note('✓', label, v);
  }
  async function fillText(label, val) {
    if (!val) return note('–', label, 'tiada teks dari AI');
    await waitFor(() => { const q = field(label); return q && q.ctl; }, 2500);
    const f = field(label);
    if (!f) {
      const names = [...document.querySelectorAll('.FormEntry .FieldName')].map(x => JSON.stringify(x.textContent.trim()));
      keep(label, 'medan tak jumpa. FieldName: ' + names.join(', '), '');
      return note('✗', label, 'medan tak jumpa');
    }
    if (f && f.ctl && f.kind === 'text') {
      f.ctl.scrollIntoView({ block: 'center' }); await sleep(120);
      setText(f.ctl, val); await sleep(250);
      return note('✓', label, 'diisi');
    }
    if (f) { keep(label, 'kotak teks tak jumpa', f.entry.outerHTML.slice(0, 6000)); return note('✗', label, 'kotak teks tak jumpa'); }
    const rg = region(label);
    if (!rg) return note('–', label, 'tiada di skrin ini');
    const el = textCtl(rg.nodes);
    if (!el) { keep(label, 'kotak teks tak jumpa', regionHTML(rg)); return note('✗', label, 'kotak teks tak jumpa'); }
    el.scrollIntoView({ block: 'center' });
    await sleep(120);
    setText(el, val);
    await sleep(250);
    note('✓', label, 'diisi');
  }
  function fmtPeng(p) {
    if (Array.isArray(p)) return p.map((x, i) => `${i + 1}. ${String(x).replace(/^\s*\d+[.)]\s*/, '')}`).join('\n');
    return String(p || '');
  }
  function looseJSON(str) {
    let out = '', inStr = false, escp = false;
    for (const ch of String(str)) {
      if (inStr) {
        if (escp) { out += ch; escp = false; continue; }
        if (ch === '\\') { out += ch; escp = true; continue; }
        if (ch === '"') { inStr = false; out += ch; continue; }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') continue;
        if (ch === '\t') { out += ' '; continue; }
        out += ch;
      } else { if (ch === '"') inStr = true; out += ch; }
    }
    out = out.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(out);
  }
  function parseAI(txt) {
    let t = String(txt || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      const o = looseJSON(t.slice(a, b + 1));
      if (!o.objektif && !o.pengembangan) return null;
      return o;
    } catch (e) { return null; }
  }

  /* ===================== PROMPT ===================== */
  function buildPrompt(s, plan, nt) {
    plan = plan || {};
    const d = sessDate(s), dur = mins(s.tamat) - mins(s.mula), subj = subjName(s);
    const lang = S.bahasa === 'BI' ? 'Bahasa Inggeris' : 'Bahasa Melayu';
    const pj = subj === 'PENDIDIKAN JASMANI' ? ', aktiviti amali di padang/gelanggang termasuk memanaskan badan dan menyejukkan badan' : '';
    return `Anda guru ${subj} sekolah menengah di Malaysia (KSSM). Tulis RPH harian yang ringkas dan realistik.

Subjek: ${subj}
Kelas: Tingkatan ${s.ting} ${s.kelas}
Hari/Tarikh: ${s.hari}, ${dmy(d)}
Masa: ${s.mula} - ${s.tamat} (${dur} minit)
${plan.tema ? 'Tema: ' + plan.tema + '\n' : ''}Standard Kandungan: ${plan.sk || '(pilih yang paling sesuai)'}
${plan.sp ? 'Standard Pembelajaran (' + plan.sp.split(/;\s*|,\s*(?=\d)/).length + '): ' + plan.sp + '\n' : ''}Objektif dan aktiviti MESTI sejajar dengan Standard Pembelajaran di atas.
${nt ? 'Nota guru: ' + nt + '\n' : ''}Bahasa penulisan: ${lang}

Syarat:
1. "objektif": satu objektif yang boleh diukur untuk setiap Standard Pembelajaran (maksimum 3), dalam format "1. ... 2. ... 3. ...". JANGAN tulis ayat pembuka "Pada akhir PdP..." (borang dah ada).
2. "pengembangan": TEPAT 4 langkah (set induksi, 2 aktiviti utama, penutup), 1-2 ayat setiap satu, sesuai untuk ${dur} minit${pj}. Jangan letak nombor di depan. JANGAN masukkan refleksi di sini.
3. "refleksi": 2 ayat lengkap, JANGAN ada tempat kosong. Guna "80%" sebagai peratus murid yang mencapai objektif (guru akan ubah nombor ni), dan nyatakan tindakan susulan untuk murid yang belum menguasai. Contoh: "80% murid dapat mencapai objektif pembelajaran. Murid yang belum menguasai akan diberi latihan pengukuhan pada sesi akan datang."

Balas HANYA dengan JSON di bawah, tanpa teks lain dan tanpa markdown:
{"objektif":"...","pengembangan":["...","...","...","..."],"refleksi":"..."}`;
  }

  async function copy(t) {
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(t, 'text'); return true; } } catch (e) {}
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {}
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.cssText = 'position:fixed;top:0;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); return ok;
  }

  /* ===================== UI ===================== */
  host = document.createElement('div');
  host.id = 'erph-root';
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  (document.body || document.documentElement).appendChild(host);
  setInterval(() => { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); }, 1500);
  const R = host.attachShadow({ mode: 'open' });
  R.innerHTML = [
    '<style>',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,Roboto,sans-serif}',
    '.fab{position:fixed;left:10px;bottom:170px;opacity:.9;width:54px;height:54px;border-radius:50%;border:0;background:#2b0a2e;color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.35)}',
    '.sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:#fff;color:#1d1d1f;border-radius:18px 18px 0 0;box-shadow:0 -6px 30px rgba(0,0,0,.3);padding:14px 14px 30px;display:none;font-size:15px}',
    '.sheet.open{display:block}',
    '.hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}',
    '.hd b{font-size:17px;color:#2b0a2e}',
    '.x{border:0;background:#eee;border-radius:50%;width:34px;height:34px;font-size:16px}',
    '.week{display:flex;align-items:center;justify-content:space-between;background:#f4eef6;border-radius:12px;padding:6px}',
    '.week button{border:0;background:#fff;border-radius:10px;width:42px;height:34px;font-size:16px}',
    '.week b{font-size:14px;text-align:center}',
    '.bar{height:6px;background:#eee;border-radius:3px;margin:8px 0 2px;overflow:hidden}.bar i{display:block;height:100%;background:#2e9e5b}',
    '.prog{font-size:12px;color:#666}',
    '.item{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e3e3e3;border-radius:12px;margin:6px 0}',
    '.item.sel{border-color:#2b0a2e;background:#faf5fb;border-width:2px}',
    '.item.done{opacity:.5}',
    '.chk{font-size:22px;padding:2px 4px}',
    '.item small{display:block;color:#666;font-size:12px}',
    '.badge{margin-left:auto;background:#2b0a2e;color:#fff;font-size:11px;padding:3px 8px;border-radius:10px;white-space:nowrap}',
    '.sec{margin-top:10px;padding-top:10px;border-top:1px solid #eee}',
    '.l{display:block;font-size:12px;color:#666;margin:12px 0 4px;text-transform:uppercase;letter-spacing:.03em}',
    'select,input,textarea{width:100%;font-size:15px;padding:10px;border:1px solid #ccc;border-radius:10px;background:#fff;color:#111}',
    'textarea{min-height:90px;font-size:13px}',
    '.btn{display:block;width:100%;margin-top:8px;padding:12px;border-radius:12px;border:1px solid #2b0a2e;background:#fff;color:#2b0a2e;font-size:15px;font-weight:600}',
    '.btn.p{background:#2b0a2e;color:#fff}',
    '.btn.s{padding:8px;font-size:13px;font-weight:500}',
    '.row{display:flex;gap:8px}.row .btn{flex:1}',
    '.seg{display:flex;gap:6px}.seg button{flex:1;padding:9px;border-radius:10px;border:1px solid #ccc;background:#fff;font-size:14px}',
    '.seg button.on{background:#2b0a2e;color:#fff;border-color:#2b0a2e}',
    '.hint{font-size:12px;color:#777;margin-top:6px;line-height:1.4}',
    '.sk{background:#f3f7f3;border:1px solid #cfe5d4;padding:8px;border-radius:10px;font-size:13px;margin-top:6px}',
    '.step{border:2px solid #e6dee9;border-radius:14px;padding:12px;margin-top:12px;background:#fff}',
    '.step.on{border-color:#2b0a2e;background:#faf5fb;box-shadow:0 2px 10px rgba(43,10,46,.12)}',
    '.step h4{display:flex;align-items:center;gap:10px;margin:0 0 4px;font-size:16px;color:#2b0a2e}',
    '.num{width:32px;height:32px;border-radius:50%;background:#b9a9be;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;flex:none}',
    '.step.on .num{background:#2b0a2e}.step.ok .num{background:#2e9e5b}',
    '.step p:not(.p0){margin:0 0 6px 42px;font-size:12px;color:#6d6072;line-height:1.4}',
    '.closebar{margin-top:14px}',
    '.warn{background:#fff4e5;border:1px solid #f0c58a;color:#5a3a06;padding:10px;border-radius:10px;font-size:13px;margin-top:8px;line-height:1.45}',
    '.cur{display:flex;gap:10px;align-items:center;justify-content:space-between;background:#f4eef6;border-radius:14px;padding:12px;margin-top:12px}',
    '.cur small{display:block;color:#6d6072;font-size:12px}.cur b{display:block;font-size:16px;color:#2b0a2e}.cur span{display:block;font-size:13px;color:#333}',
    '.cur em{display:block;font-size:12px;color:#2e7a4f;font-style:normal;margin-top:3px}',
    '.mini{border:1px solid #2b0a2e;background:#fff;color:#2b0a2e;border-radius:10px;padding:8px 12px;font-size:13px;flex:none}',
    '.dots{display:flex;align-items:center;margin:16px 6px 2px}.dots i{flex:1;height:3px;background:#e1d6e4;margin:0 4px;border-radius:2px}',
    '.dot{width:36px;height:36px;border-radius:50%;background:#e1d6e4;color:#6d6072;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex:none}',
    '.dot.on{background:#2b0a2e;color:#fff;box-shadow:0 0 0 4px #e9dcee}.dot.ok{background:#2e9e5b;color:#fff}',
    '.btn.big{padding:16px;font-size:17px}.btn:disabled{opacity:.35}',
    '.p0{margin:4px 0 6px;font-size:13px;color:#6d6072;line-height:1.45}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 8px}',
    'label{display:block;font-size:12px;color:#6d6072;margin-top:8px}label select,label input{margin-top:4px}',
    '.log{margin-top:10px;font-size:13px;background:#f6f6f6;border-radius:10px;padding:10px;white-space:pre-wrap;line-height:1.5}',
    'details{margin-top:16px}summary{font-weight:600;color:#2b0a2e;padding:6px 0}',
    '.toast{position:fixed;left:50%;bottom:240px;transform:translateX(-50%);background:#222;color:#fff;padding:9px 16px;border-radius:20px;font-size:14px;display:none;max-width:85vw;text-align:center}',
    '.busy{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#2b0a2e;color:#fff;padding:8px 16px;border-radius:20px;font-size:13px;display:none}',
    '</style>',
    '<button class="fab" title="ERPH Autofill">📝</button>',
    '<div class="sheet"></div>',
    '<div class="toast"></div>',
    '<div class="busy">⏳ Sedang isi borang… jangan sentuh skrin</div>'
  ].join('\n');
  const fab = R.querySelector('.fab'), sheet = R.querySelector('.sheet'), toastEl = R.querySelector('.toast'), busyEl = R.querySelector('.busy');

  const first = nextPending();
  const ui = { sel: first ? first.id : null, sk: '', note: '', json: '', log: '', view: 'main', draft: {}, stepOv: null };
  if (first) ui.sk = suggestSK(first);
  const selSess = () => S.schedule.find(s => s.id === ui.sel);
  setTimeout(() => toast('ERPH Autofill sedia ✓ — tekan 📝'), 800);

  function toast(t) { toastEl.textContent = t; toastEl.style.display = 'block'; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.style.display = 'none', 2200); }
  function busy(on) {
    sheet.classList.toggle('open', !on && sheet._wasOpen);
    fab.style.display = on ? 'none' : 'block';
    busyEl.style.display = on ? 'block' : 'none';
  }

  const DEF_SUBJ = ['BAHASA MELAYU', 'ENGLISH', 'GEOGRAFI', 'KESUSASTERAAN MELAYU KOMUNIKATIF', 'MATEMATIK', 'PENDIDIKAN JASMANI',
    'PENDIDIKAN KESIHATAN', 'PENDIDIKAN SENI VISUAL', 'PERNIAGAAN', 'RBT', 'SAINS', 'SEJARAH'];
  const DEF_MASA = ['7:30 am', '8:10 am', '8:40 am', '9:10 am', '9:40 am', '10:10 am', '10:40 am', '11:00 am', '11:30 am', '12:00 pm',
    '12:30 pm', '1:00 pm', '1:30 pm', '2:00 pm', '2:30 pm', '3:00 pm', '3:30 pm', '4:00 pm', '4:30 pm'];
  const DEF_KELAS = ['THORIQ', 'KHALID', 'TALHAH', 'USAMAH', 'HAMZAH', 'BILAL', 'UTHMAN', 'ALI', 'UMAR', 'ABU BAKAR'];
  const HARI = ['Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat'];
  const AIS = {
    chatgpt: ['ChatGPT', 'https://chatgpt.com/'], gemini: ['Gemini', 'https://gemini.google.com/app'],
    claude: ['Claude', 'https://claude.ai/new'], copilot: ['Copilot', 'https://copilot.microsoft.com/'], none: ['Tiada (salin sahaja)', '']
  };
  const optList = k => (S.opts && S.opts[k] && S.opts[k].length) ? S.opts[k] : ({ subjek: DEF_SUBJ, masa: DEF_MASA, kelas: DEF_KELAS })[k];
  const optHtml = (arr, cur) => arr.map(v => `<option ${norm(v) === norm(cur) ? 'selected' : ''}>${esc(v)}</option>`).join('');
  function timetablePrompt() {
    return `Saya lampirkan gambar/PDF jadual waktu mengajar saya. Tukar kepada JSON mengikut peraturan ini:

1. Satu objek untuk setiap kelas. Kalau ada beberapa waktu BERTURUT-TURUT untuk kelas dan subjek yang sama pada hari yang sama, GABUNG jadi satu objek (mula = waktu pertama, tamat = waktu terakhir).
2. "hari": salah satu dari Isnin, Selasa, Rabu, Khamis, Jumaat.
3. "ting": nombor tingkatan sahaja (1-5). Contoh "PJK-3 HAMZAH" → 3, "1 KHALID" → 1.
4. "kelas": nama kelas TANPA nombor, huruf besar. Pilih dari senarai ini kalau ada: ${optList('kelas').join(', ')}.
5. "subjek": pilih TEPAT dari senarai ini: ${optList('subjek').join(', ')}. Kod SC = SAINS. Kalau subjek ialah PJK (Pendidikan Jasmani dan Kesihatan), tulis "PJK".
6. "mula" dan "tamat": format seperti "8:10 am" atau "12:30 pm".
7. Abaikan petak kosong dan rehat.

Balas HANYA dengan JSON array, tanpa teks lain dan tanpa markdown. Contoh:
[{"hari":"Isnin","ting":3,"kelas":"BILAL","subjek":"SAINS","mula":"8:10 am","tamat":"9:40 am"}]`;
  }
  function normTimeStr(t) {
    const m = /(\d{1,2})[:.](\d{2})\s*([ap])?\.?\s*m?/i.exec(String(t || ''));
    if (!m) return '';
    let h = +m[1]; const mm = m[2];
    let ap = m[3] ? m[3].toLowerCase() + 'm' : '';
    if (h > 12) { h -= 12; ap = 'pm'; }
    if (!ap) ap = (h >= 7 && h <= 11) ? 'am' : 'pm';
    if (h === 0) h = 12;
    const v = h + ':' + mm + ' ' + ap;
    const hit = optList('masa').find(x => normTime(x) === normTime(v));
    return hit || v;
  }
  function matchOpt(list, v) {
    const n = norm(v);
    return list.find(x => norm(x) === n) || list.find(x => norm(x).includes(n) || n.includes(norm(x))) || String(v || '').toUpperCase().trim();
  }
  function parseTimetable(txt) {
    let t = String(txt || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a < 0 || b <= a) return { err: 'Tiada JSON array [ ... ] dalam jawapan AI' };
    let arr;
    try { arr = looseJSON(t.slice(a, b + 1)); } catch (e) { return { err: 'JSON tak sah: ' + e.message }; }
    if (!Array.isArray(arr) || !arr.length) return { err: 'Senarai kosong' };
    const DAYS = { isn: 1, sel: 2, rab: 3, kha: 4, jum: 5 }, warn = [];
    let out = [];
    arr.forEach((r, i) => {
      const day = DAYS[norm(r.hari).slice(0, 3)];
      const mula = normTimeStr(r.mula), tamat = normTimeStr(r.tamat);
      let subj = String(r.subjek || r.subj || '').trim();
      if (/^pjk$|jasmani dan kesihatan/i.test(subj)) subj = 'PJK';
      else if (/^sc$/i.test(subj)) subj = 'SAINS';
      else subj = matchOpt(optList('subjek'), subj);
      const ting = parseInt(r.ting, 10);
      if (!day || !mula || !tamat || !(ting >= 1 && ting <= 6) || mins(tamat) <= mins(mula)) { warn.push('Baris ' + (i + 1) + ' dilangkau (data tak lengkap)'); return; }
      out.push({ day, hari: HARI[day - 1], ting, kelas: matchOpt(optList('kelas'), r.kelas), subj, mula, tamat });
    });
    out.sort((x, y) => x.day - y.day || mins(x.mula) - mins(y.mula));
    const merged = [];
    out.forEach(x => {
      const p = merged[merged.length - 1];
      if (p && p.day === x.day && p.kelas === x.kelas && p.ting === x.ting && p.subj === x.subj && mins(p.tamat) >= mins(x.mula)) {
        if (mins(x.tamat) > mins(p.tamat)) p.tamat = x.tamat;
      } else merged.push(Object.assign({}, x));
    });
    merged.forEach((x, i) => { x.id = 't' + Date.now().toString(36) + i; });
    return { list: merged, warn };
  }
  const header = t => `<div class="hd"><b>📝 ${t}</b><button class="x" data-a="close">✕</button></div>`;
  const footer = () => `<button class="btn closebar" data-a="close">✕ Tutup panel</button><div class="hint" style="text-align:center">ERPH Autofill · by gelanggangdigital · v4.3</div>`;
  function curStep(s) {
    if (ui.stepOv && ui.stepOv.id === s.id) return ui.stepOv.n;
    if (!(ui.plan && ui.plan.id === s.id)) return 1;
    if (ui.copied !== s.id) return 2;
    if (!parseAI(ui.json)) return 3;
    return 4;
  }
  function weekBar() {
    const list = sorted(), mon = monday(S.weekOffset), fri = new Date(mon); fri.setDate(fri.getDate() + 4);
    const doneN = list.filter(x => S.done[doneKey(x)]).length;
    const label = S.weekOffset === 0 ? 'Minggu ini' : S.weekOffset === 1 ? 'Minggu depan' : S.weekOffset === -1 ? 'Minggu lepas' : `Minggu ${S.weekOffset > 0 ? '+' : ''}${S.weekOffset}`;
    return `<div class="week"><button data-a="wk-">◀</button><b>${label}<br><small>${dmy(mon)} – ${dmy(fri)}</small></b><button data-a="wk+">▶</button></div>
<div class="bar"><i style="width:${list.length ? doneN / list.length * 100 : 0}%"></i></div>
<div class="prog">${doneN}/${list.length} kelas siap minggu ni</div>`;
  }
  function renderSetup() {
    const d = ui.draft || {};
    let h = header('Jadual Waktu Saya');
    if (!S.schedule.length) h += `<div class="sk">👋 Selamat datang! Masukkan kelas yang awak ajar setiap minggu. Buat sekali sahaja — lepas ni skrip ingat.</div>`;
    const ai0 = AIS[S.ai] || AIS.chatgpt;
    h += `<div class="step ${S.schedule.length ? '' : 'on'}"><h4><span class="num">⚡</span>Cara cepat: import guna AI</h4>
<p class="p0">① Tekan butang di bawah. Dalam AI, <b>lampirkan gambar/PDF jadual waktu</b> dan paste prompt, kemudian hantar.<br>② Salin jawapan AI, tampal di bawah, tekan Import.</p>
${ai0[1] ? `<button class="btn p" data-a="tprompt">📋 Salin prompt jadual & buka ${ai0[0]}</button>` : `<button class="btn p" data-a="tprompt">📋 Salin prompt jadual</button>`}
<textarea data-f="tjson" placeholder='Tampal jawapan AI di sini — [{"hari":"Isnin", ...}]'>${esc(ui.tjson || '')}</textarea>
<button class="btn s" data-a="tpaste">📋 Tampal dari clipboard</button>
${S.schedule.length ? `<div class="row"><button class="btn p" data-a="timport" data-mode="replace">Import (ganti jadual)</button><button class="btn s" data-a="timport" data-mode="add">Import (tambah)</button></div>` : `<button class="btn p" data-a="timport" data-mode="replace">⬇ Import jadual</button>`}
</div>`;
    if (S.schedule.length) h += `<span class="l">Jadual semasa (${S.schedule.length} kelas)</span>`;
    h += sorted().map(x => `<div class="item"><div><b>${esc(x.hari)} ${esc(x.mula)}–${esc(x.tamat)}</b><small>T${x.ting} ${esc(x.kelas)} · ${esc(subjName(x))}</small></div><button class="mini" style="margin-left:auto" data-a="delcls" data-id="${x.id}">🗑</button></div>`).join('');
    h += `<div class="step"><h4><span class="num">+</span>Atau tambah satu-satu</h4>
<div class="grid">
<label>Hari<select data-d="hari">${optHtml(HARI, d.hari || 'Isnin')}</select></label>
<label>Tingkatan<select data-d="ting">${optHtml(['1', '2', '3', '4', '5'], d.ting || '1')}</select></label>
<label>Masa mula<select data-d="mula">${optHtml(optList('masa'), d.mula || optList('masa')[0])}</select></label>
<label>Masa tamat<select data-d="tamat">${optHtml(optList('masa'), d.tamat || optList('masa')[1])}</select></label>
</div>
<label>Kelas<select data-d="kelas">${optHtml(optList('kelas'), d.kelas || '')}</select></label>
<label>Subjek<select data-d="subj">${optHtml(optList('subjek'), d.subj || '')}</select></label>
<button class="btn p" data-a="addcls">+ Tambah ke jadual</button>
<div class="hint">Waktu berturut (cth 7:30–9:10) masukkan sebagai satu kelas.</div>
<button class="btn s" data-a="harvest">⟳ Senarai kelas/subjek lain? Ambil dari borang AppSheet</button></div>`;
    h += `<button class="btn p big" data-a="view-main" ${S.schedule.length ? '' : 'disabled'}>Siap — mula guna ✓</button>`;
    return h + footer();
  }
  function renderList() {
    const np = nextPending();
    let h = header('Pilih kelas') + weekBar();
    for (const x of sorted()) {
      const dn = !!S.done[doneKey(x)];
      h += `<div class="item ${x.id === ui.sel ? 'sel' : ''} ${dn ? 'done' : ''}" data-a="pick" data-id="${x.id}">
<span class="chk" data-a="toggle" data-id="${x.id}">${dn ? '✅' : '⬜'}</span>
<div><b>${esc(x.hari)} ${esc(x.mula)}–${esc(x.tamat)}</b><small>T${x.ting} ${esc(x.kelas)} · ${esc(subjName(x))}</small></div>
${np && np.id === x.id ? '<span class="badge">SETERUSNYA</span>' : ''}</div>`;
    }
    h += `<button class="btn" data-a="view-main">← Kembali</button>`;
    return h + footer();
  }
  function modeSeg() {
    const wm = S.mode !== 'single';
    return `<div class="seg" style="margin-top:10px"><button data-a="mode-week" class="${wm ? 'on' : ''}">📅 Mod Minggu</button><button data-a="mode-single" class="${wm ? '' : 'on'}">1️⃣ Satu Kelas</button></div>`;
  }
  function renderWeek() {
    let h = header('ERPH Autofill') + weekBar() + modeSeg();
    const pend = sorted().filter(x => !S.done[doneKey(x)]);
    const wv = weekValid(), aiN = wv ? Object.keys(S.week.ai || {}).length : 0, planN = wv ? Object.keys(S.week.codes || {}).length : 0;
    const w = !wv ? 1 : (!aiN ? 2 : 3);
    h += `<div class="dots">${[1, 2, 3].map(i => `<span class="dot ${i < w ? 'ok' : i === w ? 'on' : ''}">${i < w ? '✓' : i}</span>`).join('<i></i>')}</div>`;
    if (w === 1) {
      h += `<div class="step on"><h4>Langkah 1 · Rancang minggu</h4>
<p class="p0">Buka <b>satu borang ERPH GURU baru</b>, kemudian tekan butang ini. Skrip guna borang ini sebagai draf untuk pilih Tema/SK/SP seterusnya bagi <b>${pend.length} kelas</b> belum siap (~30 saat sekelas). Lepas siap, skrip tekan <b>Cancel</b> sendiri (draf tak disimpan).</p>
<button class="btn p big" data-a="planweek" ${pend.length ? '' : 'disabled'}>▶ Rancang ${pend.length} kelas</button></div>`;
    }
    if (w === 2) {
      const ai = AIS[S.ai] || AIS.chatgpt;
      h += `<div class="step on"><h4>Langkah 2 · Satu prompt untuk ${planN} kelas</h4>
${ai[1] ? `<button class="btn p big" data-a="wprompt">📋 Salin prompt minggu & buka ${ai[0]}</button>` : `<button class="btn p big" data-a="wprompt">📋 Salin prompt minggu</button>`}
<p class="p0" style="margin-top:8px">Hantar dalam AI, salin <b>seluruh</b> jawapan, tampal di bawah.</p>
<textarea data-f="wjson" placeholder="Tekan lama di sini → Paste">${esc(ui.wjson || '')}</textarea>
<button class="btn s" data-a="wpaste">📋 Tampal dari clipboard</button>
<button class="btn p" data-a="wsave">💾 Simpan jawapan AI</button>
${ui.wjsonErr ? `<div class="warn">${esc(ui.wjsonErr)}. Pastikan awk salin SELURUH jawapan dari { hingga }.</div>` : ''}</div>`;
    }
    if (w === 3) {
      const s = selSess();
      const it = s && S.week.items[s.id], has = s && S.week.ai[s.id] && it && !it.err;
      h += `<div class="step on"><h4>Langkah 3 · Isi setiap kelas</h4>
${nextAuto() ? `<button class="btn p big" data-a="autoall">⚡ Isi & Save SEMUA kelas automatik</button>
<p class="p0">Skrip ulang sendiri: Catat eRPH → isi dropdown, objektif, aktiviti, refleksi → Save, untuk setiap kelas. Bunyi panjang bila semua siap. Tekan pil ⚡ di atas skrin untuk berhenti.</p>
<span class="l">Atau satu-satu</span>` : ''}
<p class="p0">Skrip <b>Save</b> borang sebelum ini (kalau ada), tekan <b>Catat eRPH Anda</b>, dan isi kelas ini.</p>
${!nextPending() ? `<div class="sk">🎉 Semua kelas minggu ni dah siap diisi!</div>${ui.lastFilledId ? '<button class="btn p big" data-a="wsaveonly">💾 Save borang terakhir</button>' : ''}` : s ? `<div class="cur"><div><small>${S.done[doneKey(s)] ? '✅ Dah siap' : 'Kelas sekarang'}</small><b>${esc(s.hari)} · ${esc(s.mula)}–${esc(s.tamat)}</b><span>T${s.ting} ${esc(s.kelas)} · ${esc(subjName(s))}</span>${it && it.sp ? `<em>${esc(it.sp.slice(0, 70))}</em>` : ''}</div></div>
<button class="btn p big" data-a="wnext" ${has ? '' : 'disabled'}>${ui.lastFilledId ? '💾 Save & isi kelas ini' : '▶ Isi kelas ini'}</button>
${ui.lastFilledId ? '<p class="p0">Borang kelas sebelum ini akan di-Save dulu. Pastikan awak dah semak.</p>' : ''}
${has ? '' : '<p class="p0">Kelas ini tiada dalam rancangan/jawapan AI — guna Mod Satu Kelas.</p>'}` : '<div class="sk">🎉 Semua kelas minggu ni dah siap!</div>'}</div>`;
    }
    const noStu = [...new Set(sorted().map(stuKey))].filter(k => !((S.students || {})[k] || []).length);
    if (noStu.length) h += `<div class="warn">Refleksi guna peratus untuk ${noStu.length} kelas tanpa senarai murid. <b data-a="view-students" style="text-decoration:underline">Tambah senarai murid</b> untuk dapat bilangan & nama murid.</div>`;
    if (wv) {
      h += `<span class="l">Rancangan minggu</span>`;
      for (const x of sorted()) {
        const it = S.week.items[x.id], dn = !!S.done[doneKey(x)], ok = S.week.ai && S.week.ai[x.id];
        const sub = it ? (it.err ? '⚠️ ' + it.err : (it.sp || it.sk || '')) : 'tiada dalam rancangan';
        h += `<div class="item ${x.id === ui.sel ? 'sel' : ''} ${dn ? 'done' : ''}" data-a="pick" data-id="${x.id}">
<span class="chk" data-a="toggle" data-id="${x.id}">${dn ? '✅' : (ok ? '🟣' : '⬜')}</span>
<div style="min-width:0"><b>${esc(x.hari)} ${esc(x.mula)} · T${x.ting} ${esc(x.kelas)}</b><small>${esc(sub.slice(0, 80))}</small></div></div>`;
      }
      h += `<button class="btn s" data-a="replan">↻ Rancang semula minggu ini</button>`;
    }
    if (ui.log) h += `<div class="log">${esc(ui.log)}</div>`;
    if (DIAG.length) h += `<button class="btn" data-a="report">📋 Salin laporan ralat (${DIAG.length}) — hantar kepada pembangun</button>`;
    return h + settingsHtml(selSess()) + footer();
  }
  function renderMain() {
    if (S.mode !== 'single') return renderWeek();
    const s = selSess();
    let h = header('ERPH Autofill') + weekBar() + modeSeg();
    if (!s) {
      h += `<div class="sk" style="margin-top:12px">🎉 Semua kelas minggu ni dah siap!</div><button class="btn" data-a="wk+">Minggu depan ▶</button>`;
      return h + settingsHtml(null) + footer();
    }
    const pkey = s.kelas + '|' + subjName(s), st = S.prog[pkey];
    const lastSp = st && st.used.length ? st.used[st.used.length - 1] : '';
    h += `<div class="cur"><div><small>${S.done[doneKey(s)] ? '✅ Dah siap' : 'Kelas sekarang'}</small><b>${esc(s.hari)} · ${esc(s.mula)}–${esc(s.tamat)}</b><span>T${s.ting} ${esc(s.kelas)} · ${esc(subjName(s))}</span>${lastSp ? `<em>SP terakhir: ${esc(lastSp.slice(0, 60))}</em>` : ''}</div><button class="mini" data-a="view-list">Tukar</button></div>`;
    if (s.subj === 'PJK') {
      const pk = S.pjkMode[s.id] === 'PK';
      h += `<div class="seg" style="margin-top:8px"><button data-a="pj" class="${pk ? '' : 'on'}">Pend. Jasmani</button><button data-a="pk" class="${pk ? 'on' : ''}">Pend. Kesihatan</button></div>`;
    }
    const n = curStep(s);
    h += `<div class="dots">${[1, 2, 3, 4].map(i => `<span class="dot ${i < n ? 'ok' : i === n ? 'on' : ''}" data-a="goto" data-n="${i}">${i < n ? '✓' : i}</span>`).join('<i></i>')}</div>`;
    const ai = AIS[S.ai] || AIS.chatgpt;
    const planTxt = ui.plan && ui.plan.id === s.id ? (ui.plan.sp || ui.plan.sk) : '';
    if (n === 1) h += `<div class="step on"><h4>Langkah 1 · Isi borang</h4>
<p class="p0">Skrip isi Subjek, Tarikh, Tingkatan, Kelas, Masa, Tema, SK dan SP seterusnya (maks 3) sendiri. Ambil masa ~30 saat — jangan sentuh skrin.</p>
<button class="btn p big" data-a="prep">▶ Mula isi borang</button></div>`;
    if (n === 2) h += `<div class="step on"><h4>Langkah 2 · Minta AI tulis RPH</h4>
${planTxt ? `<div class="sk">📌 ${esc(planTxt)}</div>` : ''}
<label>Nota untuk AI (pilihan)<input data-f="note" placeholder="cth: hujan, buat dalam kelas" value="${esc(ui.note)}"></label>
${ai[1] ? `<button class="btn p big" data-a="openai">📋 Salin prompt & buka ${ai[0]}</button><button class="btn s" data-a="prompt">Salin sahaja</button>` : `<button class="btn p big" data-a="prompt">📋 Salin prompt</button>`}
<p class="p0" style="margin-top:8px">Dalam AI: tekan lama → Paste → hantar. Kemudian salin seluruh jawapan dan kembali ke sini.</p></div>`;
    if (n === 3) h += `<div class="step on"><h4>Langkah 3 · Tampal jawapan AI</h4>
<textarea data-f="json" placeholder="Tekan lama di sini → Paste">${esc(ui.json)}</textarea>
<button class="btn s" data-a="paste">📋 Tampal dari clipboard</button>
<p class="p0">Bila jawapan sah, skrip terus ke langkah 4.</p></div>`;
    if (n === 4) h += `<div class="step on"><h4>Langkah 4 · Isi & siap</h4>
<p class="p0">Objektif, Aktiviti PdPc dan Refleksi (peratus 50–90%) akan diisi. Kemajuan SP disimpan.</p>
<button class="btn p big" data-a="fill">✓ Isi teks & tanda siap</button>
<p class="p0" style="margin-top:8px">Lepas tu semak borang dan tekan <b>Save</b> AppSheet.</p></div>`;
    h += `<div class="row"><button class="btn s" data-a="goto" data-n="${n - 1}" ${n === 1 ? 'disabled' : ''}>← Sebelum</button><button class="btn s" data-a="goto" data-n="${n + 1}" ${n === 4 ? 'disabled' : ''}>Langkau →</button></div>`;
    if (ui.log) h += `<div class="log">${esc(ui.log)}</div>`;
    if (DIAG.length) h += `<button class="btn" data-a="report">📋 Salin laporan ralat (${DIAG.length}) — hantar kepada pembangun</button>`;
    return h + settingsHtml(s) + footer();
  }
  function settingsHtml(s) {
    return `<details><summary>⚙️ Tetapan</summary>
<button class="btn s" data-a="view-setup">🗓 Ubah jadual waktu</button>
<button class="btn s" data-a="view-students">👥 Senarai murid (untuk refleksi)</button>
<button class="btn s" data-a="sound">${S.sound === false ? '🔇 Bunyi siap: OFF (tekan untuk ON)' : '🔔 Bunyi siap: ON (tekan untuk OFF)'}</button>
<div class="hint">Edisi percuma · Bijak Mulia</div>
<button class="btn s" data-a="telegram">💬 Bantuan: Telegram @bijakmulia</button>
<label>AI pilihan<select data-f="ai">${Object.keys(AIS).map(k => `<option value="${k}" ${S.ai === k ? 'selected' : ''}>${AIS[k][0]}</option>`).join('')}</select></label>
<span class="l">Bahasa RPH</span><div class="seg"><button data-a="bm" class="${S.bahasa === 'BI' ? '' : 'on'}">BM</button><button data-a="bi" class="${S.bahasa === 'BI' ? 'on' : ''}">BI</button></div>
<label>Minggu (cth M35 — kosong = biar)<input data-f="minggu" value="${esc(S.minggu)}"></label>
${s ? `<button class="btn s" data-a="resetprog">Reset kemajuan SP ${esc(s.kelas)} · ${esc(subjName(s))}</button>` : ''}
<details><summary style="font-size:13px">Lanjutan</summary>
<span class="l">Jadual (JSON)</span><textarea data-f="sched" style="min-height:140px;font-family:monospace;font-size:11px">${esc(JSON.stringify(S.schedule, null, 1))}</textarea>
<button class="btn s" data-a="savesched">Simpan jadual JSON</button>
<select data-f="diag">${LABELS.map(l => `<option>${l}</option>`).join('')}</select>
<div class="row"><button class="btn s" data-a="diag">Salin HTML medan</button><button class="btn s" data-a="diagdlg">Salin HTML dropdown</button></div>
<div class="row"><button class="btn s" data-a="export">Salin backup</button><button class="btn s" data-a="reset">Reset semua</button></div>
</details></details>`;
  }
  function renderLicence(st) {
    const cur = teacherName();
    let h = header('Aktifkan ERPH Autofill');
    if (st.why === 'mismatch') h += `<div class="warn">Kod lesen di telefon ini untuk <b>${esc(st.lic.name)}</b>, bukan ${esc(st.cur)}. Setiap lesen untuk seorang guru sahaja.</div>`;
    h += cur ? `<div class="sk">Nama guru dikesan:<br><b style="font-size:16px">${esc(cur)}</b></div>
<button class="btn s" data-a="copyname">📋 Salin nama ini</button>`
      : `<div class="warn">Nama guru belum dikesan. Buka borang ERPH GURU (tambah rekod baru) dulu, kemudian tekan 📝 semula.</div>`;
    h += `<label>Kod lesen<input data-f="lickey" placeholder="ERPH-XXXX-XXXX" autocapitalize="characters" value="${esc(ui.lickey || '')}"></label>
<button class="btn p big" data-a="activate" ${cur ? '' : 'disabled'}>Aktifkan</button>
<p class="p0" style="margin-top:12px">Belum ada kod? Hantar nama guru di atas kepada penjual melalui Telegram. Kod lesen hanya sah untuk nama tersebut.</p>
<button class="btn" data-a="telegram">💬 Telegram @bijakmulia</button>`;
    return h + footer();
  }
  function renderStudents() {
    const keys = [...new Set(sorted().map(stuKey))];
    const st = S.students || {};
    let h = header('Senarai Murid');
    h += `<p class="p0">Untuk refleksi: skrip kira bilangan murid menguasai (cth 24/30) dan petik nama murid cemerlang & yang belum menguasai secara rawak.</p>`;
    h += keys.map(k => `<div class="item ${k === ui.stuSel ? 'sel' : ''}" data-a="stu-pick" data-k="${esc(k)}"><div><b>${esc(k)}</b><small>${(st[k] || []).length ? (st[k].length + ' murid') : 'belum ada senarai'}</small></div>${(st[k] || []).length ? '<span class="badge" style="background:#2e9e5b">✓</span>' : ''}</div>`).join('');
    if (ui.stuSel) {
      const cur = st[ui.stuSel] || [];
      h += `<div class="step on"><h4>${esc(ui.stuSel)}</h4>
<p class="p0">Dalam Excel/Google Sheets, pilih lajur nama murid (boleh sekali dengan lajur Bil), salin, dan tampal di sini.</p>
<textarea data-f="stutxt" placeholder="1&#9;AHMAD BIN ALI&#10;2&#9;SITI BINTI ABU">${esc(ui.stuTxt || '')}</textarea>
<button class="btn p" data-a="stu-save">💾 Simpan senarai</button>
${cur.length ? `<div class="sk" style="max-height:160px;overflow:auto">${cur.map((n, i) => (i + 1) + '. ' + esc(n)).join('<br>')}</div><button class="btn s" data-a="stu-del">🗑 Padam senarai ${esc(ui.stuSel)}</button>` : ''}
</div>`;
    }
    h += `<button class="btn" data-a="view-main">← Kembali</button>`;
    return h + footer();
  }
  function render() {
    let h;
    const lst = licState();
    if (!lst.ok) { sheet.innerHTML = renderLicence(lst); return; }
    if (!S.schedule.length) ui.view = 'setup';
    if (ui.view === 'setup') h = renderSetup();
    else if (ui.view === 'list') h = renderList();
    else if (ui.view === 'students') h = renderStudents();
    else h = renderMain();
    sheet.innerHTML = h;
  }

  /* ===================== ACTIONS ===================== */
  async function readOptions(label) {
    const f = field(label);
    if (!f || !f.ctl || f.kind !== 'list') return [];
    const dlg = await openDlg(label, f.ctl, f.entry.outerHTML.slice(0, 4000));
    if (!dlg) return [];
    const list = (await collectAll(dlg)).filter(t => t.trim().length >= 4);
    await closeDialog(); await sleep(500);
    return list;
  }
  const inList = (arr, x) => arr.some(u => norm(u) === norm(x));
  function planFromForm() {
    const g = l => { const f = field(l); return f && f.ctl ? curText(f.ctl) : ''; };
    return { tema: g('tema'), sk: g('sk'), sp: g('standard pembelajaran') };
  }
  async function progressPick(s, stop, progObj, dry) {
    const key = s.kelas + '|' + subjName(s);
    const st = Object.assign({ tema: '', sk: '', used: [], lastSk: '' }, (progObj || S.prog)[key] || {});
    const hasTema = await waitFor(() => !!field('tema'), 2000);
    note(hasTema ? '·' : '–', 'tema', hasTema ? 'medan dijumpai' : 'tiada medan Tema');
    let tema = st.tema, temaList = null, skList = null;
    if (hasTema) {
      if (!tema) { temaList = await readOptions('tema'); tema = temaList[0]; }
      if (!tema) stop('Senarai Tema kosong');
      if (!await dropdown('tema', tema)) stop('Tema tak berjaya dipilih');
      await sleep(1500);
    }
    let sk = st.sk;
    if (!sk) { skList = await readOptions('sk'); sk = skList[0]; }
    if (!sk) stop('Senarai SK kosong');
    if (!await dropdown('sk', sk)) stop('SK tak berjaya dipilih');
    const hasSP = await waitFor(() => !!field('standard pembelajaran'), 4000);
    if (!hasSP) {
      note('–', 'standard pembelajaran', 'tiada medan SP');
      skList = await readOptions('sk');
      if (!skList.length) stop('Senarai SK kosong');
      const i = st.lastSk ? skList.findIndex(x => norm(x) === norm(st.lastSk)) : -1;
      sk = skList[Math.min(i + 1, skList.length - 1)];
      if (!await dropdown('sk', sk)) stop('SK tak berjaya dipilih');
      return { tema, sk, sp: '' };
    }
    await sleep(1000);
    let spList = await readOptions('standard pembelajaran');
    let remaining = spList.filter(x => !inList(st.used, x));
    for (let guard = 0; !remaining.length && guard < 4; guard++) {
      skList = skList || await readOptions('sk');
      const i = skList.findIndex(x => norm(x) === norm(sk));
      if (i >= 0 && i < skList.length - 1) {
        sk = skList[i + 1];
      } else if (hasTema) {
        temaList = temaList || await readOptions('tema');
        const j = temaList.findIndex(x => norm(x) === norm(tema));
        if (j < 0 || j >= temaList.length - 1) stop('Semua Tema/SK/SP dah habis diajar');
        tema = temaList[j + 1];
        if (!await dropdown('tema', tema)) stop('Tema tak berjaya dipilih');
        await sleep(1500);
        skList = await readOptions('sk'); sk = skList[0];
        if (!sk) stop('Senarai SK kosong');
      } else stop('Semua SK/SP dah habis diajar');
      if (!await dropdown('sk', sk)) stop('SK tak berjaya dipilih');
      await sleep(1500);
      spList = await readOptions('standard pembelajaran');
      remaining = spList.filter(x => !inList(st.used, x));
    }
    if (!remaining.length) stop('SP tak jumpa');
    const sps = remaining.slice(0, 3);
    if (!dry) for (const sp of sps) {
      if (!await dropdown('standard pembelajaran', sp)) stop('SP "' + sp.slice(0, 20) + '" tak berjaya dipilih');
      await sleep(500);
    }
    return { tema, sk, sp: sps.join('; ') };
  }
  async function prepareAll() {
    if (!licState().ok) { render(); return; }
    const s = selSess();
    if (!s) return toast('Pilih kelas dulu');
    busy(true); LOG = []; DIAG = []; let plan = null;
    try {
      const stop = why => { throw new Error('STOP:' + why); };
      if (S.minggu) await dropdown('minggu', S.minggu);
      if (!await dropdown('subjek', subjName(s))) stop('Subjek tak berjaya dipilih');
      await sleep(1200);
      await fillDate('tarikh', sessDate(s));
      if (!await dropdown('tahun', String(s.ting), 'num')) stop('Tingkatan tak berjaya dipilih');
      await sleep(1200);
      await dropdown('nama kelas', s.kelas);
      await dropdown('masa mula', s.mula, 'time');
      await dropdown('masa tamat', s.tamat, 'time');
      await sleep(1500);
      plan = await progressPick(s, stop);
    } catch (e) {
      if (String(e.message).startsWith('STOP:')) LOG.push('⛔ Berhenti: ' + e.message.slice(5));
      else LOG.push('✗ Ralat: ' + e.message);
    }
    busy(false);
    ding(!!plan);
    if (plan) {
      plan.id = s.id; ui.plan = plan; ui.copied = null;
      LOG.push('\n➡️ Seterusnya: Langkah 2 — Salin Prompt');
    }
    ui.log = LOG.join('\n');
    render();
  }
  async function fillTexts(ai, sess) {
    let obj = String(ai.objektif || '');
    const fo = field('objektif');
    const pre = fo && fo.ctl && fo.kind === 'text' ? String(fo.ctl.value || '').trim() : '';
    if (pre && /:\s*$/.test(pre)) {
      obj = obj.replace(/^\s*pada akhir[^:]*:\s*/i, '');
      obj = pre + '\n' + obj;
    }
    await fillText('objektif', obj);
    let peng = Array.isArray(ai.pengembangan) ? ai.pengembangan.slice() : String(ai.pengembangan || '').split(/\n+/).filter(Boolean);
    let refl = String(ai.refleksi || '').trim();
    const isRefl = x => /^\s*(\d+[.)]\s*)?refleksi\b/i.test(String(x));
    const reflItems = peng.filter(isRefl);
    peng = peng.filter(x => !isRefl(x));
    if (!refl && reflItems.length) refl = reflItems.map(x => String(x).replace(/^\s*(\d+[.)]\s*)?refleksi\s*[:\-–]?\s*/i, '')).join(' ');
    if (!refl) refl = '80% murid dapat mencapai objektif pembelajaran. Murid yang belum menguasai akan diberi bimbingan dan latihan pengukuhan pada sesi akan datang.';
    await fillText('pengembangan', fmtPeng(peng));
    refl = buildRefleksi(sess || selSess() || {}, refl);
    await fillText('refleksi', refl);
  }
  function filledOK() { return LOG.some(l => l.startsWith('✓ objektif')) && !LOG.some(l => l.startsWith('✗')); }
  function recordDone(s) {
    S.done[doneKey(s)] = true;
    const pf = planFromForm(), key = s.kelas + '|' + subjName(s);
    const st = Object.assign({ tema: '', sk: '', used: [], lastSk: '' }, S.prog[key] || {});
    const okRec = !!pf.sp || !field('standard pembelajaran');
    if (okRec && pf.tema) st.tema = pf.tema;
    if (okRec && pf.sk) { st.sk = pf.sk; st.lastSk = pf.sk; }
    if (pf.sp) pf.sp.split(/\s*,\s*(?=\d)/).forEach(x => { if (x && !inList(st.used, x)) st.used.push(x); });
    S.prog[key] = st; ui.plan = null; ui.copied = null;
    LOG.push('📚 Kemajuan disimpan: ' + (pf.sp || pf.sk || '-'));
    save();
    LOG.push('\n✅ Ditanda siap. Semak & tekan Save AppSheet.');
    ui.json = '';
    const n = nextPending();
    if (n) { ui.sel = n.id; ui.note = ''; }
  }
  function stopMsg(e, extra) {
    if (String(e.message).startsWith('STOP:')) LOG.push('⛔ Berhenti: ' + e.message.slice(5) + (extra || ''));
    else LOG.push('✗ Ralat: ' + e.message);
  }
  async function fillAll() {
    if (!licState().ok) { render(); return; }
    const s = selSess();
    if (!s) return toast('Pilih kelas dulu');
    const ai = parseAI(ui.json);
    if (!ai) return toast(ui.json.trim() ? 'Jawapan AI bukan JSON yang sah' : 'Tampal jawapan AI dulu');
    const fs = field('subjek');
    if (fs && fs.ctl && !curText(fs.ctl)) return toast('Buat langkah 1 dulu');
    busy(true); LOG = []; DIAG = [];
    try { await fillTexts(ai, s); } catch (e) { stopMsg(e); }
    busy(false);
    if (filledOK()) { recordDone(s); ding(true); } else ding(false);
    ui.log = LOG.join('\n');
    render();
  }

  /* ===================== SENARAI MURID ===================== */
  const stuKey = x => 'T' + x.ting + ' ' + String(x.kelas || '').toUpperCase();
  function parseStudents(txt) {
    const out = [], seen = new Set();
    String(txt || '').split(/\r?\n/).forEach(line => {
      const cells = line.split(/\t|;|\|/).map(c => c.trim()).filter(Boolean);
      let best = '';
      cells.forEach(c => {
        const t = c.replace(/^\d+[.)\s-]*/, '').trim();
        const letters = (t.match(/[A-Za-z]/g) || []).length;
        if (letters >= 3 && letters > (best.match(/[A-Za-z]/g) || []).length && !/^\d+$/.test(t)) best = t;
      });
      if (!best || /^(bil|nama|name|no\.?|kelas|jantina)\b/i.test(best)) return;
      const k = best.toUpperCase().replace(/\s+/g, ' ');
      if (!seen.has(k)) { seen.add(k); out.push(best.replace(/\s+/g, ' ')); }
    });
    return out;
  }
  function shortName(n) {
    const base = String(n).split(/\s+(?:BIN|BINTI|BT|B\.|A\/L|A\/P)\s+/i)[0].trim();
    return base.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  function pickN(arr, n) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  }
  const joinNames = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' dan ' + arr[arr.length - 1];
  function buildRefleksi(s, aiRefl) {
    const list = (S.students || {})[stuKey(s)] || [];
    const sentences = String(aiRefl || '').split(/(?<=[.!?])\s+/).filter(x => x && !/\d{1,3}\s*%/.test(x) && !/\d+\s*\/\s*\d+/.test(x));
    const followUp = sentences.join(' ') || 'Murid yang belum menguasai akan diberi bimbingan dan latihan pengukuhan pada sesi akan datang.';
    if (!list.length) {
      const pct = 50 + Math.floor(Math.random() * 41);
      return pct + '% murid dapat mencapai objektif pembelajaran. ' + followUp;
    }
    const N = list.length;
    const got = Math.max(1, Math.round(N * (0.5 + Math.random() * 0.4)));
    const weakN = N - got;
    const shuffled = pickN(list, N);
    const weak = shuffled.slice(0, Math.min(3, weakN)).map(shortName);
    const good = shuffled.slice(weakN, weakN + Math.min(2, got)).map(shortName);
    let r = `${got}/${N} murid menguasai objektif pembelajaran.`;
    if (good.length) r += ` Murid yang menunjukkan penguasaan cemerlang: ${joinNames(good)}.`;
    if (weakN > 0) r += ` ${weakN} murid belum menguasai${weak.length ? (weak.length === weakN ? ', iaitu ' : ', antaranya ') + joinNames(weak) : ''}. ${followUp}`;
    else r += ' Semua murid menguasai objektif pembelajaran.';
    return r;
  }

  /* ===================== MOD MINGGU ===================== */
  function setBusyText(t) { busyEl.textContent = (ui.autoTxt && /Sedang isi|Menyimpan|Membuka/.test(t)) ? ui.autoTxt : t; }
  busyEl.style.cursor = 'pointer';
  busyEl.addEventListener('click', () => { if (ui.autoTxt) { ui.abort = true; busyEl.textContent = '⏹ Akan berhenti selepas kelas ini…'; } });
  let AC = null;
  function primeAudio() {
    try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {}
  }
  function ding(ok, force) {
    if (S.sound === false) return;
    if (ui.quiet && !force) return;
    try { navigator.vibrate && navigator.vibrate(ok ? [400, 150, 400, 150, 600] : [900]); } catch (e) {}
    try {
      primeAudio(); if (!AC) return;
      const notes = ok ? [880, 1175, 1568, 1175, 1568] : [330, 262];
      const t0 = AC.currentTime + 0.05;
      notes.forEach((f, i) => {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'square'; o.frequency.value = f;
        const st = t0 + i * 0.22;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.9, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.2);
        o.connect(g); g.connect(AC.destination); o.start(st); o.stop(st + 0.21);
      });
    } catch (e) {}
  }
  const weekValid = () => S.week && S.week.wk === wkKey() && S.week.items;
  async function planWeek() {
    if (!licState().ok) { render(); return; }
    const list = sorted().filter(x => !S.done[doneKey(x)]);
    if (!list.length) return toast('Semua kelas minggu ni dah siap');
    if (!field('subjek')) return toast('Buka borang ERPH GURU baru (tambah rekod) dulu');
    const prog = JSON.parse(JSON.stringify(S.prog || {}));
    const items = {}, codes = {};
    busy(true); LOG = []; DIAG = [];
    const stop = why => { throw new Error('STOP:' + why); };
    for (let i = 0; i < list.length; i++) {
      const x = list[i];
      setBusyText(`⏳ Merancang ${i + 1}/${list.length}: ${x.hari} ${x.kelas}… jangan sentuh skrin`);
      LOG.push(`— ${x.hari} ${x.mula} T${x.ting} ${x.kelas} · ${subjName(x)}`);
      try {
        if (!await dropdown('subjek', subjName(x))) stop('Subjek tak berjaya dipilih');
        await sleep(1200);
        if (!await dropdown('tahun', String(x.ting), 'num')) stop('Tingkatan tak berjaya dipilih');
        await sleep(1500);
        const plan = await progressPick(x, stop, prog, true);
        items[x.id] = plan;
        const key = x.kelas + '|' + subjName(x);
        const st = Object.assign({ tema: '', sk: '', used: [], lastSk: '' }, prog[key] || {});
        if (plan.tema) st.tema = plan.tema;
        if (plan.sk) { st.sk = plan.sk; st.lastSk = plan.sk; }
        String(plan.sp || '').split(/;\s*/).filter(Boolean).forEach(sp => { if (!inList(st.used, sp)) st.used.push(sp); });
        prog[key] = st;
        LOG.push('  📌 ' + (plan.sp || plan.sk));
      } catch (e) {
        items[x.id] = { err: String(e.message).replace(/^STOP:/, '') };
        stopMsg(e);
      }
    }
    let n = 0;
    list.forEach(x => { if (items[x.id] && !items[x.id].err) codes['K' + (++n)] = x.id; });
    S.week = { wk: wkKey(), items, codes, ai: {} };
    save();
    setBusyText('⏳ Membatalkan borang draf…');
    const cancelled = await cancelDraft();
    setBusyText('⏳ Sedang isi borang… jangan sentuh skrin');
    busy(false);
    ding(n > 0);
    LOG.push(`\n✓ ${n}/${list.length} kelas dirancang.` + (cancelled ? ' Borang draf dibatalkan sendiri.' : ' Tekan Cancel pada borang draf ini — JANGAN Save.') + ' Seterusnya: Langkah 2.');
    ui.log = LOG.join('\n');
    render();
  }
  async function cancelDraft() {
    try {
      if (!formOpen()) return true;
      const cb = findBtn(/^(cancel|batal)$/);
      if (!cb) return false;
      await tapSmart(cb, () => !formOpen() || !!findBtn(/^(discard|buang|yes|ya|ok|discard changes)$/));
      await sleep(600);
      if (formOpen()) {
        const d = findBtn(/^(discard|buang|yes|ya|ok|discard changes)$/);
        if (d) await tapSmart(d, () => !formOpen());
      }
      return await waitFor(() => !formOpen(), 4000);
    } catch (e) { return false; }
  }
  function buildWeekPrompt() {
    const lang = S.bahasa === 'BI' ? 'Bahasa Inggeris' : 'Bahasa Melayu';
    const lines = Object.keys(S.week.codes).map(code => {
      const x = S.schedule.find(q => q.id === S.week.codes[code]);
      if (!x) return '';
      const it = S.week.items[x.id], dur = mins(x.tamat) - mins(x.mula);
      return `${code}: ${subjName(x)} | Tingkatan ${x.ting} ${x.kelas} | ${x.hari} ${dmy(sessDate(x))} | ${x.mula}-${x.tamat} (${dur} minit)` +
        (it.tema ? `\n   Tema: ${it.tema}` : '') + `\n   Standard Kandungan: ${it.sk || '-'}` + (it.sp ? `\n   Standard Pembelajaran: ${it.sp}` : '');
    }).filter(Boolean).join('\n\n');
    return `Anda guru sekolah menengah di Malaysia (KSSM). Tulis RPH harian yang ringkas dan realistik untuk SEMUA kelas di bawah.

${lines}

Bahasa penulisan: ${lang}

Syarat untuk setiap kelas:
1. "objektif": satu objektif yang boleh diukur untuk setiap Standard Pembelajaran (maksimum 3), format "1. ... 2. ... 3. ...". JANGAN tulis ayat pembuka "Pada akhir PdP..." (borang dah ada). Objektif MESTI sejajar dengan Standard Pembelajaran.
2. "pengembangan": TEPAT 4 langkah (set induksi, 2 aktiviti utama, penutup), 1-2 ayat setiap satu, sesuai dengan tempoh kelas. Untuk Pendidikan Jasmani: aktiviti amali di padang/gelanggang termasuk memanaskan dan menyejukkan badan. Jangan letak nombor di depan. JANGAN masukkan refleksi di sini.
3. "refleksi": 2 ayat lengkap, tiada tempat kosong. Guna "80%" sebagai peratus murid mencapai objektif dan nyatakan tindakan susulan.
4. Jangan ulang aktiviti yang sama untuk kelas berbeza.

Balas HANYA dengan satu JSON object, tanpa teks lain dan tanpa markdown. Kunci ialah kod kelas (K1, K2, ...):
{"K1":{"objektif":"1. ...","pengembangan":["...","...","...","..."],"refleksi":"..."},"K2":{...}}`;
  }
  function parseWeekAI(txt) {
    let t = String(txt || '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    let o; try { o = looseJSON(t.slice(a, b + 1)); } catch (e) { ui.wjsonErr = 'JSON tak sah: ' + e.message; return null; }
    const out = {};
    Object.keys(S.week.codes || {}).forEach(code => {
      const v = o[code] || o[code.toLowerCase()];
      if (v && (v.objektif || v.pengembangan)) out[S.week.codes[code]] = v;
    });
    return Object.keys(out).length ? out : null;
  }
  function findBtn(re) {
    const c = [...document.querySelectorAll('body *')].filter(el => el !== host && !host.contains(el) && re.test(norm(ownText(el))) && visible(el));
    if (!c.length) return null;
    const el = c[c.length - 1];
    return el.closest('[role=button],button,a,.ASTappable') || el;
  }
  const formOpen = () => !!field('subjek');
  const formHasData = () => { const f = field('subjek'); return !!(f && f.ctl && curText(f.ctl)); };
  function visibleButtons() {
    return [...document.querySelectorAll('[role=button],button,a,.ASTappable')].filter(el => !host.contains(el) && visible(el))
      .map(el => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 40).join(' | ');
  }
  async function saveAndOpenNew(openNew) {
    if (openNew === undefined) openNew = true;
    const stop = why => { throw new Error('STOP:' + why); };
    if (formOpen() && formHasData()) {
      if (!ui.lastFilledId) {
        setBusyText('⏳ Menutup borang draf (tanpa Save)…');
        if (!await cancelDraft()) stop('Ada borang terbuka yang bukan diisi oleh skrip. Tekan Cancel pada borang itu dulu');
        note('✓', 'draf', 'ditutup tanpa Save');
        await sleep(1000);
      }
    }
    if (formOpen() && formHasData()) {
      setBusyText('⏳ Menyimpan borang…');
      const sv = findBtn(/^(save|simpan)$/);
      if (!sv) { keep('save', 'butang Save tak jumpa', visibleButtons()); stop('Butang Save tak jumpa'); }
      const ok = await tapSmart(sv, () => !formOpen());
      if (!ok || !await waitFor(() => !formOpen(), 8000)) {
        keep('save', 'borang tak tertutup lepas Save', visibleButtons());
        stop('Save tak berjaya — mungkin ada medan wajib belum diisi. Semak borang.');
      }
      note('✓', 'save', 'borang sebelum ini disimpan');
      ui.lastFilledId = null;
      await sleep(1500);
    }
    if (openNew && !formOpen()) {
      setBusyText('⏳ Membuka borang baru…');
      let cb = null;
      for (let i = 0; i < 20 && !cb; i++) { cb = findBtn(/catat\s*e?rph/); if (!cb) await sleep(500); }
      if (!cb) { keep('catat', 'butang Catat eRPH tak jumpa', visibleButtons()); stop('Butang "Catat eRPH Anda" tak jumpa'); }
      const ok = await tapSmart(cb, () => formOpen());
      if (!ok || !await waitFor(() => formOpen(), 10000)) { keep('catat', 'borang baru tak terbuka', visibleButtons()); stop('Borang baru tak terbuka'); }
      note('✓', 'borang baru', 'dibuka');
      await sleep(1500);
    }
  }
  async function autoNext() {
    if (!licState().ok) { render(); return; }
    const s = selSess();
    if (!s || !weekValid() || !S.week.items[s.id] || !(S.week.ai || {})[s.id]) return toast('Kelas ini belum ada rancangan/jawapan AI');
    if (S.done[doneKey(s)]) return toast('Kelas ini dah siap — pilih kelas lain dalam senarai');
    busy(true); LOG = []; DIAG = [];
    let ok = true;
    try { await saveAndOpenNew(); } catch (e) { ok = false; stopMsg(e); }
    busy(false);
    if (!ok) { ding(false); ui.log = LOG.join('\n'); render(); return; }
    const pre = LOG.slice();
    await fillWeekClass(pre);
  }
  const nextAuto = () => sorted().find(x => !S.done[doneKey(x)] && S.week && S.week.items[x.id] && !S.week.items[x.id].err && (S.week.ai || {})[x.id]);
  async function autoAll() {
    if (!licState().ok) { render(); return; }
    if (!weekValid() || !Object.keys(S.week.ai || {}).length) return toast('Simpan jawapan AI minggu dulu');
    ui.abort = false; ui.quiet = true;
    const summary = [];
    let fail = null, n = 0;
    const total = sorted().filter(x => !S.done[doneKey(x)] && S.week.items[x.id] && !S.week.items[x.id].err && (S.week.ai || {})[x.id]).length;
    while (!ui.abort) {
      const s = nextAuto();
      if (!s) break;
      ui.sel = s.id;
      ui.autoTxt = `⚡ Kelas ${n + 1}/${total}: ${s.hari} ${s.kelas} — tekan di sini untuk berhenti`;
      await autoNext();
      if (!S.done[doneKey(s)]) { fail = { s, log: LOG.slice() }; break; }
      n++;
      summary.push(`✅ ${s.hari} ${s.mula} T${s.ting} ${s.kelas} · ${subjName(s)}`);
    }
    ui.autoTxt = '';
    if (!fail && !ui.abort && ui.lastFilledId) {
      busy(true); setBusyText('⏳ Menyimpan borang terakhir…'); LOG = [];
      try { await saveAndOpenNew(false); summary.push('💾 Borang terakhir disimpan'); }
      catch (e) { stopMsg(e); fail = { log: LOG.slice() }; }
      setBusyText('⏳ Sedang isi borang… jangan sentuh skrin');
      busy(false);
    }
    ui.quiet = false;
    let out = summary.join('\n');
    if (fail) out += '\n\n⛔ Berhenti' + (fail.s ? ` pada ${fail.s.hari} ${fail.s.kelas}` : '') + ':\n' + fail.log.filter(l => /⛔|✗/.test(l)).join('\n') + '\nBetulkan borang, kemudian tekan ⚡ semula untuk sambung.';
    else if (ui.abort) out += '\n\n⏹ Dihentikan. Tekan ⚡ semula untuk sambung.';
    else out += `\n\n🎉 Siap! ${n} kelas diisi & disimpan.`;
    ui.abort = false;
    ui.log = out;
    ding(!fail && !ui.abort, true);
    if (!fail) setTimeout(() => ding(true, true), 1400);
    render();
  }
  async function saveOnly() {
    busy(true); LOG = []; DIAG = [];
    let ok = true;
    try { await saveAndOpenNew(false); } catch (e) { ok = false; stopMsg(e); }
    busy(false); ding(ok);
    if (ok) LOG.push('\n🎉 Borang terakhir disimpan. Semua kelas minggu ni siap!');
    ui.log = LOG.join('\n'); render();
  }
  async function fillWeekClass(preLog) {
    if (!licState().ok) { render(); return; }
    const s = selSess();
    if (!s || !weekValid()) return toast('Rancang minggu dulu');
    const it = S.week.items[s.id], ai = (S.week.ai || {})[s.id];
    if (!it || it.err) return toast('Kelas ini tiada dalam rancangan — guna Mod Satu Kelas');
    if (!ai) return toast('Tampal jawapan AI minggu dulu');
    if (!field('subjek')) return toast('Buka borang ERPH GURU baru dulu');
    busy(true); LOG = (preLog || []).slice(); if (!preLog) DIAG = [];
    setBusyText('⏳ Sedang isi borang… jangan sentuh skrin');
    try {
      const stop = why => { throw new Error('STOP:' + why); };
      if (S.minggu) await dropdown('minggu', S.minggu);
      if (!await dropdown('subjek', subjName(s))) stop('Subjek tak berjaya dipilih');
      await sleep(1200);
      await fillDate('tarikh', sessDate(s));
      if (!await dropdown('tahun', String(s.ting), 'num')) stop('Tingkatan tak berjaya dipilih');
      await sleep(1200);
      await dropdown('nama kelas', s.kelas);
      await dropdown('masa mula', s.mula, 'time');
      await dropdown('masa tamat', s.tamat, 'time');
      await sleep(1200);
      if (it.tema && await waitFor(() => !!field('tema'), 2000)) {
        if (!await dropdown('tema', it.tema)) stop('Tema tak berjaya dipilih');
        await sleep(1500);
      }
      if (it.sk) {
        if (!await dropdown('sk', it.sk)) stop('SK tak berjaya dipilih');
        await sleep(1000);
      }
      const sps = String(it.sp || '').split(/;\s*/).filter(Boolean);
      if (sps.length) {
        if (!await waitFor(() => !!field('standard pembelajaran'), 4000)) stop('Medan SP tak muncul');
        for (const sp of sps) {
          if (!await dropdown('standard pembelajaran', sp)) stop('SP "' + sp.slice(0, 20) + '" tak berjaya dipilih');
          await sleep(500);
        }
      }
      await fillTexts(ai, s);
    } catch (e) { stopMsg(e, '. Medan lain tak diisi supaya tak salah.'); }
    busy(false);
    if (filledOK()) { recordDone(s); ui.lastFilledId = s.id; ding(true); } else ding(false);
    ui.log = LOG.join('\n');
    render();
  }

  async function loadSK() {
    const s = selSess();
    if (!s) return;
    busy(true); LOG = []; DIAG = []; let list = null;
    try {
      if (!await dropdown('subjek', subjName(s))) throw new Error('STOP:Subjek tak berjaya dipilih');
      await sleep(1200);
      if (!await dropdown('tahun', String(s.ting), 'num')) throw new Error('STOP:Tingkatan tak berjaya dipilih');
      await sleep(2500);
      const fsk = field('sk');
      const rg = fsk ? { nodes: [fsk.ctl].filter(Boolean) } : region('sk');
      if (!rg || !rg.nodes.length) {
        LOG.push('✗ SK: medan SK tak jumpa.');
        const names = [...document.querySelectorAll('.FormEntry .FieldName')].map(x => JSON.stringify(x.textContent.trim()));
        keep('sk', 'medan tak jumpa. FieldName yang ada: ' + names.join(', '),
          fsk ? fsk.entry.outerHTML.slice(0, 8000) : (document.querySelector('.EntryForm, .TableEntryScreen') || document.body).innerHTML.slice(-8000));
      }
      else {
        const tg = fsk && fsk.ctl ? { el: fsk.ctl } : clickTarget(rg.nodes);
        if (tg.select) list = [...tg.select.options].map(o => o.text.trim()).filter(Boolean);
        else if (tg.el) {
          const opened = await tapSmart(tg.el, () => !!getDialog());
          const dlg = opened ? await waitDialog() : null;
          if (!dlg) { LOG.push('✗ SK: dropdown tak terbuka'); keep('sk', 'dropdown tak terbuka\n' + reactInfo(tg.el), (fsk ? fsk.entry.outerHTML : tg.el.outerHTML).slice(0, 4000)); }
          else { list = await collectAll(dlg); await closeDialog(); }
        }
      }
      if (list) list = list.filter(t => t.trim().length >= 4);
      if (list && list.length) {
        S.skLists[skKey(s)] = list; save();
        ui.sk = suggestSK(s);
        LOG.push(`✓ ${list.length} SK disimpan untuk ${skKey(s)}`);
      } else if (list) LOG.push('✗ SK: senarai kosong (pastikan Subjek & Tingkatan dah dipilih)');
    } catch (e) {
      if (String(e.message).startsWith('STOP:')) LOG.push('⛔ Berhenti: ' + e.message.slice(5));
      else LOG.push('✗ Ralat: ' + e.message);
    }
    busy(false);
    ui.log = LOG.join('\n');
    render();
  }

  function diag(label) {
    const rg = region(label);
    if (!rg) return 'Label tak jumpa: ' + label + '\nLabel dijumpai: ' + Object.keys(scanLabels()).join(', ');
    let c = rg.lab;
    for (let i = 0; i < 3 && c.parentElement; i++) c = c.parentElement;
    return 'LABEL: ' + label + '\n' + c.outerHTML.slice(0, 9000);
  }

  fab.addEventListener('click', () => { sheet._wasOpen = true; sheet.classList.add('open'); render(); });
  sheet.addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (f === 'note') ui.note = e.target.value;
    else if (f === 'json') {
      const was = !!parseAI(ui.json);
      ui.json = e.target.value;
      if (!was && parseAI(ui.json)) { ui.stepOv = null; render(); toast('Jawapan AI sah ✓'); }
    }
    else if (f === 'minggu') { S.minggu = e.target.value.trim(); save(); }
    else if (f === 'tjson') ui.tjson = e.target.value;
    else if (f === 'stutxt') ui.stuTxt = e.target.value;
    else if (f === 'lickey') ui.lickey = e.target.value;
    else if (f === 'wjson') { ui.wjson = e.target.value; ui.wjsonErr = ''; tryWeekAI(); }
  });
  sheet.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.d) {
      ui.draft = ui.draft || {};
      ui.draft[t.dataset.d] = t.value;
      if (t.dataset.d === 'mula') {
        const ms = optList('masa'), i = ms.indexOf(t.value);
        if (i >= 0 && ms[i + 1]) ui.draft.tamat = ms[i + 1];
        render();
      }
    } else if (t.dataset.f === 'ai') { S.ai = t.value; save(); render(); }
  });
  async function harvestOpts() {
    busy(true); LOG = []; DIAG = [];
    const o = Object.assign({}, S.opts || {});
    try {
      const subj = await readOptions('subjek'); if (subj.length) o.subjek = subj;
      const kel = await readOptions('nama kelas'); if (kel.length) o.kelas = kel;
      const ms = await readOptions('masa mula'); if (ms.length) o.masa = ms;
    } catch (e) {}
    S.opts = o; save(); busy(false);
    toast('Senarai dikemas kini: ' + ['subjek', 'kelas', 'masa'].map(k => (o[k] || []).length + ' ' + k).join(', '));
    render();
  }
  function tryWeekAI() {
    if (!weekValid()) return;
    const r = parseWeekAI(ui.wjson);
    if (!r) return false;
    S.week.ai = r; save(); ui.wjsonErr = '';
    const n = Object.keys(r).length, total = Object.keys(S.week.codes).length;
    ui.wjson = ''; ui.sel = (nextPending() || {}).id || null;
    ui.log = `✓ Jawapan AI disimpan untuk ${n}/${total} kelas.` + (n < total ? ' Kelas yang tertinggal boleh guna Mod Satu Kelas.' : '');
    toast('Jawapan AI disimpan ✓'); render();
    return true;
  }
  function openTab(url) {
    try { if (typeof GM_openInTab === 'function') { GM_openInTab(url, { active: true }); return; } } catch (e) {}
    try { window.open(url, '_blank'); } catch (e) {}
  }
  function promptText(s) {
    const pf = planFromForm();
    const plan = (pf.sk || pf.sp) ? pf : (ui.plan && ui.plan.id === s.id ? ui.plan : pf);
    return buildPrompt(s, plan, ui.note);
  }
  sheet.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a, s = selSess();
    if (['wfill', 'wnext', 'planweek', 'fill', 'prep', 'autoall'].includes(a)) primeAudio();
    if (a === 'close') { sheet._wasOpen = false; sheet.classList.remove('open'); }
    else if (a === 'wk-' || a === 'wk+') {
      S.weekOffset += a === 'wk+' ? 1 : -1; save();
      const n = nextPending(); ui.sel = n ? n.id : null; ui.stepOv = null;
      render();
    }
    else if (a === 'toggle') {
      e.stopPropagation();
      const x = S.schedule.find(q => q.id === b.dataset.id), k = doneKey(x);
      if (S.done[k]) delete S.done[k]; else S.done[k] = true;
      save(); render();
    }
    else if (a === 'pick') { ui.sel = b.dataset.id; ui.json = ''; ui.log = ''; ui.stepOv = null; ui.view = 'main'; render(); }
    else if (a === 'view-main' || a === 'view-list' || a === 'view-setup') { ui.view = a.slice(5); render(); }
    else if (a === 'goto') { const n = +b.dataset.n; if (s && n >= 1 && n <= 4) { ui.stepOv = { id: s.id, n }; render(); } }
    else if (a === 'addcls') {
      const g = k => { const el = R.querySelector('[data-d="' + k + '"]'); return el ? el.value : ''; };
      const hari = g('hari'), mula = g('mula'), tamat = g('tamat');
      if (mins(tamat) <= mins(mula)) return toast('Masa tamat mesti selepas masa mula');
      S.schedule.push({ id: 'c' + Date.now().toString(36), day: HARI.indexOf(hari) + 1, hari, kelas: g('kelas'), ting: +g('ting'), subj: g('subj'), mula, tamat });
      save(); ui.draft = { hari, ting: g('ting') };
      if (!ui.sel) { const n0 = nextPending(); if (n0) ui.sel = n0.id; }
      toast('Kelas ditambah ✓'); render();
    }
    else if (a === 'delcls') { S.schedule = S.schedule.filter(x => x.id !== b.dataset.id); if (ui.sel === b.dataset.id) ui.sel = (nextPending() || {}).id || null; save(); render(); }
    else if (a === 'harvest') harvestOpts();
    else if (a === 'telegram') openTab(TG);
    else if (a === 'mode-week' || a === 'mode-single') { S.mode = a === 'mode-week' ? 'week' : 'single'; save(); ui.log = ''; render(); }
    else if (a === 'planweek') planWeek();
    else if (a === 'replan') { if (confirm('Rancang semula? Jawapan AI minggu ini akan dibuang.')) { S.week = null; save(); ui.log = ''; render(); } }
    else if (a === 'wprompt') {
      if (!weekValid()) return;
      const url = (AIS[S.ai] || AIS.chatgpt)[1];
      if (url) openTab(url);
      toast(await copy(buildWeekPrompt()) ? 'Prompt minggu disalin ✓ — paste dalam AI' : 'Gagal salin');
    }
    else if (a === 'wpaste') {
      try { ui.wjson = await navigator.clipboard.readText(); if (!tryWeekAI()) { render(); toast('Teks ditampal, tapi bukan JSON minggu yang sah'); } }
      catch (err) { toast('Tak boleh baca clipboard — tekan lama kotak & Paste'); }
    }
    else if (a === 'wfill') fillWeekClass();
    else if (a === 'wnext') autoNext();
    else if (a === 'autoall') { primeAudio(); autoAll(); }
    else if (a === 'wsaveonly') { primeAudio(); saveOnly(); }
    else if (a === 'sound') { S.sound = S.sound === false; save(); if (S.sound !== false) { primeAudio(); ding(true); } render(); }
    else if (a === 'wsave') {
      const t = R.querySelector('[data-f=wjson]'); if (t) ui.wjson = t.value;
      ui.wjsonErr = '';
      if (!tryWeekAI()) { if (!ui.wjsonErr) ui.wjsonErr = 'Kod kelas K1, K2… tak dijumpai dalam jawapan'; render(); }
    }
    else if (a === 'view-students') { ui.view = 'students'; ui.stuSel = ui.stuSel || ''; render(); }
    else if (a === 'stu-pick') { ui.stuSel = b.dataset.k; ui.stuTxt = ''; render(); }
    else if (a === 'stu-save') {
      const t = R.querySelector('[data-f=stutxt]'); const list = parseStudents(t ? t.value : '');
      if (!list.length) return toast('Tiada nama dijumpai');
      S.students = S.students || {}; S.students[ui.stuSel] = list; save(); ui.stuTxt = '';
      toast(list.length + ' murid disimpan untuk ' + ui.stuSel); render();
    }
    else if (a === 'stu-del') { if (S.students) delete S.students[ui.stuSel]; save(); render(); }
    else if (a === 'copyname') toast(await copy(teacherName()) ? 'Nama disalin ✓ — hantar kepada penjual' : 'Gagal salin');
    else if (a === 'activate') {
      const cur = teacherName(), k = normKey(ui.lickey);
      if (!cur) return toast('Buka borang ERPH GURU dulu');
      if (k.length !== 8 || k !== keyFor(cur)) return toast('Kod lesen tak sah untuk ' + cur);
      S.lic = { name: normName(cur), key: fmtKey(k) }; save(); ui.lickey = '';
      toast('Diaktifkan ✓ Terima kasih!'); render();
    }
    else if (a === 'tprompt') {
      const url = (AIS[S.ai] || AIS.chatgpt)[1];
      if (url) openTab(url);
      toast(await copy(timetablePrompt()) ? 'Prompt disalin ✓ — lampirkan gambar jadual & paste' : 'Gagal salin');
    }
    else if (a === 'tpaste') {
      try { ui.tjson = await navigator.clipboard.readText(); render(); }
      catch (err) { toast('Tak boleh baca clipboard — tekan lama kotak & Paste'); }
    }
    else if (a === 'timport') {
      const r = parseTimetable(ui.tjson);
      if (r.err) { toast(r.err); return; }
      if (!r.list.length) { toast('Tiada kelas sah dijumpai'); return; }
      if (b.dataset.mode === 'add') S.schedule = S.schedule.concat(r.list);
      else { S.schedule = r.list; S.done = {}; }
      save(); ui.tjson = ''; ui.sel = (nextPending() || {}).id || null;
      ui.log = '✓ ' + r.list.length + ' kelas diimport' + (r.warn.length ? '\n' + r.warn.join('\n') : '');
      toast(r.list.length + ' kelas diimport ✓'); render();
    }
    else if (a === 'openai') {
      if (s) {
        openTab((AIS[S.ai] || AIS.chatgpt)[1]);
        const ok = await copy(promptText(s));
        if (ok) { ui.copied = s.id; ui.stepOv = null; }
        toast(ok ? 'Prompt disalin ✓ — paste dalam AI' : 'Gagal salin');
        render();
      }
    }
    else if (a === 'pj' || a === 'pk') { S.pjkMode[s.id] = a === 'pk' ? 'PK' : 'PJ'; save(); ui.sk = suggestSK(s); render(); }
    else if (a === 'bm' || a === 'bi') { S.bahasa = a === 'bi' ? 'BI' : 'BM'; save(); render(); }
    else if (a === 'loadsk') loadSK();
    else if (a === 'prompt') {
      if (s) {
        const ok = await copy(promptText(s));
        if (ok) { ui.copied = s.id; ui.stepOv = null; }
        toast(ok ? 'Prompt disalin ✓ — paste ke AI' : 'Gagal salin');
        render();
      }
    }
    else if (a === 'prep') { ui.stepOv = null; prepareAll(); }
    else if (a === 'resetprog') { if (s) { delete S.prog[s.kelas + '|' + subjName(s)]; save(); toast('Kemajuan direset'); render(); } }
    else if (a === 'paste') {
      try { ui.json = await navigator.clipboard.readText(); if (parseAI(ui.json)) ui.stepOv = null; render(); toast(parseAI(ui.json) ? 'JSON OK ✓' : 'Teks ditampal, tapi bukan JSON sah'); }
      catch (err) { toast('Tak boleh baca clipboard — tekan lama kotak & Paste'); }
    }
    else if (a === 'fill') { ui.stepOv = null; fillAll(); }
    else if (a === 'report') {
      const txt = 'ERPH Autofill v4.3 laporan ralat\nLOG:\n' + ui.log + '\n\n' + DIAG.join('\n\n');
      if (await copy(txt)) { toast('Laporan disalin ✓ — paste dalam Telegram'); openTab(TG); } else toast('Gagal salin');
    }
    else if (a === 'savesched') {
      try {
        const v = JSON.parse(R.querySelector('[data-f=sched]').value);
        if (!Array.isArray(v)) throw 0;
        S.schedule = v; save(); toast('Jadual disimpan ✓'); render();
      } catch (err) { toast('JSON jadual tak sah'); }
    }
    else if (a === 'diag') toast(await copy(diag(R.querySelector('[data-f=diag]').value)) ? 'HTML disalin — hantar kepada pembangun' : 'Gagal salin');
    else if (a === 'diagdlg') {
      const d = getDialog();
      toast(d ? (await copy(d.outerHTML.slice(0, 12000)) ? 'HTML dropdown disalin' : 'Gagal salin') : 'Tiada dropdown terbuka');
    }
    else if (a === 'export') toast(await copy(JSON.stringify(S)) ? 'Backup disalin ✓' : 'Gagal salin');
    else if (a === 'reset') {
      if (confirm('Padam semua data (status siap, senarai SK, jadual)?')) {
        S = Object.assign(load(), { schedule: [], done: {}, skLists: {}, lastSK: {}, pjkMode: {}, minggu: '', weekOffset: 0, prog: {}, opts: {}, lic: S.lic });
        ui.sel = null; ui.view = 'setup';
        save(); render(); toast('Direset');
      }
    }
  });

  /* ===== semakan permulaan ===== */
  try {
    const VK = 'erph_seen_ver';
    const seen = typeof GM_getValue === 'function' ? GM_getValue(VK, '') : '';
    if (seen !== '4.3.0') {
      alert(seen ? 'ERPH Autofill dikemas kini ke v4.4 ✓ — edisi percuma Bijak Mulia (tiada kod lesen)' : 'ERPH Autofill dipasang ✓\nTekan butang ungu 📝 di kiri bawah skrin untuk mula.');
      if (typeof GM_setValue === 'function') GM_setValue(VK, '4.3.0');
    }
  } catch (e) {}
  setTimeout(() => {
    if (busyEl.style.display === 'block' || sheet.classList.contains('open') || fab.style.display === 'none') return;
    const r = fab.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (hit !== host) {
      const cs = getComputedStyle(document.body);
      alert('ERPH Autofill: butang 📝 terlindung.\n' +
        'hit=' + (hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) : 'null') +
        '\nfab=' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        '\nskrin=' + innerWidth + 'x' + innerHeight +
        '\nbody transform=' + cs.transform + ' contain=' + cs.contain +
        '\nconnected=' + host.isConnected +
        '\nScreenshot mesej ni & hantar kepada pembangun.');
    }
  }, 3000);
  } catch (e) {
    alert('ERPH Autofill ralat:\n' + e.message + '\n' + String(e.stack || '').slice(0, 300) + '\nScreenshot & hantar kepada pembangun.');
  }
})();
