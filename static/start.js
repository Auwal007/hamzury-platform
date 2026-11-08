/* start here: two routes (fast or full picture), one question per screen, "other" answers,
   reflections in the client's own words, a clarity snapshot, then the hamzury id.
   honest by design: no invented numbers, no false urgency. the client's business is the hero. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qs = new URLSearchParams(location.search);
  const venture = (qs.get('v') || '').toLowerCase();
  const src = ['wa', 'tt', 'ig', 'fb', 'bn'].includes((qs.get('src') || '').toLowerCase()) ? qs.get('src').toLowerCase() : '';
  const VNAMES = { bizdoc: 'bizdoc', medialy: 'medialy', subt: 'subt', iotics: 'iotics', hub: 'hamzury hub', iwiin: 'iwiin' };
  const vname = VNAMES[venture] || '';
  let cfg = { whatsapp: '', quick_reply_hours: 24, review_hours: 48 };
  let ventureServices = [];

  const STAGE_REFLECT = {
    'just an idea': 'good. the right foundations now save rework later. we will show you what comes first.',
    'starting in the next 3 months': 'good timing. what you decide now shapes everything after.',
    'running less than 1 year': 'simple systems pay off most in the first year. let us find what matters most.',
    'running 1 to 3 years': 'you have built something real. now we remove what slows you down.',
    'running more than 3 years': 'you have built something that lasts. now for the next level.',
  };
  const short = (t, n = 220) => { t = String(t || '').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '...' : t; };
  const biz = a => (a.business || '').trim() || 'your business';
  const listText = (arr, other) => (arr || []).map(x => x === 'other' ? (other || 'something else') : x);
  const OTHER = 'other';

  const HELP = ['registration, documents and compliance', 'a brand, logo and social media', 'marketing that brings customers',
    'a website or online shop', 'ai tools that answer customers or do admin', 'automating repeated work (orders, invoices, reports)',
    'cctv, smart devices or installations', 'training for me or my team', 'grants, funding or partnerships', 'not sure, recommend for me', OTHER];
  const helpOptions = () => vname && ventureServices.length ? [...ventureServices, 'not sure, recommend for me', OTHER] : HELP;

  const QUICK = [
    { key: 'needs', type: 'many', other: true, title: () => vname ? `what do you need from ${vname}?` : 'what do you need help with?', hint: 'choose all that apply.', options: helpOptions },
    { key: 'urgency', type: 'one', title: 'how soon do you need it?', options: ['today or tomorrow', 'this week', 'this month'] },
    { key: 'business', type: 'text', title: 'what is your business called?', hint: 'you can skip this.', optional: () => true, placeholder: 'business name' },
    { key: 'note', type: 'long', title: 'anything we should know?', hint: 'optional. one or two lines is perfect.', optional: () => true, placeholder: 'for example: we need a website before our launch on the 20th.' },
    { key: '_contact', type: 'contact', title: 'where should we reach you?', hint: 'we will message you on whatsapp.' },
  ];

  const FULL = [
    { key: 'path', type: 'one', title: 'where are you right now?', hint: 'choose the closest one.',
      options: [['start', 'i have an idea and i am ready to start', 'we help you set it up the right way'],
                ['contract', 'i won a contract and need to deliver it', 'papers, people and systems to deliver it well'],
                ['grow', 'my business is running and i want it to grow', 'more customers, less stress, better systems'],
                ['service', 'i know exactly what i need', 'tell us and we will confirm the best way to do it'],
                ['partnership', 'i want funding or a partnership', 'grants, partners and opportunities']],
      footer: 'already with us? <a href="/#track">track your progress</a>' },
    { key: 'business', type: 'text', title: a => a.path === 'start' ? 'what will you call your business?' : 'what is your business called?',
      hint: a => a.path === 'start' ? 'a working name is perfect. you can skip this.' : 'the name your customers know.', optional: a => a.path === 'start', placeholder: 'business name' },
    { key: 'industry', type: 'many', other: true, title: a => `what does ${biz(a)} do?`, hint: 'choose all that apply. many businesses do more than one thing.',
      options: ['cleaning services', 'interior decoration and painting', 'fashion and tailoring', 'retail and trading', 'food and drink', 'beauty and wellness', 'agriculture', 'logistics and transport', 'education and training',
                'health and care', 'technology', 'professional services', 'manufacturing', 'events and hospitality', 'real estate and building', 'construction', 'mining, oil and gas', 'ngo, foundation or association', OTHER] },
    { key: 'stage', type: 'one', title: a => a.path === 'start' ? 'when do you plan to start?' : `how long has ${biz(a)} been running?`, hint: 'this helps us start in the right place.',
      options: a => a.path === 'start' ? ['just an idea', 'starting in the next 3 months'] : Object.keys(STAGE_REFLECT) },
    { type: 'reflect', render: a => ({ eyebrow: 'noted', title: a.business ? `${a.business}, ${a.stage}.` : `${a.stage}.`, body: STAGE_REFLECT[a.stage] || 'thank you. this helps us start in the right place.' }) },
    { key: 'registered', type: 'one', title: a => `is ${biz(a)} registered with cac?`, hint: 'the corporate affairs commission.', options: ['yes', 'not yet', 'not sure'] },
    { key: 'challenge', type: 'many', other: true, title: a => `what is slowing ${biz(a)} down right now?`, hint: 'choose everything that feels true. this stays between us.',
      options: ['customers do not find us easily', 'people ask, but do not buy', 'we do too much by hand', 'orders, records or money get lost',
                'our papers or compliance are not sorted', 'we have no website or online presence', 'the team needs better skills', 'we need funding to grow', OTHER] },
    { key: 'note', type: 'long', optional: () => true, title: 'in your own words, what is the one thing you most want fixed?', hint: 'optional, but it helps us get your plan exactly right.',
      placeholder: 'for example: orders come in on whatsapp and we lose track of them.' },
    { type: 'reflect', render: a => {
        const picked = listText(a.challenge, a.challenge_other);
        return a.note && a.note.trim()
          ? { eyebrow: 'we hear you', quote: short(a.note), body: 'this is where we will start. a few more questions to understand it fully.' }
          : { eyebrow: 'we hear you', title: picked.length > 1 ? `${picked.length} things are slowing ${biz(a)} down.` : 'thank you for being honest.', body: `${picked.slice(0, 3).join(', ')}. this is exactly where we will start.` };
      } },
    { key: 'needs', type: 'many', other: true, title: () => vname ? `what would you love ${vname} to take off your plate?` : 'what would you love us to take off your plate?', hint: 'choose all that apply.', options: helpOptions },
    { key: 'tried', type: 'many', title: 'what have you tried so far?', hint: 'there is no wrong answer.',
      options: ['nothing yet', 'doing it myself', 'free tools or apps', 'hired someone before', 'asked friends or family', 'something else'] },
    { key: 'impact', type: 'many', title: 'picture it sorted. what is different?', hint: 'choose what matters most to you.',
      options: ['we make more money', 'more customers come back', 'i get my time back', 'less stress, fewer surprises', 'customers trust us more', 'ready to grow or raise funding', 'my team works without me watching'] },
    { key: 'importance', type: 'scale', title: 'how much does sorting this matter to you right now?', hint: '1 means "it can wait". 10 means "i need this now".' },
    { type: 'reflect', render: a => {
        const n = Number(a.importance || 0);
        const body = n >= 8 ? 'this matters now. your plan will start with what makes the biggest difference.'
          : n >= 5 ? 'noted. we will show you what to do first, and what can wait.'
          : 'no pressure. we will show you the options, and you decide when.';
        return { eyebrow: `${n} out of 10`, title: (a.impact || []).length ? `so that ${(a.impact || []).slice(0, 2).join(' and ')}.` : 'thank you.', body };
      } },
    { key: 'timing', type: 'one', title: 'when do you want to start?', options: ['right away', 'within a month', 'in 1 to 3 months', 'just exploring for now'] },
    { key: 'team', type: 'one', title: a => `how many people work in ${biz(a)}?`, options: ['just me', '2 to 5', '6 to 20', 'more than 20'] },
    { key: 'location', type: 'text', title: 'where are you based?', hint: 'city and state.', placeholder: 'for example: kaduna, kaduna state' },
    { type: 'snapshot' },
    { key: '_contact', type: 'contact', title: a => `last step. where should we send the plan for ${biz(a)}?`, hint: 'we use these details only to prepare and send your plan.' },
  ];

  /* venture flows: when someone starts from a venture, every question is about that venture's offers. */
  const DEADLINE = ['within 2 weeks', 'within a month', 'within 3 months', 'no deadline yet'];
  const VQ = {
    bizdoc: {
      needs: ['business registration or incorporation', 'cac changes (directors, shares, name)', 'tax registration, tin or annual returns', 'licences, permits or approvals for my sector', 'contracts, agreements or board resolutions', 'a compliance check: what am i missing?', 'renewals and ongoing compliance'],
      situation: ['where are your papers right now?', ['nothing is registered yet', 'registered, but some papers are missing', 'registered, i need licences or permits', 'i need renewals or filings', 'not sure what i need']],
      details: ['which sector are you in?', ['trading and retail', 'mining', 'oil and gas', 'agriculture', 'health', 'education', 'construction', 'real estate', 'manufacturing', 'transport and logistics', 'hospitality', 'technology', 'import and export', 'ngo, foundation or association']],
      last: ['urgency', 'is there a deadline?', DEADLINE],
    },
    medialy: {
      needs: ['a brand: name, logo and identity', 'company profile and marketing materials', 'social media management', 'content, photos or video', 'ads that bring customers', 'a website or landing page that sells', 'market research or competitor insight', 'more leads and better follow-up'],
      situation: ['how do most customers find you today?', ['word of mouth', 'social media', 'they walk in', 'a website or google', 'they do not find us yet']],
      details: ['what do you already have?', ['a logo', 'brand colours and guidelines', 'active social media pages', 'a website', 'paid ads running', 'none of these yet']],
      last: ['goal', 'what matters most right now?', ['more people know us', 'more enquiries', 'more enquiries turn into sales', 'customers come back', 'a brand that looks professional']],
    },
    subt: {
      needs: ['a website or web app', 'a mobile app', 'software for my operations (crm, inventory, school, hospital...)', 'an ai assistant or chatbot', 'automating repeated work', 'online booking, payments or an e-commerce store', 'dashboards and reports', 'support for a system i already have'],
      situation: ['how do you run things today?', ['mostly paper and memory', 'whatsapp and phone calls', 'excel or google sheets', 'some software that does not connect', 'we have systems and want ai on top']],
      details: ['what takes the most time every week?', ['answering the same customer questions', 'taking and tracking orders', 'invoices and payments', 'records and reports', 'bookings and appointments', 'staff, stock or inventory']],
      last: ['urgency', 'when do you need it?', DEADLINE],
    },
    iotics: {
      needs: ['smart home, office or building', 'cctv and security monitoring', 'smart access control', 'lighting, power or water control', 'sensors and remote monitoring', 'industrial or farm automation', 'a robotics or prototype project', 'maintenance of existing devices'],
      situation: ['what space is this for?', ['home', 'office', 'shop or business premises', 'school or institution', 'farm or industrial site']],
      details: ['what should the space do better?', ['let me see what is happening', 'control who comes in', 'save power or water', 'control lights and devices from my phone', 'warn me when something goes wrong']],
      last: ['urgency', 'when do you want it working?', DEADLINE],
    },
    hub: {
      needs: ['digital basics and productivity', 'ai for work', 'a professional course (software, data, design, marketing...)', 'training for my team', 'junior innovator programme', 'it/siwes or internship placement', 'entrepreneurship and mentorship', 'a workshop or bootcamp for my organisation'],
      situation: ['who is the training for?', ['me', 'my team or staff', 'my child or young people', 'a student needing it/siwes', 'an institution or organisation']],
      details: ['what do you want to be able to do after?', ['work faster with digital tools', 'use ai confidently', 'build software', 'analyse data', 'market online', 'design', 'start or grow a business']],
      last: ['format', 'how would you like to learn?', ['in person', 'online', 'a mix of both', 'not sure yet']],
    },
    iwiin: {
      needs: ['find grants that fit me', 'write a grant or funding proposal', 'a business plan or pitch deck', 'scholarship, fellowship or accelerator application', 'partnerships or sponsorships', 'tender research and bid documents', 'ngo or impact project proposal', 'a funding strategy'],
      situation: ['what are you looking for?', ['a grant', 'investors', 'a partner or sponsor', 'a tender or contract', 'a scholarship, fellowship or accelerator', 'not sure yet']],
      details: ['what do you have ready?', ['a registered organisation', 'a business plan', 'a pitch deck', 'financial records', 'a past application', 'none of these yet']],
      last: ['urgency', 'is there a deadline?', DEADLINE],
      note: 'funding decisions stay with each organisation. we help you find the right ones and apply well.',
    },
  };
  function ventureFlow(k) {
    const v = VQ[k];
    return [
      { key: 'needs', type: 'many', other: true, title: `what do you need from ${vname}?`, hint: v.note || 'choose all that apply.', options: [...v.needs, 'not sure, recommend for me', OTHER] },
      { type: 'reflect', render: a => { const n = listText(a.needs, a.needs_other); return { eyebrow: 'noted', title: n.length > 1 ? `${n.length} things for ${vname} to look at.` : `${vname} will look at this for you.`, body: `${n.slice(0, 3).join(', ')}${n.length > 3 ? ' and more' : ''}. a few quick questions so we get it right.` }; } },
      { key: 'situation', type: 'one', title: v.situation[0], options: v.situation[1], q: v.situation[0] },
      { key: 'details', type: 'many', other: true, title: v.details[0], hint: 'choose all that apply.', options: [...v.details[1], OTHER], q: v.details[0] },
      { key: v.last[0], type: 'one', title: v.last[1], options: v.last[2] },
      { key: 'business', type: 'text', title: 'what is your business or project called?', hint: 'a working name is fine. you can skip this.', optional: () => true, placeholder: 'name' },
      { key: 'note', type: 'long', optional: () => true, title: 'anything else we should know?', hint: 'optional. one or two lines is perfect.', placeholder: 'for example: we need it before our launch on the 20th.' },
      { key: '_contact', type: 'contact', title: 'last step. where should we reach you?', hint: 'we use these details only to prepare your proposal.' },
    ];
  }

  let route = '', Q = [], i = -1, busy = false;
  let a = {};
  const store = 'hz_start_' + venture;
  try { a = JSON.parse(sessionStorage.getItem(store) || '{}'); } catch (e) { a = {}; }
  const save = () => { try { sessionStorage.setItem(store, JSON.stringify(a)); } catch (e) { /* private mode */ } };
  const val = x => typeof x === 'function' ? x(a) : x;
  const isQuestion = q => !['reflect', 'snapshot'].includes(q.type);
  const screen = $('screen'), bottom = $('bottom'), next = $('nextBtn');
  const ventureLine = () => vname ? `<div class="flow-venture"><img src="/static/img/${esc(venture)}.png" alt="${esc(vname)}"><span>with ${esc(vname)}, part of hamzury</span></div>` : '';
  const waBanner = () => src === 'wa' ? `<div class="wa-banner"><span><b>hello from whatsapp.</b> answer here, then we continue the chat on whatsapp. your answers are private.</span></div>` : '';
  const track = (flow, step) => { try { fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow, step }), keepalive: true }); } catch (e) { /* ignore */ } };

  function chooseRoute() {
    i = -1; route = '';
    $('count').textContent = ''; $('bar').style.width = '4%'; $('backBtn').style.visibility = 'visible'; $('backBtn').textContent = '\u2039 home';
    screen.innerHTML = `<div class="fade-in">${waBanner()}${ventureLine()}
      <span class="eyebrow">start here</span>
      <h1 class="q-title">let's move your business forward.</h1>
      <p class="q-hint">two ways to start. both are free.</p>
      <button class="route" type="button" data-route="full"><span class="eyebrow">recommended</span><b>build my full plan</b>
        <span class="d">a plan made for you, with every price shown.</span><span class="time">about 4 minutes</span></button>
      <button class="route route-quiet" type="button" data-route="quick"><span class="eyebrow">in a hurry</span><b>i need help now</b>
        <span class="d">4 questions. we reply on whatsapp.</span><span class="time">about 1 minute</span></button>
      <p class="muted small mt-24">already with us? <a href="/#track">track your progress</a></p></div>`;
    bottom.hidden = true;
    screen.querySelectorAll('[data-route]').forEach(b => b.addEventListener('click', () => {
      route = b.dataset.route; a.route = route; save(); Q = route === 'quick' ? QUICK : FULL; i = 0; track('route', route === 'quick' ? 1 : 2); render();
    }));
    track('route', 0);
    window.scrollTo({ top: 0 });
  }

  function optionsHtml(q, multi) {
    const chosen = multi ? (a[q.key] || []) : a[q.key];
    return `<div class="options" role="${multi ? 'group' : 'radiogroup'}" aria-labelledby="qTitle">` + val(q.options).map(o => {
      const [v, label, sub] = Array.isArray(o) ? o : [o, o === OTHER ? 'other (tell us)' : o, ''];
      const on = multi ? chosen.includes(v) : chosen === v;
      return `<button type="button" class="opt${multi ? ' multi' : ''}" ${multi ? 'aria-pressed' : 'role="radio" aria-checked'}="${on}" data-v="${esc(v)}"><span class="mark" aria-hidden="true">${on ? '&#10003;' : ''}</span><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
    }).join('') + '</div>' + (q.other ? `<div class="field other-box" id="otherBox" ${(chosen || []).includes(OTHER) ? '' : 'hidden'}><label for="otherInput">tell us in your own words</label><input id="otherInput" class="input" maxlength="${q.key === 'industry' ? 120 : 300}" value="${esc(a[q.key + '_other'] || '')}" placeholder="type here"></div>` : '');
  }

  function render() {
    const q = Q[i];
    const qn = Q.slice(0, i + 1).filter(isQuestion).length, total = Q.filter(isQuestion).length;
    $('count').textContent = isQuestion(q) ? `${qn} of ${total}` : '';
    $('bar').style.width = `${Math.round((Math.max(qn, 1) / total) * 100)}%`;
    $('backBtn').style.visibility = 'visible'; $('backBtn').textContent = i === 0 && route === 'venture' ? `\u2039 ${vname}` : '\u2039 back';
    track(route, i + 1);
    let body = `<div class="fade-in">${i === 0 ? waBanner() : ''}${ventureLine()}`;
    if (q.type === 'reflect') {
      const r = q.render(a);
      body += `<span class="eyebrow">${esc(r.eyebrow)}</span>${r.title ? `<h1 class="q-title">${esc(r.title)}</h1>` : ''}
        <div class="reflect">${r.quote ? `<span class="tiny muted">you said</span><q>${esc(r.quote)}</q>` : ''}<p>${esc(r.body)}</p></div>`;
      screen.innerHTML = body + '</div>'; bottom.hidden = false; next.textContent = 'continue'; window.scrollTo({ top: 0 }); return;
    }
    if (q.type === 'snapshot') {
      const n = Number(a.importance || 0);
      const row = (label, html) => html ? `<div class="snap-row"><small>${esc(label)}</small>${html}</div>` : '';
      const join = (k) => listText(a[k], a[k + '_other']).join(', ');
      body += `<span class="eyebrow">your clarity snapshot</span><h1 class="q-title">this is ${esc(biz(a))}, as you described it.</h1>
        <p class="q-hint">your plan is built on this. not right? go back and change it.</p>
        <div class="snap">
          ${row('where you are', `<p>${esc([a.stage, join('industry')].filter(Boolean).join(' · '))}</p>`)}
          ${row('what is slowing you down', `<p>${esc(join('challenge'))}</p>${a.note ? `<p class="small muted mt-4">&ldquo;${esc(short(a.note, 240))}&rdquo;</p>` : ''}`)}
          ${row('what you have tried', (a.tried || []).length ? `<p>${esc(a.tried.join(', '))}</p>` : '')}
          ${row('what changes when it is sorted', (a.impact || []).length ? `<p>${esc(a.impact.join(', '))}</p>` : '')}
          ${row('what you want us to take on', (a.needs || []).length ? `<p>${esc(join('needs'))}</p>` : '')}
          ${row('how much it matters now', n ? `<p>${n} out of 10</p><div class="meter" aria-hidden="true">${Array.from({ length: 10 }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('')}</div>` : '')}
        </div>`;
      screen.innerHTML = body + '</div>'; bottom.hidden = false; next.textContent = 'yes, that is us'; window.scrollTo({ top: 0 }); return;
    }
    body += `<h1 class="q-title" id="qTitle">${esc(val(q.title))}</h1>${q.hint ? `<p class="q-hint">${esc(val(q.hint))}</p>` : ''}`;
    if (q.type === 'one' || q.type === 'many') body += optionsHtml(q, q.type === 'many');
    else if (q.type === 'scale') {
      body += `<div class="scale" role="radiogroup" aria-labelledby="qTitle">${Array.from({ length: 10 }, (_, k) => k + 1).map(n => `<button type="button" class="opt" role="radio" aria-checked="${String(a.importance) === String(n)}" data-v="${n}"><span class="mark"></span>${n}</button>`).join('')}</div>
        <div class="scale-ends"><span>it can wait</span><span>i need this now</span></div>`;
    } else if (q.type === 'text') {
      body += `<div class="field"><label class="skip" for="qInput">${esc(val(q.title))}</label><input id="qInput" class="input" value="${esc(a[q.key] || '')}" placeholder="${esc(q.placeholder || '')}" maxlength="150" autocomplete="off"></div>`;
    } else if (q.type === 'long') {
      body += `<div class="field"><label class="skip" for="qInput">${esc(val(q.title))}</label><textarea id="qInput" placeholder="${esc(q.placeholder || '')}" maxlength="800" rows="4">${esc(a[q.key] || '')}</textarea><span class="help">please do not include passwords, bank details or id numbers.</span></div>`;
    } else if (q.type === 'contact') {
      body += `<div class="field"><label for="cName">your name</label><input id="cName" class="input" value="${esc(a._name || '')}" autocomplete="name" maxlength="120"></div>
        <div class="field"><label for="cPhone">whatsapp number</label><input id="cPhone" class="input" type="tel" inputmode="tel" value="${esc(a._phone || '')}" autocomplete="tel" placeholder="+234" maxlength="40"><span class="help">you will use this with your hamzury id to track your progress.</span></div>
        <div class="field"><label for="cEmail">email <span class="muted">(optional)</span></label><input id="cEmail" class="input" type="email" inputmode="email" value="${esc(a._email || '')}" autocomplete="email" maxlength="160"></div>
        <div class="skip" aria-hidden="true"><label for="cWeb">leave empty</label><input id="cWeb" tabindex="-1" autocomplete="off"></div>
        <label class="check"><input type="checkbox" id="cConsent" ${a._consent ? 'checked' : ''}><span>you may use my answers and contact details to prepare my plan and contact me. see the <a href="/privacy">privacy note</a>.</span></label>`;
    }
    body += `<div class="error mt-16" id="qError" role="alert" hidden></div>`;
    if (q.footer) body += `<p class="muted small mt-24">${q.footer}</p>`;
    screen.innerHTML = body + '</div>';
    const auto = q.type === 'one' || q.type === 'scale';
    bottom.hidden = auto && !a[q.key];
    next.textContent = q.type === 'contact' ? (route === 'quick' ? 'send and get my id' : 'get my proposal and my id') : (val(q.optional) && !a[q.key] ? 'skip' : 'continue');
    const input = $('qInput');
    if (input) {
      input.addEventListener('input', () => { a[q.key] = input.value; save(); if (val(q.optional)) next.textContent = input.value.trim() ? 'continue' : 'skip'; });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && q.type === 'text') { e.preventDefault(); go(); } });
      setTimeout(() => input.focus({ preventScroll: true }), 60);
    }
    const other = $('otherInput');
    if (other) other.addEventListener('input', () => { a[q.key + '_other'] = other.value; save(); });
    screen.querySelectorAll('.opt').forEach(btn => btn.addEventListener('click', () => {
      const v = btn.dataset.v;
      if (q.type === 'many') {
        const list = new Set(a[q.key] || []);
        list.has(v) ? list.delete(v) : list.add(v);
        a[q.key] = [...list]; save();
        const on = list.has(v); btn.setAttribute('aria-pressed', on); btn.querySelector('.mark').innerHTML = on ? '&#10003;' : '';
        if (v === OTHER && $('otherBox')) { $('otherBox').hidden = !on; if (on) setTimeout(() => { $('otherInput').focus({ preventScroll: true }); $('otherBox').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 30); }
      } else {
        a[q.key] = v; save();
        screen.querySelectorAll('.opt').forEach(b => { const on = b === btn; b.setAttribute('aria-checked', on); const m = b.querySelector('.mark'); if (m && q.type === 'one') m.innerHTML = on ? '&#10003;' : ''; });
        bottom.hidden = false;
        setTimeout(go, 220);
      }
    }));
    window.scrollTo({ top: 0 });
  }

  function fail(msg) { const e = $('qError'); if (e) { e.textContent = msg; e.hidden = false; } }

  function go() {
    if (busy || i < 0) return;
    const q = Q[i];
    if ((q.type === 'one' || q.type === 'scale') && !a[q.key]) return fail('please choose one option.');
    if (q.type === 'many' && !(a[q.key] || []).length) return fail('please choose at least one.');
    if (q.type === 'many' && q.other && (a[q.key] || []).includes(OTHER) && !String(a[q.key + '_other'] || '').trim()) return fail('please tell us a little more in the box.');
    if ((q.type === 'text' || q.type === 'long') && !val(q.optional) && String(a[q.key] || '').trim().length < (q.min || 2)) return fail('please add a short answer.');
    if (q.type === 'contact') return submit();
    i += 1; render();
  }

  async function submit() {
    a._name = $('cName').value.trim(); a._phone = $('cPhone').value.trim(); a._email = $('cEmail').value.trim(); a._consent = $('cConsent').checked; save();
    if (a._name.length < 2) return fail('please tell us your name.');
    if (a._phone.replace(/\D/g, '').length < 7) return fail('please check your whatsapp number, including the country code.');
    if (a._email && !/^\S+@\S+\.\S+$/.test(a._email)) return fail('please check your email address.');
    if (!a._consent) return fail('please tick the box so we can prepare your plan.');
    busy = true; next.disabled = true; next.textContent = 'creating your id...';
    const answers = { venture, route, src };
    Q.forEach(q => { if (q.key && !q.key.startsWith('_')) { answers[q.key] = a[q.key] ?? ''; if (q.other) answers[q.key + '_other'] = a[q.key + '_other'] || ''; if (q.q) answers[q.key + '_q'] = q.q; } });
    if (route === 'venture') answers.path = 'service';
    answers.importance = String(answers.importance || '');
    if (route === 'quick') answers.path = '';
    try {
      const r = await fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, name: a._name, phone: a._phone, email: a._email, consent: true, website: $('cWeb').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'something went wrong. please try again.');
      try { sessionStorage.removeItem(store); } catch (e) { /* ignore */ }
      track(route, 30);
      done(d);
    } catch (ex) {
      busy = false; next.disabled = false; next.textContent = 'try again'; fail(String(ex.message).toLowerCase());
    }
  }

  function done(d) {
    $('count').textContent = ''; $('bar').style.width = '100%'; $('backBtn').style.visibility = 'hidden';
    const first = a._name.split(' ')[0].toLowerCase();
    const quick = route === 'quick';
    const team = vname ? `the ${vname} team and the holding desk` : 'our team';
    const waText = encodeURIComponent(`hello hamzury, i just finished start here. my hamzury id is ${d.ref}.`);
    const waBtn = cfg.whatsapp ? `<a class="btn btn-wa btn-block mt-16" href="https://wa.me/${esc(cfg.whatsapp)}?text=${waText}" rel="noopener">${src === 'wa' ? 'back to whatsapp' : 'message us on whatsapp'}</a>` : '';
    screen.innerHTML = `<div class="fade-in">${ventureLine()}
      <span class="eyebrow">${quick ? 'we are on it' : 'you are in'}</span>
      <h1 class="q-title">thank you, ${esc(first)}.</h1>
      <p class="q-hint">${quick ? `a member of ${esc(team)} will message you on whatsapp soon, within working hours.` : 'this is your hamzury id. save it. you will use it with your phone number to follow everything.'}</p>
      <div class="id-card"><small>your hamzury id</small><div class="id-num" id="idNum">${esc(d.ref)}</div>
        <button class="btn btn-ghost btn-sm" type="button" id="copyId">copy id</button></div>
      ${waBtn}
      ${!quick && d.focus && d.focus.length ? `<h2 class="h-section">from your answers, your first focus is likely</h2>
        <ol class="focus-list">${d.focus.map(f => `<li>${esc(f)}</li>`).join('')}</ol>
        <p class="tiny muted">your team checks this and confirms it in your proposal, with every fee shown before you choose.</p>` : ''}
      <h2 class="h-section">what happens next</h2>
      <ol class="next-list">
        ${quick ? `<li><span class="n">1</span><span><b>we read your request.</b>straight away, because you need it fast.</span></li>
        <li><span class="n">2</span><span><b>we message you on whatsapp.</b>to confirm the details and the price.</span></li>
        <li><span class="n">3</span><span><b>you decide.</b>nothing starts and nothing is charged until you agree.</span></li>`
        : `<li><span class="n">1</span><span><b>${esc(team)} study your snapshot.</b>everything you told us, in your words.</span></li>
        <li><span class="n">2</span><span><b>your proposal appears in your dashboard.</b>soon, within working hours. we message you on whatsapp when it is ready.</span></li>
        <li><span class="n">3</span><span><b>you choose your roadmap.</b>see what is inside each part and the fee. choose only what you want.</span></li>`}
      </ol></div>`;
    bottom.hidden = false; next.disabled = false; next.textContent = 'open my dashboard';
    next.onclick = () => { location.href = '/track'; };
    $('copyId').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(d.ref); $('copyId').textContent = 'copied'; } catch (e) { $('copyId').textContent = 'press and hold the id to copy'; }
    });
  }

  next.addEventListener('click', () => { if (!next.onclick) go(); });
  $('backBtn').addEventListener('click', () => {
    if (busy) return;
    if (i > 0) { i -= 1; render(); }
    else if (i === 0 && route === 'venture') location.href = '/v/' + venture;
    else if (i === 0) chooseRoute();
    else location.href = '/';
  });

  (async () => {
    try { cfg = { ...cfg, ...(await (await fetch('/api/public/config')).json()) }; } catch (e) { /* defaults */ }
    if (venture && vname) {
      document.body.classList.add('theme-' + venture);
      try { const r = await fetch('/api/public/ventures/' + venture); if (r.ok) ventureServices = (await r.json()).services.map(s => s.name); } catch (e) { /* fall back */ }
      document.title = `start here with ${vname} | hamzury`;
    }
    const pre = (qs.get('route') || '').toLowerCase();
    if (venture && VQ[venture]) { route = 'venture'; a.route = route; Q = ventureFlow(venture); i = 0; render(); }
    else if (pre === 'quick' || pre === 'full') { route = pre; a.route = route; Q = route === 'quick' ? QUICK : FULL; i = 0; render(); }
    else chooseRoute();
  })();
})();
