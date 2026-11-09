/* hamzury proposal page: one html template for the client's link and the pdf (the browser's save as pdf).
   page 1 tells the story (what we heard, the strategy, how we work). page 2 is the numbered, priced roadmap.
   input is one plain data object (see normalise below), built by track.js from the client's dashboard or by desk.js from the draft. */
(function () {
  const ACC = { bizdoc: 1, medialy: 1, subt: 1, iotics: 1, hub: 1, iwiin: 1 };  // colours live in proposal-doc.css (.acc-*, .d-*)
  const VNAME = { bizdoc: 'BizDoc', medialy: 'Medialy', subt: 'SUBT', iotics: 'Iotics', hub: 'Hamzury Hub', iwiin: 'IWIIN' };
  const PHASE_DEFAULT = { minimum: 'Start here', standard: 'Build', protection: 'Protect', scaling: 'Scale', renewals: 'Every month' };
  const CHIP = ['c1', 'c2', 'c3', 'c4'];
  const PROMISES = ['You see every price before you decide. Nothing starts until you choose.',
    'One team looks after you. Follow every step with your Hamzury ID, and hear from us within 48 hours while work is active.',
    'We are honest about what we can promise. We never guarantee grants, income or growth.'];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cap = t => { t = String(t || '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
  const title = t => String(t || '').replace(/(^|[\s,(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  const naira = m => '₦' + new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 }).format((m || 0) / 100);
  const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
  const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  const paras = t => lines(t).map(l => `<p>${esc(l)}</p>`).join('');

  // the shape every caller passes in. items are already in roadmap order.
  function normalise(d) {
    const doc = d.doc || {};
    const items = (d.items || []).filter(x => !x.client_has).map(x => ({
      name: cap(x.name), venture: x.venture || '', code: x.code || '', duration: x.duration || '', why: cap(x.why || ''), external: cap(x.external || ''),
      requires: Array.isArray(x.requires) ? x.requires : (() => { try { return JSON.parse(x.requires || '[]'); } catch (e) { return []; } })(),
      monthly: x.basis === 'monthly', ask: x.quote === 'ask' || x.fee_pending, price: x.price_minor || 0, list: x.list_minor || 0,
      renewal: x.renewal || 'none', renewal_minor: x.renewal_minor || 0, suggested: Boolean(x.suggested),
      phase: cap(x.phase) || (x.basis === 'monthly' ? 'Every month' : PHASE_DEFAULT[x.level || 'standard'] || 'Build'),
    }));
    const count = {}; items.forEach(i => { if (i.venture) count[i.venture] = (count[i.venture] || 0) + 1; });
    const lead = ACC[doc.lead_venture] ? doc.lead_venture : (Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [''])[0];
    return { ...d, doc, items, lead, first: cap(String(d.name || '').trim().split(/\s+/)[0] || 'there') };
  }

  function priceCell(i) {
    if (i.ask) return '<td class="pd-std"></td><td class="pd-rate"><span class="pd-ask">Quoted after review</span></td>';
    const per = i.monthly ? '<small>/month</small>' : '';
    const after = !i.monthly && i.renewal !== 'none' && i.renewal_minor ? `<small class="pd-then">then ${naira(i.renewal_minor)}/${i.renewal === 'yearly' ? 'year' : 'month'}</small>` : '';
    const std = i.list > i.price ? `<s>${naira(i.list)}${i.monthly ? '/month' : ''}</s>` : '';
    return `<td class="pd-std">${std}</td><td class="pd-rate"><b>${naira(i.price)}</b>${per}${after}</td>`;
  }

  function render(input) {
    const d = normalise(input), doc = d.doc, biz = d.business || d.name;
    const rate = doc.rate_pct > 0 ? { label: doc.rate_label || 'Your rate', pct: doc.rate_pct } : null;
    const office = ((window.HZ && window.HZ.offices) || [])[0];
    const address = office ? title(office.lines.join(', ')) : '';
    const logos = `<div class="pd-logos"><img src="/static/img/hamzury.png" alt="Hamzury">${d.lead ? `<span class="pd-bar"></span><img src="/static/img/${esc(d.lead)}.png" alt="${esc(VNAME[d.lead])}">` : ''}</div>`;
    const footer = `<footer class="pd-foot"><span>Hamzury Holding${d.lead ? ' · ' + esc(VNAME[d.lead]) : ''}${address ? ' · ' + esc(address) : ''}</span><span>hamzury.com</span></footer>`;

    // page 1: the story
    const headline = lines(doc.headline).length ? lines(doc.headline).map(esc).join('<br>') : `${esc(d.first)}, you took the first step.`;
    const intro = doc.intro || `You stopped, looked honestly at ${biz || 'your business'} and asked for a clear way forward. That is how growth starts. This proposal is built only on what you told us, and we are proud to build it with you.`;
    const heard = lines(d.heard);
    const strategy = (doc.strategy || []).filter(s => s.title || s.body);
    const how = (doc.how_we_work || []).filter(Boolean).length ? doc.how_we_work.filter(Boolean) : PROMISES;
    const fairRate = rate ? `${biz} gets the ${rate.label}: ${rate.pct}% off our standard price${doc.rate_why ? ', ' + doc.rate_why.replace(/^[,\s]+/, '') : ''}. Both prices are shown on page 2.` : '';
    const fair = [lines(doc.disclosure).map(l => `<p>${esc(l)}</p>`).join(''), fairRate ? `<p>${esc(fairRate)}</p>` : ''].join('');
    const vents = [...new Set(d.items.map(i => i.venture).filter(v => VNAME[v]))];

    const page1 = `<section class="pd-sheet">
      <header class="pd-head">${logos}<div class="pd-meta">Prepared for <b>${esc(d.name)}</b>${doc.topic ? `<br>${esc(doc.topic)}` : ''}<br>Ref ${esc(d.ref)} · ${esc(d.date)}</div></header>
      <p class="pd-eyebrow">Proposal${d.business ? ' for ' + esc(d.business) : ''}</p>
      <h1 class="pd-h1">${headline}</h1>
      <p class="pd-lead">${esc(intro)}</p>
      ${heard.length ? `<div class="pd-card"><h2>What we heard from you</h2><ul class="pd-heard${heard.length > 1 ? ' two' : ''}">${heard.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      ${strategy.length ? `<h2 class="pd-h2">Our strategy, in ${['one part', 'two parts', 'three parts'][strategy.length - 1]}</h2>
        <div class="pd-strat n${strategy.length}">${strategy.map((s, k) => `<div class="pd-card"><span class="pd-num">${k + 1}</span><h3>${esc(cap(s.title))}</h3>${paras(s.body)}</div>`).join('')}</div>`
        : d.advice ? `<div class="pd-card"><h2>Our recommendation</h2>${paras(d.advice)}</div>` : ''}
      ${doc.your_part || doc.our_part ? `<div class="pd-band"><div><h4>Your part</h4>${paras(doc.your_part)}</div><div><h4>Our part</h4>${paras(doc.our_part)}</div></div>` : ''}
      <div class="pd-pair${fair ? '' : ' one'}">
        <div class="pd-card"><h2>How we work</h2><ul class="pd-bullets">${how.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>
        ${fair ? `<div class="pd-card"><h2>Open and fair</h2>${fair}</div>` : ''}
      </div>
      ${vents.length ? `<div class="pd-card pd-who"><h2>Who will work with you</h2><p>Hamzury Holding brings six expert ventures together under one team: BizDoc, Medialy, SUBT, Iotics, Hamzury Hub and IWIIN. Each focuses on one area, so you work with specialists while one team looks after you.</p>
        <ul>${vents.map(v => `<li><span class="pd-dot d-${esc(v)}"></span><b>${esc(VNAME[v])}</b> ${esc(((window.HZ && window.HZ.ventures && window.HZ.ventures[v]) || {}).area ? '· ' + cap(window.HZ.ventures[v].area) : '')}</li>`).join('')}</ul></div>` : ''}
      ${d.management ? `<div class="pd-card"><h2>After delivery</h2>${paras(d.management)}</div>` : ''}
      ${footer}
    </section>`;

    // page 2: the numbered roadmap
    const num = new Map(d.items.map((i, k) => [i, k + 1]));
    const byCode = new Map(d.items.filter(i => i.code).map(i => [i.code, num.get(i)]));
    const phases = []; d.items.forEach(i => { let p = phases.find(x => x.name === i.phase); if (!p) phases.push(p = { name: i.phase, items: [] }); p.items.push(i); });
    const row = i => {
      const needs = i.requires.map(c => byCode.get(c)).filter(Boolean);
      const meta = [i.duration, needs.length ? `<span class="pd-needs">needs ${needs.join(', ')}</span>` : ''].filter(Boolean).join(' · ');
      return `<tr><td class="pd-no"><span>${num.get(i)}</span></td><td><b>${esc(i.name)}</b>${meta ? ` <span class="pd-meta-i">· ${meta}</span>` : ''}${i.why ? `<div class="pd-why">${esc(i.why)}</div>` : ''}${i.external ? `<div class="pd-ext">${esc(i.external)}</div>` : ''}</td>${priceCell(i)}</tr>`;
    };
    const hasStd = d.items.some(i => !i.ask && i.list > i.price);
    const sug = d.items.filter(i => i.suggested && !i.ask);
    const once = sug.filter(i => !i.monthly).reduce((a, i) => a + i.price, 0);
    const monthly = sug.reduce((a, i) => a + (i.monthly ? i.price : i.renewal === 'monthly' ? i.renewal_minor : 0), 0);
    const totals = [once ? `<b>${naira(once)}</b> once` : '', monthly ? `${once ? 'plus ' : ''}<b>${naira(monthly)}</b> a month` : ''].filter(Boolean).join(', ');
    const suggestion = sug.length ? `<p>Our suggestion: <b>${andList(sug.map(i => num.get(i)))}</b>.${totals ? ` That is ${totals}${rate ? ' at the ' + esc(rate.label) : ''}.` : ''} ${esc(doc.cta_note || 'Add the rest when you are ready.')}</p>` : (doc.cta_note ? `<p>${esc(doc.cta_note)}</p>` : '');
    const foot = [ 'Prices in naira.', rate ? `${rate.label} is ${rate.pct}% off our standard price.` : '', 'VAT and third-party fees are added only where they apply.', doc.footnote || '' ].filter(Boolean).join(' ');

    const page2 = d.items.length ? `<section class="pd-sheet">
      <header class="pd-head">${logos}<div class="pd-meta">Roadmap for <b>${esc(biz)}</b>${doc.topic ? `<br>${esc(doc.topic)}` : ''}<br>Ref ${esc(d.ref)}</div></header>
      <p class="pd-eyebrow">Roadmap</p>
      <h1 class="pd-h1 sm">Your roadmap, numbered. Choose where you start.</h1>
      <p class="pd-lead">Each number is one piece of work with a clear result. Implemented in order, each step builds on the one before it.</p>
      <div class="pd-tblwrap"><table class="pd-tbl"><thead><tr><th>No.</th><th>What you get</th><th class="pd-std">${hasStd ? 'Standard' : ''}</th><th class="pd-rate">${esc(rate ? rate.label : 'Price')}</th></tr></thead>
        <tbody>${phases.map((p, k) => `<tr class="pd-phase"><td colspan="4"><span class="pd-chip ${CHIP[k % CHIP.length]}">${esc(p.name)}</span></td></tr>${p.items.map(row).join('')}`).join('')}</tbody></table></div>
      <p class="pd-small">${esc(foot)}</p>
      <div class="pd-cta"><div><h3>Choose your numbers.<br>We send the invoice and begin.</h3>
        <p>Choose on hamzury.com with your Hamzury ID ${esc(d.ref)}, or reply on WhatsApp with the numbers you want to start with. We send your invoice${rate ? ' at the ' + esc(rate.label) : ''} and begin once payment is confirmed.</p>${suggestion}</div>
        <div><div class="pd-boxes">${d.items.map(i => `<span class="${i.suggested ? 'on' : ''}">${num.get(i)}</span>`).join('')}</div>
        <p class="pd-small">${sug.length ? 'Filled boxes show our suggested start. ' : ''}Choose any mix. Monthly numbers can be added or stopped month by month.</p></div></div>
      ${footer}
    </section>` : '';

    return `<div class="pdoc acc-${esc(d.lead || 'none')}">${page1}${page2}</div>`;
  }

  // print from this page: everything else is hidden while printing, so the print screen shows only the proposal.
  // the page title becomes the pdf file name on most browsers.
  function print(data, filename) {
    let box = document.getElementById('pdocPrint');
    if (!box) { box = document.createElement('div'); box.id = 'pdocPrint'; document.body.appendChild(box); }
    box.innerHTML = render(data);
    const before = document.title, root = document.documentElement;
    document.title = String(filename || 'hamzury-proposal').replace(/.pdf$/i, '');
    root.classList.add('pdoc-printing');
    const done = () => { root.classList.remove('pdoc-printing'); document.title = before; box.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    const imgs = [...box.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })).filter(Boolean);
    return Promise.all([...imgs, document.fonts ? document.fonts.ready : null]).then(() => { window.print(); });
  }

  window.HZProposalDoc = { render, print, normalise, PROMISES };
})();
