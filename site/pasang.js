/* Halaman pasang: tab peranti, salin pautan & salin kod skrip — Bijak Mulia */
(() => {
  const yr = document.getElementById('yr'); if (yr) yr.textContent = new Date().getFullYear();
  const toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl);
  const toast = t => { toastEl.textContent = t; toastEl.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.style.display = 'none', 2600); };
  async function copy(text){
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;top:0;opacity:0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); return ok;
  }
  /* tab: pilih automatik ikut peranti */
  const tabs = [...document.querySelectorAll('.tab')];
  const show = k => { tabs.forEach(t => t.classList.toggle('on', t.dataset.tab === k)); document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + k)); try { localStorage.setItem('bm_tab', k); } catch (e) {} };
  tabs.forEach(t => t.onclick = () => show(t.dataset.tab));
  let pref = null; try { pref = localStorage.getItem('bm_tab'); } catch (e) {}
  if (tabs.length) show(pref && tabs.some(t => t.dataset.tab === pref) ? pref : (/Android|iPhone|iPad/i.test(navigator.userAgent) ? 'and' : 'pc'));
  document.querySelectorAll('[data-copy-url]').forEach(b => b.onclick = async () => { if (await copy(location.href.split('#')[0])) { toast('✅ Pautan disalin — tampal dalam Edge'); b.classList.add('done'); } else toast('Salin pautan dari bar alamat'); });
  document.querySelectorAll('[data-copy-code]').forEach(b => b.onclick = async () => {
    const lbl = b.textContent; b.textContent = '⏳ Memuat kod…';
    try { const t = await (await fetch(b.dataset.copyCode, { cache: 'no-store' })).text(); if (await copy(t)) { toast('✅ Kod disalin (' + Math.round(t.length / 1024) + ' KB) — tampal dalam Tampermonkey'); b.textContent = '✅ Kod disalin'; b.classList.add('done'); return; } } catch (e) {}
    b.textContent = lbl; toast('Gagal salin — cuba lagi');
  });
})();
