/* my hamzury: the client's app. recommendation, packages, checkout, onboarding, progress, downloads. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const naira = m => '₦' + new Intl.NumberFormat('en-NG', { maximumFractionDigits: (m % 100) ? 2 : 0, minimumFractionDigits: (m % 100) ? 2 : 0 }).format((m || 0) / 100);
  const day = d => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }).toLowerCase() : '';
  const vname = v => v === 'hub' ? 'hamzury hub' : v;
  const vtag = v => `<span class="vtag v-${esc(v)}">${esc(vname(v))}</span>`;
  // urgency, in colour: red needed now, amber needed soon, blue optional, green you have this, grey saved for later
  const URG = { 1: ['needed now', 'u-now'], 2: ['needed soon', 'u-soon'], 3: ['optional', 'u-opt'], has: ['you have this', 'u-has'], later: ['saved for later', 'u-later'], skip: ['not needed', 'u-later'] };
  const urgKey = x => (x.owned || x.client_has) ? 'has' : groupTaken(x) ? 'skip' : x.saved ? 'later' : (x.priority || 2);
  const pill = x => { const u = URG[urgKey(x)]; return `<span class="upill ${u[1]}">${u[0]}</span>`; };
  // the price the client sees, with its basis: never a number that was not approved
  const BASIS = { from: m => 'from ' + naira(m), monthly: m => naira(m) + ' / month', session: m => naira(m) + ' per session', request: m => naira(m) + ' per request', workflow: m => naira(m) + ' per workflow' };
  const price = x => x.quote === 'ask' ? 'after a few questions' : (BASIS[x.package.basis] || naira)(x.package.price_minor);
  const FORMAT = { file: 'a file', document: 'a document', workbook: 'a workbook', folder: 'an organised folder', bundle: 'a set of documents', workspace: 'a working setup', website: 'a live website', guide: 'a written guide', service: 'an ongoing service' };
  const STAGES = ['awareness', 'strategy', 'structure', 'systems', 'success'];
  const LEVELS = ['minimum', 'standard', 'protection', 'scaling'];
  const ALL = [...LEVELS, 'renewals'];
  const LNAME = L => L === 'renewals' ? 'renewals and changes' : L;
  const ROUTE_QS = ['what do you need renewed, filed or changed?', 'when is it due, if you know?'];
  const MEANING = { renewals: 'keep everything current as you grow: renewals, filings, updates and changes.', minimum: 'the essentials your business needs to run properly.', standard: 'what makes you organised, trusted and easy to buy from.', protection: 'protect what you have built: records, data, money and people.', scaling: 'systems that let the business grow beyond you.' };
  const lvl = x => { const k = ALL.indexOf(x.level || 'standard'); return k < 0 ? 1 : k; };
  const isCare = x => lvl(x) === 4;
  const app = $('app'), cart = $('cart');
  let me = null, csrf = '';
  let selected = new Set();
  try { selected = new Set(JSON.parse(sessionStorage.getItem('hz_sel') || '[]')); } catch (e) { /* ignore */ }
  const keep = () => { try { sessionStorage.setItem('hz_sel', JSON.stringify([...selected])); } catch (e) { /* ignore */ } };

  async function api(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(body) };
    const r = await fetch(path, { credentials: 'same-origin', ...opts });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { me = null; showLogin(); throw new Error('signed out'); }
    if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'something went wrong. please try again.');
    return d;
  }
  // files go straight to private storage with a one-time signature, then the server checks them. without one, they are posted here.
  async function upload(path, file) {
    const ask = async body => {
      const form = body instanceof FormData;
      const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, ...(form ? {} : { 'Content-Type': 'application/json' }) }, body: form ? body : JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'upload failed. please try again.');
      return d;
    };
    const s = await ask({ upload: 'sign', name: file.name, size: file.size });
    const fd = new FormData();
    if (s.direct) { fd.append('file', file); return ask(fd); }
    Object.entries(s.fields).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file);
    const up = await fetch(s.url, { method: 'POST', body: fd });
    if (!up.ok) throw new Error('upload failed. please try again.');
    return ask({ upload: 'done', name: file.name, ticket: s.ticket });
  }
  function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, Math.min(6000, 1800 + m.length * 35)); }
  const items = () => (me && me.recommendation ? me.recommendation.items : []);
  const item = id => items().find(x => x.id === Number(id));
  const stageIdx = x => STAGES.indexOf(x.stage);
  const roadmapOrder = list => list.slice().sort((p, q) => lvl(p) - lvl(q) || (p.saved - q.saved) || p.priority - q.priority || stageIdx(p) - stageIdx(q));
  const covered = x => x.owned || x.client_has || selected.has(x.id);
  const byCode = c => items().find(x => x.package.code && x.package.code === c);
  // an alternative the client already has or bought (one registration type, one scuml category)
  const groupTaken = x => x.package.group ? items().find(y => y.id !== x.id && y.package.group === x.package.group && (y.owned || y.client_has)) : null;
  const basicOk = x => !x.owned && !x.client_has && x.quote !== 'ask' && x.assess !== 'verify' && !groupTaken(x);
  // something this item needs first that is in the roadmap but cannot be added (another registration was chosen, or we are still checking it)
  const blockedNeed = x => (x.package.requires || []).map(byCode).find(n => n && !(n.owned || n.client_has) && !basicOk(n));
  const addable = x => basicOk(x) && !blockedNeed(x);
  // what to do first: needed now, not yet covered, one per choose-one group, in roadmap order
  function firstSteps() {
    const out = [], groups = new Set(items().filter(y => y.package.group && covered(y)).map(y => y.package.group));
    for (const x of roadmapOrder(items().filter(x => x.priority === 1 && !x.saved && !covered(x) && (addable(x) || (x.quote === 'ask' && !x.requested))))) {
      if (x.package.group) { if (groups.has(x.package.group)) continue; groups.add(x.package.group); }
      out.push(x); if (out.length === 3) break;
    }
    return out;
  }
  const nextLocked = () => roadmapOrder(items().filter(x => addable(x) && !x.saved && !isCare(x)))[0];
  const lastDelivered = () => items().filter(x => x.owned && x.engagement.status === 'delivered').sort((p, q) => String(q.engagement.delivered_at).localeCompare(String(p.engagement.delivered_at)))[0];
  const openOrder = () => (me.orders || []).find(o => o.status === 'pending' || o.status === 'awaiting_confirmation');
  // vat: only when finance has turned it on, and only on services classified as taxable
  const pr = () => me.pricing || { vat_registered: false, vat_rate_bp: 0, entity_name: 'hamzury holding' };
  const vatOf = x => pr().vat_registered && (me.vat_flags || {})[String(x.package.id)] !== false ? Math.round(x.package.price_minor * pr().vat_rate_bp / 10000) : 0;
  const pct = () => (pr().vat_rate_bp / 100).toString().replace(/\.0+$/, '') + '%';
  const checking = () => (me.orders || []).some(o => o.status === 'awaiting_confirmation');
  const invoice = id => (me.invoices || []).find(o => o.id === Number(id));

  // a private link from whatsapp: /track?t=token#dest opens the right step without the id and phone
  let linkCtx = null;
  const BANNERS = {
    home: ['welcome back.', 'everything about your plan, in one place.'],
    recommendation: ['your proposal is ready.', 'built only on what you told us. read it, then open your roadmap.'],
    roadmap: ['your roadmap is ready.', 'start with what is needed now. choose anything, any time.'],
    checkout: ['finish your payment.', 'your packages start as soon as your payment is confirmed.'],
    pay: ['finish your payment.', 'your packages start as soon as your payment is confirmed.'],
    onboarding: ['a few details so we can start.', 'only the questions for what you chose. about 2 minutes.'],
    progress: ['here is where your work stands.', 'progress for each part, and downloads when they are ready.'],
  };
  async function linkLogin() {
    const t = new URLSearchParams(location.search).get('t');
    if (!t) return;
    history.replaceState(null, '', location.pathname + location.hash);
    try {
      const r = await fetch('/api/client/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(String(d.detail || 'this link has expired').toLowerCase()); return; }
      linkCtx = { dest: d.dest, sender: d.sender, shown: false };
      if (!location.hash && d.dest !== 'home') location.hash = d.dest;
    } catch (e) { /* fall back to sign in */ }
  }
  function showBanner() {
    if (!linkCtx || linkCtx.shown) return;
    linkCtx.shown = true;
    const b = BANNERS[(location.hash.slice(1) || 'home').split('-')[0]] || BANNERS.home;
    const el = document.createElement('div');
    el.className = 'link-banner fade-in';
    el.innerHTML = `<img src="/static/img/hamzury-mark.png" alt=""><div><span class="tiny muted">sent to you by ${esc(linkCtx.sender)}${/hamzury/.test(linkCtx.sender) ? '' : ' at hamzury'}</span><h2>${esc(b[0])}</h2><p class="small">${esc(b[1])}</p><span class="private">private to ${esc(me.business || me.name)} · ${esc(me.ref)}</span></div><button class="x" type="button" aria-label="close">&times;</button>`;
    el.querySelector('.x').addEventListener('click', () => el.remove());
    app.prepend(el);
  }
  async function load() {
    await linkLogin();
    try { me = await api('/api/client/me'); csrf = me.csrf; } catch (e) { return; }
    // drop selections that are no longer possible
    selected = new Set([...selected].filter(id => item(id) && addable(item(id)))); keep();
    $('topRight').innerHTML = `<span class="idchip">${esc(me.ref)}</span>`;
    route();
  }

  function setTop(backTo, label) {
    $('topLeft').innerHTML = backTo ? `<button class="back" type="button" data-go="${backTo}">&#8249; ${esc(label)}</button>` : '<a href="/" aria-label="hamzury home"><img src="/static/img/hamzury.png" alt="hamzury.com" width="128" height="22"></a>';
    if (me) $('topRight').innerHTML = backTo && backTo !== 'home' ? '<button class="top-home" type="button" data-go="home">my dashboard</button>' : `<span class="idchip">${esc(me.ref)}</span>`;
  }

  function route() {
    if (!me) return;
    const h = location.hash.slice(1) || 'home';
    window.scrollTo({ top: 0 });
    if (h.startsWith('package-')) return pkgScreen(h.slice(8));
    if (h.startsWith('invoice-')) return invoiceScreen(h.slice(8));
    if (h === 'files') return filesScreen();
    ({ recommendation: proposalScreen, proposal: proposalScreen, roadmap: roadmapScreen, checkout: checkoutScreen, pay: payScreen, onboarding: onboardingScreen, progress: progressScreen }[h] || homeScreen)();
    showBanner();
  }
  // always show the latest picture on the main screens and when the client comes back to the tab
  async function fresh() { try { const d = await api('/api/client/me'); me = d; csrf = d.csrf; selected = new Set([...selected].filter(id => item(id) && addable(item(id)))); keep(); } catch (e) { /* keep last */ } }
  window.addEventListener('hashchange', async () => { const h = location.hash.slice(1) || 'home'; if (['home', 'progress', 'recommendation', 'proposal', 'roadmap', 'files'].includes(h)) await fresh(); route(); });
  document.addEventListener('visibilitychange', async () => { if (!document.hidden && me) { await fresh(); const h = location.hash.slice(1) || 'home'; if (['home', 'progress'].includes(h)) route(); } });
  window.addEventListener('scroll', () => $('appTop').classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); location.hash = g.dataset.go; }
    const t = e.target.closest('[data-toggle]'); if (t) { e.preventDefault(); toggle(Number(t.dataset.toggle)); }
    const u = e.target.closest('[data-unlock]'); if (u) { e.preventDefault(); const x = item(u.dataset.unlock); if (!x || !addable(x)) { location.hash = x ? 'package-' + x.id : 'roadmap'; return; } add(x, true); location.hash = 'checkout'; }
    const sv = e.target.closest('[data-save]'); if (sv) { e.preventDefault(); saveLater(Number(sv.dataset.save), sv.dataset.on === '1'); }
    const fa = e.target.closest('[data-first-all]'); if (fa) { e.preventDefault(); const list = firstSteps().filter(x => addable(x) && !selected.has(x.id)); const msgs = list.flatMap(x => add(x, true)); updateCart(); route(); toast(msgs.length ? msgs[msgs.length - 1] : `added ${list.length === 1 ? 'it' : 'them'} to your slip.`); }
    const ak = e.target.closest('[data-ask]'); if (ak) { e.preventDefault(); askUpdate(Number(ak.dataset.ask), ak); }
    const sc = e.target.closest('[data-sub-cancel]'); if (sc) { e.preventDefault(); subAction(sc.dataset.subCancel, sc.dataset.act); }
    const ip = e.target.closest('[data-inv-card]'); if (ip) { e.preventDefault(); payInvoiceCard(Number(ip.dataset.invCard), ip); }
    const hv = e.target.closest('[data-have]'); if (hv) { e.preventDefault(); have(Number(hv.dataset.have), hv.dataset.on === '1'); }
    const lv = e.target.closest('[data-level]'); if (lv) { e.preventDefault(); openLevel(Number(lv.dataset.level)); }
    const rm = e.target.closest('[data-slip-rm]'); if (rm) { e.preventDefault(); toggle(Number(rm.dataset.slipRm)); }
    const ro = e.target.closest('[data-route-open]'); if (ro) { e.preventDefault(); routeOpen = Number(ro.dataset.routeOpen); route(); }
  });

  let openLv = null;
  // choose one: adding one registration type (or scuml category) swaps out the other.
  // needs first: adding an item brings what it depends on; removing that dependency takes the item out too.
  function add(x, quiet) {
    const msgs = [];
    if (x.package.group) for (const id of [...selected]) {
      const y = item(id);
      if (y && y.id !== x.id && y.package.group === x.package.group) {
        const dep = remove(y, true);
        msgs.push(`swapped ${y.package.name} for this. you choose one.` + (dep.length ? ` also removed ${dep.map(d => d.package.name).join(', ')}.` : ''));
      }
    }
    selected.add(x.id);
    for (const code of x.package.requires || []) {
      const need = byCode(code);
      if (need && !covered(need) && addable(need)) { add(need, true); msgs.push(`added ${need.package.name} too. it comes first.`); }
    }
    keep();
    if (!quiet && msgs.length) toast(msgs[msgs.length - 1]);
    return msgs;
  }
  function remove(x, quiet) {
    selected.delete(x.id);
    const dep = [...selected].map(item).filter(y => y && (y.package.requires || []).includes(x.package.code) && !(x.owned || x.client_has));
    dep.forEach(y => selected.delete(y.id));
    keep();
    if (dep.length && !quiet) toast(`also removed ${dep.map(y => y.package.name).join(', ')}. it needs ${x.package.name} first.`);
    return dep;
  }
  function toggle(id) {
    const it = item(id); if (!it || !addable(it)) return;
    if (selected.has(id)) remove(it); else { const m = add(it); if (!m.length) toast('added to your slip.'); }
    route(); updateCart();
  }
  async function have(id, on) {
    try {
      await api(`/api/client/items/${id}/have`, { has: on });
      if (on) { selected.delete(id); keep(); } await fresh();
      toast(on ? 'noted. we will confirm it with you.' : 'undone.');
      route(); updateCart();
    } catch (ex) { toast(String(ex.message).toLowerCase()); }
  }
  async function saveLater(id, on) {
    try {
      await api(`/api/client/items/${id}/save`, { saved: on });
      if (on && item(id)) remove(item(id)); await fresh();
      toast(on ? 'saved for later. it stays on your roadmap.' : 'back on your list.');
      route(); updateCart();
    } catch (ex) { toast(String(ex.message).toLowerCase()); }
  }
  async function subAction(id, act) {
    try {
      const r = await api(`/api/client/subscriptions/${id}/${act}`, {});
      await fresh(); toast(act === 'keep' ? 'great. it carries on as normal.' : r.status === 'cancelled' ? 'done. it has stopped.' : 'done. it stops at the end of the month you paid for.'); route();
    } catch (ex) { toast(String(ex.message).toLowerCase()); }
  }
  async function askUpdate(id, b) {
    b.disabled = true;
    try { await api(`/api/client/engagements/${id}/ask`, {}); await fresh(); toast('sent. your team will reply with an update soon.'); route(); }
    catch (ex) { toast(String(ex.message).toLowerCase()); b.disabled = false; }
  }
  async function payInvoiceCard(id, b) {
    const em = $('invEmail'), email = em ? em.value.trim() : '';
    b.disabled = true; b.textContent = 'please wait...';
    try { const d = await api(`/api/client/orders/${id}/pay`, { email }); location.href = d.redirect; }
    catch (ex) { toast(String(ex.message).toLowerCase()); b.disabled = false; b.textContent = 'pay by card'; }
  }
  function updateCart(show = true) {
    const sel = roadmapOrder([...selected].map(item).filter(Boolean));
    const total = sel.reduce((s, x) => s + x.package.price_minor, 0);
    $('cartCount').textContent = `${sel.length} in your slip`;
    $('cartTotal').textContent = naira(total);
    $('slipList').innerHTML = sel.map(x => `<li><span><b>${esc(x.package.name)}</b><span class="tiny muted">${esc(LNAME(x.level))} · ${esc(vname(x.package.venture))}</span></span><span class="slip-r"><b>${esc(price(x))}</b><button type="button" class="slip-x" data-slip-rm="${x.id}" aria-label="remove ${esc(x.package.name)}">&times;</button></span></li>`).join('');
    if (!sel.length) cart.classList.remove('open');
    cart.classList.toggle('show', show && sel.length > 0);
    document.body.classList.toggle('cart-on', show && sel.length > 0);
  }
  $('cartBtn').addEventListener('click', () => { location.hash = 'checkout'; });
  $('slipBtn').addEventListener('click', () => { const o = !cart.classList.contains('open'); cart.classList.toggle('open', o); $('slipBtn').setAttribute('aria-expanded', String(o)); });

  /* ---------- sign in ---------- */
  function showLogin() {
    cart.classList.remove('show'); setTop(); $('topRight').innerHTML = '';
    app.innerHTML = `<div class="fade-in"><span class="eyebrow">my hamzury</span><h1 class="hello">track your progress.</h1>
      <p class="muted">use your hamzury id and the phone number you gave us.</p>
      <form id="loginForm" class="mt-24" novalidate>
        <div class="field"><label for="lRef">hamzury id</label><input id="lRef" class="input" placeholder="HZ-7K2M9P" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
        <div class="field"><label for="lPhone">phone number</label><input id="lPhone" class="input" type="tel" inputmode="tel" autocomplete="tel"></div>
        <div class="error" id="lErr" role="alert" hidden></div>
        <button class="btn btn-primary btn-block mt-8" id="lBtn">continue</button>
      </form>
      <p class="muted small mt-24">new here? <a href="/start">start here</a></p></div>`;
    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('lErr'); err.hidden = true; const b = $('lBtn'); b.disabled = true; b.textContent = 'checking...';
      try {
        const r = await fetch('/api/client/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: $('lRef').value, phone: $('lPhone').value }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'please check your id and phone number.');
        location.hash = ''; await load();
      } catch (ex) { err.textContent = String(ex.message).toLowerCase(); err.hidden = false; b.disabled = false; b.textContent = 'continue'; }
    });
  }

  /* ---------- home ---------- */
  function homeScreen() {
    setTop(); updateCart();
    const first = me.name.split(' ')[0].toLowerCase(), o = openOrder();
    const step = me.step;
    let card;
    if (o && o.status === 'awaiting_confirmation') card = ['payment', 'we are confirming your payment.', 'you will see your next step here as soon as it is confirmed. you do not need to do anything.', 'see payment details', 'pay'];
    else if (o && o.status === 'pending') card = ['payment', 'finish your payment.', `you chose ${o.lines.length} package${o.lines.length === 1 ? '' : 's'}. total ${naira(o.total_minor)}.`, 'continue to payment', 'pay'];
    else card = {
      2: ['step 2 of 5', 'we are preparing your proposal.', `our team is reading your answers now. your proposal will be ready ${me.plan_eta || 'soon, within working hours'}, and we will message you on whatsapp when it is.`, '', '', me.focus || []],
      3: ['step 3 of 5', 'your proposal is ready.', 'built only on what you told us. read it, save it, then open your roadmap and choose what you want.', 'see my proposal', 'proposal'],
      4: ['step 4 of 5', 'tell us a few details so we can start.', 'a few short questions for the packages you chose.', 'start onboarding', 'onboarding'],
      5: ['step 5 of 5', 'your work is in progress.', 'see where each package stands. you can download each one when it is delivered.', 'see my progress', 'progress'],
      6: ['complete', 'everything is delivered.', 'your files are ready to download.', 'download my files', 'progress'],
    }[step];
    const steps = [['tell us about your business', 'done'], ['your proposal', 'we prepare it for you'], ['activate your roadmap', 'only what you choose'], ['onboarding', 'details for your packages'], ['progress and delivery', 'track and download']];
    const current = step >= 6 ? 6 : step;
    const last = me.updates[0];
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">${esc(me.business || 'my hamzury')}</span>
      <h1 class="hello">hello, ${esc(first)}.</h1>
      <section class="next-card" aria-labelledby="nextTitle"><span class="eyebrow">${esc(card[0])}</span><h2 id="nextTitle">${esc(card[1])}</h2><p>${esc(card[2])}</p>
        ${card[5] && card[5].length ? `<div class="focus"><span class="tiny">from your answers, your first focus is likely</span><ol>${card[5].map(f => `<li>${esc(f)}</li>`).join('')}</ol><span class="tiny">your team confirms it in your proposal.</span></div>` : ''}
        ${card[3] ? `<button class="btn" data-go="${card[4]}">${esc(card[3])}</button>` : ''}</section>
      ${billingHtml()}
      ${(() => { const d = lastDelivered(), n = nextLocked(); if (!d || !n || o) return '';
        return `<section class="unlock-card" aria-labelledby="unlockTitle"><span class="eyebrow">ready for your next step?</span>
          <h2 id="unlockTitle">you have finished ${esc(d.package.name)}.</h2>
          <p>the next step on your roadmap is <b>${esc(n.package.name)}</b>${n.note ? `: ${esc(n.note)}` : '.'}</p>
          <button class="btn btn-primary" data-unlock="${n.id}">add the next step · ${esc(price(n))}</button>
          <p class="tiny muted mt-12"><button class="btn-text" data-go="package-${n.id}">see what is inside first</button></p></section>`; })()}
      <h2 class="h-section">your journey</h2>
      <ol class="timeline card">${steps.map((s, k) => {
        const n = k + 1, cls = n < current ? 'is-done' : n === current ? 'is-now' : '';
        return `<li class="${cls}" ${n === current ? 'aria-current="step"' : ''}><span class="ic" aria-hidden="true">${n < current ? '&#10003;' : n}</span><div><b>${esc(s[0])}</b><span>${n < current ? 'done' : n === current ? 'now' : esc(s[1])}</span></div></li>`;
      }).join('')}</ol>
      ${last ? `<h2 class="h-section">latest update</h2><div class="card">${updateHtml(last)}</div>` : ''}
      ${(me.agreements || []).length || items().some(x => x.owned) ? '<button class="file-link mt-24" type="button" data-go="files"><b>my files and agreements</b><span>deliverables, your uploads, handover details and what you accepted</span></button>' : ''}
      <div class="note mt-24">your contact is <b>${esc(me.contact)}</b>. while work is active, you hear from us within ${me.review_hours} hours. <a href="/visit">our offices</a></div>
      ${me.whatsapp ? `<a class="btn btn-wa btn-block mt-12" rel="noopener" href="https://wa.me/${esc(me.whatsapp)}?text=${encodeURIComponent('hello hamzury, this is ' + me.ref + '.')}">message us on whatsapp</a>` : ''}
      <p class="mt-24"><button class="btn-text" type="button" id="signOut">sign out</button></p></div>`;
    $('signOut').addEventListener('click', async () => { try { await api('/api/client/logout', {}); } catch (e) { /* ignore */ } location.href = '/'; });
  }

  // monthly services and their invoices, on the dashboard
  function billingHtml() {
    const subs = me.subscriptions || [], inv = me.invoices || [];
    if (!subs.length && !inv.length) return '';
    const st = s => s.cancel_at ? `ends on ${esc(day(s.cancel_at))}` : s.status === 'paused' ? 'paused until the payment is made' : s.status === 'grace' ? 'payment is due' : `next on ${esc(day(s.next_due))}${s.method === 'paystack' ? ', charged to your card' : ', we send you an invoice'}`;
    return `<h2 class="h-section">monthly services</h2>
      ${inv.map(o => `<div class="inv ${o.status === 'awaiting_confirmation' ? 'wait' : ''}"><div><b>${esc(o.name)}</b><span class="tiny muted">${o.status === 'awaiting_confirmation' ? 'we are confirming your transfer' : 'due ' + esc(day(o.next_due))} · ${naira(o.total_minor)}</span></div>
        ${o.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-go="invoice-${o.id}">pay</button>` : ''}</div>`).join('')}
      <div class="card subs">${subs.map(s => `<div class="sub"><div><b>${esc(s.name)}</b><span class="tiny muted">${naira(s.amount_minor)} / month · ${st(s)}</span></div>
        ${s.cancel_at ? `<button class="btn-text tiny" data-sub-cancel="${s.id}" data-act="keep">keep it</button>` : `<button class="btn-text tiny" data-sub-cancel="${s.id}" data-act="cancel">stop after this month</button>`}</div>`).join('')}</div>`;
  }

  function updateHtml(u) {
    return `<div class="update"><time>${esc(day(u.created_at))}${u.package ? ' · ' + esc(u.package) : ''}</time><dl>
      <dt>progress</dt><dd>${esc(u.progress)}</dd><dt>holding us back</dt><dd>${esc(u.blocker || 'nothing at the moment.')}</dd><dt>next step</dt><dd>${esc(u.next_action)}</dd></dl></div>`;
  }

  /* ---------- my proposal ---------- */
  function proposalScreen() {
    if (!me.recommendation) return homeScreen();
    setTop('home', 'home'); updateCart(false);
    app.innerHTML = `<div class="fade-in proposal proposal-doc">
      ${window.HZProposalDoc.render(docData())}
      <button class="btn btn-primary btn-block mt-32" data-go="roadmap">See my roadmap and choose</button>
      <div class="p-save"><button class="btn btn-ghost" type="button" id="saveCard">Save to my phone</button><button class="btn btn-ghost" type="button" id="savePdf">Download PDF</button></div>
      <p class="tiny muted mt-12">Your proposal stays here too. Sign in any time with ${esc(me.ref)}.</p>
    </div>`;
    $('saveCard').addEventListener('click', () => keepFile('card'));
    $('savePdf').addEventListener('click', () => keepFile('pdf'));
  }
  // the proposal page data: the published plan in the order the team set, without alternatives already settled
  function docData() {
    const r = me.recommendation;
    return {
      name: me.name, business: me.business, ref: me.ref, heard: r.heard, advice: r.advice, management: r.management || '', doc: r.doc || {},
      date: new Date(r.published_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      items: items().filter(x => !groupTaken(x)).map(x => ({ name: x.package.name, venture: x.package.venture, code: x.package.code, duration: x.package.duration,
        why: x.note || x.package.summary || '', external: x.package.external, requires: x.package.requires, basis: x.package.basis, level: x.level,
        quote: x.quote, fee_pending: x.fee_pending, price_minor: x.package.price_minor, list_minor: x.list_minor, renewal: x.renewal, renewal_minor: x.renewal_minor,
        phase: x.phase, suggested: x.suggested, client_has: x.client_has })),
    };
  }
  const promises = () => ['You see every price before you decide. Nothing starts until you choose.', `One team looks after you. Follow every step with your Hamzury ID, and hear from us within ${me.review_hours} hours while work is active.`, 'We are honest about what we can promise. We never guarantee grants, income or growth.'];
  function proposalData() {
    const r = me.recommendation;
    return {
      first: me.name.trim().split(/\s+/)[0], name: me.name, business: me.business, ref: me.ref,
      date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
      advice: r.advice, management: r.management || '', promises: promises(),
      levels: ALL.map(L => ({ name: LNAME(L), meaning: MEANING[L], items: roadmapOrder(items().filter(x => (x.level || 'standard') === L && !groupTaken(x)))
        .map(x => ({ name: x.package.name, venture: x.package.venture, vname: vname(x.package.venture), why: x.note || x.package.summary || '' })) })).filter(l => l.items.length),
    };
  }
  async function keepFile(kind) {
    const b = $(kind === 'card' ? 'saveCard' : 'savePdf'), was = b.textContent; b.disabled = true; b.textContent = 'preparing...';
    try {
      const d = proposalData(), slug = (me.business || me.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (kind === 'card') {
        const blob = await window.HZProposal.card(d);
        const res = await window.HZProposal.save(blob, `hamzury-proposal-${slug}.png`, 'my hamzury proposal');
        if (res !== 'cancelled') showCard(blob);
      } else {
        await window.HZProposalDoc.print(docData(), `hamzury-proposal-${slug}`);
        toast('Choose "Save as PDF" on the print screen.');
      }
    } catch (ex) { toast('we could not prepare it. please try again.'); }
    b.disabled = false; b.textContent = was;
  }
  // show the image so a phone can press and hold to save it to photos
  function showCard(blob) {
    const url = URL.createObjectURL(blob), el = document.createElement('div');
    el.className = 'card-view fade-in'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'your proposal image');
    el.innerHTML = `<div class="card-view-in"><img src="${url}" alt="your hamzury proposal"><p class="small">on your phone, press and hold the image, then choose <b>save to photos</b>.</p><button class="btn btn-primary btn-block" type="button">done</button></div>`;
    el.querySelector('button').addEventListener('click', () => { el.remove(); URL.revokeObjectURL(url); });
    document.body.appendChild(el);
  }
  /* ---------- ask-first items: a few questions, then we send the route ---------- */
  let routeOpen = null;
  function routeForm(x) {
    const qs = x.package.onboarding.length ? x.package.onboarding.map(q => q.label) : ROUTE_QS;
    return `<form class="route-form" data-route-form="${x.id}" novalidate>${qs.map((q, k) => `<div class="field"><label for="rq${x.id}_${k}">${esc(q)}</label><input class="input" id="rq${x.id}_${k}" data-rq="${esc(q)}" maxlength="1500"></div>`).join('')}
      <button class="btn btn-primary btn-block" type="submit">send</button><p class="tiny muted mt-8">no payment now. we reply with your route and the fee.</p></form>`;
  }
  document.addEventListener('submit', async e => {
    const f = e.target.closest('[data-route-form]'); if (!f) return; e.preventDefault();
    const answers = {}; f.querySelectorAll('[data-rq]').forEach(i => { if (i.value.trim()) answers[i.dataset.rq] = i.value.trim(); });
    const b = f.querySelector('button'); b.disabled = true; b.textContent = 'sending...';
    try { await api(`/api/client/items/${f.dataset.routeForm}/request`, { answers }); routeOpen = null; await fresh(); toast('sent. we will reply with your route.'); route(); }
    catch (ex) { toast(String(ex.message).toLowerCase()); b.disabled = false; b.textContent = 'send'; }
  });

  /* ---------- roadmap: levels to read, urgency to act on, nothing locked ---------- */
  function openLevel(k) { openLv = openLv === k ? -1 : k; roadmapScreen(true); }
  function roadmapScreen(keepScroll) {
    if (!me.recommendation) return homeScreen();
    setTop('proposal', 'my proposal'); updateCart();
    if (openLv === null) { const f = roadmapOrder(items().filter(x => !covered(x) && !x.saved))[0]; openLv = f ? lvl(f) : 0; }
    const y = window.scrollY, first = firstSteps();
    app.innerHTML = `<div class="fade-in-soft">
      <span class="eyebrow">${esc(me.business ? 'for ' + me.business : 'your roadmap')}</span>
      <h1 class="hello">your scaling roadmap.</h1>
      <p class="muted">everything we recommend, grouped by level. choose anything, any time. already have something? tap <b>i have this</b>.</p>
      ${checking() ? '<div class="note mt-16">we are confirming your last payment. once it is confirmed, you can choose more.</div>' : ''}
      ${first.length ? `<section class="first" aria-labelledby="firstT"><span class="eyebrow">start here first</span><h2 id="firstT">${first.length === 1 ? 'one thing is needed now.' : first.length + ' things are needed now.'}</h2>
        <ol>${first.map(x => `<li><button class="btn-text" data-go="package-${x.id}">${esc(x.package.name)}</button><span>${esc(x.quote === 'ask' ? 'we ask a few questions first' : price(x))}</span></li>`).join('')}</ol>
        ${first.some(x => addable(x) && !selected.has(x.id)) ? '<button class="btn btn-primary btn-block" type="button" data-first-all>add what is needed now</button>' : ''}</section>` : ''}
      <div class="legend" aria-label="what the colours mean">${['1', '2', '3', 'has', 'later'].map(k => `<span class="upill ${URG[k][1]}">${URG[k][0]}</span>`).join('')}</div>
      <div class="levels">${ALL.map((L, k) => levelHtml(L, k)).join('')}</div>
      <p class="muted small mt-24">nothing starts and nothing is charged until you activate. what you do not choose now stays here for later.</p>
    </div>`;
    if (keepScroll === true) window.scrollTo({ top: y });
  }
  function levelHtml(L, k) {
    const list = roadmapOrder(items().filter(x => lvl(x) === k));
    if (!list.length) return '';
    const isOpen = openLv === k, care = k === 4;
    const live = list.filter(x => !groupTaken(x));
    const now = live.filter(x => x.priority === 1 && !x.saved && !covered(x)).length;
    const core = live.filter(x => x.priority !== 3 && !x.saved);
    const done = core.length > 0 && core.every(covered);
    const picked = list.filter(x => selected.has(x.id)).length;
    const state = care ? '<span class="lv-state">ongoing</span>' : now ? `<span class="lv-state u-now">${now} needed now</span>` : done ? '<span class="lv-state ok">covered</span>' : `<span class="lv-state">${live.filter(covered).length} of ${live.length}</span>`;
    return `<section class="level ${isOpen ? 'open' : ''} ${done && !care ? 'done' : ''}">
      <button class="level-head" type="button" data-level="${k}" aria-expanded="${isOpen}">
        <span class="lv-n" aria-hidden="true">${done && !care ? '&#10003;' : k + 1}</span>
        <span class="lv-t"><b>${esc(LNAME(L))}</b><span>${esc(MEANING[L])}</span></span>
        <span class="lv-r">${state}${picked ? `<span class="lv-sum">${picked} added</span>` : ''}</span>
      </button>
      ${isOpen ? `<div class="level-body">${list.map(itemRow).join('')}</div>` : ''}
    </section>`;
  }
  function itemRow(x) {
    const p = x.package, on = selected.has(x.id), tk = groupTaken(x);
    const meta = `<span class="ri-meta">${pill(x)}${vtag(p.venture)}</span>`;
    if (x.owned) return `<div class="ri owned"><div class="ri-main">${meta}<h3>${esc(p.name)}</h3><span class="ri-sub">in your plan · ${esc(x.engagement.status_label)}</span></div><button class="btn-text tiny" data-go="progress">progress</button></div>`;
    if (x.client_has) return `<div class="ri has"><div class="ri-main">${meta}<h3>${esc(p.name)}</h3><span class="ri-sub">${x.assess === 'improve' ? 'you have this. we suggest a few improvements.' : 'you have this'}</span></div><button class="btn-text tiny" data-have="${x.id}" data-on="0">undo</button></div>`;
    if (tk) return `<div class="ri has"><div class="ri-main">${meta}<h3>${esc(p.name)}</h3><span class="ri-sub">you have ${esc(tk.package.name)}, so you do not need this</span></div></div>`;
    if (x.assess === 'verify') return `<div class="ri ask"><button class="ri-main" type="button" data-go="package-${x.id}">${meta}<span class="ri-h">${esc(p.name)}</span><span class="ri-sub">${x.fee_pending ? 'we are confirming the fee. we will let you know.' : 'we are checking whether you need this. we will confirm it with you.'} · <u>see inside</u></span></button></div>`;
    const bn = blockedNeed(x);
    if (bn) return `<div class="ri has"><button class="ri-main" type="button" data-go="package-${x.id}">${meta}<span class="ri-h">${esc(p.name)}</span><span class="ri-sub">this comes after ${esc(bn.package.name)}, which is not in your plan. · <u>see inside</u></span></button></div>`;
    if (x.quote === 'ask') return `<div class="ri ask">
      <button class="ri-main" type="button" data-go="package-${x.id}">
        ${meta}<span class="ri-h">${esc(p.name)}</span>
        <span class="ri-sub">${x.requested ? 'route requested. we will reply with your route and the fee.' : 'we ask a few questions first, then send your route.'} · <u>see inside</u></span>
      </button>
      <div class="ri-act">${x.requested ? '<span class="ri-done">sent &#10003;</span>' : `<button class="ri-add" type="button" data-route-open="${x.id}">get my route</button>`}</div>
      ${routeOpen === x.id && !x.requested ? routeForm(x) : ''}
    </div>`;
    const needs = (p.requires || []).map(byCode).filter(n => n && !covered(n));
    return `<div class="ri ${on ? 'on' : ''} ${x.saved ? 'later' : ''}">
      <button class="ri-main" type="button" data-go="package-${x.id}">
        ${meta}<span class="ri-h">${esc(p.name)}</span>
        <span class="ri-sub"><b>${esc(price(x))}</b>${p.duration && p.basis !== 'monthly' ? ` · ${esc(p.duration)}` : ''} · <u>see inside</u></span>
        ${p.group && !on ? '<span class="ri-note">choose one of these</span>' : ''}${needs.length && !on ? `<span class="ri-note">comes after ${esc(needs.map(n => n.package.name).join(', '))}. we add it with this.</span>` : ''}
      </button>
      <div class="ri-act">
        <button class="ri-add" type="button" data-toggle="${x.id}" aria-pressed="${on}">${on ? '&#10003; added' : '+ add'}</button>
        ${on ? '' : `<button class="ri-have" type="button" data-have="${x.id}" data-on="1">i have this</button>`}
        ${on ? '' : x.saved ? `<button class="ri-have" type="button" data-save="${x.id}" data-on="0">bring back</button>` : x.priority !== 1 ? `<button class="ri-have" type="button" data-save="${x.id}" data-on="1">later</button>` : ''}
      </div>
    </div>`;
  }

  /* ---------- package detail ---------- */
  function pkgScreen(id) {
    const x = item(id); if (!x) return roadmapScreen();
    setTop('roadmap', 'my roadmap'); updateCart();
    const tk = groupTaken(x);
    const p = x.package, on = selected.has(x.id);
    app.innerHTML = `<div class="fade-in">
      <div class="pkg-hero">${vtag(p.venture)}<h1>${esc(p.name)}</h1>${p.summary && !(p.value || '').startsWith(p.summary) ? `<p>${esc(p.summary)}</p>` : ''}</div>
      <div class="pkg-pill">${pill(x)}</div>
      <div class="facts"><div class="fact"><small>fee</small><strong>${x.fee_pending ? 'being confirmed' : esc(price(x))}</strong></div><div class="fact"><small>duration</small><strong>${esc(p.duration || 'agreed with you')}</strong></div></div>
      <p class="tiny muted">${p.basis === 'monthly' ? 'the first month is paid when you activate. stop any time before the next month.' : p.basis === 'from' ? 'this is the starting fee. if yours needs more, we tell you the extra before we do it.' : 'the time starts when we have your payment and your details.'}</p>
      ${p.inclusions.length ? `<h2 class="h-section">what is inside</h2><ul class="inside card">${p.inclusions.map(i => `<li><span class="tick" aria-hidden="true">&#10003;</span><span>${esc(i)}</span></li>`).join('')}</ul>` : ''}
      ${FORMAT[p.format] ? `<p class="small"><b>you receive:</b> ${esc(FORMAT[p.format])}.</p>` : ''}
      ${(p.exclusions || []).length ? `<h2 class="h-section">not included</h2><ul class="outside">${p.exclusions.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${p.external ? `<div class="note"><b>please note:</b> ${esc(p.external)}</div>` : ''}
      ${(x.note || p.value) ? `<h2 class="h-section">why we recommend it for you</h2><div class="why">${esc([x.note, p.value].filter(Boolean).join('\n\n'))}</div>` : ''}
      <div class="mt-32">${x.owned
        ? `<div class="note">this package is in your plan. <button class="btn-text" data-go="progress">see its progress</button></div>`
        : x.quote === 'ask' ? (x.requested ? '<div class="note">route requested. we will reply with your route and the fee.</div>' : routeForm(x))
        : x.client_has ? `<div class="note">you told us you already have this. <button class="btn-text" data-have="${x.id}" data-on="0">undo</button></div>`
        : tk ? `<div class="note">you chose ${esc(tk.package.name)}. you only need one of these.</div>`
        : x.assess === 'verify' ? `<div class="note">${x.fee_pending ? 'we are confirming the fee for this. we will let you know before you pay anything.' : 'we are checking whether you need this. we will confirm it with you before you pay anything.'}</div>`
        : blockedNeed(x) ? `<div class="note">this comes after ${esc(blockedNeed(x).package.name)}, which is not in your plan. ask us if you are not sure.</div>`
        : `<button class="btn ${on ? 'btn-ghost' : 'btn-primary'} btn-block" type="button" data-toggle="${x.id}">${on ? 'remove from my slip' : 'add to my slip · ' + esc(price(x))}</button>
           ${on ? '' : `<p class="tc mt-12"><button class="btn-text" data-have="${x.id}" data-on="1">i already have this</button></p>`}`}</div>
    </div>`;
  }

  /* ---------- checkout ---------- */
  let method = null;
  function checkoutScreen() {
    const sel = roadmapOrder([...selected].map(item).filter(Boolean));
    if (!sel.length) { location.hash = 'roadmap'; return; }
    setTop('roadmap', 'my roadmap'); updateCart(false);
    const sub = sel.reduce((s, x) => s + x.package.price_minor, 0), vat = sel.reduce((s, x) => s + vatOf(x), 0), total = sub + vat;
    const outside = sel.filter(x => x.package.external);
    const pay = me.payment;
    if (!method) method = pay.paystack ? 'paystack' : 'transfer';
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">activate</span><h1 class="hello">activate your roadmap.</h1>
      <p class="muted">your work starts as soon as your payment is confirmed.</p>
      <div class="card mt-16">${sel.map(x => `<div class="line-item"><span>${esc(x.package.name)}<br><span class="tiny muted">${esc(vname(x.package.venture))}${x.package.duration && x.package.basis !== 'monthly' ? ' · ' + esc(x.package.duration) : ''}</span></span><b>${esc(price(x))}</b></div>`).join('')}
        ${vat ? `<div class="line-item sub"><span>fees</span><b>${naira(sub)}</b></div><div class="line-item sub"><span>vat (${pct()})</span><b>${naira(vat)}</b></div>` : ''}
        <div class="line-total"><span>total today</span><span>${naira(total)}</span></div>
        <p class="tiny muted mt-8">billed by ${esc(pr().entity_name)}${vat ? '' : '. no vat is charged on these fees'}.</p></div>
      ${outside.length ? `<div class="note mt-12"><b>please note:</b> ${outside.map(x => esc(x.package.external)).join(' ')}</div>` : ''}
      ${sel.some(x => x.package.basis === 'monthly') ? `<div class="note mt-12">monthly services: today covers the first month. after that, ${method === 'paystack' ? 'we charge the same card each month' : 'we send you an invoice each month'}, and you can stop any time before the next month.</div>` : ''}
      <h2 class="h-section">how would you like to pay?</h2>
      <div role="radiogroup" aria-label="payment method">
        ${pay.paystack ? `<button class="pay-opt" type="button" role="radio" data-method="paystack" aria-checked="${method === 'paystack'}"><span class="mark"></span><span><b>pay online</b><span>card, bank transfer or ussd, through paystack.</span></span></button>` : ''}
        ${pay.transfer ? `<button class="pay-opt" type="button" role="radio" data-method="transfer" aria-checked="${method === 'transfer'}"><span class="mark"></span><span><b>bank transfer</b><span>pay into our account, then tell us. we confirm it for you.</span></span></button>` : ''}
      </div>
      <div class="field mt-12" id="emailBox" ${method === 'paystack' ? '' : 'hidden'}><label for="payEmail">email for your receipt</label><input id="payEmail" class="input" type="email" inputmode="email" autocomplete="email"></div>
      <label class="check mt-16"><input type="checkbox" id="terms"><span>i accept the <a href="/terms" target="_blank" rel="noopener">terms of service</a> and this proposal for the services above.</span></label>
      <div class="error mt-12" id="payErr" role="alert" hidden></div>
      ${checking() ? '<div class="note mt-16">we are confirming your last payment. once it is confirmed, you can activate more.</div>' : `<button class="btn btn-primary btn-block mt-16" id="payBtn">pay ${naira(total)} and activate</button>`}
      <p class="muted small mt-16">you pay only for what is above. the rest of your roadmap stays here for when you are ready.</p></div>`;
    app.querySelectorAll('[data-method]').forEach(b => b.addEventListener('click', () => { method = b.dataset.method; checkoutScreen(); }));
    if ($('payBtn')) $('payBtn').addEventListener('click', async () => {
      const b = $('payBtn'), err = $('payErr'); err.hidden = true;
      if (!$('terms').checked) { err.textContent = 'please read and accept the terms to continue.'; err.hidden = false; $('terms').focus(); return; }
      b.disabled = true; b.textContent = 'please wait...';
      try {
        const d = await api('/api/client/checkout', { items: sel.map(x => x.id), method, accept_terms: true, email: method === 'paystack' ? $('payEmail').value.trim() : '' });
        if (d.redirect) { selected.clear(); keep(); location.href = d.redirect; return; }
        selected.clear(); keep(); me = await api('/api/client/me'); location.hash = 'pay';
      } catch (ex) { err.textContent = String(ex.message).toLowerCase(); err.hidden = false; b.disabled = false; b.textContent = 'pay ' + naira(total) + ' and activate'; }
    });
  }

  function cardPaymentScreen(o, monthly) {
    app.innerHTML = `<div class="fade-in"><span class="eyebrow">card payment</span><h1 class="hello">check your payment.</h1><p class="muted">we confirm this payment with the payment provider. please check its status before sending another payment.</p><div class="facts"><div class="fact"><small>reference</small><strong>${esc(o.reference)}</strong></div></div><button class="btn btn-primary btn-block" id="checkCard">check payment status</button>${monthly ? `<div class="field mt-24"><label for="invEmail">email for your receipt</label><input id="invEmail" class="input" type="email" value="${esc(me.email || '')}"></div><button class="btn btn-ghost btn-block" data-inv-card="${o.id}">retry by card if the last attempt failed</button>` : '<p class="muted small mt-16">if you did not complete checkout, return to your roadmap to choose a new payment.</p>'}<button class="btn btn-ghost btn-block mt-16" data-go="${monthly ? 'home' : 'roadmap'}">${monthly ? 'home' : 'return to roadmap'}</button><p id="cardStatus" role="status" class="muted mt-16"></p></div>`;
    $('checkCard').addEventListener('click', async () => {
      const b = $('checkCard'); b.disabled = true;
      try {
        const d = await api(`/api/client/orders/${o.id}/check`, {}); await fresh();
        if (d.status !== 'pending') { toast(d.status === 'paid' ? 'payment confirmed. thank you.' : 'payment status updated.'); route(); }
        else $('cardStatus').textContent = 'payment is still unconfirmed. please check again later or contact the desk.';
      } catch (ex) { $('cardStatus').textContent = String(ex.message).toLowerCase(); }
      finally { b.disabled = false; }
    });
  }

  function payScreen() {
    const o = openOrder(); if (!o) return homeScreen();
    setTop('home', 'home'); updateCart(false);
    const waiting = o.status === 'awaiting_confirmation';
    if (o.method === 'paystack' && !waiting) return cardPaymentScreen(o, false);
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">bank transfer</span><h1 class="hello">${waiting ? 'thank you. we are confirming it.' : 'pay ' + naira(o.total_minor) + '.'}</h1>
      <p class="muted">${waiting ? 'you will see your onboarding as soon as we confirm your payment. you do not need to do anything else.' : 'transfer the exact amount, using your payment reference.'}</p>
      <div class="facts"><div class="fact"><small>amount</small><strong>${naira(o.total_minor)}</strong></div><div class="fact"><small>reference</small><strong>${esc(o.reference)}</strong></div></div>
      ${o.vat_minor ? `<p class="tiny muted">includes vat of ${naira(o.vat_minor)}.</p>` : ''}
      <div class="bank">${esc(me.payment.bank_details)}</div>
      ${waiting ? '' : `<div class="field mt-24"><label for="tNote">anything we should know? <span class="muted">(optional)</span></label><input id="tNote" class="input" placeholder="for example: paid from my gtbank account"></div>
        <div class="error" id="tErr" role="alert" hidden></div>
        <button class="btn btn-primary btn-block mt-8" id="tBtn">i have made the transfer</button>`}
      <p class="muted small mt-16">never share your card pin, otp or banking password with anyone, including us.</p></div>`;
    const b = $('tBtn');
    if (b) b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'sending...';
      try { await api(`/api/client/orders/${o.id}/transfer`, { note: $('tNote').value }); me = await api('/api/client/me'); toast('thank you. we will confirm your payment.'); payScreen(); }
      catch (ex) { $('tErr').textContent = String(ex.message).toLowerCase(); $('tErr').hidden = false; b.disabled = false; b.textContent = 'i have made the transfer'; }
    });
  }

  function invoiceScreen(id) {
    const o = invoice(id); if (!o) return homeScreen();
    setTop('home', 'home'); updateCart(false);
    const waiting = o.status === 'awaiting_confirmation';
    if (o.method === 'paystack' && !waiting) return cardPaymentScreen(o, true);
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">monthly invoice · ${esc(o.name)}</span><h1 class="hello">${waiting ? 'thank you. we are confirming it.' : 'pay ' + naira(o.total_minor) + '.'}</h1>
      <p class="muted">${waiting ? 'your service carries on while we confirm it.' : 'transfer the exact amount, using this reference.'}</p>
      <div class="facts"><div class="fact"><small>amount</small><strong>${naira(o.total_minor)}</strong></div><div class="fact"><small>reference</small><strong>${esc(o.reference)}</strong></div></div>
      ${o.vat_minor ? `<p class="tiny muted">includes vat of ${naira(o.vat_minor)}.</p>` : ''}
      ${!waiting && me.payment.paystack ? `<h2 class="h-section">pay by card</h2><div class="field"><label for="invEmail">email for your receipt</label><input id="invEmail" class="input" type="email" inputmode="email" autocomplete="email"></div>
        <button class="btn btn-primary btn-block" type="button" data-inv-card="${o.id}">pay ${naira(o.total_minor)} by card</button><h2 class="h-section">or pay by transfer</h2>` : ''}
      <div class="bank">${esc(me.payment.bank_details)}</div>
      ${waiting ? '' : `<div class="error mt-12" id="iErr" role="alert" hidden></div><button class="btn ${me.payment.paystack ? 'btn-ghost' : 'btn-primary'} btn-block mt-16" id="iBtn">i have made the transfer</button>`}
      <p class="muted small mt-16">never share your card pin, otp or banking password with anyone, including us.</p></div>`;
    const b = $('iBtn');
    if (b) b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'sending...';
      try { await api(`/api/client/orders/${o.id}/transfer`, { note: '' }); await fresh(); toast('thank you. we will confirm your payment.'); invoiceScreen(id); }
      catch (ex) { $('iErr').textContent = String(ex.message).toLowerCase(); $('iErr').hidden = false; b.disabled = false; b.textContent = 'i have made the transfer'; }
    });
  }

  /* ---------- my files: agreements, deliverables, uploads, handover ---------- */
  function filesScreen() {
    setTop('home', 'home'); updateCart(false);
    const owned = items().filter(x => x.owned), ag = me.agreements || [];
    const delivered = owned.filter(x => x.engagement.status === 'delivered');
    const uploads = owned.filter(x => Object.keys(x.engagement.attachments || {}).length);
    const hand = owned.filter(x => ((x.engagement.handover || {}).accounts || []).length);
    const sec = (title, body) => `<h2 class="h-section">${title}</h2>${body}`;
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">${esc(me.business || me.ref)}</span><h1 class="hello">my files and agreements.</h1>
      <p class="muted">everything here is private to you. sign in to open it. please keep your own copies of finished work.</p>
      ${sec('agreements', ag.length ? `<div class="card">${ag.map(o => `<div class="line-item"><span>proposal accepted ${esc(day(o.accepted_at))}<br><span class="tiny muted">${esc(o.reference)} · terms version ${esc(o.terms_version)} · ${esc(o.status === 'paid' ? 'paid' : o.status === 'refunded' ? 'refunded' : o.status === 'refund_due' ? 'refund on its way' : o.status === 'awaiting_confirmation' ? 'payment being confirmed' : 'awaiting payment')}</span></span><b>${naira(o.total_minor)}</b></div>`).join('')}
        <p class="tiny muted mt-8"><a href="/terms" target="_blank" rel="noopener">read the terms</a> · <a href="/privacy" target="_blank" rel="noopener">privacy note</a></p></div>` : '<p class="muted small">nothing accepted yet.</p>')}
      ${sec('finished work', delivered.length ? `<div class="card">${delivered.map(x => `<div class="line-item"><span>${esc(x.package.name)}<br><span class="tiny muted">${x.engagement.file_removed ? 'removed after 12 months' : x.engagement.has_file ? 'available until ' + esc(day(x.engagement.files_until)) : 'delivered'}</span></span>${x.engagement.has_file ? `<a class="btn btn-ghost btn-sm" href="/api/client/engagements/${x.engagement.id}/download">download</a>` : ''}</div>`).join('')}</div>` : '<p class="muted small">nothing delivered yet.</p>')}
      ${hand.length ? sec('your accounts', `<div class="card">${hand.map(x => `<div class="handover"><b>${esc(x.package.name)}</b>${x.engagement.handover.accounts.map(a => `<div class="small mt-4">${esc(a.service)}: ${esc(a.login_url)} · ${esc(a.account_email)}${a.recovery_owner ? ` · recovery: ${esc(a.recovery_owner)}` : ''}</div>`).join('')}</div>`).join('')}
        <p class="tiny muted mt-8">we never keep your passwords. if you are missing access to any account, message us.</p></div>`) : ''}
      ${sec('documents you sent us', uploads.length ? `<div class="card">${uploads.map(x => `<div class="line-item"><span>${esc(x.package.name)}<br><span class="tiny muted">${Object.values(x.engagement.attachments).map(esc).join(', ')}</span></span></div>`).join('')}
        <p class="tiny muted mt-8">we remove these within 90 days after the work is delivered.</p></div>` : '<p class="muted small">none.</p>')}
    </div>`;
  }

  /* ---------- onboarding ---------- */
  function onboardingScreen() {
    const todo = items().filter(x => x.owned && x.engagement.status === 'awaiting_onboarding');
    if (!todo.length) { location.hash = 'progress'; return; }
    setTop('home', 'home'); updateCart(false);
    const x = todo[0], all = items().filter(i => i.owned && i.package.onboarding.length).length, n = all - todo.length + 1;
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">onboarding · ${n} of ${all}</span><h1 class="hello">${esc(x.package.name)}</h1>
      <p class="muted">a few details so the ${esc(vname(x.package.venture))} team can start. each one says why we need it.</p>
      ${x.package.onboarding.some(q => q.kind === 'file') ? `<div class="ready-list"><b>have these ready:</b> ${x.package.onboarding.filter(q => q.kind === 'file').map(q => esc(q.label) + (q.required === false ? ' (optional)' : '')).join(', ')}.</div>` : ''}
      <form id="onbForm" class="mt-24" novalidate>${x.package.onboarding.map((q, k) => {
        const id = 'ob' + k, opt = q.required !== false ? '' : ' <span class="opt-tag">optional</span>';
        const why = q.why ? `<p class="why"><b>why we ask:</b> ${esc(q.why)}</p>` : '';
        const head = `<label for="${id}">${esc(q.label)}${opt}</label>${why}`;
        if (q.kind === 'file') {
          const got = (x.engagement.attachments || {})[String(k)];
          return `<div class="field req req-file">${head}
            <div class="upl ${got ? 'done' : ''}" id="upl${k}">
              <span class="upl-name">${got ? '&#10003; ' + esc(got) : 'no file yet'}</span>
              <label class="btn btn-ghost btn-sm upl-btn" for="${id}">${got ? 'replace' : 'attach a file'}</label>
              <input id="${id}" type="file" class="upl-input" data-file="${k}" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.zip,.txt,.csv">
            </div><p class="tiny muted mt-4">pdf, word, excel, image or zip, up to 25 mb.</p></div>`;
        }
        if (q.kind === 'choice' && q.options && q.options.length) return `<div class="field req">${head}<select id="${id}" data-q="${esc(q.label)}"><option value="">choose one</option>${q.options.map(o => `<option>${esc(o)}</option>`).join('')}</select></div>`;
        if (q.kind === 'long') return `<div class="field req">${head}<textarea id="${id}" data-q="${esc(q.label)}" rows="4" maxlength="3000"></textarea></div>`;
        return `<div class="field req">${head}<input id="${id}" class="input" data-q="${esc(q.label)}" maxlength="3000"></div>`;
      }).join('')}
      <p class="help">your files go only to the team doing your work. please do not share passwords or card details. if we need account access, we will arrange it safely with you.</p>
      <div class="error mt-12" id="obErr" role="alert" hidden></div>
      <button class="btn btn-primary btn-block mt-16" id="obBtn">${todo.length > 1 ? 'save and continue' : 'save and finish'}</button></form></div>`;
    app.querySelectorAll('[data-file]').forEach(inp => inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      const k = inp.dataset.file, box = $('upl' + k), nm = box.querySelector('.upl-name');
      if (f.size > 25 * 1024 * 1024) { toast('that file is larger than 25 mb.'); inp.value = ''; return; }
      nm.textContent = 'uploading ' + f.name + '...'; box.classList.remove('done');
      try {
        const d = await upload(`/api/client/engagements/${x.engagement.id}/attachment?q=${k}`, f);
        x.engagement.attachments = { ...(x.engagement.attachments || {}), [k]: d.name };
        nm.innerHTML = '&#10003; ' + esc(d.name); box.classList.add('done'); box.querySelector('.upl-btn').textContent = 'replace'; $('obErr').hidden = true;
      } catch (ex) { nm.textContent = String(ex.message).toLowerCase(); }
      inp.value = '';
    }));
    $('onbForm').addEventListener('submit', async e => {
      e.preventDefault();
      const answers = {}; app.querySelectorAll('[data-q]').forEach(el => { answers[el.dataset.q] = el.value; });
      const b = $('obBtn'); b.disabled = true; b.textContent = 'saving...';
      try { await api(`/api/client/engagements/${x.engagement.id}/onboarding`, { answers }); me = await api('/api/client/me'); toast('thank you. details received.'); onboardingScreen(); }
      catch (ex) { $('obErr').textContent = String(ex.message).toLowerCase(); $('obErr').hidden = false; b.disabled = false; b.textContent = 'try again'; }
    });
  }

  /* ---------- progress ---------- */
  function progressScreen() {
    if (!me.recommendation) return homeScreen();
    setTop('home', 'home'); updateCart();
    const all = roadmapOrder(items()), owned = all.filter(x => x.owned);
    const groups = ALL.map((L, k) => [LNAME(L), all.filter(x => lvl(x) === k && !x.client_has && !groupTaken(x))]).filter(([, l]) => l.length);
    const ownedCard = x => {
      const e = x.engagement, done = e.status === 'delivered';
      return `<article class="work"><div class="work-top">${vtag(x.package.venture)}<h3>${esc(x.package.name)}</h3><span class="dot ${done ? 'dot-done' : 'dot-now'}">${esc(e.status_label)}</span></div>
        <div class="bar ${done ? 'done' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e.progress}" aria-label="${esc(x.package.name)} progress"><i data-w="${Number(e.progress) || 0}"></i></div>
        <div class="work-foot"><span>${e.progress}% ${done && e.delivered_at ? '· delivered ' + esc(day(e.delivered_at)) : ''}</span>
        ${done && e.has_file ? `<a class="btn btn-primary btn-sm" href="/api/client/engagements/${e.id}/download">download</a>` : e.status === 'awaiting_onboarding' ? '<button class="btn btn-ghost btn-sm" data-go="onboarding">add details</button>'
          : !done ? (e.asked_at ? '<span class="tiny muted">update requested</span>' : `<button class="btn btn-ghost btn-sm" data-ask="${e.id}">ask for an update</button>`) : ''}</div>
        ${done && e.files_until && e.has_file ? `<p class="tiny muted mt-8">available here until ${esc(day(e.files_until))}. please keep your own copy.</p>` : ''}</article>`;
    };
    const lockedCard = x => `<article class="work locked"><div class="work-top">${vtag(x.package.venture)}<h3>${esc(x.package.name)}</h3>${pill(x)}</div>
        ${(x.note || x.package.summary) ? `<p class="why-line">${esc(x.note || x.package.summary)}</p>` : ''}
        <div class="work-foot mt-12"><span>${x.package.duration ? esc(x.package.duration) : ''}</span>
        <span class="row"><button class="btn-text tiny" data-go="package-${x.id}">see inside</button>${!addable(x) ? `<button class="btn btn-ghost btn-sm" data-go="package-${x.id}">${x.quote === 'ask' ? 'get my route' : 'see details'}</button>` : `<button class="btn btn-primary btn-sm" data-unlock="${x.id}">add · ${esc(price(x))}</button>`}</span></div></article>`;
    app.innerHTML = `<div class="fade-in">
      <span class="eyebrow">your roadmap</span><h1 class="hello">your progress.</h1>
      <p class="muted">${owned.length ? `${owned.filter(x => x.engagement.status === 'delivered').length} of ${owned.length} of your packages delivered.` : 'nothing has started yet.'} the rest of your roadmap waits here. add it when you are ready.</p>
      ${groups.map(([st, list]) => `<div class="stage-group"><div class="stage-name">${esc(st)}</div>${list.map(x => x.owned ? ownedCard(x) : lockedCard(x)).join('')}</div>`).join('')}
      ${me.updates.length ? `<h2 class="h-section">updates</h2><div class="card">${me.updates.map(updateHtml).join('')}</div>` : ''}</div>`;
    requestAnimationFrame(() => app.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; }));
  }

  load();
})();
