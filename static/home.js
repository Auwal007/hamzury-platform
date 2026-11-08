/* home: venture tiles open in place, returning clients sign in, whatsapp chat if configured. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // whatsapp chat link, only when a number is configured
  fetch('/api/public/config').then(r => r.json()).then(cfg => {
    if (!cfg.whatsapp) return;
    $('waHome').href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('hello hamzury, i would like to talk about my business.')}`;
    $('waLine').hidden = false;
  }).catch(() => {});

  const C = window.HZ || { ventures: {}, formula: [], who: [], proof: [] };

  // venture tiles: tap to open the team's real offers and the two doors, without leaving the page
  const SITES = { bizdoc: 'https://bizdocconsult.com', iwiin: 'https://iwiin.hamzury.com' };
  document.querySelectorAll('.vt').forEach(tile => {
    const btn = tile.querySelector('.vt-head'), panel = tile.querySelector('.vt-panel'), key = tile.dataset.v, v = C.ventures[key];
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      document.querySelectorAll('.vt').forEach(t => { if (t !== tile) { t.classList.remove('open'); t.querySelector('.vt-head').setAttribute('aria-expanded', 'false'); t.querySelector('.vt-panel').hidden = true; } });
      btn.setAttribute('aria-expanded', String(!open)); tile.classList.toggle('open', !open); panel.hidden = open;
      if (open || !v) return;
      panel.innerHTML = `<p class="vt-promise">${esc(v.value)}</p>
        <ul class="vt-offers">${v.offers.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
        <div class="vt-actions theme-${esc(key)}">
          <a class="btn btn-primary btn-block" href="/start?v=${esc(key)}">start here with ${esc(v.name)}</a>
          ${SITES[key] ? `<a class="btn btn-ghost btn-block" href="${SITES[key]}" rel="noopener">explore the ${esc(v.name)} site</a>` : `<a class="btn btn-ghost btn-block" href="/v/${esc(key)}">more about ${esc(v.name)}</a>`}
        </div>`;
      tile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  // the hm formula: why, how and who
  if ($('formulaSteps')) {
    $('formulaSteps').innerHTML = C.formula.map(([s, d], k) => `<li><span class="hf-n">${k + 1}</span><div><h3>${esc(s)}</h3><p>${esc(d)}</p></div></li>`).join('');
    $('formulaWho').innerHTML = C.who.map(([w, d]) => `<li><b>${esc(w)}</b><span>${esc(d)}</span></li>`).join('');
    if ($('formulaFirst')) $('formulaFirst').innerHTML = (C.first || []).map(([w, d]) => `<li><b>${esc(w)}</b><span>${esc(d)}</span></li>`).join('');
    if (C.founder) $('founderLink').href = C.founder.site;
  }

  // proof of work: only real, permitted work. hidden until there is some.
  if ($('proof') && C.proof && C.proof.length) {
    $('proofList').innerHTML = C.proof.map(p => `<article class="pw">
      <div class="pw-top"><b>${esc(p.client)}</b><span>${esc([p.industry, p.year].filter(Boolean).join(' · '))}</span></div>
      <dl><dt>what they needed</dt><dd>${esc(p.need)}</dd><dt>what we did</dt><dd>${esc(p.did)}</dd><dt>what changed</dt><dd>${esc(p.result)}</dd></dl>
      ${p.quote ? `<blockquote>${esc(p.quote)}</blockquote>` : ''}
      ${p.venture && C.ventures[p.venture] ? `<span class="pw-v">delivered by ${esc(C.ventures[p.venture].name)}</span>` : ''}
    </article>`).join('');
    $('proof').hidden = false;
  }

  // returning clients: tracking opens in place, from the hero line or the top link
  const tgl = $('trackToggle'), tp = $('trackPanel');
  const openTrack = focus => { if (!tgl) return; tgl.setAttribute('aria-expanded', 'true'); tp.hidden = false; if (focus) setTimeout(() => $('trackRef').focus(), 50); };
  if (tgl) tgl.addEventListener('click', () => { const o = tgl.getAttribute('aria-expanded') === 'true'; if (o) { tgl.setAttribute('aria-expanded', 'false'); tp.hidden = true; } else openTrack(true); });
  document.addEventListener('click', e => { const a = e.target.closest('a[href="#track"]'); if (a) { e.preventDefault(); openTrack(true); $('track').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
  if (location.hash === '#track') openTrack(false);
  window.addEventListener('hashchange', () => { if (location.hash === '#track') openTrack(true); });

  const form = $('trackForm');
  if (!form) return;
  const err = $('trackError'), tb = $('trackBtn');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    const ref = $('trackRef').value.trim(), phone = $('trackPhone').value.trim();
    if (ref.length < 4) { err.textContent = 'please enter your hamzury id.'; err.hidden = false; return; }
    if (phone.replace(/\D/g, '').length < 7) { err.textContent = 'please enter the phone number you gave us.'; err.hidden = false; return; }
    tb.disabled = true; tb.textContent = 'checking...';
    try {
      const r = await fetch('/api/client/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref, phone }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || 'please check your id and phone number.');
      location.href = '/track';
    } catch (ex) {
      err.textContent = String(ex.message).toLowerCase(); err.hidden = false;
      tb.disabled = false; tb.textContent = 'open my progress';
    }
  });
})();
