/* hamzury staff desk v4: clients, recommendation builder, catalogue, payments, delivery, team. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const naira = m => '₦' + new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format((m || 0) / 100);
  const day = d => d ? new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase() : '';
  const label = s => String(s || '').replaceAll('_', ' ');
  const VENTURES = ['bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin'];
  const OWNERS = [...VENTURES, 'holding', 'finance'];
  const URGENCY = [[1, 'needed now'], [2, 'needed soon'], [3, 'optional']];
  const UPILL = { 1: ['needed now', 'u-now'], 2: ['needed soon', 'u-soon'], 3: ['optional', 'u-opt'] };
  const BASES = [['fixed', 'fixed fee'], ['from', 'from (starting fee)'], ['monthly', 'per month'], ['session', 'per session'], ['request', 'per request'], ['workflow', 'per workflow'], ['quote', 'quoted after questions']];
  const BASIS_WORD = { from: 'from ', monthly: ' / month', session: ' per session', request: ' per request', workflow: ' per workflow' };
  const fee = p => p.basis === 'quote' ? 'quoted after questions' : (p.basis === 'from' ? 'from ' : '') + naira(p.price_minor) + (p.basis !== 'from' ? (BASIS_WORD[p.basis] || '') : '');
  const FORMATS = ['file', 'document', 'workbook', 'folder', 'bundle', 'workspace', 'website', 'guide', 'service'];

  const STAGES = ['awareness', 'strategy', 'structure', 'systems', 'success'];
  const PATHS = { contract: 'won a contract', start: 'starting a business', grow: 'has a business', service: 'knows the service', partnership: 'partnership', quick: 'fast request' };
  const INTAKE = [['route', 'route'], ['urgency', 'how soon'], ['path', 'where they are'], ['business', 'business'], ['industry', 'what they do'], ['stage', 'how far along'], ['registered', 'registered with cac'],
    ['situation', 'their situation'], ['details', 'details'], ['format', 'how they want to learn'], ['goal', 'what matters most'],
    ['challenge', 'what slows them down'], ['note', 'in their words'], ['needs', 'want us to take on'], ['tried', 'tried so far'], ['impact', 'when it is sorted'], ['importance', 'how much it matters (1-10)'],
    ['timing', 'start'], ['team', 'team size'], ['location', 'location'], ['venture', 'came through'], ['src', 'came from']];
  const intakeValue = (c, k) => { let v = c.intake[k]; if (k === 'path') v = PATHS[v] || v; if (k === 'route') v = v === 'quick' ? 'fast (urgent)' : v === 'full' ? 'full picture' : v === 'venture' ? 'venture questions' : v; if (k === 'src') v = ({ wa: 'whatsapp', tt: 'tiktok', ig: 'instagram', fb: 'facebook', bn: 'banner' })[v] || v;
    if (Array.isArray(v)) v = v.map(x => x === 'other' ? 'other: ' + (c.intake[k + '_other'] || '') : x).join(', '); return v; };
  const vtag = v => `<span class="vtag v-${esc(v)}">${esc(v === 'hub' ? 'hamzury hub' : v)}</span>`;
  const priceTag = p => p.price_status === 'approved' ? '' : ' <span class="badge badge-soon">price to approve</span>';
  const badge = (s) => {
    const cls = { new: 'badge-soon', reviewing: 'badge-soon', recommended: '', active: 'badge-done', completed: 'badge-done', closed: 'badge-lock',
      awaiting_confirmation: 'badge-soon', pending: 'badge-lock', paid: 'badge-done', refund_due: 'badge-late', published: 'badge-done', draft: 'badge-soon',
      overdue: 'badge-late', due_soon: 'badge-soon', on_track: 'badge-done', delivered: 'badge-done', review: 'badge-soon', awaiting_onboarding: 'badge-lock', onboarding_received: 'badge-soon' }[s] || '';
    const words = { awaiting_confirmation: 'transfer to confirm', pending: 'not paid yet', refund_due: 'paid, refund due', overdue: 'update overdue', due_soon: 'update due soon', on_track: 'on track', not_required: '' };
    const w = s in words ? words[s] : label(s);
    return w ? `<span class="badge ${cls}">${esc(w)}</span>` : '';
  };
  let me = null, csrf = '', packages = [], staffList = [];

  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const headers = { ...(opts.method && opts.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}), ...(isForm || !opts.body ? {} : { 'Content-Type': 'application/json' }) };
    const r = await fetch(path, { credentials: 'same-origin', ...opts, headers, body: isForm ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined) });
    const d = await r.json().catch(() => ({}));
    const accountChallenge = path.startsWith('/api/account/') || /^\/api\/users\/\d+\/(password|email)$/.test(path);
    if (r.status === 401 && path !== '/api/login' && !accountChallenge) { showLogin(); throw new Error('please sign in'); }
    if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : (Array.isArray(d.detail) ? d.detail.map(x => (x.loc || []).slice(-1)[0] + ': ' + x.msg).join('; ') : 'request failed'));
    return d;
  }
  // files go straight to private storage with a one-time signature, then the server checks them. without one, they are posted here.
  async function upload(path, file) {
    const s = await api(path, { method: 'POST', body: { upload: 'sign', name: file.name, size: file.size } });
    const fd = new FormData();
    if (s.direct) { fd.append('file', file); return api(path, { method: 'POST', body: fd }); }
    Object.entries(s.fields).forEach(([k, v]) => fd.append(k, v)); fd.append('file', file);
    const up = await fetch(s.url, { method: 'POST', body: fd });
    if (!up.ok) throw new Error('upload failed. please try again.');
    return api(path, { method: 'POST', body: { upload: 'done', name: file.name, ticket: s.ticket } });
  }
  function toast(m, bad) { const t = $('toast'); t.textContent = m; t.hidden = false; t.style.background = bad ? '#8e2a20' : ''; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200); }
  const holding = () => me && ['holding_owner', 'holding_admin'].includes(me.role);
  let UPDATE_EVERY = 48;
  const finance = () => me && me.role === 'finance';
  const moneyRole = () => holding() || finance();
  const main = () => $('main');
  const head = (title, sub, right = '') => `<div class="desk-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="row">${right}</div></div>`;
  const toMinor = v => Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100);

  /* ---------- auth ---------- */
  function showLogin() { $('deskView').hidden = true; $('loginView').hidden = false; }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('le').hidden = true; $('lb').disabled = true;
    try { const d = await api('/api/login', { method: 'POST', body: { email: $('lu').value.trim(), password: $('lp').value, otp: $('lotp').value } }); me = d.user; csrf = d.csrf; $('lp').value = ''; $('lotp').value = ''; start(); }
    catch (ex) { $('le').textContent = ex.message; $('le').hidden = false; }
    $('lb').disabled = false;
  });
  $('logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ } location.reload(); });
  $('menuBtn').addEventListener('click', () => $('side').classList.toggle('open'));

  async function start() {
    $('loginView').hidden = true; $('deskView').hidden = false;
    $('who').innerHTML = `<b>${esc(me.display_name)}</b> · ${esc(label(me.role))}${me.venture ? ' · ' + esc(me.venture) : ''}`;
    document.querySelectorAll('[data-holding]').forEach(x => { x.hidden = !holding(); });
    document.querySelectorAll('[data-money]').forEach(x => { x.hidden = !moneyRole(); });
    if (finance()) {
      document.querySelectorAll('[data-nav="delivery"]').forEach(x => { x.hidden = true; });
      document.querySelector('.side-foot').innerHTML = '<b>finance desk</b>confirm transfers, watch monthly billing, close refunds and keep vat and the books right.<p class="mt-12 tiny">part of hamzury holding</p>';
    }
    if (!holding() && me.venture) {
      // a venture desk wears the venture's own identity
      document.body.classList.add('theme-' + me.venture);
      const logo = document.querySelector('#side > img'); logo.src = '/static/img/' + me.venture + '.png'; logo.alt = me.venture;
      document.querySelector('[data-nav="delivery"] span').textContent = 'my work';
      document.querySelector('.side-foot').innerHTML = '<b>how we work</b>do the work, upload the file, then send a report to holding. holding updates the client.<p class="mt-12 tiny">part of hamzury holding</p>';
    }
    if (me.mfa_required && !me.mfa_enabled) { location.hash = 'security'; securityView(); return; }
    try { packages = await api('/api/admin/packages'); if (holding()) staffList = await api('/api/users'); } catch (e) { /* shown per view */ }
    route();
  }
  document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.nav; $('side').classList.remove('open'); }));
  window.addEventListener('hashchange', route);
  async function route() {
    const h = location.hash.slice(1) || 'overview';
    const nav = h.startsWith('client-') ? 'clients' : h;
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === nav));
    window.scrollTo({ top: 0 });
    try {
      if (h.startsWith('client-')) return await clientView(Number(h.slice(7)));
      await ({ security: securityView, money: moneyView, ventures: scoreboardView, clients: clientsView, payments: paymentsView, delivery: deliveryView, catalogue: catalogueView, team: teamView, followups: followupsView, insights: insightsView, kit: kitView }[h] || overviewView)();
    } catch (ex) { if (ex.message !== 'please sign in') main().innerHTML = `<div class="error">${esc(ex.message)}</div>`; }
  }

  /* ---------- today ---------- */
  async function overviewView() {
    if (finance()) return financeToday();
    const o = await api('/api/admin/overview');
    if (!holding()) {
      const n = s => (o.work.find(w => w.status === s) || {}).n || 0;
      main().innerHTML = head('today', `work for ${o.venture}. holding assigns it, you deliver it and report back.`) + `<div class="stats">
        <button class="stat ${o.assigned_to_me ? 'alert' : ''}" data-go="delivery"><span>assigned to you</span><strong>${o.assigned_to_me}</strong><small>open packages</small></button>
        <button class="stat ${o.returned ? 'alert' : ''}" data-go="delivery"><span>reports returned</span><strong>${o.returned}</strong><small>holding asked for changes</small></button>
        <button class="stat" data-go="delivery"><span>waiting for holding</span><strong>${o.waiting_for_holding}</strong><small>reports being reviewed</small></button>
        ${[['details received', n('onboarding_received'), 'ready to start'], ['in progress', n('in_progress'), ''], ['final check', n('review'), 'with holding'], ['delivered', n('delivered'), '']]
          .map(([a, b, c]) => `<button class="stat" data-go="delivery"><span>${a}</span><strong>${b}</strong><small>${c}</small></button>`).join('')}</div>`;
      $('cWork').textContent = o.assigned_to_me || '';
      bindGo(); return;
    }
    UPDATE_EVERY = o.update_hours || UPDATE_EVERY;
    api('/api/admin/nudges').then(n => { $('cFollow').textContent = n.length || ''; }).catch(() => {});
    $('cNew').textContent = o.new_clients || ''; $('cPay').textContent = o.payments_to_confirm || ''; $('cWork').textContent = (o.reports_to_review + o.unassigned) || '';
    const [clients, orders] = await Promise.all([api('/api/admin/clients'), api('/api/admin/orders')]);
    const newOnes = clients.filter(c => ['new', 'reviewing'].includes(c.status));
    const pay = orders.filter(x => x.status === 'awaiting_confirmation');
    const due = clients.filter(c => ['due_soon', 'overdue'].includes(c.update_state));
    main().innerHTML = head('today', 'what needs a decision, a reply or an update.') + `<div class="stats">
      <button class="stat ${o.new_clients ? 'alert' : ''}" data-go="clients"><span>new clients</span><strong>${o.new_clients}</strong><small>need a recommendation</small></button>
      <button class="stat ${o.payments_to_confirm ? 'alert' : ''}" data-go="payments"><span>transfers to confirm</span><strong>${o.payments_to_confirm}</strong><small>check your bank, then confirm</small></button>
      <button class="stat" data-go="delivery"><span>details received</span><strong>${o.onboarding_received}</strong><small>ready to start work</small></button>
      <button class="stat ${o.reports_to_review ? 'alert' : ''}" data-go="delivery"><span>venture reports</span><strong>${o.reports_to_review}</strong><small>review, then publish to the client</small></button>
      <button class="stat ${o.unassigned ? 'alert' : ''}" data-go="delivery"><span>not assigned yet</span><strong>${o.unassigned}</strong><small>paid packages without an owner</small></button>
      <button class="stat" data-go="delivery"><span>final checks</span><strong>${o.in_review}</strong><small>ready for holding to deliver</small></button>
      <button class="stat ${o.overdue ? 'alert' : ''}" data-go="clients"><span>updates due</span><strong>${o.updates_due}</strong><small>${o.overdue} past ${o.update_hours} hours</small></button>
      <div class="stat"><span>paid</span><strong>${naira(o.revenue_paid_minor)}</strong><small>all confirmed payments</small></div></div>
      <div class="panel"><div class="panel-h"><h2>prepare a recommendation</h2></div>${newOnes.length ? clientTable(newOnes) : '<div class="empty">every new client has a recommendation.</div>'}</div>
      <div class="panel"><div class="panel-h"><h2>transfers to confirm</h2></div>${pay.length ? orderTable(pay) : '<div class="empty">nothing to confirm.</div>'}</div>
      ${due.length ? `<div class="panel"><div class="panel-h"><h2>clients waiting for an update</h2></div>${clientTable(due)}</div>` : ''}`;
    bindGo(); bindOrders();
  }
  function bindGo() { main().querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.go; })); }

  /* ---------- clients ---------- */
  function clientTable(list) {
    return `<div class="tbl"><table><thead><tr><th>id</th><th>client</th><th>situation</th><th>status</th><th>recommendation</th><th>paid</th><th>updates</th></tr></thead><tbody>
      ${list.map(c => `<tr class="click" data-go="client-${c.id}"><td><b>${esc(c.ref)}</b><div class="tiny muted">${esc(day(c.created_at))}</div></td>
        <td><b>${esc(c.business || c.name)}</b><div class="tiny muted">${esc(c.name)} · ${esc(c.phone)}</div></td>
        <td class="small">${c.intake.route === 'quick' ? '<span class="badge badge-late">urgent</span> ' : ''}${esc(PATHS[c.path] || c.path)}<div class="tiny muted">${esc((c.intake.needs || []).map(x => x === 'other' ? (c.intake.needs_other || 'other') : x).join(', '))}</div>${c.source && c.source !== 'holding' ? `<div class="mt-4">${vtag(c.source)}</div>` : ''}${c.intake.src === 'wa' ? '<div class="tiny muted">from whatsapp</div>' : ''}</td>
        <td>${badge(c.status)}</td><td>${c.rec_status ? badge(c.rec_status) : '<span class="tiny muted">not started</span>'}</td>
        <td>${c.paid_minor ? naira(c.paid_minor) : '<span class="tiny muted">none</span>'}</td><td>${badge(c.update_state)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  async function clientsView() {
    const list = (await api('/api/admin/clients')).sort((x, y) => ((y.intake.route === 'quick' && y.status === 'new') - (x.intake.route === 'quick' && x.status === 'new')));
    main().innerHTML = head('clients', 'everyone who used start here. open a client to read their answers and build their recommendation.') +
      `<div class="panel">${list.length ? clientTable(list) : '<div class="empty">no clients yet. new ones appear here after start here.</div>'}</div>`;
    main().querySelectorAll('tr[data-go]').forEach(r => r.addEventListener('click', () => { location.hash = r.dataset.go; }));
  }

  let draft = null;
  async function clientView(id) {
    const c = await api('/api/admin/clients/' + id);
    const rec = c.recommendation;
    const ownedRec = new Set(c.engagements.map(e => e.rec_item_id));
    draft = { heard: rec ? rec.heard : '', advice: rec ? rec.advice : '', management: rec ? (rec.management || '') : '',
      items: rec ? rec.items.map(i => ({ package_id: i.package_id, price_minor: i.price_minor, note: i.note, priority: i.priority, stage: i.stage, level: i.level || 'standard', renewal: i.renewal || 'none', renewal_minor: i.renewal_minor || 0, quote: i.quote || 'fixed', assess: i.assess || '', owned: ownedRec.has(i.id), has: !!i.client_has, request: i.request || '', saved: !!i.client_saved })) : [] };
    const intakeRows = INTAKE.filter(([k]) => c.intake[k] && (!Array.isArray(c.intake[k]) || c.intake[k].length)).map(([k, l]) => `<dt>${esc(c.intake[k + '_q'] || l)}</dt><dd>${esc(intakeValue(c, k))}</dd>`).join('');
    main().innerHTML = `<p><button class="btn-text" data-go="clients">&#8249; all clients</button></p>` +
      head(`${c.business || c.name}`, `${c.ref} · ${c.name} · ${c.phone}${c.email ? ' · ' + c.email : ''}`, badge(c.status) + badge(c.update_state) + (c.intake.route === 'quick' ? '<span class="badge badge-late">urgent</span>' : '') + '<button class="sbtn primary" id="waBtn">message on whatsapp</button>') +
      `<div class="cols">
        <div>
          <div class="panel"><div class="panel-h"><h2>their answers</h2><span class="tiny muted">${esc(day(c.created_at))}</span></div><div class="panel-b"><dl class="kv">${intakeRows}</dl></div></div>
          <div class="panel"><div class="panel-h"><h2>relationship</h2></div><div class="panel-b">
            <div class="grid2"><div class="dfield"><label for="cStatus">status</label><select id="cStatus">${['new', 'reviewing', 'recommended', 'active', 'completed', 'closed'].map(s => `<option ${s === c.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
            <div class="dfield"><label for="cOwner">accountable contact</label><select id="cOwner"><option value="">not set</option>${staffList.filter(u => u.active).map(u => `<option value="${u.id}" ${u.id === c.owner_user_id ? 'selected' : ''}>${esc(u.display_name)}</option>`).join('')}</select></div></div>
            <div class="dfield"><label for="cEta">proposal ready (the client sees this while they wait)</label><select id="cEta">${['', 'today', 'within 2 working hours', 'within 4 working hours', 'by tomorrow', 'within 2 working days'].map(v => `<option value="${v}" ${v === (c.plan_eta || '') ? 'selected' : ''}>${v || 'soon, within working hours (default)'}</option>`).join('')}</select></div>
            <div class="dfield"><label for="cNotes">internal notes</label><textarea id="cNotes">${esc(c.notes)}</textarea></div>
            <button class="sbtn" id="saveRel">save</button></div></div>
        </div>
        <div>
          <div class="panel"><div class="panel-h"><h2>recommendation</h2>${rec ? badge(rec.status) : badge('draft')}</div><div class="panel-b">
            <div class="dfield"><label for="rHeard">what we heard (in the client's words)</label><textarea id="rHeard" placeholder="you have been trading for two years and orders on whatsapp are hard to track.">${esc(draft.heard)}</textarea></div>
            <div class="dfield"><label for="rAdvice">what we recommend, and why</label><textarea id="rAdvice" placeholder="start with a simple order tracker, then a brand refresh so new customers trust you.">${esc(draft.advice)}</textarea></div>
            <div class="dfield"><label for="rMgmt">after delivery (optional, shown in the proposal and pdf)</label><textarea id="rMgmt" placeholder="for example: what we look after once work is delivered, and how renewals work for this client.">${esc(draft.management)}</textarea></div>
            ${rec && rec.auto && rec.status !== 'published' ? '<div class="note small">drafted automatically from their answers. check each item, the urgency and the fees, then publish. the client only sees the plain focus lines until you do.</div>' : ''}
            <label class="dfield"><span class="tiny muted">roadmap items. the level groups them for reading. the urgency colour tells the client what to do first. nothing is locked: the client can choose any item, any time.</span></label>
            <div id="selWarn"></div>
            <div id="selItems"></div>
            <div class="row mt-8"><select id="catVenture" class="sbtn"><option value="">all teams</option>${OWNERS.map(v => `<option>${v}</option>`).join('')}</select><input id="catSearch" class="sbtn" placeholder="search name or code"><span class="tiny muted">add from the catalogue</span></div>
            <div id="catList" class="mt-8"></div>
            <div class="row mt-16"><button class="sbtn" id="saveRec">save draft</button><button class="sbtn primary" id="pubRec">${rec && rec.status === 'published' ? 'save and update for client' : 'publish to client'}</button>${rec && rec.status === 'published' ? '<button class="sbtn" id="recPdf">proposal pdf</button>' : ''}</div>
            <p class="tiny muted mt-8">the client sees it in their dashboard after you publish. tell them on whatsapp too.</p>
          </div></div>
        </div>
      </div>
      <div class="panel"><div class="panel-h"><h2>payments</h2></div>${c.orders.length ? orderTable(c.orders.map(o => ({ ...o, ref: c.ref, name: c.name, business: c.business, lines: [] }))) : '<div class="empty">no payments yet.</div>'}</div>
      <div class="panel"><div class="panel-h"><h2>packages bought</h2><button class="sbtn" data-go="delivery">open delivery</button></div>
        ${c.engagements.length ? `<div class="tbl"><table><thead><tr><th>package</th><th>status</th><th>progress</th><th>onboarding</th></tr></thead><tbody>${c.engagements.map(e => `<tr><td><b>${esc(e.name)}</b><div class="mt-4">${vtag(e.venture)}</div><div class="tiny muted mt-4">${e.assigned_user_id ? 'assigned to ' + esc((staffList.find(u => u.id === e.assigned_user_id) || {}).display_name || 'staff') : 'not assigned yet'}</div></td><td>${badge(e.status)}</td><td>${e.progress}%</td><td class="small">${Object.keys(e.onboarding).length ? Object.entries(e.onboarding).map(([q, a]) => `<div><span class="muted">${esc(q)}:</span> ${esc(a)}</div>`).join('') + attLinks(e) : '<span class="muted">not yet</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">nothing bought yet.</div>'}</div>
      <div class="panel"><div class="panel-h"><h2>client updates</h2>${badge(c.update_state)}</div><div class="panel-b">
        <div class="grid3"><div class="dfield"><label for="uProg">progress</label><textarea id="uProg" placeholder="we have finished your logo drafts."></textarea></div>
        <div class="dfield"><label for="uBlock">anything holding us back (optional)</label><textarea id="uBlock"></textarea></div>
        <div class="dfield"><label for="uNext">next step</label><textarea id="uNext" placeholder="review the drafts in your dashboard by friday."></textarea></div></div>
        <div class="row"><select id="uEng" class="sbtn"><option value="">overall</option>${c.engagements.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select><button class="sbtn primary" id="postUp">post update</button></div>
        <div id="upText"></div>
        <div class="mt-16">${c.updates.map(u => `<div class="cat-item"><span><b>${esc(day(u.created_at))}</b> · ${esc(u.author)}<br>${esc(u.progress)} <span class="muted">next: ${esc(u.next_action)}</span></span></div>`).join('') || '<p class="tiny muted">no updates yet.</p>'}</div>
      </div></div>
      <div class="panel"><div class="panel-h"><h2>activity</h2></div><div class="panel-b small">${c.activity.map(a => `<div class="cat-item"><span>${esc(label(a.event))} <span class="muted">${esc(a.summary)}</span></span><span class="tiny muted">${esc(a.actor)} · ${esc(day(a.at))}</span></div>`).join('')}</div></div>`;
    bindGo(); bindOrders();
    renderSel(); renderCat();
    $('waBtn').addEventListener('click', () => waModal(c, c.intake.route === 'quick' && c.status === 'new' ? 'quick_reply' : rec && rec.status === 'published' ? 'plan_reminder' : 'plan_coming'));
    $('catVenture').addEventListener('change', renderCat);
    $('catSearch').addEventListener('input', renderCat);
    $('saveRel').addEventListener('click', async () => {
      try { await api('/api/admin/clients/' + id, { method: 'PATCH', body: { status: $('cStatus').value, owner_user_id: $('cOwner').value ? Number($('cOwner').value) : null, notes: $('cNotes').value, plan_eta: $('cEta').value } }); toast('saved'); }
      catch (ex) { toast(ex.message, true); }
    });
    const saveRec = async () => {
      draft.heard = $('rHeard').value; draft.advice = $('rAdvice').value; draft.management = $('rMgmt').value;
      await api(`/api/admin/clients/${id}/recommendation`, { method: 'PUT', body: { heard: draft.heard, advice: draft.advice, management: draft.management, items: draft.items.map(({ owned, request, saved, ...x }) => x) } });
    };
    $('saveRec').addEventListener('click', async () => { try { await saveRec(); toast('draft saved'); } catch (ex) { toast(ex.message, true); } });
    $('pubRec').addEventListener('click', async () => {
      try { await saveRec(); await api(`/api/admin/clients/${id}/recommendation/publish`, { method: 'POST' }); toast('published. now send it on whatsapp.'); await clientView(id); waModal(c, 'plan_ready'); }
      catch (ex) { toast(ex.message, true); }
    });
    if ($('recPdf')) $('recPdf').addEventListener('click', async () => {
      const LV = ['minimum', 'standard', 'protection', 'scaling'];
      const MEAN = { renewals: 'keep everything current as you grow: renewals, filings, updates and changes.', minimum: 'the essentials your business needs to run properly.', standard: 'what makes you organised, trusted and easy to buy from.', protection: 'protect what you have built: records, data, money and people.', scaling: 'systems that let the business grow beyond you.' };
      const d = { first: c.name.split(' ')[0].toLowerCase(), name: c.name, business: c.business, ref: c.ref,
        date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).toLowerCase(),
        advice: rec.advice, management: rec.management || '',
        promises: ['you see every price before you decide. nothing starts until you choose.', 'one team looks after you. follow every step with your hamzury id, and hear from us within 48 hours while work is active.', 'we are honest about what we can promise. we never guarantee grants, income or growth.'],
        levels: [...LV, 'renewals'].map(L => ({ name: L === 'renewals' ? 'renewals and changes' : L, meaning: MEAN[L], items: rec.items.filter(x => (x.level || 'standard') === L).sort((p, q) => p.priority - q.priority)
          .map(x => { const pk = packages.find(p => p.id === x.package_id) || {}; return { name: x.name, venture: x.venture, vname: x.venture === 'hub' ? 'hamzury hub' : x.venture, why: x.note || pk.summary || '' }; }) })).filter(l => l.items.length) };
      try { const blob = await window.HZProposal.pdf(d); await window.HZProposal.save(blob, `hamzury-proposal-${c.ref.toLowerCase()}.pdf`, 'hamzury proposal'); toast('pdf ready. attach it on whatsapp.'); }
      catch (ex) { toast('could not make the pdf', true); }
    });
    $('postUp').addEventListener('click', async () => {
      try {
        const d = await api(`/api/admin/clients/${id}/updates`, { method: 'POST', body: { engagement_id: $('uEng').value ? Number($('uEng').value) : null, progress: $('uProg').value, blocker: $('uBlock').value, next_action: $('uNext').value } });
        toast('update posted. it is on their dashboard.');
        $('upText').innerHTML = `<div class="dfield mt-12"><label>whatsapp message</label><textarea readonly rows="8" id="waText">${esc(d.whatsapp_text)}</textarea></div><button class="sbtn" id="copyWa">copy message</button>`;
        $('copyWa').addEventListener('click', async () => { try { await navigator.clipboard.writeText(d.whatsapp_text); toast('copied'); } catch (e) { toast('select the text and copy it', true); } });
      } catch (ex) { toast(ex.message, true); }
    });
  }
  // what the desk should look at before publishing: alternatives, needs-first and overlaps
  function warnings() {
    const out = [], pk = it => packages.find(x => x.id === it.package_id) || {};
    const codes = new Set(draft.items.map(it => pk(it).code).filter(Boolean));
    const groups = {};
    draft.items.forEach(it => { const p = pk(it); if (p.group) (groups[p.group] = groups[p.group] || []).push(p.name); });
    Object.values(groups).filter(g => g.length > 1).forEach(g => out.push(['', `${g.join(' and ')} are alternatives. the client can choose one.`]));
    draft.items.forEach(it => { const p = pk(it); (p.requires || []).forEach(c => { if (!codes.has(c)) { const n = packages.find(x => x.code === c); out.push(['badge-late', `${p.name} needs ${n ? n.name : c} first. add it, or mark that the client has it.`]); } }); });
    const seen = new Set();
    draft.items.forEach(it => { const p = pk(it); (p.overlaps || []).forEach(c => { const k = [p.code, c].sort().join(); if (codes.has(c) && !seen.has(k)) { seen.add(k); const n = packages.find(x => x.code === c); out.push(['badge-soon', `${p.name} and ${n ? n.name : c} overlap. check you are not charging twice.`]); } }); });
    const unapproved = draft.items.filter(it => !it.owned && it.quote === 'fixed' && it.assess !== 'verify' && pk(it).price_status !== 'approved').map(it => pk(it).name);
    if (unapproved.length) out.push(['badge-late', `approve ${unapproved.length === 1 ? 'this price' : 'these prices'} before publishing: ${unapproved.join(', ')}.`]);
    return out;
  }
  function renderSel() {
    const box = $('selItems');
    const w = warnings();
    $('selWarn').innerHTML = w.length ? `<div class="warns">${w.map(([c, m]) => `<div class="warn"><span class="badge ${c}">${c === 'badge-late' ? 'fix' : 'check'}</span> ${esc(m)}</div>`).join('')}</div>` : '';
    if (!draft.items.length) { box.innerHTML = '<div class="note small">no packages yet. add them from the catalogue below.</div>'; return; }
    const LV = ['minimum', 'standard', 'protection', 'scaling', 'renewals'];
    const reqHtml = r => { let o = {}; try { o = JSON.parse(r || '{}'); } catch (e) { /* ignore */ } return Object.entries(o).map(([q, a]) => `<div class="small"><span class="muted">${esc(q)}:</span> ${esc(a)}</div>`).join(''); };
    box.innerHTML = draft.items.map((it, k) => {
      const p = packages.find(x => x.id === it.package_id) || { name: 'package ' + it.package_id, venture: '' };
      const u = UPILL[it.priority] || UPILL[2], dis = it.owned ? 'disabled' : '';
      return `<div class="sel-item"><div class="sel-item-top"><span><span class="upill ${it.has ? 'u-has' : u[1]}">${it.has ? 'they have this' : u[0]}</span> <b>${esc(p.name)}</b> <span class="tiny muted">${esc(p.code || '')}</span> ${vtag(p.venture)}${priceTag(p)}${it.owned ? ' <span class="badge badge-done">paid</span>' : ''}${it.saved ? ' <span class="badge">saved for later</span>' : ''}${it.request ? ' <span class="badge badge-late">route requested</span>' : ''}</span>
          <span class="row">${!it.owned && p.price_status !== 'approved' && p.basis !== 'quote' && it.quote !== 'ask' && holding() ? `<button class="sbtn" data-approve="${p.id}">approve ${esc(naira(p.price_minor))}</button>` : ''}${it.owned ? '' : `<button class="sbtn" data-rm="${k}">remove</button>`}</span></div>
        <div class="tiny muted">${esc(fee(p))}${p.duration ? ' · ' + esc(p.duration) : ''}${p.group ? ' · choose one' : ''}${(p.requires || []).length ? ' · needs ' + esc(p.requires.join(', ')) + ' first' : ''}</div>
        <div class="grid3"><div class="dfield"><label>urgency</label><select data-k="${k}" data-f="priority" ${dis}>${URGENCY.map(([v, l]) => `<option value="${v}" ${v === it.priority ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="dfield"><label>level</label><select data-k="${k}" data-f="level" ${dis}>${LV.map(s => `<option value="${s}" ${s === it.level ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="dfield"><label>fee for this client (₦)</label><input data-k="${k}" data-f="price" inputmode="decimal" value="${(it.price_minor ?? p.price_minor) / 100}" ${dis}></div></div>
        <div class="grid3"><div class="dfield"><label>pricing</label><select data-k="${k}" data-f="quote" ${dis}>${[['fixed', 'show the fee'], ['ask', 'questions first']].map(([v, l]) => `<option value="${v}" ${v === it.quote ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="dfield"><label>our assessment</label><select data-k="${k}" data-f="assess" ${dis}>${[['', 'recommend'], ['verify', 'checking first'], ['improve', 'improve theirs']].map(([v, l]) => `<option value="${v}" ${v === it.assess ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <label class="check mt-16"><input type="checkbox" data-k="${k}" data-f="has" ${it.has ? 'checked' : ''} ${dis}><span>they already have this</span></label></div>
        ${it.request ? `<div class="note small mt-4"><b>the client answered:</b>${reqHtml(it.request)}<span class="tiny muted">reply on whatsapp with their route, then set the fee and switch pricing to "show the fee" so they can pay.</span></div>` : ''}
        <div class="dfield"><label>why this fits them (shown to the client)</label><textarea data-k="${k}" data-f="note" rows="2">${esc(it.note)}</textarea></div></div>`;
    }).join('');
    box.querySelectorAll('[data-f]').forEach(el => el.addEventListener('input', () => {
      const it = draft.items[el.dataset.k], f = el.dataset.f;
      if (f === 'price') it.price_minor = toMinor(el.value); else if (f === 'renewal_minor') it.renewal_minor = toMinor(el.value) || 0; else if (f === 'priority') it.priority = Number(el.value);
      else if (f === 'has') it.has = el.checked; else it[f] = el.value;
      if (['priority', 'has', 'assess', 'quote'].includes(f)) renderSel();
    }));
    box.querySelectorAll('select[data-f],input[type=checkbox][data-f]').forEach(el => el.addEventListener('change', () => el.dispatchEvent(new Event('input'))));
    box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { draft.items.splice(Number(b.dataset.rm), 1); renderSel(); renderCat(); }));
    box.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => approveBox(packages.find(x => x.id === Number(b.dataset.approve)), () => renderSel())));
  }
  // the holding approves a proposed price, or sets a different one. only approved prices reach clients.
  function approveBox(p, after) {
    modal('approve this price?', `<p><b>${esc(p.name)}</b> <span class="tiny muted">${esc(p.code || '')}</span></p>
      <div class="dfield"><label for="apPrice">price (₦)${p.basis !== 'fixed' && p.basis !== 'quote' ? ' · ' + esc((BASES.find(b => b[0] === p.basis) || ['', ''])[1]) : ''}</label><input id="apPrice" inputmode="decimal" value="${p.price_minor / 100}"></div>
      <p class="tiny muted">clients only ever see approved prices. drafts not yet sent pick up this price.</p>
      <div class="modal-actions"><button class="sbtn" data-close>cancel</button><button class="sbtn primary" id="apGo">approve</button></div>`);
    $('apGo').addEventListener('click', async () => {
      const v = toMinor($('apPrice').value);
      if (!v || v <= 0) { toast('enter a price above zero', true); return; }
      try { await api(`/api/admin/packages/${p.id}/approve`, { method: 'POST', body: { price_minor: v } }); packages = await api('/api/admin/packages');
        if (typeof draft !== 'undefined' && draft && draft.items) draft.items.forEach(it => { if (it.package_id === p.id && !it.owned && it.price_minor === p.price_minor) it.price_minor = v; });
        closeModal(); toast('price approved'); after && after(); }
      catch (ex) { toast(ex.message, true); }
    });
  }
  function renderCat() {
    const v = $('catVenture').value, q = ($('catSearch').value || '').trim().toLowerCase(), inRec = new Set(draft.items.map(i => i.package_id));
    const list = packages.filter(p => p.active && (!v || p.venture === v) && !inRec.has(p.id) && (!q || p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q)));
    $('catList').innerHTML = list.length ? list.map(p => `<div class="cat-item"><span><span class="tiny muted">${esc(p.code || '')}</span> ${vtag(p.venture)} <b>${esc(p.name)}</b> <span class="muted">${esc(fee(p))}${p.duration ? ' · ' + esc(p.duration) : ''}</span>${priceTag(p)}</span><button class="sbtn" data-add="${p.id}">add</button></div>`).join('')
      : `<p class="tiny muted">${packages.length ? 'every matching package is already added.' : 'the catalogue is empty. add packages under catalogue first.'}</p>`;
    $('catList').querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
      const p = packages.find(x => x.id === Number(b.dataset.add));
      const lv = p.level || ({ awareness: 'minimum', strategy: 'minimum', structure: 'standard', systems: 'protection', success: 'scaling' }[p.stage] || 'standard');
      const monthly = p.basis === 'monthly';
      draft.items.push({ package_id: p.id, price_minor: p.price_minor, note: '', priority: 2, stage: p.stage, level: lv, renewal: monthly ? 'monthly' : 'none', renewal_minor: monthly ? p.price_minor : 0,
        quote: p.basis === 'quote' || !p.price_minor ? 'ask' : 'fixed', assess: '', owned: false, has: false, request: '' }); renderSel(); renderCat();
    }));
  }

  /* ---------- payments ---------- */
  function orderTable(list) {
    return `<div class="tbl"><table><thead><tr><th>reference</th><th>client</th><th>packages</th><th>amount</th><th>method</th><th>status</th><th></th></tr></thead><tbody>
      ${list.map(o => `<tr><td><b>${esc(o.reference)}</b><div class="tiny muted">${esc(day(o.created_at))}</div></td><td>${esc(o.business || o.name)}<div class="tiny muted">${esc(o.ref)}</div></td>
        <td class="small">${o.kind === 'renewal' ? '<span class="badge">monthly invoice</span> ' : ''}${(o.lines || []).map(l => esc(l.name)).join(', ') || '<span class="muted">see client</span>'}</td><td><b>${naira(o.total_minor)}</b>${o.vat_minor ? `<div class="tiny muted">incl. vat ${naira(o.vat_minor)}</div>` : ''}</td>
        <td class="small">${esc(o.method)}${o.transfer_note ? `<div class="tiny muted">${esc(o.transfer_note)}</div>` : ''}</td><td>${badge(o.status)}</td>
        <td class="row">${o.method === 'transfer' && ['awaiting_confirmation', 'pending'].includes(o.status) ? `<button class="sbtn primary" data-confirm="${o.id}" data-amount="${esc(naira(o.total_minor))}" data-refn="${esc(o.reference)}" data-kind="${esc(o.kind || 'purchase')}">confirm payment</button>` : ''}${o.status === 'awaiting_confirmation' ? `<button class="sbtn" data-reject="${o.id}">not received</button>` : ''}${o.status === 'refund_due' ? `<button class="sbtn" data-refunded="${o.id}">mark refunded</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function bindOrders() {
    main().querySelectorAll('[data-refunded]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('mark this payment as refunded? only do this after the money has gone back to the client.')) return;
      try { await api(`/api/admin/orders/${b.dataset.refunded}/refunded`, { method: 'POST' }); toast('marked as refunded'); route(); } catch (ex) { toast(ex.message, true); }
    }));
    main().querySelectorAll('[data-confirm]').forEach(b => b.addEventListener('click', () => confirmBox(b.dataset.confirm, b.dataset.amount, b.dataset.refn, b.dataset.kind)));
    main().querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', async () => {
      const note = prompt('what should the client know? (optional)', '') ?? null; if (note === null) return;
      try { await api(`/api/admin/orders/${b.dataset.reject}/reject`, { method: 'POST', body: { note } }); toast('marked as not received. the client can pay again or send proof.'); route(); } catch (ex) { toast(ex.message, true); }
    }));
  }
  function confirmBox(id, amount, ref, kind) {
    const renewal = kind === 'renewal';
    modal('confirm this payment?', `<p>only confirm after you see <b>${esc(amount)}</b> with reference <b>${esc(ref)}</b> in the bank account. ${renewal ? 'this pays their monthly service for the next month.' : "the client's packages then unlock for onboarding."}</p>
      <div class="modal-actions"><button class="sbtn" data-close>cancel</button><button class="sbtn primary" id="doConfirm">yes, payment received</button></div>`);
    $('doConfirm').addEventListener('click', async () => { try { await api(`/api/admin/orders/${id}/confirm`, { method: 'POST' }); closeModal(); toast('payment confirmed. now tell the client.'); await route();
      if (renewal || !holding()) return;
      const o = (await api('/api/admin/orders')).find(x => String(x.id) === String(id)); if (o) { const c = await api('/api/admin/clients/' + o.client_id); waModal(c, 'payment_received'); } } catch (ex) { toast(ex.message, true); } });
  }
  async function paymentsView() {
    const [list, subs] = await Promise.all([api('/api/admin/orders'), api('/api/admin/subscriptions')]);
    const sw = { active: ['active', 'badge-done'], grace: ['payment due', 'badge-soon'], paused: ['paused', 'badge-late'], cancelled: ['ended', 'badge-lock'] };
    main().innerHTML = head('payments', 'online payments confirm themselves. bank transfers need you to check the account, then confirm.', '<button class="sbtn" id="runBill">run monthly billing now</button>') +
      `<div class="panel">${list.length ? orderTable(list) : '<div class="empty">no payments yet.</div>'}</div>
      <div class="panel"><div class="panel-h"><h2>monthly services</h2><span class="tiny muted">cards are charged on the due date. transfer payers get an invoice 3 days before. unpaid for 7 days: paused.</span></div>
      ${subs.length ? `<div class="tbl"><table><thead><tr><th>client</th><th>service</th><th>amount</th><th>next due</th><th>pays by</th><th>status</th><th></th></tr></thead><tbody>
        ${subs.map(s => `<tr><td>${esc(s.business || s.client)}<div class="tiny muted">${esc(s.ref)}</div></td><td><b>${esc(s.name)}</b></td><td>${naira(s.amount_minor)} / month</td>
          <td class="small">${esc(s.next_due)}${s.cancel_at ? `<div class="tiny muted">ends ${esc(s.cancel_at)}</div>` : ''}${s.failures ? `<div class="tiny muted">${s.failures} declined</div>` : ''}</td><td class="small">${s.method === 'paystack' ? 'card, automatic' : 'transfer, invoiced'}</td>
          <td><span class="badge ${sw[s.status][1]}">${sw[s.status][0]}</span></td>
          <td class="row">${s.status === 'paused' ? `<button class="sbtn" data-sub="${s.id}" data-st="active">resume</button>` : ''}${s.status !== 'cancelled' ? `<button class="sbtn" data-sub="${s.id}" data-st="cancelled">end</button>` : ''}${holding() ? `<button class="sbtn" data-go="client-${s.client_id}">client</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">no monthly services yet.</div>'}</div>`;
    bindOrders(); bindGo();
    $('runBill').addEventListener('click', async () => { try { const r = await api('/api/admin/billing/run', { method: 'POST' }); toast(`done. ${r.charged} charged, ${r.invoiced} invoiced, ${r.declined} declined, ${r.paused} paused, ${r.ended} ended.`); paymentsView(); } catch (ex) { toast(ex.message, true); } });
    main().querySelectorAll('[data-sub]').forEach(b => b.addEventListener('click', async () => {
      if (b.dataset.st === 'cancelled' && !confirm('end this monthly service? the client will not be charged again.')) return;
      try { await api('/api/admin/subscriptions/' + b.dataset.sub, { method: 'PATCH', body: { status: b.dataset.st } }); toast('saved'); paymentsView(); } catch (ex) { toast(ex.message, true); }
    }));
  }

  /* ---------- delivery: holding assigns and reviews, ventures deliver and report ---------- */
  const reportHtml = r => `<div class="report"><div class="report-top"><span><b>${esc(r.progress)}%</b> · ${esc(r.author)} · ${esc(day(r.created_at))}${r.ready ? ' · <span class="badge badge-soon">ready for final check</span>' : ''}</span>${({ submitted: '<span class="badge badge-soon">with holding</span>', returned: '<span class="badge badge-late">returned</span>', published: '<span class="badge badge-done">published to client</span>' })[r.status] || ''}</div>
    <p><b>done:</b> ${esc(r.done)}</p>${r.blocker ? `<p><b>blocker:</b> ${esc(r.blocker)}</p>` : ''}<p><b>next:</b> ${esc(r.next_step)}</p>${r.holding_note ? `<p class="error mt-8">holding: ${esc(r.holding_note)}</p>` : ''}</div>`;

  async function deliveryView() {
    const list = await api('/api/admin/engagements');
    const order = ['onboarding_received', 'in_progress', 'review', 'awaiting_onboarding', 'delivered'];
    list.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    if (!holding()) return ventureWork(list);
    const reports = (await api('/api/admin/reports')).filter(r => r.status === 'submitted');
    main().innerHTML = head('delivery', 'assign each paid package to a venture, review their reports, publish updates to the client, then deliver.') +
      `<div class="panel"><div class="panel-h"><h2>venture reports to review</h2><span class="tiny muted">the client sees nothing until you publish</span></div><div class="panel-b">
        ${reports.length ? reports.map(r => `<div class="report"><div class="report-top"><span>${vtag(r.venture)} <b>${esc(r.package)}</b> · ${esc(r.business || r.client_name)} <span class="tiny muted">${esc(r.ref)}</span></span><span class="tiny muted">${esc(r.author)} · ${esc(day(r.created_at))}</span></div>
          <p><b>${r.progress}%</b>${r.ready ? ' · ready for final check' : ''}</p><p><b>done:</b> ${esc(r.done)}</p>${r.blocker ? `<p><b>blocker:</b> ${esc(r.blocker)}</p>` : ''}<p><b>next:</b> ${esc(r.next_step)}</p>
          <div class="row mt-8"><button class="sbtn primary" data-pub="${r.id}">review and publish to client</button><button class="sbtn" data-ret="${r.id}">return to venture</button></div></div>`).join('') : '<p class="tiny muted">no reports waiting.</p>'}</div></div>
      <div class="panel">${list.length ? `<div class="tbl"><table><thead><tr><th>package</th><th>client</th><th>assigned to</th><th>status</th><th>progress</th><th>deliverable</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr><td><b>${esc(e.name)}</b><div class="mt-4">${vtag(e.venture)}</div>${Object.keys(e.onboarding).length ? `<button class="btn-text tiny" data-onb="${e.id}">their details</button>` : ''}</td>
        <td class="small">${esc(e.business || e.client_name)}<div class="tiny muted">${esc(e.ref)}</div></td>
        <td class="small">${e.assigned_name ? `<b>${esc(e.assigned_name)}</b>${e.due_date ? `<div class="tiny ${e.past_due ? 'late' : 'muted'}">due ${esc(e.due_date)}${e.past_due ? ' · past due' : ''}</div>` : ''}${followTag(e)}` : '<span class="badge badge-soon">not assigned</span>'}${e.status === 'delivered' ? '' : `<div class="mt-4"><button class="sbtn" data-assign="${e.id}">${e.assigned_name ? 'change' : 'assign'}</button></div>`}</td>
        <td>${badge(e.status)}</td><td>${e.progress}%</td>
        <td class="small">${e.file_name ? esc(e.file_name) : '<span class="muted">none yet</span>'}${e.status === 'delivered' ? '' : `<div class="mt-4"><label class="sbtn">upload file<input type="file" data-file="${e.id}" class="skip"></label></div>`}</td>
        <td class="row">${e.status === 'delivered' ? `<span class="tiny muted">${esc(day(e.delivered_at))}</span>` : `<button class="sbtn primary" data-deliver="${e.id}">deliver</button>`}<button class="sbtn" data-hand="${e.id}">handover${((e.handover || {}).accounts || []).length || (e.handover || {}).copies_given ? ' &#10003;' : ''}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">no paid packages yet.</div>'}</div>`;
    bindFiles(list); bindOnb(list); bindHand(list);
    main().querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => {
      const e = list.find(x => x.id === Number(b.dataset.assign));
      const people = staffList.filter(u => u.active && (u.venture === e.venture || ['holding_owner', 'holding_admin'].includes(u.role)));
      modal('assign ' + e.name, `<form id="aForm"><p class="small muted">${esc(e.business || e.client_name)} · ${esc(e.ref)}</p>
        <div class="dfield mt-12"><label for="aUser">who will do the work</label><select id="aUser"><option value="">not assigned</option>${people.map(u => `<option value="${u.id}" ${u.id === e.assigned_user_id ? 'selected' : ''}>${esc(u.display_name)}${u.venture ? ' · ' + esc(u.venture) : ' · holding'}</option>`).join('')}</select>
        ${people.some(u => u.venture === e.venture) ? '' : `<span class="tiny muted">no ${esc(e.venture)} staff yet. add them under team.</span>`}</div>
        <div class="dfield"><label for="aDue">due date</label><input id="aDue" type="date" value="${esc(e.due_date || '')}"></div>
        <div class="dfield"><label for="aBrief">brief for the venture</label><textarea id="aBrief" rows="5" placeholder="what to deliver, what the client cares about, anything to avoid.">${esc(e.brief || '')}</textarea></div>
        <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">save</button></div></form>`);
      $('aForm').addEventListener('submit', async ev => {
        ev.preventDefault();
        try { await api(`/api/admin/engagements/${e.id}/assign`, { method: 'POST', body: { assigned_user_id: $('aUser').value ? Number($('aUser').value) : null, due_date: $('aDue').value, brief: $('aBrief').value } }); closeModal(); toast('assigned. it is now in their work list.'); deliveryView(); }
        catch (ex) { toast(ex.message, true); }
      });
    }));
    main().querySelectorAll('[data-pub]').forEach(b => b.addEventListener('click', () => {
      const r = reports.find(x => x.id === Number(b.dataset.pub));
      modal('publish to the client', `<form id="pForm"><p class="small muted">edit the wording for the client. plain words, one clear next step.</p>
        <div class="dfield mt-12"><label for="pPct">progress the client sees (%)</label><input id="pPct" type="number" min="0" max="99" value="${Math.min(r.progress, 99)}"></div>
        <div class="dfield"><label for="pDone">progress</label><textarea id="pDone" rows="3">${esc(r.done)}</textarea></div>
        <div class="dfield"><label for="pBlock">anything holding us back</label><textarea id="pBlock" rows="2">${esc(r.blocker)}</textarea></div>
        <div class="dfield"><label for="pNext">next step</label><textarea id="pNext" rows="2">${esc(r.next_step)}</textarea></div>
        ${r.ready ? '<p class="note small">the venture says this is ready for your final check. after publishing, upload or check the file and press deliver.</p>' : ''}
        <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">publish to client</button></div></form>`);
      $('pForm').addEventListener('submit', async ev => {
        ev.preventDefault();
        try {
          const d = await api(`/api/admin/reports/${r.id}/publish`, { method: 'POST', body: { progress: Number($('pPct').value), done: $('pDone').value, blocker: $('pBlock').value, next_step: $('pNext').value } });
          modal('published', `<p class="small">the client sees this update and the new progress now. send it on whatsapp too:</p><div class="dfield mt-12"><textarea rows="9" readonly>${esc(d.whatsapp_text)}</textarea></div><div class="modal-actions"><button class="sbtn" id="cpy">copy message</button><button class="sbtn primary" data-close>done</button></div>`);
          $('cpy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(d.whatsapp_text); toast('copied'); } catch (e) { toast('select the text and copy it', true); } });
          deliveryView();
        } catch (ex) { toast(ex.message, true); }
      });
    }));
    main().querySelectorAll('[data-ret]').forEach(b => b.addEventListener('click', () => {
      modal('return to the venture', `<form id="rForm"><div class="dfield"><label for="rNote">what needs to change?</label><textarea id="rNote" rows="4" required></textarea></div>
        <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">return report</button></div></form>`);
      $('rForm').addEventListener('submit', async ev => { ev.preventDefault(); try { await api(`/api/admin/reports/${b.dataset.ret}/return`, { method: 'POST', body: { note: $('rNote').value } }); closeModal(); toast('returned to the venture'); deliveryView(); } catch (ex) { toast(ex.message, true); } });
    }));
    main().querySelectorAll('[data-deliver]').forEach(b => b.addEventListener('click', () => {
      modal('confirm delivery?', '<p>confirm the work passed your quality check and the uploaded file is final. the client can then download it.</p><div class="modal-actions"><button class="sbtn" data-close>cancel</button><button class="sbtn primary" id="doDeliver">yes, deliver</button></div>');
      $('doDeliver').addEventListener('click', async () => { try { await api('/api/admin/engagements/' + b.dataset.deliver, { method: 'PATCH', body: { status: 'delivered' } }); closeModal(); toast('delivered. now tell the client on whatsapp.'); await deliveryView();
        const e = list.find(x => x.id === Number(b.dataset.deliver)); const c = await api('/api/admin/clients/' + e.client_id); waModal(c, 'delivered', { package: e.name }); } catch (ex) { closeModal(); toast(ex.message, true); } });
    }));
  }

  // the follow-up signal on each job: the client asked, an update is late or due soon
  function followTag(e) {
    const t = [];
    if (e.update_requested_at) t.push('<span class="badge badge-late">client asked for an update</span>');
    if (e.update_state === 'overdue') t.push('<span class="badge badge-late">update overdue</span>');
    else if (e.update_state === 'due_soon') t.push('<span class="badge badge-soon">update due soon</span>');
    else if (e.update_state === 'on_track' && e.update_due_at) t.push(`<span class="tiny muted">next update by ${esc(e.update_due_at.slice(0, 16))}</span>`);
    return t.length ? `<div class="mt-4 row">${t.join('')}</div>` : '';
  }
  // handover: what the client now owns. addresses and emails only, never passwords.
  function bindHand(list) {
    main().querySelectorAll('[data-hand]').forEach(b => b.addEventListener('click', () => {
      const e = list.find(x => x.id === Number(b.dataset.hand)), h = e.handover || {};
      const rows = (h.accounts && h.accounts.length ? h.accounts : [{}]).map(a => [a.service, a.login_url, a.account_email, a.recovery_owner].map(x => x || '').join(' | ')).join('\n');
      modal('handover · ' + e.name, `<form id="hForm"><p class="small muted">${esc(e.business || e.client_name)} · ${esc(e.ref)}. the client sees this in their files.</p>
        <div class="dfield mt-12"><label for="hAcc">accounts the client now owns, one per line: service | login address | account email | who controls recovery</label>
          <textarea id="hAcc" rows="4" placeholder="google business profile | business.google.com | owner@theirbusiness.com | the client">${esc(rows.trim() === '| | |' ? '' : rows)}</textarea>
          <span class="tiny muted">never write passwords here. send access through an invitation or a password manager.</span></div>
        ${[['copies_given', 'the client has their own copy of every file'], ['client_owns_accounts', 'accounts are in the client\'s name'], ['sent_securely', 'access was sent through invitations or a password manager'], ['staff_access_removed', 'our staff access is removed']]
          .map(([k, l]) => `<label class="check"><input type="checkbox" data-hk="${k}" ${h[k] ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        <div class="dfield"><label for="hNotes">notes for the team</label><textarea id="hNotes" rows="2">${esc(h.notes || '')}</textarea></div>
        <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">save handover</button></div></form>`);
      $('hForm').addEventListener('submit', async ev => {
        ev.preventDefault();
        const accounts = $('hAcc').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(x => x[0]).map(([service, login_url, account_email, recovery_owner]) => ({ service, login_url: login_url || '', account_email: account_email || '', recovery_owner: recovery_owner || '' }));
        const body = { accounts, notes: $('hNotes').value };
        $('mBody').querySelectorAll('[data-hk]').forEach(c => { body[c.dataset.hk] = c.checked; });
        try { await api(`/api/admin/engagements/${e.id}/handover`, { method: 'PUT', body }); closeModal(); toast('handover saved'); deliveryView(); } catch (ex) { toast(ex.message, true); }
      });
    }));
  }
  function bindFiles(list) {
    main().querySelectorAll('[data-file]').forEach(inp => inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      try { await upload(`/api/admin/engagements/${inp.dataset.file}/file`, inp.files[0]); toast('file uploaded. the client cannot see it until holding delivers.'); deliveryView(); } catch (ex) { toast(ex.message, true); }
    }));
  }
  function bindOnb(list) {
    main().querySelectorAll('[data-onb]').forEach(b => b.addEventListener('click', () => {
      const e = list.find(x => x.id === Number(b.dataset.onb));
      modal(e.name + ': their details', `<dl class="kv">${Object.entries(e.onboarding).map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a || 'not answered')}</dd>`).join('')}</dl>${attLinks(e)}<div class="modal-actions"><button class="sbtn" data-close>close</button></div>`);
    }));
  }

  function ventureWork(list) {
    const mineFirst = list.slice().sort((a, b) => (b.assigned_user_id === me.id) - (a.assigned_user_id === me.id));
    main().innerHTML = head('my work', 'every package holding has given to ' + (me.venture === 'hub' ? 'hamzury hub' : me.venture) + '. do the work, upload the file, then report to holding.') +
      (mineFirst.length ? mineFirst.map(e => {
        const last = e.reports[0];
        const sit = e.situation || {};
        return `<article class="task"><div class="report-top"><div>${vtag(e.venture)} ${e.assigned_user_id === me.id ? '<span class="badge badge-essential">assigned to you</span>' : e.assigned_name ? `<span class="badge">${esc(e.assigned_name)}</span>` : '<span class="badge badge-soon">not assigned yet</span>'}
            <h3 class="mt-8">${esc(e.name)}</h3><p class="small muted">${esc(e.business || e.client_name)} · ${esc(e.ref)}${e.due_date ? ' · due ' + esc(e.due_date) : ''}${e.past_due ? ' <span class="badge badge-late">past due</span>' : ''}</p>${followTag(e)}</div>${badge(e.status)}</div>
          <div class="task-grid">
            <div><span class="tiny muted">brief from holding</span><p class="small">${esc(e.brief || 'no brief yet. ask holding if anything is unclear.')}</p>
              <span class="tiny muted mt-12">client situation</span><p class="small">${esc([sit.industry, sit.stage, sit.location].filter(Boolean).join(' · '))}</p>${sit.challenge ? `<p class="small">&ldquo;${esc(sit.challenge)}&rdquo;</p>` : ''}</div>
            <div><span class="tiny muted">client onboarding details</span>${Object.keys(e.onboarding).length ? `<dl class="kv small">${Object.entries(e.onboarding).map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a || 'not answered')}</dd>`).join('')}</dl>${attLinks(e)}` : `<p class="small muted">${e.status === 'awaiting_onboarding' ? 'waiting for the client.' : 'none needed.'}</p>`}</div>
          </div>
          <div class="mt-16">${last ? reportHtml(last) : ''}</div>
          ${e.status === 'delivered' ? '<p class="small muted">delivered to the client.</p>' : `<div class="row mt-8">${e.status !== 'awaiting_onboarding' ? `<button class="sbtn primary" data-report="${e.id}">send report to holding</button>` : ''}
            <label class="sbtn">upload file <input type="file" data-file="${e.id}" class="skip"></label><button class="sbtn" data-hand="${e.id}">handover${((e.handover || {}).accounts || []).length || (e.handover || {}).copies_given ? ' &#10003;' : ''}</button>${e.file_name ? `<span class="tiny muted">uploaded: ${esc(e.file_name)}</span>` : ''}</div>`}
        </article>`;
      }).join('') : '<div class="empty">nothing assigned to your venture yet.</div>');
    bindFiles(list); bindHand(list);
    main().querySelectorAll('[data-report]').forEach(b => b.addEventListener('click', () => {
      const e = list.find(x => x.id === Number(b.dataset.report));
      const prev = e.reports[0];
      modal('report to holding', `<form id="vrForm"><p class="small muted">${esc(e.name)} · ${esc(e.business || e.client_name)}. holding reviews this before the client sees anything.</p>
        <div class="dfield mt-12"><label for="vrPct">how far along (%)</label><input id="vrPct" type="number" min="0" max="100" step="5" value="${prev ? prev.progress : e.progress}"></div>
        <div class="dfield"><label for="vrDone">what you have done</label><textarea id="vrDone" rows="3" required></textarea></div>
        <div class="dfield"><label for="vrBlock">anything holding you back (optional)</label><textarea id="vrBlock" rows="2"></textarea></div>
        <div class="dfield"><label for="vrNext">next step</label><textarea id="vrNext" rows="2" required></textarea></div>
        <label class="check"><input type="checkbox" id="vrReady"><span>the work is finished and the file is uploaded. ready for holding's final check.</span></label>
        <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">send to holding</button></div></form>`);
      $('vrForm').addEventListener('submit', async ev => {
        ev.preventDefault();
        try { await api(`/api/admin/engagements/${e.id}/reports`, { method: 'POST', body: { progress: Number($('vrPct').value), done: $('vrDone').value, blocker: $('vrBlock').value, next_step: $('vrNext').value, ready: $('vrReady').checked } }); closeModal(); toast('sent to holding. thank you.'); deliveryView(); }
        catch (ex) { toast(ex.message, true); }
      });
    }));
  }

  /* ---------- whatsapp: ready messages with a private link to the right step ---------- */
  const TEMPLATES = {
    route_reply: ['send their route', 'roadmap', x => `hello ${x.first}, ${x.sender} from hamzury here. thank you for your answers${x.package ? ' about ' + x.package : ''}.\n\nhere is your route:\n1. [first step]\n2. [second step]\nfee: [amount]\n\nit is now in your roadmap, ready when you are: ${x.link}`],
    quick_reply: ['fast reply', 'home', x => `hello ${x.first}, this is ${x.sender} from hamzury. thank you for reaching out${x.need ? ' about ' + x.need : ''}. we want to get you moving quickly. what is a good time to talk today?\n\nyour hamzury id is ${x.ref}. you can follow everything here: ${x.link}`],
    plan_coming: ['plan is being prepared', 'home', x => `hello ${x.first}, ${x.sender} from hamzury here. we are preparing the plan for ${x.biz} now, built around what you told us. you will see it here as soon as it is ready: ${x.link}`],
    plan_ready: ['plan is ready', 'recommendation', x => `hello ${x.first}, your plan for ${x.biz} is ready.\n\nwe built it around what you told us, starting with what will make the biggest difference. tap to see what we recommend, what is inside each part and every fee:\n${x.link}\n\nyou choose what we do. nothing starts until you decide.`],
    plan_reminder: ['plan reminder', 'recommendation', x => `hello ${x.first}, just checking in. your plan for ${x.biz} is here whenever you are ready: ${x.link}\n\nif anything is unclear, or you would like to start with just one part, reply here and we will help.`],
    payment_reminder: ['finish payment', 'pay', x => `hello ${x.first}, your packages are ready to start. finish your payment here and we begin straight away: ${x.link}\n\nany questions about the payment, reply here.`],
    payment_received: ['payment confirmed', 'onboarding', x => `hello ${x.first}, we have confirmed your payment. thank you.\n\na few quick details so we can start, about 2 minutes: ${x.link}`],
    onboarding_reminder: ['onboarding reminder', 'onboarding', x => `hello ${x.first}, we are ready to start${x.package ? ' ' + x.package : ''}. we only need a few details from you, about 2 minutes: ${x.link}`],
    update: ['progress update', 'progress', x => `hello ${x.first}, here is your latest update for ${x.biz}. see the progress for each part here: ${x.link}`],
    delivered: ['delivered', 'progress', x => `hello ${x.first}, ${x.package || 'your work'} is delivered. you can download it here: ${x.link}\n\nthank you for trusting us with ${x.biz}.`],
    files_expiring: ['download your files', 'files', x => `hello ${x.first}, a quick reminder: the finished file${x.package ? ' for ' + x.package : ''} stays in your hamzury dashboard for a few more weeks. please download your own copy here: ${x.link}`],
    update_coming: ['update is coming', 'progress', x => `hello ${x.first}, thank you for checking in${x.package ? ' on ' + x.package : ''}. we are getting the latest from the team and will update you today. you can follow everything here: ${x.link}`],
    renewal_due: ['monthly invoice', 'home', x => `hello ${x.first}, your monthly invoice for ${x.package || 'your service'} is ready${x.amount ? ': ' + x.amount : ''}. you can pay by card or transfer here: ${x.link}\n\nwant to stop it? you can do that on the same page, any time before the next month.`],
    renewal_overdue: ['monthly payment overdue', 'home', x => `hello ${x.first}, a quick reminder: the monthly payment for ${x.package || 'your service'} is still open. please pay here so it carries on without a break: ${x.link}\n\nif something has changed, reply here and we will sort it out together.`],
    next_step: ['next step', 'progress', x => `hello ${x.first}, now that ${x.package || 'your first package'} is done, the next step on the roadmap for ${x.biz} is ready when you are. see it here: ${x.link}`],
  };
  const attLinks = e => (e.attachments || []).length ? `<div class="att-list">${e.attachments.map(a => `<a href="/api/admin/engagements/${e.id}/attachment/${encodeURIComponent(a.q)}">download ${esc(a.name)}</a>`).join('')}</div>` : '';
  const waNumber = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d.startsWith('0')) d = '234' + d.slice(1); return d; };
  async function waModal(c, key, extra = {}) {
    const opts = Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${esc(t[0])}</option>`).join('');
    modal('message ' + (c.business || c.name) + ' on whatsapp', `<div class="dfield"><label for="wTpl">message</label><select id="wTpl">${opts}</select></div>
      <div class="dfield"><label for="wText">edit before sending</label><textarea id="wText" rows="9">preparing your private link...</textarea></div>
      <p class="tiny muted">the link opens the right step for this client only. it lasts 14 days.</p>
      <div class="modal-actions"><button class="sbtn" data-close>close</button><button class="sbtn" id="wCopy">copy</button><a class="sbtn primary" id="wOpen" target="_blank" rel="noopener">open in whatsapp</a></div>`);
    const build = async () => {
      const t = TEMPLATES[$('wTpl').value];
      $('wText').value = 'preparing your private link...';
      try {
        const l = await api(`/api/admin/clients/${c.id}/link`, { method: 'POST', body: { dest: t[1] } });
        const link = l.url.startsWith('http') ? l.url : location.origin + l.url;
        const need = (c.intake && (c.intake.needs || [])[0]) || '';
        $('wText').value = t[2]({ first: (c.name || '').split(' ')[0].toLowerCase(), biz: c.business || 'your business', ref: c.ref, sender: me.display_name.split(' (')[0], link, need: need === 'other' ? c.intake.needs_other : need, ...extra });
        sync();
      } catch (ex) { $('wText').value = ex.message; }
    };
    const sync = () => { $('wOpen').href = `https://wa.me/${waNumber(c.phone)}?text=${encodeURIComponent($('wText').value)}`; };
    $('wTpl').addEventListener('change', build);
    $('wText').addEventListener('input', sync);
    $('wCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('wText').value); toast('copied'); } catch (e) { toast('select the text and copy it', true); } });
    build();
  }

  /* ---------- follow-ups ---------- */
  const NUDGE_WORDS = { route_requested: ['route requested', 'badge-late'], urgent: ['urgent', 'badge-late'], payment_pending: ['payment not finished', 'badge-soon'], onboarding_missing: ['details missing', 'badge-soon'],
    plan_due: ['plan due', 'badge-soon'], plan_not_chosen: ['plan not chosen yet', ''], next_step: ['ready for next step', 'badge-done'],
    renewal_due: ['monthly invoice open', 'badge-soon'], renewal_overdue: ['monthly payment overdue', 'badge-late'],
    client_asked: ['client asked for an update', 'badge-late'], files_expiring: ['files leaving soon', 'badge-soon'], blocker: ['venture is blocked', 'badge-late'], venture_late: ['venture update late', 'badge-soon'], work_late: ['past due date', 'badge-late'] };
  const VENTURE_MSG = {
    venture_chase: n => `hello ${n.staff}, this is the holding desk. please send your update on ${n.package} for ${n.business || n.name} (${n.ref}) today: what is done, what is next, and anything blocking you. thank you.`,
    venture_late: n => `hello ${n.staff}, ${n.package} for ${n.business || n.name} (${n.ref}) has passed its due date. please tell us what is left and the new date you can commit to, so we can update the client today.`,
  };
  async function followupsView() {
    const list = await api('/api/admin/nudges');
    $('cFollow').textContent = list.length || '';
    main().innerHTML = head('follow-ups', 'who to message today. one tap opens a ready whatsapp message with their private link.') +
      `<div class="panel">${list.length ? list.map((n, k) => `<div class="nudge"><div><span class="badge ${NUDGE_WORDS[n.kind][1]}">${esc(NUDGE_WORDS[n.kind][0])}</span> <b>${esc(n.business || n.name)}</b> <span class="tiny muted">${esc(n.ref)}</span><div class="small muted mt-4">${esc(n.detail)}</div></div>
        <div class="row">${n.kind === 'plan_due' || n.kind === 'urgent' || n.kind === 'route_requested' ? `<button class="sbtn" data-go="client-${n.client_id}">open</button>` : ''}<button class="sbtn primary" data-nudge="${k}">message</button></div></div>`).join('') : '<div class="empty">nobody is waiting. well done.</div>'}</div>`;
    bindGo();
    main().querySelectorAll('[data-nudge]').forEach(b => b.addEventListener('click', async () => {
      const n = list[Number(b.dataset.nudge)];
      if (n.to === 'venture') return ventureMsg(n);
      const c = await api('/api/admin/clients/' + n.client_id);
      waModal(c, n.template, { package: n.package, amount: n.amount_minor ? naira(n.amount_minor) : '' });
    }));
  }

  function ventureMsg(n) {
    const text = VENTURE_MSG[n.template](n), phone = String(n.phone || '').replace(/\D/g, '').replace(/^0/, '234');
    modal('message ' + n.staff, `<div class="dfield"><label for="vText">edit before sending</label><textarea id="vText" rows="7">${esc(text)}</textarea></div>
      ${phone ? '' : '<p class="tiny muted">no phone number for this person yet. add it under team, or copy the message.</p>'}
      <div class="modal-actions"><button class="sbtn" data-close>close</button><button class="sbtn" id="vCopy">copy</button>${phone ? '<a class="sbtn primary" id="vOpen" target="_blank" rel="noopener">open in whatsapp</a>' : ''}</div>`);
    const upd = () => { if ($('vOpen')) $('vOpen').href = `https://wa.me/${phone}?text=${encodeURIComponent($('vText').value)}`; };
    upd(); $('vText').addEventListener('input', upd);
    $('vCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('vText').value); toast('copied'); } catch (e) { toast('select the text and copy it', true); } });
  }

  /* ---------- ventures: who is on time ---------- */
  async function scoreboardView() {
    const s = await api('/api/admin/scoreboard');
    main().innerHTML = head('ventures', `every venture's open work, late updates and delivery against the date we promised. updates are due every ${UPDATE_EVERY} hours while work is active.`) +
      `<div class="panel"><div class="tbl"><table><thead><tr><th>venture</th><th>open</th><th>not assigned</th><th>updates late</th><th>past due date</th><th>client asked</th><th>delivered</th><th>on time</th><th>average days</th><th>reports returned</th></tr></thead><tbody>
      ${s.map(v => `<tr><td>${vtag(v.venture)}</td><td>${v.open}</td><td>${v.unassigned ? `<span class="badge badge-soon">${v.unassigned}</span>` : 0}</td><td>${v.updates_overdue ? `<span class="badge badge-late">${v.updates_overdue}</span>` : 0}</td>
        <td>${v.past_due ? `<span class="badge badge-late">${v.past_due}</span>` : 0}</td><td>${v.asked_by_client ? `<span class="badge badge-late">${v.asked_by_client}</span>` : 0}</td><td>${v.delivered}</td>
        <td>${v.delivered ? Math.round(v.on_time / v.delivered * 100) + '%' : '-'}</td><td>${v.avg_days ?? '-'}</td><td>${v.returned_reports}</td></tr>`).join('')}</tbody></table></div></div>
      <p class="tiny muted">tap delivery to assign work, chase an update or publish a report.</p>`;
  }

  /* ---------- finance desk ---------- */
  async function financeToday() {
    const o = await api('/api/admin/money');
    $('cPay').textContent = o.transfers_to_confirm || '';
    const orders = await api('/api/admin/orders');
    const pay = orders.filter(x => x.status === 'awaiting_confirmation'), refunds = orders.filter(x => x.status === 'refund_due');
    main().innerHTML = head('today', 'payments to check, monthly billing, refunds and vat.') + `<div class="stats">
      <button class="stat ${o.transfers_to_confirm ? 'alert' : ''}" data-go="payments"><span>transfers to confirm</span><strong>${o.transfers_to_confirm}</strong><small>check the bank, then confirm</small></button>
      <button class="stat ${o.refunds_due ? 'alert' : ''}" data-go="payments"><span>refunds due</span><strong>${o.refunds_due}</strong><small>money received for a replaced or ended order</small></button>
      <div class="stat"><span>paid this month</span><strong>${naira(o.paid_this_month_minor)}</strong><small>${o.vat_this_month_minor ? 'incl. vat ' + naira(o.vat_this_month_minor) : 'no vat charged'}</small></div>
      <button class="stat" data-go="payments"><span>monthly services</span><strong>${o.monthly_active}</strong><small>${naira(o.monthly_due_minor)} a month · ${o.monthly_overdue} overdue · ${o.paused} paused</small></button>
      <button class="stat ${o.prices_to_approve ? 'alert' : ''}" data-go="catalogue"><span>prices not approved</span><strong>${o.prices_to_approve}</strong><small>review costs and margins with the holding</small></button></div>
      <div class="panel"><div class="panel-h"><h2>transfers to confirm</h2></div>${pay.length ? orderTable(pay) : '<div class="empty">nothing to confirm.</div>'}</div>
      ${refunds.length ? `<div class="panel"><div class="panel-h"><h2>refunds due</h2></div>${orderTable(refunds)}</div>` : ''}`;
    bindGo(); bindOrders();
  }
  async function moneyView() {
    const s = await api('/api/admin/settings');
    const canEdit = finance() || me.role === 'holding_owner';
    const pk = packages.filter(p => p.active);
    main().innerHTML = head('money settings', 'who bills the client, whether vat applies, and the finance checks before go-live. vat stays off until finance confirms it.') +
      `<div class="panel"><div class="panel-b"><form id="mForm">
        <div class="grid2"><div class="dfield"><label for="mEnt">company that invoices clients</label><input id="mEnt" value="${esc(s.entity_name)}" ${canEdit ? '' : 'disabled'}></div>
        <div class="dfield"><label for="mRc">rc number</label><input id="mRc" value="${esc(s.entity_rc)}" ${canEdit ? '' : 'disabled'}></div></div>
        <div class="grid3"><label class="check mt-16"><input type="checkbox" id="mVat" ${s.vat_registered ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>registered for vat: charge vat</span></label>
        <div class="dfield"><label for="mRate">vat rate (%)</label><input id="mRate" inputmode="decimal" value="${s.vat_rate_bp / 100}" ${canEdit ? '' : 'disabled'}></div>
        <div class="dfield"><label for="mTin">tax id (tin)</label><input id="mTin" value="${esc(s.vat_tin)}" ${canEdit ? '' : 'disabled'}></div></div>
        ${canEdit ? '<div class="row mt-8"><button class="sbtn primary">save</button><span class="tiny muted">clients see the new totals on their next checkout. paid orders do not change.</span></div>' : '<p class="tiny muted">only finance or the holding owner can change these.</p>'}
      </form></div></div>
      <div class="panel"><div class="panel-h"><h2>finance checks before go-live</h2></div><div class="panel-b">
        ${s.finance_checks.map(c => `<label class="check"><input type="checkbox" data-check="${c.key}" ${c.done ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span>${esc(c.label)}${c.done && c.by ? ` <span class="tiny muted">· ${esc(c.by)}, ${esc(c.at)}</span>` : ''}</span></label>`).join('')}</div></div>
      <div class="panel"><div class="panel-h"><h2>vat by service</h2><span class="tiny muted">ticked: vat applies to our fee. outside fees we pass on are never taxed by us.</span></div>
        <div class="tbl"><table><thead><tr><th>service</th><th>fee</th><th>vat applies</th></tr></thead><tbody>
        ${pk.map(p => `<tr><td><span class="tiny muted">${esc(p.code || '')}</span> <b>${esc(p.name)}</b> ${vtag(p.venture)}</td><td class="small">${esc(fee(p))}</td><td><input type="checkbox" data-vat="${p.id}" ${p.vat !== false ? 'checked' : ''} ${moneyRole() ? '' : 'disabled'} aria-label="vat applies to ${esc(p.name)}"></td></tr>`).join('')}</tbody></table></div></div>`;
    if (canEdit) $('mForm').addEventListener('submit', async e => {
      e.preventDefault();
      const rate = Math.round(parseFloat($('mRate').value || '0') * 100);
      try { await api('/api/admin/settings', { method: 'PUT', body: { entity_name: $('mEnt').value, entity_rc: $('mRc').value, vat_registered: $('mVat').checked, vat_rate_bp: rate, vat_tin: $('mTin').value } }); toast('saved'); moneyView(); } catch (ex) { toast(ex.message, true); }
    });
    main().querySelectorAll('[data-check]').forEach(b => b.addEventListener('change', async () => { try { await api('/api/admin/finance-checks/' + b.dataset.check, { method: 'PUT', body: { done: b.checked } }); toast('saved'); } catch (ex) { toast(ex.message, true); b.checked = !b.checked; } }));
    main().querySelectorAll('[data-vat]').forEach(b => b.addEventListener('change', async () => { try { await api(`/api/admin/packages/${b.dataset.vat}/vat`, { method: 'PATCH', body: { vat: b.checked } }); const p = packages.find(x => x.id === Number(b.dataset.vat)); if (p) p.vat = b.checked; toast('saved'); } catch (ex) { toast(ex.message, true); b.checked = !b.checked; } }));
  }

  /* ---------- insights ---------- */
  async function insightsView() {
    const d = await api('/api/admin/insights');
    const f = d.funnel, top = Math.max(f.started_questions, f.finished_questions, 1);
    const rate = (a, b) => b ? Math.round((a / b) * 100) + '%' : 'not enough data';
    const rows = [['opened start here', f.started_questions], ['finished the questions', f.finished_questions], ['plan published', f.plan_published], ['paid', f.paid], ['delivered', f.delivered], ['bought again', f.bought_again]];
    const NAMES = { full: ['', 'where they are', 'business name', 'what they do', 'how long running', 'reflection', 'registered', 'what slows them', 'in their words', 'reflection', 'what to take on', 'tried so far', 'when sorted', 'how much it matters', 'reflection', 'when to start', 'team size', 'location', 'snapshot', 'contact details'],
      quick: ['', 'what they need', 'how soon', 'business name', 'anything else', 'contact details'] };
    const steps = (flow, label) => { const s = (d.steps[flow] || []).filter(x => x.step > 0); if (!s.length) return `<p class="tiny muted">no ${label} visits recorded in the last 30 days.</p>`;
      const m = Math.max(...s.map(x => x.n), 1); return `<div class="funnel">${s.map(x => `<div class="funnel-row"><span>${x.step === 30 ? 'sent' : (NAMES[flow][x.step] || 'screen ' + x.step)}</span><span class="funnel-bar"><i data-w="${Math.round(x.n / m * 100)}"></i></span><b>${x.n}</b></div>`).join('')}</div>`; };
    main().innerHTML = head('insights', 'where people come from, where they stop, and how many become paying clients.') +
      `<div class="stats"><div class="stat"><span>finished to paid</span><strong>${rate(f.paid, f.finished_questions)}</strong><small>of everyone who finished the questions</small></div>
        <div class="stat"><span>plan to paid</span><strong>${rate(f.paid, f.plan_published)}</strong><small>of published plans</small></div>
        <div class="stat"><span>hours to publish a plan</span><strong>${d.hours_to_plan ?? '-'}</strong><small>average</small></div>
        <div class="stat"><span>hours from plan to payment</span><strong>${d.hours_plan_to_paid ?? '-'}</strong><small>average</small></div>
        <div class="stat"><span>paid</span><strong>${naira(d.revenue_minor)}</strong><small>all confirmed payments</small></div></div>
      <div class="panel"><div class="panel-h"><h2>the journey</h2></div><div class="panel-b"><div class="funnel">${rows.map(([l, n]) => `<div class="funnel-row"><span>${l}</span><span class="funnel-bar"><i data-w="${Math.round(n / top * 100)}"></i></span><b>${n}</b></div>`).join('')}</div></div></div>
      <div class="cols"><div class="panel"><div class="panel-h"><h2>where people stop: full picture</h2></div><div class="panel-b">${steps('full', 'full picture')}</div></div>
        <div class="panel"><div class="panel-h"><h2>where people stop: help fast</h2></div><div class="panel-b">${steps('quick', 'help fast')}</div></div></div>
      <div class="cols"><div class="panel"><div class="panel-h"><h2>route chosen</h2></div><div class="panel-b">${Object.entries(d.by_route).map(([k, n]) => `<div class="cat-item"><span>${k === 'quick' ? 'help fast' : 'full picture'}</span><b>${n}</b></div>`).join('') || '<p class="tiny muted">no data yet.</p>'}</div></div>
        <div class="panel"><div class="panel-h"><h2>where they came from</h2></div><div class="panel-b">${Object.entries(d.by_source).map(([k, n]) => `<div class="cat-item"><span>${VENTURES.includes(k) ? vtag(k) : esc(k)}</span><b>${n}</b></div>`).join('') || '<p class="tiny muted">no data yet.</p>'}</div></div></div>
      <p class="tiny muted">screen counts are anonymous. they show how many visits reached each screen, with no personal data.</p>`;
    requestAnimationFrame(() => main().querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; }));
  }

  /* ---------- whatsapp kit ---------- */
  async function kitView() {
    const config = await api('/api/public/config');
    const o = config.public_base_url || location.origin;
    const items = [
      ['greeting message (whatsapp business auto-reply)', `hello, welcome to hamzury. we help businesses with registration, marketing, websites, ai and automation, smart devices, training and funding.\n\nneed help fast? tap here, it takes 1 minute:\n${o}/start?src=wa&route=quick\n\nwant the full picture and a personal plan?\n${o}/start?src=wa&route=full\n\nalready with us? track your progress:\n${o}/track\n\na member of our team will reply here shortly.`],
      ['away message (outside working hours)', `thank you for your message. our team is away right now and will reply when we are back.\n\nyou can get started now, it takes 1 minute:\n${o}/start?src=wa&route=quick`],
      ['quick reply: /start', `here is the quickest way to get started. answer a few questions and we will come back to you with a plan: ${o}/start?src=wa`],
      ['quick reply: /track', `you can follow everything with your hamzury id and phone number here: ${o}/track`],
      ...['bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin'].map(v => [`venture start link: ${v === 'hub' ? 'hamzury hub' : v}`, `${o}/start?src=wa&v=${v}`]),
    ];
    main().innerHTML = head('whatsapp kit', 'paste these into whatsapp business: greeting message, away message and quick replies. every link brings people back into the same journey.') +
      items.map(([t, txt], k) => `<div class="kit"><h3>${esc(t)}</h3><textarea readonly id="kit${k}">${esc(txt)}</textarea><button class="sbtn" data-kit="${k}">copy</button></div>`).join('') +
      `<div class="note small">for personal messages with a private link to each client's next step, use <b>message on whatsapp</b> on a client page or in follow-ups.</div>`;
    main().querySelectorAll('[data-kit]').forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText($('kit' + b.dataset.kit).value); toast('copied'); } catch (e) { toast('select the text and copy it', true); } }));
  }

  /* ---------- catalogue ---------- */
  let catFilter = '';
  async function catalogueView() {
    packages = await api('/api/admin/packages');
    const toApprove = packages.filter(p => p.active && p.price_status !== 'approved' && p.basis !== 'quote');
    const shown = packages.filter(p => catFilter === 'approve' ? toApprove.includes(p) : !catFilter || p.venture === catFilter);
    main().innerHTML = head('catalogue', 'every service we offer. clients see the name, what is inside, what is not, the duration and the fee once it is approved.', holding() ? '<button class="sbtn primary" id="newPkg">add a package</button>' : '') +
      `<div class="row mb-12"><button class="sbtn ${!catFilter ? 'primary' : ''}" data-cf="">all</button>${toApprove.length ? `<button class="sbtn ${catFilter === 'approve' ? 'primary' : ''}" data-cf="approve">prices to approve <span class="count">${toApprove.length}</span></button>` : ''}${OWNERS.map(v => `<button class="sbtn ${catFilter === v ? 'primary' : ''}" data-cf="${v}">${v === 'hub' ? 'hamzury hub' : v}</button>`).join('')}</div>
      <div class="panel">${shown.length ? `<div class="tbl"><table><thead><tr><th>package</th><th>level</th><th>fee</th><th>duration</th><th>rules</th><th>status</th><th></th></tr></thead><tbody>
      ${shown.map(p => `<tr><td><span class="tiny muted">${esc(p.code || '')}</span> <b>${esc(p.name)}</b><div class="mt-4">${vtag(p.venture)}</div><div class="tiny muted mt-4">${esc(p.summary)}</div></td><td class="small">${esc(p.level)}</td>
        <td><b>${esc(fee(p))}</b>${priceTag(p)}</td><td class="small">${esc(p.duration)}</td>
        <td class="tiny">${[p.group ? 'choose one' : '', (p.requires || []).length ? 'needs ' + p.requires.join(', ') : '', (p.overlaps || []).length ? 'overlaps ' + p.overlaps.join(', ') : '', p.onboarding.length ? p.onboarding.length + ' requirement' + (p.onboarding.length === 1 ? '' : 's') : ''].filter(Boolean).map(esc).join('<br>')}</td>
        <td>${p.active ? badge('active') : badge('closed')}</td><td class="row">${holding() && p.price_status !== 'approved' && p.basis !== 'quote' ? `<button class="sbtn primary" data-approve="${p.id}">approve</button>` : ''}${holding() ? `<button class="sbtn" data-edit="${p.id}">edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">nothing here.</div>'}</div>`;
    if ($('newPkg')) $('newPkg').addEventListener('click', () => pkgForm());
    main().querySelectorAll('[data-cf]').forEach(b => b.addEventListener('click', () => { catFilter = b.dataset.cf; catalogueView(); }));
    main().querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => approveBox(packages.find(p => p.id === Number(b.dataset.approve)), catalogueView)));
    main().querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => pkgForm(packages.find(p => p.id === Number(b.dataset.edit)))));
  }
  const qToText = qs => qs.map(q => (q.required === false ? 'optional: ' : '') + q.label + (q.kind === 'long' ? ' (long)' : '') + (q.kind === 'choice' ? ' | ' + q.options.join(', ') : '')).join('\n');
  const textToQ = t => t.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    let required = true; if (/^optional:/i.test(l)) { required = false; l = l.replace(/^optional:\s*/i, ''); }
    let [q, opts] = l.split('|').map(x => x.trim()); let kind = 'text';
    if (opts) { kind = 'choice'; opts = opts.split(',').map(x => x.trim()).filter(Boolean); }
    if (/\(long\)$/i.test(q)) { kind = 'long'; q = q.replace(/\s*\(long\)$/i, ''); }
    return { label: q, kind, options: opts || [], required };
  });
  function pkgForm(p) {
    p = p || { venture: 'bizdoc', name: '', summary: '', inclusions: [], value: '', duration: '', price_minor: 0, onboarding: [], stage: 'structure', active: true,
      code: '', level: 'standard', exclusions: [], basis: 'fixed', price_status: 'approved', external: '', format: 'document', group: '', requires: [], overlaps: [] };
    modal(p.id ? 'edit package' : 'add a package', `<form id="pkgForm">
      <div class="grid2"><div class="dfield"><label for="pVen">venture</label><select id="pVen">${OWNERS.map(v => `<option ${v === p.venture ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="dfield"><label for="pStage">usual roadmap stage</label><select id="pStage">${STAGES.map(s => `<option ${s === p.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="grid2"><div class="dfield"><label for="pName">package name</label><input id="pName" value="${esc(p.name)}" required maxlength="120"></div>
      <div class="dfield"><label for="pCode">code</label><input id="pCode" value="${esc(p.code || '')}" placeholder="BZ-25" maxlength="7"></div></div>
      <div class="grid2"><div class="dfield"><label for="pLevel">roadmap level</label><select id="pLevel">${['minimum', 'standard', 'protection', 'scaling', 'renewals'].map(s => `<option ${s === p.level ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="dfield"><label for="pFmt">what the client receives</label><select id="pFmt">${FORMATS.map(s => `<option ${s === p.format ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="dfield"><label for="pSum">one-line summary</label><input id="pSum" value="${esc(p.summary)}" maxlength="400"></div>
      <div class="dfield"><label for="pInc">what is inside (one item per line)</label><textarea id="pInc" rows="5">${esc(p.inclusions.join('\n'))}</textarea></div>
      <div class="dfield"><label for="pExc">not included (one per line)</label><textarea id="pExc" rows="2">${esc((p.exclusions || []).join('\n'))}</textarea></div>
      <div class="dfield"><label for="pVal">the value for the client</label><textarea id="pVal" rows="3">${esc(p.value)}</textarea></div>
      <div class="dfield"><label for="pExt">please note (outside fees or approvals, shown to the client)</label><input id="pExt" value="${esc(p.external || '')}" maxlength="400" placeholder="for example: government fees are paid directly by you."></div>
      <div class="grid3"><div class="dfield"><label for="pPrice">fee (₦)</label><input id="pPrice" inputmode="decimal" value="${p.price_minor / 100}" required></div>
      <div class="dfield"><label for="pBasis">charged</label><select id="pBasis">${BASES.map(([v, l]) => `<option value="${v}" ${v === p.basis ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="dfield"><label for="pPs">price</label><select id="pPs">${[['proposed', 'proposed (clients cannot see it)'], ['approved', 'approved']].map(([v, l]) => `<option value="${v}" ${v === p.price_status ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="dfield"><label for="pDur">duration</label><input id="pDur" value="${esc(p.duration)}" placeholder="for example: 5 working days" maxlength="80"></div>
      <div class="grid3"><div class="dfield"><label for="pGrp">choose-one group</label><input id="pGrp" value="${esc(p.group || '')}" placeholder="cac-registration" maxlength="40"></div>
      <div class="dfield"><label for="pReq">needs first (codes)</label><input id="pReq" value="${esc((p.requires || []).join(', '))}" placeholder="BZ-02"></div>
      <div class="dfield"><label for="pOv">overlaps with (codes)</label><input id="pOv" value="${esc((p.overlaps || []).join(', '))}" placeholder="ST-07"></div></div>
      <div class="dfield"><label>onboarding requirements</label>
        <span class="tiny muted">what the client gives us after paying. say why you need each one: the client sees the reason.</span>
        <div id="rqList" class="mt-8"></div>
        <button type="button" class="sbtn" id="rqAdd">+ add a requirement</button></div>
      <label class="check"><input type="checkbox" id="pAct" ${p.active ? 'checked' : ''}><span>available to recommend</span></label>
      <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">save package</button></div></form>`);
    // requirement builder: label, type, required, why we need it
    const reqs = (p.onboarding || []).map(q => ({ label: q.label, kind: q.kind || 'text', options: q.options || [], required: q.required !== false, why: q.why || '' }));
    const KINDS = [['text', 'short answer'], ['long', 'long answer'], ['choice', 'choose one'], ['file', 'attachment']];
    const drawReqs = () => {
      $('rqList').innerHTML = reqs.length ? reqs.map((q, k) => `<div class="rq">
        <div class="rq-top"><div class="dfield"><label>requirement</label><input data-rk="${k}" data-rf="label" value="${esc(q.label)}" placeholder="for example: your cac certificate" maxlength="200"></div>
          <div class="dfield"><label>type</label><select data-rk="${k}" data-rf="kind">${KINDS.map(([v, l]) => `<option value="${v}" ${v === q.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <label class="rq-req"><input type="checkbox" data-rk="${k}" data-rf="required" ${q.required ? 'checked' : ''}> required</label></div>
        ${q.kind === 'choice' ? `<div class="dfield mt-8"><label>options (comma separated)</label><input data-rk="${k}" data-rf="options" value="${esc(q.options.join(', '))}" placeholder="warm, cool, no preference"></div>` : ''}
        <div class="rq-bottom"><div class="dfield"><label>why we need it (the client sees this)</label><input data-rk="${k}" data-rf="why" value="${esc(q.why)}" placeholder="for example: the licence form asks for your registration number" maxlength="300"></div>
          <button type="button" class="sbtn" data-rdel="${k}">remove</button></div></div>`).join('') : '<p class="small muted">no requirements. the work starts as soon as payment is confirmed.</p>';
    };
    drawReqs();
    $('rqAdd').addEventListener('click', () => { reqs.push({ label: '', kind: 'text', options: [], required: true, why: '' }); drawReqs(); $('rqList').querySelector(`[data-rk="${reqs.length - 1}"][data-rf="label"]`).focus(); });
    $('rqList').addEventListener('input', e => { const el = e.target.closest('[data-rk]'); if (!el) return; const q = reqs[el.dataset.rk], f = el.dataset.rf;
      if (f === 'required') q.required = el.checked; else if (f === 'options') q.options = el.value.split(',').map(x => x.trim()).filter(Boolean); else if (f !== 'kind') q[f] = el.value; });
    $('rqList').addEventListener('change', e => { const el = e.target.closest('[data-rf="kind"]'); if (el) { reqs[el.dataset.rk].kind = el.value; drawReqs(); } });
    $('rqList').addEventListener('click', e => { const b = e.target.closest('[data-rdel]'); if (b) { reqs.splice(Number(b.dataset.rdel), 1); drawReqs(); } });
    $('pkgForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = { venture: $('pVen').value, stage: $('pStage').value, name: $('pName').value, summary: $('pSum').value, inclusions: $('pInc').value.split('\n'),
        value: $('pVal').value, price_minor: toMinor($('pPrice').value), duration: $('pDur').value,
        code: $('pCode').value.trim().toUpperCase(), level: $('pLevel').value, format: $('pFmt').value, exclusions: $('pExc').value.split('\n').map(x => x.trim()).filter(Boolean),
        external: $('pExt').value.trim(), basis: $('pBasis').value, price_status: $('pPs').value, group: $('pGrp').value.trim().toLowerCase(),
        requires: $('pReq').value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), overlaps: $('pOv').value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), onboarding: reqs.filter(q => q.label.trim().length > 1).map(q => ({ ...q, label: q.label.trim(), options: q.kind === 'choice' ? q.options : [] })), active: $('pAct').checked };
      if (reqs.some(q => q.kind === 'choice' && q.label.trim() && !q.options.length)) { toast('add the options for each choice requirement', true); return; }
      try { await api('/api/admin/packages' + (p.id ? '/' + p.id : ''), { method: p.id ? 'PUT' : 'POST', body }); closeModal(); toast('package saved'); catalogueView(); }
      catch (ex) { toast(ex.message, true); }
    });
  }

  /* ---------- team ---------- */
  async function teamView() {
    staffList = await api('/api/users');
    const owner = me.role === 'holding_owner';
    main().innerHTML = head('team', 'holding staff see every client. venture staff sign in at /admin and see only their venture\'s work. finance sees money only.', owner ? '<button class="sbtn primary" id="addStaff">add staff</button>' : '') +
      `<div class="panel"><div class="tbl"><table><thead><tr><th>name</th><th>role</th><th>venture</th><th>access</th><th></th></tr></thead><tbody>
      ${staffList.map(u => `<tr><td><b>${esc(u.display_name)}</b><div class="tiny muted">${u.email ? esc(u.email) : 'login email needed'}</div></td><td class="small">${esc(label(u.role))}</td><td>${u.venture ? vtag(u.venture) : u.role === 'finance' ? 'finance' : 'holding'}${u.phone ? `<div class="tiny muted">${esc(u.phone)}</div>` : ''}</td><td>${u.active ? badge('active') : badge('closed')}</td>
        <td>${owner && u.active && u.id !== me.id ? `<button class="sbtn" data-email="${u.id}">set login email</button> <button class="sbtn" data-reset="${u.id}">reset password</button> <button class="sbtn" data-off="${u.id}">remove access</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    if ($('addStaff')) $('addStaff').addEventListener('click', () => {
      modal('add staff', `<form id="sForm"><div class="grid2"><div class="dfield"><label for="sU">login email</label><input id="sU" type="email" autocomplete="off" maxlength="254" required></div><div class="dfield"><label for="sN">display name</label><input id="sN" required></div></div>
        <div class="dfield"><label for="sP">first password (12+ characters)</label><input id="sP" type="password" autocomplete="new-password" required></div>
        <div class="grid2"><div class="dfield"><label for="sR">role</label><select id="sR"><option value="holding_admin">holding admin</option><option value="venture_ceo">venture lead</option><option value="venture_admin">venture staff</option><option value="finance">finance</option></select></div>
        <div class="dfield"><label for="sV">venture</label><select id="sV"><option value="">none</option>${VENTURES.map(v => `<option>${v}</option>`).join('')}</select></div></div>
        <div class="dfield"><label for="sPh">whatsapp number (for update reminders)</label><input id="sPh" inputmode="tel" placeholder="0803 000 0000"></div>
        <p class="tiny muted">venture staff see only their venture's work. finance sees payments, monthly billing, refunds and vat, never client documents.</p>
        <div class="modal-actions"><button type="button" class="sbtn" data-close>cancel</button><button class="sbtn primary">create</button></div></form>`);
      $('sForm').addEventListener('submit', async e => {
        e.preventDefault();
        try { await api('/api/users', { method: 'POST', body: { email: $('sU').value.trim(), display_name: $('sN').value, password: $('sP').value, role: $('sR').value, venture: $('sR').value.startsWith('venture') ? ($('sV').value || null) : null, phone: $('sPh').value } }); closeModal(); toast('staff added. share the password privately.'); teamView(); }
        catch (ex) { toast(ex.message, true); }
      });
    });
    main().querySelectorAll('[data-off]').forEach(b => b.addEventListener('click', async () => { try { await api(`/api/users/${b.dataset.off}/deactivate`, { method: 'POST' }); toast('access removed'); teamView(); } catch (ex) { toast(ex.message, true); } }));
    main().querySelectorAll('[data-email]').forEach(b => b.addEventListener('click', () => {
      const u = staffList.find(x => x.id === Number(b.dataset.email));
      modal('set staff login email', `<form id="emailStaffForm"><div class="dfield"><label for="staffEmail">login email</label><input id="staffEmail" type="email" maxlength="254" value="${esc(u.email || '')}" required></div><div class="dfield"><label for="emailOwnerPass">your owner password</label><input id="emailOwnerPass" type="password" autocomplete="current-password" required></div><p>this signs the staff member out. their password and authenticator stay in place.</p><button class="sbtn primary">save login email</button></form>`);
      $('emailStaffForm').addEventListener('submit', async e => {
        e.preventDefault();
        try { await api(`/api/users/${u.id}/email`, { method: 'POST', body: { email: $('staffEmail').value.trim(), owner_password: $('emailOwnerPass').value } }); closeModal(); toast('login email saved'); teamView(); }
        catch (ex) { toast(ex.message, true); }
      });
    }));
    main().querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', () => {
      modal('reset staff password', `<form id="resetForm"><div class="dfield"><label for="ownerPass">your owner password</label><input id="ownerPass" type="password" autocomplete="current-password" required></div><div class="dfield"><label for="resetPass">new staff password (12+ characters)</label><input id="resetPass" type="password" autocomplete="new-password" minlength="12" maxlength="200" required></div><p>this signs the staff member out of every session. their authenticator stays enabled.</p><button class="sbtn primary">reset password</button></form>`);
      $('resetForm').addEventListener('submit', async e => {
        e.preventDefault();
        try { await api(`/api/users/${b.dataset.reset}/password`, { method: 'POST', body: { owner_password: $('ownerPass').value, new_password: $('resetPass').value } }); closeModal(); toast('password reset. share it privately with the staff member.'); }
        catch (ex) { toast(ex.message, true); }
      });
    }));
  }

  async function securityView() {
    main().innerHTML = head('account security', 'use a unique password and an authenticator app to protect your staff account.') +
      `<section class="panel"><h2>login email</h2><form id="emailForm"><div class="dfield"><label for="accountEmail">email address</label><input id="accountEmail" type="email" maxlength="254" autocomplete="email" value="${esc(me.email || '')}" required></div><div class="dfield"><label for="emailPassword">current password</label><input id="emailPassword" type="password" autocomplete="current-password" required></div><button class="sbtn primary">change email and sign out</button></form></section>` +
      `<section class="panel"><h2>change password</h2><form id="passwordForm"><div class="dfield"><label for="currentPass">current password</label><input id="currentPass" type="password" autocomplete="current-password" required></div><div class="dfield"><label for="newPass">new password (12+ characters)</label><input id="newPass" type="password" autocomplete="new-password" minlength="12" maxlength="200" required></div><button class="sbtn primary">change password and sign out</button></form></section>` +
      `<section class="panel"><h2>authenticator</h2>${me.mfa_enabled ? '<p>enabled. enter a fresh code when you sign in. if you lose access, contact the server operator for recovery.</p>' : `<p>${me.mfa_required ? 'set this up before opening client or payment records.' : 'add a second step when signing in.'}</p><form id="mfaSetup"><div class="dfield"><label for="mfaPass">confirm your password</label><input id="mfaPass" type="password" autocomplete="current-password" required></div><button class="sbtn primary">set up authenticator</button></form><div id="mfaKey"></div>`}</section>`;
    $('passwordForm').addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('/api/account/password', { method: 'POST', body: { current_password: $('currentPass').value, new_password: $('newPass').value } }); location.reload(); }
      catch (ex) { toast(ex.message, true); }
    });
    $('emailForm').addEventListener('submit', async e => {
      e.preventDefault();
      try { await api('/api/account/email', { method: 'POST', body: { email: $('accountEmail').value.trim(), current_password: $('emailPassword').value } }); location.reload(); }
      catch (ex) { toast(ex.message, true); }
    });
    if ($('mfaSetup')) $('mfaSetup').addEventListener('submit', async e => {
      e.preventDefault();
      try {
        const d = await api('/api/account/mfa/setup', { method: 'POST', body: { password: $('mfaPass').value } });
        $('mfaPass').value = ''; $('mfaSetup').hidden = true;
        $('mfaKey').innerHTML = `<p>in your authenticator app, add a time-based account named hamzury with this setup key. keep the key private.</p><p><code>${esc(d.secret)}</code></p><form id="mfaEnable"><div class="dfield"><label for="mfaCode">six-digit code</label><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button class="sbtn primary">enable authenticator and sign out</button></form><p>after enabling, wait for the next code to sign in.</p>`;
        $('mfaEnable').addEventListener('submit', async ev => {
          ev.preventDefault();
          try { await api('/api/account/mfa/enable', { method: 'POST', body: { code: $('mfaCode').value } }); location.reload(); }
          catch (ex) { toast(ex.message, true); }
        });
      } catch (ex) { toast(ex.message, true); }
    });
  }

  /* ---------- modal ---------- */
  function modal(title, html) { $('mTitle').textContent = title; $('mBody').innerHTML = html; $('modal').hidden = false; const f = $('mBody').querySelector('input,select,textarea,button'); if (f) setTimeout(() => f.focus(), 30); }
  function closeModal() { $('modal').hidden = true; $('mBody').innerHTML = ''; }
  $('modal').addEventListener('click', e => { if (e.target === $('modal') || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('modal').hidden) closeModal(); });

  (async () => { try { const d = await api('/api/me'); me = d.user; csrf = d.csrf; start(); } catch (e) { showLogin(); } })();
})();
