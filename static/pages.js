/* library, corporate profile and gallery. all content comes from content.js. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = window.HZ || {};
  const ORDER = ['bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin'];
  const steps = list => list.map(([s, d], k) => `<li><span class="hf-n">${k + 1}</span><div><h3>${esc(s)}</h3><p>${esc(d)}</p></div></li>`).join('');

  /* ---------- library ---------- */
  if ($('libList')) {
    const ICON = { profile: 'profile', method: 'formula', catalogue: 'catalogue', report: 'report' };
    $('libList').innerHTML = (C.library || []).filter(it => it.view || it.download).map(it => `<article class="lib-item">
      <span class="lib-ic lib-${esc(ICON[it.kind] || 'doc')}" aria-hidden="true"></span>
      <div class="lib-t"><h2>${esc(it.title)}</h2><p>${esc(it.text)}</p></div>
      <div class="lib-a">
        ${it.view ? `<a class="btn btn-primary btn-sm" href="${esc(it.view)}">view online</a>` : '<span class="lib-soon">coming soon</span>'}
        ${it.download ? `<a class="btn btn-ghost btn-sm" href="${esc(it.download)}" download>download</a>` : ''}
      </div>
    </article>`).join('');
  }

  /* ---------- corporate profile ---------- */
  if ($('pfVentures')) {
    $('pfFormula').innerHTML = steps(C.formula || []);
    $('pfMethod').innerHTML = steps(C.method || []);
    $('pfVentures').innerHTML = ORDER.map(k => { const v = C.ventures[k]; return `<article class="pf-v theme-${k}">
      <div class="pf-v-h"><img src="/static/img/${k}.png" alt="${esc(v.name)}" height="26"><span>${esc(v.area)}</span></div>
      <p class="pf-v-val">${esc(v.value)}</p>
      <ul class="vt-offers">${v.offers.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      <a class="link small" href="/v/${k}">more about ${esc(v.name)}</a>
    </article>`; }).join('');
    $('printBtn').addEventListener('click', () => window.print());
  }

  /* ---------- gallery ---------- */
  if ($('glYears')) {
    const all = (C.gallery || []).filter(g => !g.placeholder).sort((a, b) => b.year - a.year);
    const KINDS = [['all', 'all'], ['team', 'team'], ['moments', 'moments'], ['achievements', 'achievements'], ['events', 'events']].filter(([k]) => k === 'all' || all.some(g => g.kind === k));
    let kind = 'all', shown = all;
    $('glNote').hidden = !all.some(g => g.placeholder);
    $('glChips').innerHTML = KINDS.map(([k, l]) => `<button type="button" class="gl-chip" data-k="${k}" aria-pressed="${k === kind}">${esc(l)}</button>`).join('');
    const render = () => {
      shown = all.filter(g => kind === 'all' || g.kind === kind);
      const years = [...new Set(shown.map(g => g.year))];
      $('glYears').innerHTML = years.map(y => `<section class="gl-year"><h2 class="gl-y">${y}</h2><div class="gl-grid">${
        shown.map((g, i) => [g, i]).filter(([g]) => g.year === y).map(([g, i]) => `<figure class="gl-item"><button type="button" class="gl-open" data-i="${i}" aria-label="open ${esc(g.title)}"><img src="${esc(g.src)}" alt="${esc(g.title)}" loading="lazy"></button>
          <figcaption><b>${esc(g.title)}</b><span>${esc(g.date)}</span></figcaption></figure>`).join('')}</div></section>`).join('') || '<p class="muted">no photos here yet.</p>';
    };
    render();
    $('glChips').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; kind = b.dataset.k; $('glChips').querySelectorAll('[data-k]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); render(); });
    // lightbox
    const lb = $('lb'); let cur = 0, lastFocus = null, sx = null;
    const show = i => { cur = (i + shown.length) % shown.length; const g = shown[cur]; $('lbImg').src = g.src; $('lbImg').alt = g.title; $('lbTitle').textContent = g.title; $('lbCap').textContent = g.caption || ''; $('lbDate').textContent = g.date || ''; };
    const open = i => { lastFocus = document.activeElement; show(i); lb.hidden = false; document.body.classList.add('lb-on'); $('lbClose').focus(); };
    const close = () => { lb.hidden = true; document.body.classList.remove('lb-on'); if (lastFocus) lastFocus.focus(); };
    $('glYears').addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) open(Number(b.dataset.i)); });
    $('lbClose').addEventListener('click', close);
    $('lbPrev').addEventListener('click', () => show(cur - 1));
    $('lbNext').addEventListener('click', () => show(cur + 1));
    lb.addEventListener('click', e => { if (e.target === lb) close(); });
    document.addEventListener('keydown', e => { if (lb.hidden) return; if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
    lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); sx = null; });
  }
})();
