/* our offices: map links and one-tap sharing. data lives in content.js (HZ.offices). */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const offices = (window.HZ && window.HZ.offices) || [];
  const short = o => (/hamzury\.com$/.test(location.hostname) ? location.origin : 'https://hamzury.com') + '/visit/' + o.key;
  const shareText = o => `hamzury ${o.city} office: ${o.lines.join(', ')}. map: ${short(o)}`;
  const box = $('offices');
  if (box) {
    box.innerHTML = offices.map(o => `<article class="office" id="${esc(o.key)}">
      <span class="eyebrow">${esc(o.city)} · ${esc(o.label)}</span>
      <address>${o.lines.map(esc).join('<br>')}</address>
      <div class="office-a">
        <a class="btn btn-primary" href="${esc(o.directions)}" target="_blank" rel="noopener">get directions</a>
        <a class="btn btn-ghost" href="${esc(o.maps)}" target="_blank" rel="noopener">open in google maps</a>
        <button class="btn btn-ghost" type="button" data-share="${esc(o.key)}">share this location</button>
      </div>
      <p class="tiny muted">short link to share: <b>${esc(short(o).replace(/^https?:\/\//, ''))}</b></p>
    </article>`).join('');
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-share]'); if (!b) return;
      const o = offices.find(x => x.key === b.dataset.share), text = shareText(o);
      if (navigator.share) { try { await navigator.share({ title: 'hamzury ' + o.city, text, url: short(o) }); return; } catch (err) { if (err && err.name === 'AbortError') return; } }
      location.href = 'https://wa.me/?text=' + encodeURIComponent(text);
    });
  }
  fetch('/api/public/config').then(r => r.json()).then(c => {
    if (c.whatsapp && $('visitWa')) { $('visitWa').href = 'https://wa.me/' + c.whatsapp + '?text=' + encodeURIComponent('hello hamzury, i would like to visit your office.'); $('visitWa').target = '_blank'; $('visitWa').rel = 'noopener'; }
  }).catch(() => {});
  if (location.hash) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
})();
