// the client journey, the desk and the money rules. ported one-for-one from the python suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as CAT from '../lib/catalogue.js';
import { addDays, addMonth, daysIn, vatOf } from '../lib/app.js';
import { ANSWERS, Client, makeApp, paidJob, pkg, publish, setupMonthly, staff, start } from './helpers.js';

const checkout = (client, items, method = 'transfer', extra = {}) => client.post('/api/client/checkout', { json: { accept_terms: true, items, method, ...extra } });
const me = async client => (await client.get('/api/client/me')).json();

test('pages and basics', async () => {
  const app = await makeApp();
  const t = new Client(app);
  for (const p of ['/', '/start', '/track', '/admin', '/privacy', '/static/style.css', '/static/img/hamzury.png']) assert.equal((await t.get(p)).status, 200, p);
  assert.ok(!(await t.get('/')).text.includes('—'));
  assert.equal((await t.get('/api/client/me')).status, 401);
  assert.equal((await t.get('/api/admin/clients')).status, 401);
  assert.equal((await t.post('/api/start', { json: { answers: ANSWERS, name: 'Ada', phone: '+2348030000001' } })).status, 400);  // consent
  assert.equal((await t.post('/api/start', { json: { answers: { ...ANSWERS, path: 'nonsense' }, name: 'Ada', phone: '+2348030000001', consent: true } })).status, 400);
});

test('full journey', async () => {
  const app = await makeApp();
  const [client, ref] = await start(app);
  let m = await me(client);
  assert.ok(ref.startsWith('HZ-'));
  assert.equal(m.step, 2); assert.equal(m.recommendation, null);
  // returning client logs in with id + phone (any formatting)
  const other = new Client(app);
  assert.equal((await other.post('/api/client/login', { json: { ref, phone: '08030000002' } })).status, 401);
  assert.equal((await other.post('/api/client/login', { json: { ref: ref.toLowerCase().replace('hz-', ''), phone: '0803 000 0001' } })).status, 200);

  const admin = await staff(app);
  const p1 = (await admin.post('/api/admin/packages', { json: { venture: 'medialy', name: 'brand starter', summary: 'a clear brand',
    inclusions: ['logo refresh', 'brand guide'], value: 'look consistent everywhere', duration: '3 weeks',
    price_minor: 15000000, stage: 'strategy', onboarding: [{ label: 'link to your current logo', kind: 'text' }] } })).json().id;
  const p2 = (await admin.post('/api/admin/packages', { json: { venture: 'subt', name: 'order tracker', price_minor: 20000000, inclusions: ['whatsapp order form'], duration: '4 weeks', onboarding: [] } })).json().id;
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  assert.ok((await admin.get(`/api/admin/clients/${cid}`)).json().intake.challenge.startsWith('orders'));
  assert.equal((await admin.post(`/api/admin/clients/${cid}/recommendation/publish`)).status, 400);
  assert.equal((await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { heard: 'you lose orders', advice: 'start with brand and tracking',
    items: [{ package_id: p1, priority: 1, note: 'first' }, { package_id: p2, priority: 2, price_minor: 18000000 }] } })).status, 200);
  assert.equal((await me(client)).recommendation, null);  // drafts stay private
  assert.equal((await admin.post(`/api/admin/clients/${cid}/recommendation/publish`)).status, 200);

  m = await me(client);
  assert.equal(m.step, 3);
  const items = m.recommendation.items;
  assert.deepEqual(items.map(i => i.package.price_minor), [15000000, 18000000]);
  assert.deepEqual(items[0].package.inclusions, ['logo refresh', 'brand guide']);
  // client chooses only the first package and pays by transfer
  assert.equal((await checkout(client, [items[0].id], 'paystack')).status, 400);  // not configured
  const order = (await checkout(client, [items[0].id])).json();
  assert.equal(order.total_minor, 15000000);
  assert.equal((await client.post(`/api/client/orders/${order.order_id}/transfer`, { json: { note: 'sent from gtb' } })).status, 200);
  assert.equal((await admin.get('/api/admin/overview')).json().payments_to_confirm, 1);
  assert.equal((await admin.post(`/api/admin/orders/${order.order_id}/confirm`)).status, 200);
  assert.equal((await admin.post(`/api/admin/orders/${order.order_id}/confirm`)).status, 409);

  m = await me(client);
  assert.equal(m.step, 4);
  const owned = m.recommendation.items.filter(i => i.owned), locked = m.recommendation.items.filter(i => !i.owned);
  assert.ok(owned.length === 1 && locked.length === 1 && owned[0].engagement.status === 'awaiting_onboarding');
  const eid = owned[0].engagement.id;
  assert.equal((await client.post(`/api/client/engagements/${eid}/onboarding`, { json: { answers: {} } })).status, 400);
  assert.equal((await client.post(`/api/client/engagements/${eid}/onboarding`, { json: { answers: { 'link to your current logo': 'drive link' } } })).status, 200);
  assert.equal((await me(client)).step, 5);
  assert.equal((await client.get(`/api/client/engagements/${eid}/download`)).status, 404);  // not delivered

  // delivery: cannot deliver without a file; venture staff cannot deliver
  assert.equal((await admin.patch(`/api/admin/engagements/${eid}`, { json: { status: 'in_progress', progress: 40 } })).status, 200);
  const up = await admin.post(`/api/admin/clients/${cid}/updates`, { json: { engagement_id: eid, progress: 'logo drafts done', next_action: 'review drafts' } });
  assert.ok(up.json().whatsapp_text.includes(ref));
  assert.equal((await admin.patch(`/api/admin/engagements/${eid}`, { json: { status: 'delivered' } })).status, 400);
  assert.equal((await admin.post(`/api/admin/engagements/${eid}/file`, { files: { file: ['run.exe', 'x'] } })).status, 400);
  assert.equal((await admin.post(`/api/admin/engagements/${eid}/file`, { files: { file: ['brand-guide.pdf', '%PDF-1.4 test'] } })).status, 200);
  await admin.post('/api/users', { json: { username: 'med', display_name: 'medialy ceo', password: 'venture-only-strong-pass', role: 'venture_ceo', venture: 'medialy' } });
  const ven = await staff(app, 'med', 'venture-only-strong-pass');
  assert.equal((await ven.get('/api/admin/clients')).status, 403);
  assert.equal((await ven.get('/api/admin/engagements')).json().length, 1);
  assert.equal((await ven.patch(`/api/admin/engagements/${eid}`, { json: { status: 'delivered' } })).status, 403);
  assert.equal((await admin.patch(`/api/admin/engagements/${eid}`, { json: { status: 'delivered' } })).status, 200);
  m = await me(client);
  const e = m.recommendation.items.find(i => i.owned).engagement;
  assert.ok(e.has_file && e.progress === 100 && m.updates[0].progress === 'logo drafts done');
  const dl = await client.get(`/api/client/engagements/${eid}/download`);
  assert.equal(dl.status, 200); assert.ok(dl.text.startsWith('%PDF'));
  assert.equal((await new Client(app).get(`/api/client/engagements/${eid}/download`)).status, 401);
  // the locked package can still be added later; paid ones cannot be bought twice or removed
  assert.equal((await checkout(client, [owned[0].id])).status, 409);
  assert.equal((await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { heard: '', advice: 'x', items: [{ package_id: p2 }] } })).status, 409);
  assert.equal((await checkout(client, [locked[0].id])).json().total_minor, 18000000);
});

test('client isolation', async () => {
  const app = await makeApp();
  const [a, refA] = await start(app);
  const b = new Client(app);
  const rb = (await b.post('/api/start', { json: { answers: ANSWERS, name: 'Bola', phone: '+2348039999999', consent: true } })).json();
  b.headers['X-CSRF-Token'] = rb.csrf;
  const admin = await staff(app);
  const pid = (await admin.post('/api/admin/packages', { json: { venture: 'bizdoc', name: 'annual returns', price_minor: 5000000 } })).json().id;
  const ids = Object.fromEntries((await admin.get('/api/admin/clients')).json().map(c => [c.ref, c.id]));
  await admin.put(`/api/admin/clients/${ids[refA]}/recommendation`, { json: { advice: 'file returns', items: [{ package_id: pid }] } });
  await admin.post(`/api/admin/clients/${ids[refA]}/recommendation/publish`);
  const item = (await me(a)).recommendation.items[0].id;
  assert.equal((await checkout(b, [item])).status, 409);  // b has no recommendation
  const o = (await checkout(a, [item])).json();
  assert.equal((await b.post(`/api/client/orders/${o.order_id}/transfer`, { json: {} })).status, 404);
  const noCsrf = new Client(app);
  noCsrf.cookies = { ...a.cookies };
  assert.equal((await checkout(noCsrf, [item])).status, 403);
});

test('paystack verification', async () => {
  const app = await makeApp();
  app.cfg.PAYSTACK_SECRET = 'sk_test_fake';
  let amount = 0;
  app.paystack = async (method, p) => (p === '/transaction/initialize'
    ? { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } }
    : { status: true, data: { status: 'success', amount, currency: 'NGN' } });
  const [client] = await start(app);
  const admin = await staff(app);
  const pid = (await admin.post('/api/admin/packages', { json: { venture: 'subt', name: 'website', price_minor: 30000000 } })).json().id;
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { advice: 'a site', items: [{ package_id: pid }] } });
  await admin.post(`/api/admin/clients/${cid}/recommendation/publish`);
  const item = (await me(client)).recommendation.items[0].id;
  assert.equal((await checkout(client, [item], 'paystack')).status, 400);  // needs email
  const r = (await checkout(client, [item], 'paystack', { email: 'ada@example.com' })).json();
  assert.ok(r.redirect.startsWith('https://checkout.paystack.com'));
  amount = 1;  // wrong amount must not mark paid
  await client.get('/pay/callback?reference=' + r.reference);
  assert.equal((await me(client)).step, 3);
  amount = 30000000;
  const res = await client.get('/pay/callback?reference=' + r.reference);
  assert.equal(res.status, 303);
  assert.equal((await me(client)).step, 5);  // no onboarding questions, straight to progress
});

test('venture pages and branded start', async () => {
  const app = await makeApp();
  const t = new Client(app);
  const admin = await staff(app);
  await admin.post('/api/admin/packages', { json: { venture: 'bizdoc', name: 'annual returns', price_minor: 5000000, inclusions: ['filing'] } });
  await admin.post('/api/admin/packages', { json: { venture: 'bizdoc', name: 'hidden', price_minor: 1, active: false } });
  assert.equal((await t.get('/v/bizdoc')).status, 200); assert.equal((await t.get('/v/nope')).status, 404);
  const v = (await t.get('/api/public/ventures/bizdoc')).json();
  assert.equal(v.site, 'https://bizdocconsult.com');
  assert.ok(v.services.map(s => s.name).includes('annual returns') && !v.services.map(s => s.name).includes('hidden'));
  assert.ok(!('price_minor' in v.services[0]));
  assert.equal((await t.get('/api/public/ventures/medialy')).json().site, '');  // unconfirmed address stays hidden
  const answers = { ...ANSWERS, venture: 'bizdoc', tried: ['doing it myself'], impact: ['less stress'], importance: '9' };
  const r = await t.post('/api/start', { json: { answers, name: 'Bisi', phone: '+2348031111111', consent: true } });
  assert.equal(r.status, 200);
  t.headers['X-CSRF-Token'] = r.json().csrf;
  assert.equal((await me(t)).told.importance, '9');
  const row = (await admin.get('/api/admin/clients')).json()[0];
  assert.equal(row.source, 'bizdoc'); assert.deepEqual(row.intake.impact, ['less stress']);
});

test('assign, report, publish', async () => {
  const app = await makeApp();
  const [client, ref] = await start(app);
  const admin = await staff(app);
  const pid = (await admin.post('/api/admin/packages', { json: { venture: 'subt', name: 'order tracker', price_minor: 20000000 } })).json().id;
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { advice: 'tracker', items: [{ package_id: pid }] } });
  await admin.post(`/api/admin/clients/${cid}/recommendation/publish`);
  const item = (await me(client)).recommendation.items[0].id;
  const o = (await checkout(client, [item])).json();
  await admin.post(`/api/admin/orders/${o.order_id}/confirm`);
  const eid = (await admin.get('/api/admin/engagements')).json()[0].id;
  const sid = (await admin.post('/api/users', { json: { username: 'subtdev', display_name: 'subt dev', password: 'venture-only-strong-pass', role: 'venture_admin', venture: 'subt' } })).json().id;
  const mid = (await admin.post('/api/users', { json: { username: 'meddev', display_name: 'medialy dev', password: 'venture-only-strong-pass', role: 'venture_admin', venture: 'medialy' } })).json().id;
  assert.equal((await admin.post(`/api/admin/engagements/${eid}/assign`, { json: { assigned_user_id: mid } })).status, 400);  // wrong venture
  assert.equal((await admin.post(`/api/admin/engagements/${eid}/assign`, { json: { assigned_user_id: sid, due_date: '2026-12-01', brief: 'build the order form' } })).status, 200);
  const ven = await staff(app, 'subtdev', 'venture-only-strong-pass');
  const work = (await ven.get('/api/admin/engagements')).json();
  assert.equal(work[0].brief, 'build the order form'); assert.ok(work[0].situation.challenge.startsWith('orders'));
  assert.equal((await ven.get('/api/admin/overview')).json().assigned_to_me, 1);
  // ventures cannot talk to the client or change client-visible progress directly
  assert.equal((await ven.post(`/api/admin/clients/${cid}/updates`, { json: { engagement_id: eid, progress: 'xxxxx', next_action: 'yyyyy' } })).status, 403);
  assert.equal((await ven.patch(`/api/admin/engagements/${eid}`, { json: { progress: 50 } })).status, 403);
  const rid = (await ven.post(`/api/admin/engagements/${eid}/reports`, { json: { progress: 50, done: 'order form built', next_step: 'test with client' } })).json().id;
  assert.equal((await me(client)).recommendation.items[0].engagement.progress, 0);  // not yet visible
  assert.equal((await admin.get('/api/admin/overview')).json().reports_to_review, 1);
  assert.equal((await ven.post(`/api/admin/reports/${rid}/publish`, { json: { progress: 50, done: 'xxxxx', next_step: 'yyyyy' } })).status, 403);
  assert.equal((await admin.post(`/api/admin/reports/${rid}/return`, { json: { note: 'add a screenshot' } })).status, 200);
  assert.equal((await ven.get('/api/admin/overview')).json().returned, 1);
  const rid2 = (await ven.post(`/api/admin/engagements/${eid}/reports`, { json: { progress: 80, done: 'order form built and tested', next_step: 'final check', ready: true } })).json().id;
  const pub = await admin.post(`/api/admin/reports/${rid2}/publish`, { json: { progress: 80, done: 'your order form is built and tested.', next_step: 'we do a final quality check.' } });
  assert.equal(pub.status, 200); assert.ok(pub.json().whatsapp_text.includes(ref));
  const m = await me(client);
  const e = m.recommendation.items[0].engagement;
  assert.ok(e.progress === 80 && e.status === 'review' && m.updates[0].progress === 'your order form is built and tested.');
  assert.equal((await admin.post(`/api/admin/reports/${rid2}/publish`, { json: { progress: 80, done: 'xxx', next_step: 'yyy' } })).status, 409);
});

test('quick route, links, events, nudges, insights', async () => {
  const app = await makeApp();
  const t = new Client(app);
  const quick = { route: 'quick', needs: ['a website or online shop', 'other'], needs_other: 'a booking page', urgency: 'this week', business: 'Speedy Ltd', src: 'wa' };
  const r = await t.post('/api/start', { json: { answers: quick, name: 'Kunle', phone: '08035550000', consent: true } });
  assert.equal(r.status, 200, r.text);
  for (const step of [0, 0, 1, 2]) assert.equal((await t.post('/api/events', { json: { flow: 'route', step } })).status, 200);
  assert.equal((await t.post('/api/events', { json: { flow: 'nope', step: 1 } })).status, 422);
  assert.equal((await t.get('/api/public/config')).json().quick_reply_hours, 24);
  const admin = await staff(app);
  const row = (await admin.get('/api/admin/clients')).json()[0];
  assert.equal(row.path, 'quick'); assert.equal(row.intake.needs_other, 'a booking page');
  const n = (await admin.get('/api/admin/nudges')).json();
  assert.equal(n[0].kind, 'urgent'); assert.equal(n[0].template, 'quick_reply');
  const ins = (await admin.get('/api/admin/insights')).json();
  assert.equal(ins.funnel.started_questions, 2); assert.equal(ins.funnel.finished_questions, 1);
  assert.deepEqual(ins.by_route, { quick: 1 }); assert.deepEqual(ins.by_source, { whatsapp: 1 });
  // private whatsapp link opens the client app without id and phone
  const link = (await admin.post(`/api/admin/clients/${row.id}/link`, { json: { dest: 'recommendation' } })).json();
  assert.ok(link.path.startsWith('/track?t=') && link.path.endsWith('#recommendation'));
  const token = link.path.split('t=')[1].split('#')[0];
  const fresh = new Client(app);
  assert.equal((await fresh.get('/api/client/me')).status, 401);
  const lg = await fresh.post('/api/client/link', { json: { token } });
  assert.equal(lg.status, 200); assert.equal(lg.json().dest, 'recommendation');
  fresh.headers['X-CSRF-Token'] = lg.json().csrf;
  assert.equal((await me(fresh)).ref, row.ref);
  assert.equal((await new Client(app).post('/api/client/link', { json: { token: 'x'.repeat(40) } })).status, 401);
  await app.sql('UPDATE client_links SET expires_at=0');
  assert.equal((await new Client(app).post('/api/client/link', { json: { token } })).status, 401);
  assert.equal((await new Client(app).post('/api/admin/clients/1/link', { json: { dest: 'home' } })).status, 401);
});

test('roadmap rules: choose one, needs first, i have this', async () => {
  const app = await makeApp();
  const [client] = await start(app);
  const admin = await staff(app);
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const [bn, ltd, ngo, tm, sav] = await Promise.all(['BZ-01', 'BZ-02', 'BZ-16', 'BZ-04', 'MD-01'].map(x => pkg(admin, x)));
  for (const p of [bn, ltd, ngo, tm, sav]) if (p.price_status !== 'approved') assert.equal((await admin.post(`/api/admin/packages/${p.id}/approve`, { json: {} })).status, 200);
  assert.equal((await publish(admin, cid, [{ package_id: bn.id, priority: 1 }, { package_id: ltd.id, priority: 1 }, { package_id: ngo.id, priority: 3 },
    { package_id: tm.id, priority: 2 }, { package_id: sav.id, priority: 3, level: 'scaling' }])).status, 200);
  const m = await me(client);
  const ids = Object.fromEntries(m.recommendation.items.map(i => [i.package.code, i]));
  assert.equal(ids['BZ-02'].package.group, 'cac-registration'); assert.deepEqual(ids['BZ-04'].package.requires, ['BZ-02']);
  assert.deepEqual(m.focus, []);  // published: the roadmap speaks for itself
  const co = (...codes) => checkout(client, codes.map(c => ids[c].id));
  // no level lock: a scaling item can be chosen on its own
  assert.equal((await co('MD-01')).status, 200);
  // choose one: two registration types together are refused
  let r = await co('BZ-01', 'BZ-02');
  assert.equal(r.status, 409); assert.ok(r.json().detail.includes('choose one'));
  // needs first: trademark without the company registration is refused, with both it is fine
  r = await co('BZ-04');
  assert.equal(r.status, 400); assert.ok(r.json().detail.includes(ids['BZ-02'].package.name));
  assert.equal((await co('BZ-02', 'BZ-04')).status, 200);
  // one open purchase at a time: the earlier unpaid one was replaced
  assert.deepEqual((await me(client)).orders.map(o => o.status).slice(0, 2), ['pending', 'cancelled']);
  // "i have this" covers what is needed first
  assert.equal((await client.post(`/api/client/items/${ids['BZ-02'].id}/have`, { json: { has: true } })).status, 200);
  assert.equal((await co('BZ-04')).status, 200);
  // "i have this" on one registration type counts as the choice: undo it to choose another
  assert.equal((await co('BZ-16')).status, 409);
  assert.equal((await client.post(`/api/client/items/${ids['BZ-02'].id}/have`, { json: { has: false } })).status, 200);
  assert.equal((await co('BZ-16')).status, 200);
  const oid = (await me(client)).orders[0].id;
  assert.equal((await admin.post(`/api/admin/orders/${oid}/confirm`)).status, 200);
  r = await co('BZ-01');
  assert.equal(r.status, 409); assert.ok(r.json().detail.includes(ngo.name));
  // save for later
  assert.equal((await client.post(`/api/client/items/${ids['MD-01'].id}/save`, { json: { saved: true } })).status, 200);
  assert.ok(Object.fromEntries((await me(client)).recommendation.items.map(i => [i.package.code, i]))['MD-01'].saved);
  assert.equal((await client.post(`/api/client/items/${ids['MD-01'].id}/have`, { json: { has: true } })).status, 200);
  assert.ok((await admin.get(`/api/admin/clients/${cid}`)).json().recommendation.items.some(i => i.client_has));
  // another client cannot touch these items
  const other = new Client(app);
  const o = (await other.post('/api/start', { json: { answers: ANSWERS, name: 'Bola', phone: '+234 803 000 0009', consent: true } })).json();
  other.headers['X-CSRF-Token'] = o.csrf;
  assert.equal((await other.post(`/api/client/items/${ids['MD-01'].id}/have`, { json: { has: true } })).status, 404);
  assert.equal((await other.post(`/api/client/items/${ids['MD-01'].id}/save`, { json: { saved: true } })).status, 404);
});

test('answers make a draft and prices need approval', async () => {
  const app = await makeApp();
  const t = new Client(app);
  const ans = { ...ANSWERS, path: 'start', registered: 'not yet', needs: ['register my business'] };
  const r = await t.post('/api/start', { json: { answers: ans, name: 'Idea Owner', phone: '+234 803 000 0011', consent: true } });
  assert.equal(r.status, 200); assert.ok(r.json().focus.length, r.text);
  t.headers['X-CSRF-Token'] = r.json().csrf;
  const m = await me(t);
  assert.equal(m.recommendation, null); assert.deepEqual(m.focus, r.json().focus);
  assert.ok(!m.focus.join(' ').includes('₦') && !m.focus.join(' ').includes(',000'));
  const admin = await staff(app);
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const rec = (await admin.get(`/api/admin/clients/${cid}`)).json().recommendation;
  const codes = rec.items.map(i => i.code);
  assert.ok(codes.includes('BZ-01')); assert.equal(rec.status, 'draft');
  assert.equal(codes.filter(x => ['BZ-01', 'BZ-02', 'BZ-16'].includes(x)).length, 1);  // one registration type
  // proposed prices block publishing until the holding approves them
  const pr = await admin.post(`/api/admin/clients/${cid}/recommendation/publish`);
  assert.equal(pr.status, 400); assert.ok(pr.json().detail.includes('approve these prices'));
  const bn = await pkg(admin, 'BZ-01');
  assert.equal((await admin.post(`/api/admin/packages/${bn.id}/approve`, { json: { price_minor: 2500000 } })).status, 200);
  assert.equal((await publish(admin, cid, [{ package_id: bn.id, priority: 1 }])).status, 200);
  const item = (await me(t)).recommendation.items[0];
  assert.equal(item.package.price_minor, 2500000); assert.equal(item.package.price_status, 'approved');
  // staff without the holding role cannot approve prices
  assert.equal((await admin.post('/api/users', { json: { username: 'bzceo', display_name: 'bizdoc ceo', role: 'venture_ceo', venture: 'bizdoc', password: 'venture-only-strong-pass' } })).status, 200);
  const bz = await staff(app, 'bzceo', 'venture-only-strong-pass');
  assert.ok([401, 403].includes((await bz.post(`/api/admin/packages/${bn.id}/approve`, { json: {} })).status));
});

test('scuml, free note, durations and catalogue', () => {
  const by = CAT.BY_CODE;
  assert.ok(['BZ-05', 'BZ-06', 'BZ-07', 'BZ-02'].every(c => by[c].duration.startsWith('5')));
  assert.ok(by['BZ-16'].duration.startsWith('30') && by['BZ-01'].duration.startsWith('14'));
  assert.ok(['BZ-17', 'BZ-18', 'BZ-19'].every(c => by[c].duration.startsWith('14')));
  assert.ok(by['BZ-05'].external.includes('free'));
  const outside = new Set(['BZ-01', 'BZ-03', 'BZ-11', 'BZ-16', 'BZ-17', 'BZ-18', 'BZ-19', 'BZ-20', 'BZ-21', 'BZ-22', 'BZ-23', 'BZ-24']);  // wait on cac, firs, the trademarks registry, agencies
  for (const i of CAT.CATALOGUE) {
    assert.ok(i.name === i.name.toLowerCase() && !(i.value + i.name).includes('—'));
    const d = i.duration.replace('within ', '');
    if (/^\d/.test(d) && !outside.has(i.code)) assert.ok(parseInt(d, 10) <= 7, `${i.code} ${i.duration}`);  // anything we produce: 7 days at most
    if (outside.has(i.code) && i.code !== 'BZ-16') assert.ok(d.startsWith('14'), `${i.code} ${i.duration}`);
  }
  assert.equal(by['ST-06'].price_minor, 18000000); assert.equal(by['ST-15'].price_minor, 35000000);
});

test('monthly by transfer: invoices, reminders, pauses and cancels', async () => {
  const app = await makeApp();
  const { client, admin, m, item } = await setupMonthly(app);
  const r = (await checkout(client, [item])).json();
  assert.equal(r.total_minor, m.price_minor);  // the first month is paid upfront
  await admin.post(`/api/admin/orders/${r.order_id}/confirm`);
  let s = (await me(client)).subscriptions[0];
  assert.equal(s.status, 'active'); assert.equal(s.amount_minor, m.price_minor);
  const due = s.next_due;
  assert.equal((await app.billingRun(addDays(due, -4))).invoiced, 0);
  assert.equal((await app.billingRun(addDays(due, -3))).invoiced, 1);
  assert.equal((await app.billingRun(addDays(due, -2))).invoiced, 0);  // once only
  let mm = await me(client);
  assert.equal(mm.invoices.length, 1); assert.equal(mm.orders[0].status, 'paid');  // purchases and invoices stay apart
  let kinds = (await admin.get('/api/admin/nudges')).json().map(n => n.kind);
  assert.ok(kinds.includes('renewal_due') && !kinds.includes('payment_pending'));
  await app.billingRun(addDays(due, 1));
  assert.ok((await admin.get('/api/admin/nudges')).json().map(n => n.kind).includes('renewal_overdue'));
  assert.equal((await app.billingRun(addDays(due, 8))).paused, 1);
  assert.equal((await me(client)).subscriptions[0].status, 'paused');
  // paying the invoice late restarts the service from today
  const inv = (await me(client)).invoices[0];
  assert.equal((await client.post(`/api/client/orders/${inv.id}/transfer`, { json: { note: 'paid' } })).status, 200);
  await admin.post(`/api/admin/orders/${inv.id}/confirm`);
  s = (await me(client)).subscriptions[0];
  assert.equal(s.status, 'active'); assert.ok(s.next_due > due);
  // cancel: runs to the end of the paid month, then ends without a new invoice
  assert.equal((await client.post(`/api/client/subscriptions/${s.id}/cancel`)).json().cancel_at, s.next_due);
  assert.equal((await client.post(`/api/client/subscriptions/${s.id}/keep`)).json().cancel_at, null);
  await client.post(`/api/client/subscriptions/${s.id}/cancel`);
  const end = s.next_due;
  assert.equal((await app.billingRun(addDays(end, -3))).invoiced, 0);
  assert.equal((await app.billingRun(end)).ended, 1);
  assert.deepEqual((await me(client)).subscriptions, []);
  // the cron door needs the key
  assert.equal((await new Client(app).post('/api/billing/run')).status, 401);
  app.cfg.BILLING_KEY = 'k'.repeat(40);
  assert.equal((await new Client(app).post('/api/billing/run', { headers: { 'X-Billing-Key': 'k'.repeat(40) } })).status, 200);
});

test('monthly by card: charges, retries, never charges twice', async () => {
  const app = await makeApp();
  app.cfg.PAYSTACK_SECRET = 'sk_test_fake';
  const state = { charge: 'success', verify: 'success', calls: [] };
  app.paystack = async (method, p, payload) => {
    state.calls.push(p.split('/').length > 2 ? p.split('/')[2] : p);
    if (p === '/transaction/initialize') return { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } };
    if (p === '/transaction/charge_authorization') return { status: true, data: { status: state.charge, amount: payload.amount, currency: 'NGN' } };
    const [o] = await app.sql('SELECT total_minor FROM orders WHERE reference=?', p.split('/').pop());
    return { status: true, data: { status: state.verify, amount: o.total_minor, currency: 'NGN', authorization: { reusable: true, authorization_code: 'AUTH_x' } } };
  };
  const { client, item } = await setupMonthly(app);
  const r = (await checkout(client, [item], 'paystack', { email: 'ada@example.com' })).json();
  await client.get('/pay/callback?reference=' + r.reference);
  const s = (await me(client)).subscriptions[0];
  assert.equal(s.method, 'paystack');
  const due = s.next_due;
  assert.equal((await app.billingRun(addDays(due, -1))).charged, 0);  // cards are charged on the day
  assert.equal((await app.billingRun(due)).charged, 1);
  const s2 = (await me(client)).subscriptions[0];
  assert.ok(s2.next_due > s.next_due && s2.status === 'active');
  // a declined card: grace, the invoice stays open for the client, no retry inside two days
  state.charge = 'failed';
  const due2 = s2.next_due;
  assert.equal((await app.billingRun(due2)).declined, 1);
  assert.equal((await app.billingRun(due2)).declined, 0);
  let m = await me(client);
  assert.equal(m.subscriptions[0].status, 'grace'); assert.equal(m.invoices.length, 1);
  // an attempt still with the bank is never charged again
  await app.sql("UPDATE orders SET created_at=ts_ago('3 days') WHERE kind='renewal' AND status='pending'");
  state.verify = 'ongoing';
  const n = state.calls.filter(x => x === 'charge_authorization').length;
  await app.billingRun(addDays(due2, 2));
  assert.equal(state.calls.filter(x => x === 'charge_authorization').length, n);
  // once the bank says it failed, we try again with a fresh reference
  state.verify = 'failed'; state.charge = 'success';
  assert.equal((await app.billingRun(addDays(due2, 2))).charged, 1);
  m = await me(client);
  assert.equal(m.subscriptions[0].status, 'active'); assert.deepEqual(m.invoices, []);
});

test('plan eta and ask-first items', async () => {
  const app = await makeApp();
  const [client] = await start(app);
  const admin = await staff(app);
  const a = (await admin.post('/api/admin/packages', { json: { venture: 'bizdoc', name: 'registration', price_minor: 5000000, inclusions: [], onboarding: [] } })).json().id;
  const tax = (await admin.post('/api/admin/packages', { json: { venture: 'bizdoc', name: 'tax filing', price_minor: 0, inclusions: [], onboarding: [{ label: 'when is your filing due?', kind: 'text' }] } })).json().id;
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  assert.equal((await admin.patch(`/api/admin/clients/${cid}`, { json: { plan_eta: 'within 4 working hours' } })).status, 200);
  assert.equal((await me(client)).plan_eta, 'within 4 working hours');
  assert.equal((await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { heard: '', advice: 'a', items: [
    { package_id: a, level: 'minimum', priority: 1 }, { package_id: tax, level: 'renewals', quote: 'ask' }] } })).status, 200);
  assert.equal((await admin.post(`/api/admin/clients/${cid}/recommendation/publish`)).status, 200);
  const items = Object.fromEntries((await me(client)).recommendation.items.map(i => [i.package.name, i]));
  assert.equal(items['tax filing'].quote, 'ask'); assert.equal(items['tax filing'].level, 'renewals');
  // renewals is always open, but an ask-first item cannot be paid before the desk sends the route
  const r = await checkout(client, [items['tax filing'].id]);
  assert.equal(r.status, 400); assert.ok(r.json().detail.includes('route'));
  assert.equal((await client.post(`/api/client/items/${items['tax filing'].id}/request`, { json: { answers: {} } })).status, 400);
  assert.equal((await client.post(`/api/client/items/${items['tax filing'].id}/request`, { json: { answers: { 'when is your filing due?': 'march' } } })).status, 200);
  assert.equal((await me(client)).recommendation.items[1].requested, true);
  const desk = (await admin.get(`/api/admin/clients/${cid}`)).json().recommendation.items;
  assert.ok(desk.some(i => i.request && i.request.includes('march')));
  // the desk sets a fee and switches it to fixed: now it can be paid on its own, without covering minimum
  assert.equal((await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { heard: '', advice: 'a', items: [
    { package_id: a, level: 'minimum', priority: 1 }, { package_id: tax, level: 'renewals', quote: 'fixed', price_minor: 3000000 }] } })).status, 200);
  assert.equal((await checkout(client, [items['tax filing'].id])).json().total_minor, 3000000);
});

test('venture questions are kept', async () => {
  const app = await makeApp();
  const c = new Client(app);
  const r = await c.post('/api/start', { json: { answers: { route: 'venture', path: 'service', venture: 'bizdoc', needs: ['licences, permits or approvals for my sector'],
    situation: 'registered, i need licences or permits', situation_q: 'where are your papers right now?', details: ['mining'], details_q: 'which sector are you in?',
    urgency: 'within a month' }, name: 'Musa Bello', phone: '+234 803 000 0042', consent: true } });
  assert.equal(r.status, 200, r.text);
  const admin = await staff(app);
  const cl = (await admin.get('/api/admin/clients')).json().find(x => x.ref === r.json().ref);
  const it = (await admin.get(`/api/admin/clients/${cl.id}`)).json().intake;
  assert.ok(it.route === 'venture' && it.situation.startsWith('registered') && it.situation_q.startsWith('where'));
  assert.deepEqual(it.details, ['mining']);
});

test('onboarding attachment with reason', async () => {
  const app = await makeApp();
  const [client] = await start(app);
  const admin = await staff(app);
  const pid = (await admin.post('/api/admin/packages', { json: { venture: 'bizdoc', name: 'licence application', price_minor: 5000000, inclusions: [], onboarding: [
    { label: 'your cac certificate', kind: 'file', required: true, why: 'the licence form asks for your registration number and date.' },
    { label: 'anything else we should know?', kind: 'long', required: false }] } })).json().id;
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { heard: '', advice: 'a', items: [{ package_id: pid, level: 'minimum' }] } });
  await admin.post(`/api/admin/clients/${cid}/recommendation/publish`);
  const item = (await me(client)).recommendation.items[0];
  assert.ok(item.package.onboarding[0].why.startsWith('the licence form'));
  const o = (await checkout(client, [item.id])).json();
  await admin.post(`/api/admin/orders/${o.order_id}/confirm`);
  const eid = (await me(client)).recommendation.items[0].engagement.id;
  // a file is required: submitting without it is refused
  const r = await client.post(`/api/client/engagements/${eid}/onboarding`, { json: { answers: {} } });
  assert.equal(r.status, 400); assert.ok(r.json().detail.includes('attach'));
  // wrong question index and bad file type are refused
  assert.equal((await client.post(`/api/client/engagements/${eid}/attachment?q=1`, { files: { file: ['a.pdf', '%PDF-1.4 x', 'application/pdf'] } })).status, 400);
  assert.equal((await client.post(`/api/client/engagements/${eid}/attachment?q=0`, { files: { file: ['a.exe', 'MZ', 'application/octet-stream'] } })).status, 400);
  assert.equal((await client.post(`/api/client/engagements/${eid}/attachment?q=0`, { files: { file: ['cac.pdf', '%PDF-1.4 cac', 'application/pdf'] } })).json().name, 'cac.pdf');
  assert.deepEqual((await me(client)).recommendation.items[0].engagement.attachments, { 0: 'cac.pdf' });
  assert.equal((await client.post(`/api/client/engagements/${eid}/onboarding`, { json: { answers: {} } })).status, 200);
  const eng = (await admin.get(`/api/admin/clients/${cid}`)).json().engagements[0];
  assert.equal(eng.onboarding['your cac certificate'], 'file: cac.pdf');
  assert.equal(eng.attachments[0].name, 'cac.pdf'); assert.ok(!('stored' in eng.attachments[0]));
  const got = await admin.get(`/api/admin/engagements/${eid}/attachment/0`);
  assert.equal(got.status, 200); assert.equal(got.text, '%PDF-1.4 cac');
  // another client cannot upload to this engagement
  const other = new Client(app);
  const x = (await other.post('/api/start', { json: { answers: ANSWERS, name: 'Bola', phone: '+234 803 000 0011', consent: true } })).json();
  other.headers['X-CSRF-Token'] = x.csrf;
  assert.equal((await other.post(`/api/client/engagements/${eid}/attachment?q=0`, { files: { file: ['b.pdf', '%PDF', 'application/pdf'] } })).status, 404);
});

test('money edge cases found in review', async () => {
  // months keep their billing day: 31 jan -> 28 feb -> 31 mar
  assert.equal(addMonth('2027-01-31', 31), '2027-02-28'); assert.equal(addMonth('2027-02-28', 31), '2027-03-31');
  const app = await makeApp();
  const { client, admin, cid, item } = await setupMonthly(app);
  // an unapproved price never leaves the server
  const bz17 = await pkg(admin, 'BZ-17');
  assert.equal(bz17.price_status, 'proposed');
  const rec = (await admin.get(`/api/admin/clients/${cid}`)).json().recommendation;
  const items = rec.items.map(i => ({ package_id: i.package_id, priority: i.priority, renewal: i.renewal, renewal_minor: i.renewal_minor }));
  await publish(admin, cid, [...items, { package_id: bz17.id, priority: 2, assess: 'verify' }]);
  let x = Object.fromEntries((await me(client)).recommendation.items.map(i => [i.package.code, i]))['BZ-17'];
  assert.ok(x.package.price_minor === 0 && x.fee_pending && x.assess === 'verify');
  // approving after publish reprices the client's unpaid item; zero and quoted prices cannot be approved
  assert.equal((await admin.post(`/api/admin/packages/${bz17.id}/approve`, { json: { price_minor: 0 } })).status, 422);
  assert.equal((await admin.post(`/api/admin/packages/${(await pkg(admin, 'BZ-21')).id}/approve`, { json: { price_minor: 100 } })).status, 400);
  assert.equal((await admin.post(`/api/admin/packages/${bz17.id}/approve`, { json: { price_minor: 5500000 } })).status, 200);
  await publish(admin, cid, [...items, { package_id: bz17.id, priority: 2 }]);
  x = Object.fromEntries((await me(client)).recommendation.items.map(i => [i.package.code, i]))['BZ-17'];
  assert.ok(x.package.price_minor === 5500000 && !x.fee_pending);
  // a reported transfer is never cancelled by a new checkout
  const r = (await checkout(client, [item])).json();
  await client.post(`/api/client/orders/${r.order_id}/transfer`, { json: { note: 'sent' } });
  assert.equal((await checkout(client, [x.id])).status, 409);
  // the desk can say a transfer has not arrived, then confirm it later
  assert.equal((await admin.post(`/api/admin/orders/${r.order_id}/reject`, { json: { note: 'checked at 2pm' } })).status, 200);
  assert.equal((await me(client)).orders[0].status, 'pending');
  const results = await app.db.tx(async c => {
    const o = await c.get('SELECT * FROM orders WHERE id=?', r.order_id);
    return [await app.markPaid(c, o, 'a'), await app.markPaid(c, o, 'b')];  // a stale row cannot pay twice
  });
  assert.deepEqual(results, [true, false]);
  const s = (await me(client)).subscriptions[0];
  // the desk buttons work
  assert.equal((await admin.patch(`/api/admin/subscriptions/${s.id}`, { json: { status: 'paused' } })).json().status, 'paused');
  assert.equal((await admin.patch(`/api/admin/subscriptions/${s.id}`, { json: { status: 'active' } })).json().status, 'active');
  // money for a service that has ended is flagged for a refund, not used to extend it
  const due = s.next_due;
  await app.billingRun(addDays(due, -3));
  const inv = (await me(client)).invoices[0];
  await client.post(`/api/client/orders/${inv.id}/transfer`, { json: { note: 'paid' } });
  await client.post(`/api/client/subscriptions/${s.id}/cancel`);
  await admin.post(`/api/admin/orders/${inv.id}/confirm`);
  assert.equal((await admin.get('/api/admin/orders')).json().find(o => o.id === inv.id).status, 'refund_due');
  await app.billingRun(due);
  assert.deepEqual((await me(client)).subscriptions, []);
  // an ended monthly service can be bought again, and starts again
  assert.equal((await checkout(client, [item])).status, 200);
  const oid = (await me(client)).orders[0].id;
  await admin.post(`/api/admin/orders/${oid}/confirm`);
  assert.equal((await me(client)).subscriptions[0].status, 'active');
  // a cron key with odd characters is refused, not a crash
  app.cfg.BILLING_KEY = 'k'.repeat(40);
  await assert.rejects(() => Promise.resolve().then(() => app.billingRunCron('kéy')), e => e.status === 401);
});

test('missed billing runs charge before pausing', async () => {
  const app = await makeApp();
  app.cfg.PAYSTACK_SECRET = 'sk_test_fake';
  app.paystack = async (method, p, payload) => {
    if (p === '/transaction/initialize') return { status: true, data: { authorization_url: 'https://checkout.paystack.com/abc' } };
    if (p === '/transaction/charge_authorization') return { status: true, data: { status: 'success', amount: payload.amount, currency: 'NGN' } };
    const [o] = await app.sql('SELECT total_minor FROM orders WHERE reference=?', p.split('/').pop());
    return { status: true, data: { status: 'success', amount: o.total_minor, currency: 'NGN', authorization: { reusable: true, authorization_code: 'AUTH_x' } } };
  };
  const { client, item } = await setupMonthly(app);
  const r = (await checkout(client, [item], 'paystack', { email: 'ada@example.com' })).json();
  await client.get('/pay/callback?reference=' + r.reference);
  const s = (await me(client)).subscriptions[0];
  const out = await app.billingRun(addDays(s.next_due, 10));  // the scheduler was down for 10 days
  assert.equal(out.charged, 1); assert.equal(out.paused, 0);
});

test('finance desk, vat and terms', async () => {
  const app = await makeApp();
  const [client] = await start(app);
  const admin = await staff(app);
  assert.equal((await admin.post('/api/users', { json: { username: 'finance', display_name: 'finance lead', role: 'finance', password: 'finance-strong-pass-1', phone: '+234 800 000 0000' } })).status, 200);
  const fin = await staff(app, 'finance', 'finance-strong-pass-1');
  // finance sees money, not client work
  assert.equal((await fin.get('/api/admin/money')).status, 200); assert.equal((await fin.get('/api/admin/orders')).status, 200);
  assert.equal((await fin.get('/api/admin/engagements')).status, 403); assert.equal((await fin.get('/api/admin/clients')).status, 403);
  assert.deepEqual((await fin.get('/api/admin/overview')).json(), { finance: true });
  // vat is off until finance turns it on; venture staff cannot change it
  assert.equal((await fin.get('/api/admin/settings')).json().vat_registered, false);
  assert.equal((await fin.put('/api/admin/settings', { json: { entity_name: 'hamzury holding limited', vat_registered: true, vat_rate_bp: 750 } })).status, 200);
  assert.equal((await fin.put('/api/admin/finance-checks/entity', { json: { done: true } })).status, 200);
  assert.ok((await fin.get('/api/admin/settings')).json().finance_checks.find(x => x.key === 'entity').done);
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const p = await pkg(admin, 'ST-04'), gov = await pkg(admin, 'BZ-03');
  for (const x of [p, gov]) await admin.post(`/api/admin/packages/${x.id}/approve`, { json: {} });
  assert.equal((await fin.patch(`/api/admin/packages/${gov.id}/vat`, { json: { vat: false } })).status, 200);
  await publish(admin, cid, [{ package_id: p.id, priority: 1 }, { package_id: gov.id, priority: 1 }]);
  const m = await me(client);
  assert.ok(m.pricing.vat_registered && m.pricing.entity_name === 'hamzury holding limited');
  const ids = m.recommendation.items.map(i => i.id);
  // terms must be accepted
  assert.equal((await client.post('/api/client/checkout', { json: { items: ids, method: 'transfer' } })).status, 400);
  const r = (await checkout(client, ids)).json();
  assert.equal(r.subtotal_minor, p.price_minor + gov.price_minor);
  assert.equal(r.vat_minor, Math.round(p.price_minor * 0.075)); assert.equal(r.total_minor, r.subtotal_minor + r.vat_minor);
  const ag = (await me(client)).agreements[0];
  assert.ok(ag.terms_version === app.TERMS_VERSION && ag.accepted_at && ag.proposal_version);
  // finance confirms the transfer; a refund-due payment can be closed by finance
  assert.equal((await fin.post(`/api/admin/orders/${r.order_id}/confirm`)).status, 200);
  assert.equal((await fin.post(`/api/admin/orders/${r.order_id}/refunded`)).status, 409);
  assert.equal((await new Client(app).get('/terms')).status, 200);
});

test('venture follow-up loop', async () => {
  const app = await makeApp();
  const { client, admin, p, eng } = await paidJob(app);
  assert.equal((await admin.post('/api/users', { json: { username: 'subtlead', display_name: 'subt lead', role: 'venture_ceo', venture: 'subt',
    password: 'venture-strong-pass-1', phone: '+234 803 222 3333' } })).status, 200);
  const uid = (await admin.get('/api/users')).json().find(u => u.username === 'subtlead').id;
  // assigning without a date sets one from the catalogue duration (7 days)
  assert.equal((await admin.post(`/api/admin/engagements/${eng.id}/assign`, { json: { assigned_user_id: uid, brief: 'set up the tracker' } })).status, 200);
  const e = (await admin.get('/api/admin/engagements')).json()[0];
  assert.equal(e.due_date, addDays(app.today(), daysIn(p.duration))); assert.equal(e.update_state, 'on_track');
  const v = await staff(app, 'subtlead', 'venture-strong-pass-1');
  assert.deepEqual((await v.get('/api/admin/engagements')).json().map(x => x.id), [eng.id]);
  // no update for 48 hours: the holding is told who to chase
  app.cfg.UPDATE_HOURS = 0;
  const n = (await admin.get('/api/admin/nudges')).json().filter(x => x.kind === 'venture_late');
  assert.ok(n.length && n[0].phone === '+234 803 222 3333' && n[0].to === 'venture');
  app.cfg.UPDATE_HOURS = 48;
  // the client asks for an update; once a day
  assert.equal((await client.post(`/api/client/engagements/${eng.id}/ask`)).status, 200);
  assert.equal((await client.post(`/api/client/engagements/${eng.id}/ask`)).status, 429);
  assert.ok((await admin.get('/api/admin/nudges')).json().map(x => x.kind).includes('client_asked'));
  assert.ok((await v.get('/api/admin/engagements')).json()[0].update_requested_at);
  // the venture reports a blocker, the holding publishes, the request is answered
  assert.equal((await v.post(`/api/admin/engagements/${eng.id}/reports`, { json: { progress: 40, done: 'tracker built', blocker: 'waiting for the price list', next_step: 'load products' } })).status, 200);
  assert.ok((await admin.get('/api/admin/nudges')).json().map(x => x.kind).includes('blocker'));
  const rid = (await admin.get('/api/admin/reports')).json()[0].id;
  assert.equal((await admin.post(`/api/admin/reports/${rid}/publish`, { json: { progress: 40, done: 'tracker built', blocker: '', next_step: 'load products' } })).status, 200);
  assert.ok(!(await admin.get('/api/admin/engagements')).json()[0].update_requested_at);
  const sb = Object.fromEntries((await admin.get('/api/admin/scoreboard')).json().map(s => [s.venture, s]));
  assert.equal(sb.subt.open, 1); assert.equal(sb.subt.past_due, 0);
  // handover: never passwords
  assert.equal((await v.put(`/api/admin/engagements/${eng.id}/handover`, { json: { accounts: [{ service: 'tracker', login_url: 'https://x', account_email: 'a@b.c', recovery_owner: 'password: 123' }] } })).status, 400);
  assert.equal((await v.put(`/api/admin/engagements/${eng.id}/handover`, { json: { accounts: [{ service: 'tracker', login_url: 'https://sheets.example', account_email: 'ada@example.com', recovery_owner: 'ada' }],
    copies_given: true, client_owns_accounts: true, staff_access_removed: true } })).status, 200);
  const item = (await me(client)).recommendation.items[0];
  assert.equal(item.engagement.handover.accounts[0].account_email, 'ada@example.com');
  // another venture cannot see or touch it
  await admin.post('/api/users', { json: { username: 'medlead', display_name: 'medialy lead', role: 'venture_ceo', venture: 'medialy', password: 'venture-strong-pass-2' } });
  const m = await staff(app, 'medlead', 'venture-strong-pass-2');
  assert.deepEqual((await m.get('/api/admin/engagements')).json(), []);
  assert.equal((await m.put(`/api/admin/engagements/${eng.id}/handover`, { json: {} })).status, 403);
});

test('retention removes on schedule and respects hold', async () => {
  const app = await makeApp();
  await new Client(app).post('/api/start', { json: { answers: ANSWERS, name: 'Old Enquiry', phone: '+234 803 000 0077', consent: true } });
  await new Client(app).post('/api/start', { json: { answers: ANSWERS, name: 'Kept Enquiry', phone: '+234 803 000 0078', consent: true } });
  const admin = await staff(app);
  const ids = Object.fromEntries((await admin.get('/api/admin/clients')).json().map(c => [c.name, c.id]));
  assert.equal((await admin.post(`/api/admin/clients/${ids['Kept Enquiry']}/hold`, { json: { hold: true } })).status, 200);
  assert.equal((await app.retentionRun(app.today())).enquiries_removed, 0);  // recent: kept
  assert.equal((await app.retentionRun(addDays(app.today(), 91))).enquiries_removed, 1);
  const names = Object.fromEntries((await admin.get('/api/admin/clients')).json().map(c => [c.id, c.name]));
  assert.equal(names[ids['Old Enquiry']], 'removed'); assert.equal(names[ids['Kept Enquiry']], 'Kept Enquiry');
  assert.equal((await new Client(app).post('/api/daily/run')).status, 401);
});

test('retention never wipes a payer; refunds for removed enquiries', async () => {
  const app = await makeApp();
  const [client] = await start(app);
  const admin = await staff(app);
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const p = await pkg(admin, 'ST-04');
  await admin.post(`/api/admin/packages/${p.id}/approve`, { json: {} });
  await publish(admin, cid, [{ package_id: p.id, priority: 1 }]);
  const item = (await me(client)).recommendation.items[0].id;
  const r = (await checkout(client, [item])).json();
  // a pending transfer, untouched for 100 days, is never removed
  assert.equal((await app.retentionRun(addDays(app.today(), 100))).enquiries_removed, 0);
  // if an enquiry was removed and money turns up later, it becomes a refund, never work for "removed"
  await app.sql("UPDATE clients SET purged_at=now_ts() WHERE id=?", cid);
  assert.equal((await admin.post(`/api/admin/orders/${r.order_id}/confirm`)).status, 200);
  assert.equal((await admin.get('/api/admin/orders')).json().find(o => o.id === r.order_id).status, 'refund_due');
  assert.deepEqual((await admin.get('/api/admin/engagements')).json(), []);
  // vat rounds half up, the same as the page
  const pr = { vat_registered: true, vat_rate_bp: 750 };
  assert.equal(vatOf(1500300, true, pr), 112523); assert.equal(vatOf(1000, false, pr), 0);
  // handover refuses anything that looks like a secret, in notes too
  assert.ok(app.SECRET_WORDS.test('pwd 1234') && app.SECRET_WORDS.test('the PIN is') && !app.SECRET_WORDS.test('pinterest page'));
});

test('follow-up waits on holding during review; proposal versions', async () => {
  const app = await makeApp();
  const { client, admin, eng } = await paidJob(app);
  await app.sql("UPDATE engagements SET status='review',assigned_user_id=1,assigned_at=ts_ago('10 days') WHERE id=?", eng.id);
  assert.equal((await admin.get('/api/admin/engagements')).json()[0].update_state, 'not_required');  // waiting on holding, not the venture
  const ag = (await me(client)).agreements[0];
  assert.equal(ag.proposal_version.split('-').pop().length, 10);
});

test('office page and share links', async () => {
  const app = await makeApp();
  const t = new Client(app);
  assert.equal((await t.get('/visit')).status, 200);
  let r = await t.get('/visit/abuja');
  assert.equal(r.status, 302); assert.ok(r.headers.location.includes('9.028329'));
  r = await t.get('/visit/jos');
  assert.equal(r.status, 302); assert.ok(r.headers.location.includes('hamzury+innovation+hub'));
  assert.equal((await t.get('/visit/kano')).headers.location, '/visit');
});
