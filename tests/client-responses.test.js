import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWERS, Client, makeApp, paidJob, PASS, staff, start } from './helpers.js';

test('download contains every saved answer group, Unicode and upload names, scoped to one client', async () => {
  const app = await makeApp();
  try {
    const { admin, cid, p, eng } = await paidJob(app);
    const intake = { ...ANSWERS, industry: ['food', 'other'], industry_other: 'Àkàrà and ƙosai',
      situation: 'active pages', situation_q: 'Where are your channels now?', details: ['website', 'brand'],
      details_q: 'What do you already have?', note: 'First line\nSecond line', future_question: 'Preserve new fields too' };
    await app.sql('UPDATE clients SET intake=?,notes=? WHERE id=?', JSON.stringify(intake), 'INTERNAL-NOTE-DO-NOT-EXPORT', cid);
    await app.sql('UPDATE rec_items SET request=?,requested_at=now_ts() WHERE id=?', JSON.stringify({ 'Which deadline?': 'Friday', 'Question_q': 'Keep this real question' }), eng.rec_item_id);
    await app.sql('UPDATE packages SET onboarding=? WHERE id=?', JSON.stringify([{ label: 'Proof of identity', type: 'file', required: false }]), p.id);
    await app.sql('UPDATE engagements SET onboarding=?,attachments=?,onboarding_at=now_ts() WHERE id=?',
      JSON.stringify({ 'Registered name?': 'Ada & Partners', 'Additional instructions?': 'Use the new address\nKeep the old phone.' }),
      JSON.stringify({ 0: { name: 'identity.pdf', size: 42, path: 'PRIVATE-STORAGE-KEY' } }), eng.id);
    const other = new Client(app);
    await other.post('/api/start', { json: { answers: { ...ANSWERS, note: 'OTHER-CLIENT-ANSWER' }, name: 'Other Person', phone: '+2348030000999', consent: true } });
    const response = await admin.get(`/api/admin/clients/${cid}/responses`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.match(response.headers['content-disposition'], /^attachment; filename="hamzury-responses-hz-[a-z0-9-]+\.txt"$/);
    assert.equal(response.headers['cache-control'], 'no-store');
    for (const expected of ['Ada Test', 'INITIAL QUESTIONNAIRE', 'PACKAGE FOLLOW-UP QUESTIONS', 'ONBOARDING QUESTIONS',
      '- food\r\n- other', 'Àkàrà and ƙosai', 'Where are your channels now?', 'active pages', 'What do you already have?',
      '- website\r\n- brand', 'First line\r\nSecond line', 'Preserve new fields too', 'Which deadline?', 'Friday',
      'Question_q', 'Keep this real question', 'Registered name?', 'Ada & Partners', 'Use the new address\r\nKeep the old phone.', 'Proof of identity: identity.pdf']) {
      assert.ok(response.text.includes(expected), `missing ${expected}`);
    }
    for (const hidden of ['INTERNAL-NOTE-DO-NOT-EXPORT', 'PRIVATE-STORAGE-KEY', 'OTHER-CLIENT-ANSWER', 'situation_q', 'details_q', 'password_hash']) {
      assert.ok(!response.text.includes(hidden), `leaked ${hidden}`);
    }
    assert.equal((await app.sql("SELECT * FROM audit WHERE event='client.responses_exported' AND entity_id=?", cid)).length, 1);
    const page = await admin.get('/static/desk.js');
    assert.ok(page.text.includes('download all responses'));
  } finally { await app.db.close(); }
});

test('only holding staff can export responses; missing clients fail without producing a file', async () => {
  const app = await makeApp();
  try {
    const [client] = await start(app);
    const admin = await staff(app);
    const cid = (await admin.get('/api/admin/clients')).json()[0].id;
    const endpoint = `/api/admin/clients/${cid}/responses`;
    assert.equal((await new Client(app).get(endpoint)).status, 401);
    assert.equal((await client.get(endpoint)).status, 401);
    for (const role of ['finance', 'venture_admin', 'holding_admin']) {
      const email = `${role}@example.test`;
      const created = await admin.post('/api/users', { json: { email, display_name: role, role, venture: role === 'venture_admin' ? 'subt' : null, password: PASS } });
      assert.equal(created.status, 200, created.text);
      const user = await staff(app, email);
      const response = await user.get(endpoint);
      assert.equal(response.status, role === 'holding_admin' ? 200 : 403);
      if (response.status !== 200) assert.equal(response.headers['content-disposition'], undefined);
    }
    assert.equal((await admin.get('/api/admin/clients/999999/responses')).status, 404);
    assert.equal((await admin.get('/api/admin/clients/not-an-id/responses')).status, 422);
  } finally { await app.db.close(); }
});

test('a client with no optional responses still gets a complete, readable download', async () => {
  const app = await makeApp();
  try {
    await start(app);
    const admin = await staff(app);
    const cid = (await admin.get('/api/admin/clients')).json()[0].id;
    await app.sql('UPDATE clients SET intake=? WHERE id=?', '{}', cid);
    const response = await admin.get(`/api/admin/clients/${cid}/responses`);
    assert.equal(response.status, 200);
    assert.ok(response.text.includes('No questionnaire responses saved.'));
    assert.ok(response.text.includes('No package follow-up responses saved.'));
    assert.ok(response.text.includes('No onboarding responses saved.'));
  } finally { await app.db.close(); }
});
