/* venture page: the venture's own colours, services and two doors (start here with this venture, or its own site). */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (location.pathname.match(/\/v\/([a-z]+)/) || [])[1] || new URLSearchParams(location.search).get('v') || '';
  const main = document.getElementById('main');
  document.body.classList.add('theme-' + key);
  (async () => {
    try {
      const r = await fetch('/api/public/ventures/' + encodeURIComponent(key));
      if (!r.ok) throw new Error('not found');
      const v = await r.json(); const c = (window.HZ && window.HZ.ventures[key]) || {};
      document.title = `${v.name} | ${v.area}`;
      main.innerHTML = `<a class="crumb" href="/#ventures">&#8249; all teams</a><section class="vhero">
          <img class="vlogo" src="/static/img/${esc(key)}.png" alt="${esc(v.name)}">
          <span class="area">${esc(v.area)}</span>
          <h1>${esc(v.promise)}</h1>
          <p class="hook">${esc(v.hook)}</p>
          <div class="vactions">
            <a class="btn btn-primary btn-block" href="/start?v=${esc(key)}">start here with ${esc(v.name)}</a>
            ${v.site ? `<a class="btn btn-ghost btn-block" href="${esc(v.site)}" rel="noopener">explore the ${esc(v.name)} site</a>` : ''}
            <small>about 2 minutes. free to start. you see every price before you decide.</small>
          </div>
        </section>
        <section class="section" aria-labelledby="svcTitle">
          <span class="eyebrow">what we do</span>
          <h2 class="title" id="svcTitle">what ${esc(v.name)} does for you.</h2>
          ${c.value ? `<p class="sub">${esc(c.value)}</p>` : ''}
          ${c.offers ? `<ul class="vt-offers v-offers">${c.offers.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
          ${v.services.length ? `<h3 class="h-section">packages</h3><p class="small muted">fees depend on your situation. you see them in your proposal, before you choose anything.</p>
            <div class="mt-16">${v.services.map(s => `<article class="svc"><h3>${esc(s.name)}</h3>${s.summary ? `<p>${esc(s.summary)}</p>` : ''}
              ${s.inclusions.length ? `<ul>${s.inclusions.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
              ${s.duration ? `<div class="meta">usually ${esc(s.duration)}</div>` : ''}</article>`).join('')}</div>` : ''}
          <div class="cta-band mt-32"><h2>not sure where to start?</h2><p class="muted">tell us about your idea, contract or business. we recommend, you choose.</p>
            <a class="btn btn-primary mt-16" href="/start?v=${esc(key)}">start here with ${esc(v.name)}</a></div>
        </section>`;
      document.getElementById('partOf').textContent = `${v.name} is part of hamzury holding. one roadmap, specialist support, clear next steps.`;
    } catch (e) {
      main.innerHTML = '<div class="center"><h1 class="hello">we could not find that page.</h1><a class="btn btn-primary" href="/">go to hamzury</a></div>';
    }
  })();
})();
