// hamzury master service catalogue: the single source of truth for every service.
// the items live in catalogue-data.json (one code, one scope, one accountable owner, one price basis, one delivery standard).
// prices marked 'proposed' are never shown to clients until the holding approves them in the desk.
// urgency: 1 = needed now (red), 2 = needed soon (amber), 3 = optional (blue).
import { readFileSync } from 'node:fs';

export const CATALOGUE = JSON.parse(readFileSync(new URL('./catalogue-data.json', import.meta.url), 'utf8'));
export const LEVEL_NAMES = { minimum: 'business foundation', standard: 'business operations', protection: 'business safeguards', scaling: 'business growth', renewals: 'business continuity' };
export const BY_CODE = Object.fromEntries(CATALOGUE.map(i => [i.code, i]));

// ---------------- suggestions: answers -> a draft roadmap ----------------
// each rule: [test on the answers, [[code, urgency, reason], ...]]. reasons are written to the client, in plain words.
const list = v => (Array.isArray(v) ? v : [v]);
const has = (a, key, ...vals) => list(a[key]).some(x => vals.includes(x));
const any = (a, key, ...frags) => list(a[key]).some(x => frags.some(f => String(x ?? '').includes(f)));
const text = (a, ...keys) => keys.flatMap(k => (Array.isArray(a[k]) ? a[k] : [a[k] || ''])).map(String).join(' ').toLowerCase();

const isNgo = a => /\b(ngos?|foundation|association|charity|church|mosque|non-?profit)\b/.test(text(a, 'industry', 'details', 'industry_other', 'details_other', 'needs'));
const heavy = a => ['mining', 'oil and gas', 'construction'].some(w => text(a, 'industry', 'details', 'industry_other', 'details_other').includes(w));  // sectors where a limited company and sector approvals are the norm
const unregistered = a => has(a, 'registered', 'not yet') || has(a, 'situation', 'nothing is registered yet') || (a.path === 'start' && !a.registered);

// which registration fits: trustees for an ngo, a limited company for contracts, partners, heavy sectors or bigger teams, else a business name
function regType(a) {
  if (isNgo(a)) return 'BZ-16';
  if (heavy(a) || ['contract', 'partnership'].includes(a.path) || has(a, 'team', '6 to 20', 'more than 20')) return 'BZ-02';
  return 'BZ-01';
}

const REG_REASON = {
  'BZ-01': 'you told us the business is not registered yet. a business name is the simplest start.',
  'BZ-02': 'you told us you are not registered yet. for your kind of work, a limited company is usually expected.',
  'BZ-16': 'you told us you are not registered yet. an ngo or association registers as incorporated trustees.',
};
const reg = (a, urg, reason) => { const code = regType(a); return [[code, urg, reason || REG_REASON[code]]]; };

// the first three industries we serve: each gets a starter roadmap built from the catalogue
const INDUSTRY_STARTERS = {
  cleaning: [['ST-04', 1, 'one place to track bookings, which team goes where, and what was paid.'],
    ['BZ-09', 1, 'clear terms for the cleaners you send into clients\' homes and offices.'],
    ['ST-02', 2, 'people search for cleaners nearby. a google profile helps them find you.'],
    ['MD-12', 2, 'regular clients are the heart of a cleaning business. this gives them a reason to rebook.'],
    ['HH-04', 2, 'simple checklists so every job is done the same way.'],
    ['MD-01', 3, 'a brand clients recognise on uniforms and messages.']],
  decoration: [['MD-02', 1, 'clients choose decorators by their past work. a profile and portfolio shows it.'],
    ['BZ-10', 1, 'clean quotes, invoices and receipts for materials and milestone payments.'],
    ['BZ-08', 1, 'an agreement that sets the scope, materials, approvals and payment stages.'],
    ['MD-07', 2, 'before and after photos are your best marketing. this sets up how you share them.'],
    ['ST-02', 2, 'so people searching nearby can find and call you.'],
    ['ST-04', 3, 'one place to track jobs, materials and payments.']],
  tailoring: [['ST-04', 1, 'one place for measurements, orders, fittings and collection dates.'],
    ['ST-01', 1, 'most orders come on whatsapp. a proper setup keeps them organised.'],
    ['BZ-10', 2, 'clear order slips, invoices and receipts, so deposits and balances are never in doubt.'],
    ['MD-07', 2, 'a steady way to show new styles and finished pieces.'],
    ['MD-01', 2, 'a label and look customers remember.'],
    ['MD-12', 3, 'a reason for customers to come back for the next occasion.']],
};

function industry(a) {
  const t = text(a, 'industry', 'industry_other', 'details', 'details_other', 'business');
  if (t.includes('cleaning')) return 'cleaning';
  if (t.includes('decorat') || t.includes('painting') || t.includes('interior')) return 'decoration';
  if (t.includes('tailor') || t.includes('fashion') || t.includes('sewing')) return 'tailoring';
  return '';
}

const RULES = [
  // where they are
  [a => a.path === 'start', [['HH-01', 1, 'you are starting out, so a clear direction comes first.'], ['MD-01', 2, 'a simple brand helps customers trust you from day one.'],
    ['ST-01', 2, 'an organised whatsapp captures your first enquiries.'], ['MD-03', 3, 'a clear offer sheet shows customers what they can buy.']]],
  [a => a.path === 'contract', [['BZ-08', 1, 'you won a contract, so the agreement should protect you before work starts.'],
    ['BZ-09', 2, 'the people delivering the contract need clear terms.'], ['BZ-10', 2, 'quotes, invoices and sign-offs keep the contract clean.'],
    ['BZ-17', 2, 'many contracts ask for nsitf compliance. we will check if yours does.'],
    ['BZ-18', 2, 'many contracts ask for pencom compliance. we will check if yours does.'],
    ['BZ-19', 2, 'public contracts usually need bpp registration. we will check if yours does.']]],
  [a => a.path === 'contract' && !has(a, 'team', 'just me'), [['HH-02', 2, 'clear roles help your team deliver on time.']]],
  [a => a.path === 'partnership', [['IW-02', 1, 'a readiness review shows what to fix before you apply.'], ['IW-03', 2, 'a strong application presents your project clearly.'],
    ['MD-02', 2, 'a company profile helps partners understand you quickly.']]],
  [a => a.path === 'grow', [['HH-01', 2, 'a clear direction keeps growth focused.']]],
  // registration
  [unregistered, a => [...reg(a, 1), ['BZ-03', 2, 'banks and clients will ask for a tin.']]],
  [a => Boolean(industry(a)), a => INDUSTRY_STARTERS[industry(a)]],
  [a => a.path === 'contract' && !unregistered(a), [['BZ-03', 2, 'contracts pay into a business with a tin. we will check yours is in order.']]],
  [a => has(a, 'registered', 'not sure'), [['BZ-13', 1, 'you were not sure about registration, so we will check exactly what applies to you.']]],
  [a => isNgo(a), [['BZ-07', 2, 'ngos and foundations usually need scuml. we will confirm it applies to you.']]],
  [a => ['mining', 'oil and gas'].some(w => text(a, 'industry', 'details', 'industry_other', 'details_other').includes(w)),
    [['BZ-06', 1, 'mining, oil and gas businesses usually need scuml. we will confirm it applies to you.'],
      ['BZ-14', 1, 'your sector needs its own approvals. this finds exactly which ones apply.'], ['BZ-20', 2, 'once we know the licence, we apply for it properly.']]],
  [a => ['real estate', 'hospitality'].some(w => text(a, 'industry', 'details').includes(w)), [['BZ-05', 2, 'property and hospitality businesses usually need scuml. we will confirm it applies to you.']]],
  // what slows them down
  [a => has(a, 'challenge', 'customers do not find us easily'), [['ST-02', 1, 'you said customers do not find you easily.'], ['MD-05', 2, 'a clear position makes you easier to choose.']]],
  [a => has(a, 'challenge', 'people ask, but do not buy'), [['MD-04', 1, 'you said people ask but do not buy. clear replies guide them to a decision.'], ['MD-06', 2, 'a follow-up process stops enquiries going cold.']]],
  [a => has(a, 'challenge', 'we do too much by hand'), [['ST-14', 2, 'you said you do too much by hand.'], ['HH-03', 2, 'written processes stop work depending on you.']]],
  [a => has(a, 'challenge', 'orders, records or money get lost'), [['ST-04', 1, 'you said orders, records or money get lost.'], ['FN-02', 2, 'proper records show where your money goes.']]],
  [a => has(a, 'challenge', 'our papers or compliance are not sorted'), [['BZ-13', 1, 'you said your papers are not sorted. this shows exactly what applies to you.']]],
  [a => has(a, 'challenge', 'we have no website or online presence'), [['ST-02', 1, 'you have no online presence yet. google is the quickest place to start.'], ['ST-06', 2, 'a website gives customers one clear place to reach you.']]],
  [a => has(a, 'challenge', 'the team needs better skills'), [['HB-02', 2, 'you said your team needs better skills.'], ['HH-02', 2, 'clear roles make training stick.']]],
  [a => has(a, 'challenge', 'we need funding to grow'), [['IW-02', 1, 'you said you need funding. this shows what to fix before you apply.'], ['FN-03', 2, 'funders look for a clear budget and cash-flow plan.']]],
  // what they want help with (holding questions)
  [a => has(a, 'needs', 'registration, documents and compliance'), a => [['BZ-13', 2, 'you asked for help with registration and compliance.'], ...reg(a, 2, 'we will confirm the right registration for you first.')]],
  [a => has(a, 'needs', 'a brand, logo and social media'), [['MD-01', 1, 'you asked for a brand and logo.'], ['MD-07', 2, 'a launch kit keeps your social media consistent.']]],
  [a => has(a, 'needs', 'marketing that brings customers'), [['MD-05', 1, 'you asked for marketing that brings customers.'], ['MD-11', 3, 'a focused campaign can bring enquiries once your offer is clear.']]],
  [a => has(a, 'needs', 'a website or online shop'), [['ST-06', 1, 'you asked for a website.'], ['ST-15', 3, 'an online store lets customers order and pay online.']]],
  [a => has(a, 'needs', 'ai tools that answer customers or do admin'), [['ST-01', 1, 'you asked for tools that answer customers.'], ['ST-14', 2, 'automation takes repeated admin off your hands.']]],
  [a => has(a, 'needs', 'automating repeated work (orders, invoices, reports)'), [['ST-14', 1, 'you asked to automate repeated work.'], ['BZ-10', 2, 'standard invoices and receipts make automation simple.']]],
  [a => has(a, 'needs', 'cctv, smart devices or installations'), [['IO-01', 1, 'you asked about devices or installations.']]],
  [a => has(a, 'needs', 'training for me or my team'), a => (has(a, 'team', '6 to 20', 'more than 20') ? [['HB-02', 1, 'you asked for training for your team.']]
    : [['HB-01', 1, 'you asked for training.'], ['HB-02', 2, 'team training helps everyone work the same way.']])],
  [a => has(a, 'needs', 'grants, funding or partnerships'), [['IW-02', 1, 'you asked about funding or partnerships.'], ['IW-01', 2, 'a partnership kit helps you approach the right partners.']]],
  // venture questions: bizdoc
  [a => has(a, 'needs', 'business registration or incorporation'), a => reg(a, 1, 'you asked for registration. we suggest the type that fits what you told us.')],
  [a => has(a, 'needs', 'cac changes (directors, shares, name)'), [['BZ-24', 1, 'you asked for cac changes.']]],
  [a => has(a, 'needs', 'tax registration, tin or annual returns'), [['BZ-03', 1, 'you asked about tax registration.'], ['BZ-21', 2, 'annual returns keep the business in good standing.'],
    ['BZ-22', 2, 'tax filings on time avoid penalties.']]],
  [a => has(a, 'needs', 'licences, permits or approvals for my sector') || has(a, 'situation', 'registered, i need licences or permits'),
    [['BZ-14', 1, 'you need sector approvals. this finds exactly which ones apply.'], ['BZ-20', 2, 'once we know the licence, we apply for it properly.']]],
  [a => has(a, 'needs', 'contracts, agreements or board resolutions'), [['BZ-08', 1, 'you asked for contracts and agreements.'], ['BZ-12', 2, 'a review finds risky terms before you sign.']]],
  [a => has(a, 'needs', 'a compliance check: what am i missing?'), [['BZ-13', 1, 'you asked for a compliance check.']]],
  [a => has(a, 'needs', 'renewals and ongoing compliance') || has(a, 'situation', 'i need renewals or filings'), [['BZ-15', 3, 'ongoing compliance keeps every deadline visible.'], ['BZ-21', 1, 'you need filings or renewals.'],
    ['BZ-23', 2, 'licences and permits renewed before they lapse.']]],
  [a => has(a, 'details', 'health', 'education', 'construction', 'real estate', 'manufacturing', 'agriculture', 'transport and logistics')
    || has(a, 'industry', 'health and care', 'real estate and building', 'manufacturing', 'food and drink', 'agriculture', 'education and training', 'logistics and transport', 'construction'),
  [['BZ-14', 2, 'your sector usually needs its own approvals. we will check which apply.']]],
  // venture questions: medialy
  [a => any(a, 'needs', 'a brand: name, logo and identity'), [['MD-01', 1, 'you asked for a brand.']]],
  [a => any(a, 'needs', 'company profile and marketing materials'), [['MD-02', 1, 'you asked for a company profile.']]],
  [a => any(a, 'needs', 'social media management'), [['MD-07', 1, 'a launch kit sets your social media up properly.'], ['MD-13', 2, 'monthly management keeps it consistent.']]],
  [a => any(a, 'needs', 'content, photos or video'), [['MD-07', 2, 'you asked for content.'], ['MD-13', 2, 'monthly content keeps you visible.']]],
  [a => any(a, 'needs', 'ads that bring customers'), [['MD-11', 1, 'you asked for ads that bring customers.'], ['MD-14', 3, 'monthly management improves ads over time.']]],
  [a => any(a, 'needs', 'a website or landing page that sells'), [['ST-06', 1, 'you asked for a website that sells.']]],
  [a => any(a, 'needs', 'market research or competitor insight'), [['MD-05', 1, 'research shapes a clear position.']]],
  [a => any(a, 'needs', 'more leads and better follow-up'), [['MD-06', 1, 'you asked for better follow-up.'], ['MD-15', 2, 'we can follow up enquiries for you every month.']]],
  // venture questions: subt
  [a => any(a, 'needs', 'a website or web app'), [['ST-06', 1, 'you asked for a website.']]],
  [a => any(a, 'needs', 'a mobile app', 'software for my operations'), [['ST-16', 1, 'custom software starts with a clear specification.']]],
  [a => any(a, 'needs', 'an ai assistant or chatbot'), [['ST-01', 1, 'an organised whatsapp is the base for any assistant.'], ['ST-14', 2, 'automation lets replies go out by themselves.']]],
  [a => any(a, 'needs', 'automating repeated work'), [['ST-14', 1, 'you asked to automate repeated work.']]],
  [a => any(a, 'needs', 'online booking, payments or an e-commerce store'), [['ST-15', 1, 'you asked for online orders and payments.']]],
  [a => any(a, 'needs', 'dashboards and reports'), [['ST-09', 1, 'you asked for dashboards.']]],
  [a => any(a, 'needs', 'support for a system i already have'), [['ST-17', 2, 'you asked for support on your existing system. we will check it first.']]],
  // venture questions: iotics
  [a => any(a, 'needs', 'smart home', 'cctv', 'smart access', 'lighting, power', 'sensors', 'industrial or farm', 'robotics or prototype'), [['IO-01', 1, 'an assessment finds the right devices for your space.']]],
  [a => any(a, 'needs', 'maintenance of existing devices'), [['IO-02', 1, 'you asked for maintenance of existing devices.']]],
  // venture questions: hub
  [a => any(a, 'needs', 'digital basics', 'ai for work', 'a professional course'), [['HB-01', 1, 'practical training you can use the next day.']]],
  [a => any(a, 'needs', 'training for my team', 'a workshop or bootcamp'), [['HB-02', 1, 'team training gets everyone working the same way.']]],
  // venture questions: iwiin
  [a => any(a, 'needs', 'find grants that fit me', 'a funding strategy'), [['IW-02', 1, 'a readiness review shows which opportunities fit you.'], ['IW-04', 3, 'monthly monitoring tells you about suitable opportunities when they open.']]],
  [a => any(a, 'needs', 'write a grant or funding proposal', 'scholarship, fellowship', 'ngo or impact project'), [['IW-03', 1, 'you asked for help with an application.']]],
  [a => any(a, 'needs', 'a business plan or pitch deck'), [['HH-01', 1, 'a clear business model is the core of a plan or pitch.']]],
  [a => any(a, 'needs', 'partnerships or sponsorships'), [['IW-01', 1, 'you asked for partnerships.']]],
  [a => any(a, 'needs', 'tender research and bid documents') || has(a, 'situation', 'a tender or contract'),
    [['IW-02', 1, 'a readiness review checks you against the tender.'], ['BZ-19', 2, 'public tenders usually need bpp registration.']]],
  [a => has(a, 'situation', 'a scholarship, fellowship or accelerator', 'a grant', 'investors'), [['IW-02', 1, 'a readiness review shows what to fix before you apply.']]],
  // size and maturity
  [a => has(a, 'team', '6 to 20', 'more than 20'), [['HH-02', 2, 'with a growing team, clear roles matter.'], ['BZ-09', 2, 'staff and contractors need clear agreements.'], ['ST-11', 3, 'more people means access needs managing.']]],
  [a => has(a, 'impact', 'my team works without me watching'), [['HH-03', 1, 'you want the team to work without you watching.'], ['HH-04', 2, 'simple routines keep everyone on track.']]],
  [a => has(a, 'impact', 'ready to grow or raise funding'), [['IW-02', 2, 'you want to be ready for funding.'], ['HH-06', 3, 'a growth plan shows how you will deliver more.']]],
  [a => has(a, 'impact', 'we make more money'), [['FN-01', 2, 'pricing that covers your costs is the quickest place to check.']]],
  [a => has(a, 'impact', 'more customers come back'), [['MD-12', 2, 'a simple retention programme gives customers a reason to return.']]],
  [a => any(a, 'needs', 'entrepreneurship and mentorship'), [['HH-01', 1, 'a clear business model is where mentorship starts.']]],
  [a => has(a, 'details', 'none of these yet') && has(a, 'venture', 'iwiin'), a => reg(a, 2, 'most funders ask for a registered organisation. we will confirm what you need.')],
  [a => has(a, 'stage', 'running more than 3 years'), [['BZ-11', 3, 'after years of building a name, protecting it makes sense.'], ['ST-12', 3, 'a tested backup protects years of records.']]],
];

const NEEDS_REGISTRATION = ['BZ-21', 'BZ-22', 'BZ-23', 'BZ-24', 'BZ-15', 'BZ-04'];  // these only apply once a business exists
const REGISTRATION = new Set(['BZ-01', 'BZ-02', 'BZ-16']);
const FALLBACK = ['HH-01', 2, 'we will look at your answers together and suggest where to start.'];

// compare tuples like python does
const cmp = (x, y) => { for (let i = 0; i < x.length; i++) { const a = +x[i], b = +y[i]; if (a !== b) return a < b ? -1 : 1; } return 0; };

// turn start-here answers into draft roadmap items: [{code, urgency, reason}], most urgent first.
// a person at the holding always reviews this before the client sees any price.
export function suggest(answers, limit = 10) {
  const a = { ...(answers || {}) };
  const picked = new Map(), order = new Map();
  for (const [test, items] of RULES) {
    let ok, rows;
    try {
      ok = test(a);
      rows = typeof items === 'function' ? items(a) : items;
    } catch {
      ok = false;
    }
    if (!ok) continue;
    for (const [code, urgency, reason] of rows) {
      if (!order.has(code)) order.set(code, order.size);
      if (!picked.has(code) || urgency < picked.get(code).urgency) picked.set(code, { code, urgency, reason });
    }
  }
  if (unregistered(a)) for (const code of NEEDS_REGISTRATION) picked.delete(code);
  // one registration and one scuml category only: keep the most urgent of each group (the type that fits wins a tie)
  const fit = regType(a);
  const byGroup = new Map();
  for (const code of [...picked.keys()].sort((x, y) => order.get(x) - order.get(y))) {
    const g = BY_CODE[code].group;
    if (!g) continue;
    if (byGroup.has(g)) {
      const key = c => [picked.get(c).urgency, c !== fit, order.get(c)];
      const [keep, drop] = [byGroup.get(g), code].sort((x, y) => cmp(key(x), key(y)));
      picked.delete(drop);
      byGroup.set(g, keep);
    } else {
      byGroup.set(g, code);
    }
  }
  // a compliance check is not needed when we already know the registration to do
  if ([...picked.keys()].some(c => REGISTRATION.has(c)) && picked.has('BZ-13') && unregistered(a)) picked.delete('BZ-13');
  // overlapping services: keep the more urgent one, never both
  const rank2 = c => [picked.get(c).urgency, order.get(c)];
  for (const code of [...picked.keys()].sort((x, y) => cmp(rank2(x), rank2(y)))) {
    if (!picked.has(code)) continue;
    const others = new Set([...BY_CODE[code].overlaps, ...[...picked.keys()].filter(c => BY_CODE[c].overlaps.includes(code))]);
    for (const other of others) {
      if (picked.has(other) && cmp(rank2(other), rank2(code)) > 0) picked.delete(other);
    }
  }
  // a needs-first item brings its requirement along, at the same urgency
  for (const code of [...picked.keys()]) {
    for (const req of BY_CODE[code].requires) {
      if (req === 'BZ-02' && !picked.has('BZ-02')) continue;  // a banking resolution only applies to companies that already exist
      if (!picked.has(req)) {
        if (!order.has(req)) order.set(req, order.get(code) - 0.5);
        picked.set(req, { code: req, urgency: picked.get(code).urgency, reason: `needed before ${BY_CODE[code].name}.` });
      }
    }
  }
  if (!picked.size) {
    picked.set(FALLBACK[0], { code: FALLBACK[0], urgency: FALLBACK[1], reason: FALLBACK[2] });
    order.set(FALLBACK[0], 0);
  }
  // urgent requests lift the top setup items (never a monthly service)
  const hot = ['today or tomorrow', 'this week', 'within 2 weeks'].includes(String(a.urgency ?? '')) || ['8', '9', '10'].includes(String(a.importance ?? ''))
    || String(a.timing ?? '') === 'right away';
  const rank = x => [x.urgency, !REGISTRATION.has(x.code), order.get(x.code)];  // registration leads its urgency
  const out = [...picked.values()].sort((x, y) => cmp(rank(x), rank(y)));
  if (hot) {
    for (const x of out.slice(0, 3)) if (x.urgency === 2 && BY_CODE[x.code].basis !== 'monthly') x.urgency = 1;
    out.sort((x, y) => cmp(rank(x), rank(y)));
  }
  return out.slice(0, limit);
}

// short plain phrases for the client: what we will look at first. no prices.
export function focusLines(suggested, n = 3) {
  const lines = [];
  for (const x of suggested) {
    const f = BY_CODE[x.code]?.focus;
    if (f && !lines.includes(f)) lines.push(f);
    if (lines.length === n) break;
  }
  return lines;
}
