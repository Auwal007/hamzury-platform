// the proposal page: the desk saves the story, the client rate, phases and the suggested start; the client receives them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeApp, staff, start } from './helpers.js';

const me = async client => (await client.get('/api/client/me')).json();

test('proposal page fields reach the client, and the rate price is what they pay', async () => {
  const app = await makeApp();
  const [client] = await start(app);
  const admin = await staff(app);
  const plan = (await admin.post('/api/admin/packages', { json: { venture: 'medialy', name: 'publicity plan', price_minor: 20000000, duration: '7 working days', inclusions: ['message map'], onboarding: [] } })).json().id;
  const social = (await admin.post('/api/admin/packages', { json: { venture: 'medialy', name: 'social media management', price_minor: 30000000, basis: 'monthly', inclusions: ['12 pieces'], onboarding: [] } })).json().id;
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const doc = { topic: 'Publicity, NYIP', headline: 'Publicity with structured intention.', strategy: [{ title: 'Distribution', body: 'One event, many pieces.' }],
    your_part: 'One weekly review.', our_part: 'Everything else.', how_we_work: ['Nothing goes out without your approval.'], rate_label: 'NYIP rate', rate_pct: 30, lead_venture: 'medialy' };
  const put = body => admin.put(`/api/admin/clients/${cid}/recommendation`, { json: body });
  const items = [{ package_id: plan, price_minor: 14000000, phase: 'Start here', suggested: true }, { package_id: social, price_minor: 21000000, renewal: 'monthly', renewal_minor: 21000000, suggested: true }];
  assert.equal((await put({ heard: 'word of mouth\nlogo exists', advice: 'publicity campaign', doc, items })).status, 200);

  // the desk sees exactly what it saved
  const rec = (await admin.get(`/api/admin/clients/${cid}`)).json().recommendation;
  assert.equal(rec.doc.headline, 'Publicity with structured intention.');
  assert.equal(rec.doc.rate_pct, 30);
  assert.deepEqual(rec.items.map(i => [i.phase, i.suggested]), [['Start here', 1], ['', 1]]);

  // a save without a doc keeps the one already there (older desks), and limits are enforced
  assert.equal((await put({ heard: 'word of mouth', advice: 'publicity campaign', items })).status, 200);
  assert.equal((await admin.get(`/api/admin/clients/${cid}`)).json().recommendation.doc.topic, 'Publicity, NYIP');
  assert.equal((await put({ advice: 'x', items, doc: { ...doc, rate_pct: 95 } })).status, 422);
  assert.equal((await put({ advice: 'x', items, doc: { ...doc, strategy: [1, 2, 3, 4].map(() => ({ title: 't', body: 'b' })) } })).status, 422);

  assert.equal((await admin.post(`/api/admin/clients/${cid}/recommendation/publish`)).status, 200);
  const m = await me(client);
  assert.equal(m.recommendation.doc.rate_label, 'NYIP rate');
  assert.deepEqual(m.recommendation.items.map(i => [i.phase, i.suggested, i.list_minor, i.package.price_minor]),
    [['Start here', true, 20000000, 14000000], ['', true, 30000000, 21000000]]);

  // checkout charges the client rate, not the standard price
  const r = await client.post('/api/client/checkout', { json: { accept_terms: true, items: [m.recommendation.items[0].id], method: 'transfer' } });
  assert.equal(r.status, 200);
  assert.equal((await me(client)).orders[0].subtotal_minor, 14000000);
});
