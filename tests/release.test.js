// release checks: payment locking, account security, upload safety, limits and production gates.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { addDays, createApp } from '../lib/app.js';
import { HttpError } from '../lib/http.js';
import { totpAt } from '../lib/security.js';
import { resetPassword } from '../tools/manage.js';
import { Client, PASS, makeApp, paidJob, setupMonthly, staff } from './helpers.js';

async function cardSubscription(app) {
  const { client, admin, item } = await setupMonthly(app);
  const order = (await client.post('/api/client/checkout', { json: { accept_terms: true, items: [item], method: 'transfer' } })).json();
  assert.equal((await admin.post(`/api/admin/orders/${order.order_id}/confirm`)).status, 200);
  await app.sql("UPDATE subscriptions SET method='paystack'");
  await app.sql("UPDATE clients SET email='audit@example.com',pay_auth='AUTH_TEST'");
  const due = (await app.sql('SELECT next_due FROM subscriptions'))[0].next_due;
  app.cfg.PAYSTACK_SECRET = 'sk_test_fake';
  return { client, admin, due };
}

test('overlapping billing and cancellation cannot double charge', async () => {
  const app = await makeApp();
  const { client, due } = await cardSubscription(app);
  let started, release;
  const startedP = new Promise(r => { started = r; }), releaseP = new Promise(r => { release = r; });
  const charges = [];
  app.paystack = async (method, p, payload) => {
    assert.equal(p, '/transaction/charge_authorization');
    charges.push(payload.reference);
    started();
    await releaseP;
    return { status: true, data: { status: 'success', amount: payload.amount, currency: 'NGN' } };
  };
  const first = app.billingRun(due);
  try {
    await startedP;
    await assert.rejects(app.billingRun(due), e => e.status === 409);
    const sid = (await client.get('/api/client/me')).json().subscriptions[0].id;
    assert.equal((await client.post(`/api/client/subscriptions/${sid}/cancel`)).status, 409);
    // another server instance on the same database is excluded too, not just this one
    const twin = createApp({ db: app.db, storage: app.storage, env: { HAMZURY_ADMIN_PASSWORD: PASS, HAMZURY_SECRET: app.cfg.SECRET } });
    await assert.rejects(twin.billingRun(due), e => e.status === 409);
  } finally {
    release();
  }
  assert.equal((await first).charged, 1);
  assert.equal((await app.billingRun(due)).charged, 0);
  assert.equal(charges.length, 1);
  assert.equal(Number((await app.sql("SELECT count(*) n FROM orders WHERE kind='renewal' AND status='paid'"))[0].n), 1);
});

test('unknown gateway result does not create a new charge', async () => {
  const app = await makeApp();
  const { client, admin, due } = await cardSubscription(app);
  const charges = [];
  app.paystack = async (method, p, payload) => {
    if (method === 'POST') { charges.push(payload.reference); throw new HttpError(502, 'simulated lost response'); }
    return { status: false, message: 'verification unavailable' };
  };
  assert.equal((await app.billingRun(due)).declined, 1);
  const invoice = (await client.get('/api/client/me')).json().invoices[0];
  assert.equal((await client.post(`/api/client/orders/${invoice.id}/transfer`, { json: { note: 'sent' } })).status, 409);
  assert.equal((await admin.post(`/api/admin/orders/${invoice.id}/confirm`)).status, 409);
  assert.equal((await client.post(`/api/client/orders/${invoice.id}/check`)).json().status, 'pending');
  await app.sql("UPDATE orders SET created_at=ts_ago('3 days') WHERE kind='renewal'");
  await app.billingRun(addDays(due, 2));
  assert.equal(charges.length, 1);
  assert.equal(Number((await app.sql("SELECT count(*) n FROM orders WHERE kind='renewal'"))[0].n), 1);
});

test('password change revokes every session and recovery works', async () => {
  const app = await makeApp();
  const one = await staff(app), two = await staff(app);
  assert.equal((await one.post('/api/account/password', { json: { current_password: 'wrong', new_password: 'new-unique-password-123' } })).status, 401);
  assert.equal((await one.post('/api/account/password', { json: { current_password: PASS, new_password: 'new-unique-password-123' } })).status, 200);
  assert.equal((await one.get('/api/me')).status, 401); assert.equal((await two.get('/api/me')).status, 401);
  assert.equal((await new Client(app).post('/api/login', { json: { username: 'owner', email: 'owner@example.test', password: PASS } })).status, 401);
  const current = await staff(app, 'owner', 'new-unique-password-123');
  await resetPassword(app.db, 'owner', 'recovered-password-123');
  assert.equal((await current.get('/api/me')).status, 401);
  assert.equal((await (await staff(app, 'owner', 'recovered-password-123')).get('/api/me')).status, 200);
});

test('owner can reset staff, but staff cannot reset the owner', async () => {
  const app = await makeApp();
  const admin = await staff(app);
  const uid = (await admin.post('/api/users', { json: { username: 'finance-test', email: 'finance-test@example.test', display_name: 'Finance', role: 'finance', password: 'finance-original-password' } })).json().id;
  const finance = await staff(app, 'finance-test', 'finance-original-password');
  const payload = { owner_password: PASS, new_password: 'replacement-staff-password' };
  assert.equal((await finance.post('/api/users/1/password', { json: payload })).status, 403);
  assert.equal((await admin.post(`/api/users/${uid}/password`, { json: payload })).status, 200);
  assert.equal((await finance.get('/api/me')).status, 401);
  assert.equal((await (await staff(app, 'finance-test', payload.new_password)).get('/api/me')).status, 200);
});

test('required mfa: setup, encryption, replay and recovery', async () => {
  const app = await makeApp();
  app.cfg.REQUIRE_MFA = true;
  let clock = Math.floor(Date.now() / 1000);
  app.time = () => clock;
  const admin = await staff(app);
  assert.equal((await admin.get('/api/admin/clients')).status, 403);
  const result = await admin.post('/api/account/mfa/setup', { json: { password: PASS } });
  assert.equal(result.status, 200);
  const key = result.json().secret;
  assert.ok(result.json().uri.startsWith('otpauth://totp/'));
  const otp = t => totpAt(key, Math.floor(t / 30));
  assert.equal((await admin.post('/api/account/mfa/enable', { json: { code: otp(clock) } })).status, 200);
  assert.equal((await admin.get('/api/me')).status, 401);
  assert.notEqual((await app.sql('SELECT mfa_secret FROM users'))[0].mfa_secret, key);
  const t = new Client(app);
  assert.equal((await t.post('/api/login', { json: { username: 'owner', email: 'owner@example.test', password: PASS } })).status, 401);
  assert.equal((await t.post('/api/login', { json: { username: 'owner', email: 'owner@example.test', password: PASS, otp: otp(clock) } })).status, 401);  // the code was already used
  clock += 30;
  const login = await t.post('/api/login', { json: { username: 'owner', email: 'owner@example.test', password: PASS, otp: otp(clock) } });
  assert.equal(login.status, 200);
  t.headers['X-CSRF-Token'] = login.json().csrf;
  assert.equal((await t.get('/api/admin/clients')).status, 200);
  await resetPassword(app.db, 'owner', 'recovered-owner-password', { resetMfa: true });
  const recovered = await staff(app, 'owner', 'recovered-owner-password');
  assert.equal((await recovered.get('/api/admin/clients')).status, 403);
  assert.equal((await recovered.get('/api/me')).json().user.mfa_enabled, false);
});

// a zip built by hand, so the test needs no zip library
function zipOf(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text), packed = zlib.deflateRawSync(data), nm = Buffer.from(name), crc = zlib.crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(packed.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(packed.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, packed); centrals.push(ch, nm);
    offset += 30 + nm.length + packed.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('disguised uploads and unsafe archives are rejected', async () => {
  const app = await makeApp();
  const { admin, eng } = await paidJob(app);
  const url = `/api/admin/engagements/${eng.id}/file`;
  const up = (name, data) => admin.post(url, { files: { file: [name, data] } });
  assert.equal((await up('fake.pdf', 'MZ executable')).status, 400);
  assert.equal((await up('empty.pdf', '')).status, 400);
  assert.equal((await up('fake.png', '%PDF-1.4')).status, 400);
  const bad = zipOf([['../escape.txt', 'bad']]);
  assert.equal((await up('bad.zip', bad)).status, 400);
  assert.equal((await up('bad.docx', bad)).status, 400);
  assert.equal((await up('good.zip', zipOf([['notes/readme.txt', 'hello']]))).status, 200);
  assert.equal((await up('doc.docx', zipOf([['[Content_Types].xml', '<x/>'], ['word/document.xml', '<w/>']]))).status, 200);
  assert.equal((await up('valid.pdf', '%PDF-1.4 test')).status, 200);
});

test('production upload scan fails closed', async () => {
  const app = await makeApp();
  app.cfg.REQUIRE_SCAN = true;
  await assert.rejects(app.validateUpload('file.pdf', Buffer.from('%PDF-1.4 test')), e => e.status === 503);  // no scanner configured
  const realFetch = globalThis.fetch;
  try {
    app.cfg.SCAN_URL = 'https://scanner.invalid/scan';
    globalThis.fetch = async () => new Response(JSON.stringify({ clean: false }), { status: 200 });
    await assert.rejects(app.validateUpload('file.pdf', Buffer.from('%PDF-1.4 test')), e => e.status === 400);
    globalThis.fetch = async () => { throw new Error('down'); };
    await assert.rejects(app.validateUpload('file.pdf', Buffer.from('%PDF-1.4 test')), e => e.status === 503);
    globalThis.fetch = async () => new Response(JSON.stringify({ clean: true }), { status: 200 });
    await app.validateUpload('file.pdf', Buffer.from('%PDF-1.4 test'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('health checks real storage, and body limits', async () => {
  const app = await makeApp();
  const t = new Client(app);
  assert.equal((await t.get('/api/health')).status, 200);
  const probe = app.storage.probe;
  app.storage.probe = async () => { throw new Error('storage down'); };
  assert.equal((await t.get('/api/health')).status, 503);
  app.storage.probe = probe;
  assert.equal((await t.post('/api/login', { content: 'x'.repeat(256 * 1024 + 1) })).status, 413);
  assert.equal((await t.post('/api/login', { content: 'x'.repeat(256 * 1024 + 1), headers: { 'Content-Type': 'application/json' } })).status, 413);
});

test('renewal period constraint prevents a duplicate paid period', async () => {
  const app = await makeApp();
  const { due } = await cardSubscription(app);
  app.paystack = async (method, p, payload) => ({ status: true, data: { status: 'success', amount: payload.amount, currency: 'NGN' } });
  assert.equal((await app.billingRun(due)).charged, 1);
  const [subscription] = await app.sql('SELECT * FROM subscriptions');
  subscription.next_due = due;
  await assert.rejects(app.db.tx(c => app.renewalOrder(c, subscription, 'paystack')), e => e.code === '23505');  // unique violation
});

test('production refuses disabled security controls', () => {
  const env = { ...process.env, HAMZURY_ENV: 'production', HAMZURY_SECURE_COOKIES: '1', HAMZURY_PUBLIC_BASE_URL: 'https://example.test',
    HAMZURY_BILLING_KEY: 'b'.repeat(40), HAMZURY_REQUIRE_STAFF_MFA: '0', HAMZURY_REQUIRE_UPLOAD_SCAN: '0',
    HAMZURY_ADMIN_PASSWORD: PASS, HAMZURY_SECRET: 's'.repeat(40) };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import { loadConfig } from './lib/app.js'; loadConfig(process.env);"], { env, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('production requires'), r.stderr);
});

// ---------------------------------------------------------------- new in the serverless version
test('direct uploads: signed, fetched back, checked, and removed when unsafe', async () => {
  const app = await makeApp();
  const { admin, client, eng } = await paidJob(app);
  // pretend storage is cloudinary: it signs uploads, and the "browser" puts the file there itself
  const real = app.storage.signUpload;
  app.storage.signUpload = key => ({ url: 'https://api.cloudinary.com/v1_1/demo/raw/upload', fields: { public_id: 'hamzury/' + key } });
  try {
    const url = `/api/admin/engagements/${eng.id}/file`;
    const sign = (await admin.post(url, { json: { upload: 'sign', name: 'report.pdf', size: 20 } })).json();
    assert.equal(sign.direct, false); assert.ok(sign.ticket && sign.fields.public_id.endsWith('.pdf'));
    const key = sign.fields.public_id.replace('hamzury/', '');
    assert.equal((await admin.post(url, { json: { upload: 'done', name: 'report.pdf', ticket: sign.ticket } })).status, 400);  // nothing arrived yet
    await app.storage.put(key, Buffer.from('%PDF-1.4 direct'));
    assert.equal((await admin.post(url, { json: { upload: 'done', name: 'report.pdf', ticket: sign.ticket.replace(/.$/, '0') } })).status, 400);  // tampered
    assert.equal((await admin.post(url, { json: { upload: 'done', name: 'report.pdf', ticket: sign.ticket } })).json().file_name, 'report.pdf');
    // a disguised file is refused and deleted from storage
    const s2 = (await admin.post(url, { json: { upload: 'sign', name: 'x.pdf', size: 3 } })).json();
    const k2 = s2.fields.public_id.replace('hamzury/', '');
    await app.storage.put(k2, Buffer.from('MZ!'));
    assert.equal((await admin.post(url, { json: { upload: 'done', name: 'x.pdf', ticket: s2.ticket } })).status, 400);
    assert.equal(await app.storage.get(k2), null);
    // a ticket is tied to its engagement and person
    assert.equal((await client.post(`/api/client/engagements/${eng.id}/attachment?q=0`, { json: { upload: 'done', name: 'report.pdf', ticket: sign.ticket } })).status, 400);
    assert.equal((await admin.post(url, { json: { upload: 'sign', name: 'big.pdf', size: 26 * 1024 * 1024 } })).status, 400);
  } finally {
    app.storage.signUpload = real;
  }
  // local storage asks the browser to send the file to the server itself
  assert.deepEqual((await admin.post(`/api/admin/engagements/${eng.id}/file`, { json: { upload: 'sign', name: 'a.pdf', size: 3 } })).json(), { direct: true });
});

test('vercel cron runs the daily job only with the secret', async () => {
  const app = await makeApp();
  const t = new Client(app);
  assert.equal((await t.get('/api/cron/daily')).status, 401);
  app.cfg.CRON_SECRET = 'c'.repeat(40);
  assert.equal((await t.get('/api/cron/daily', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const r = await t.get('/api/cron/daily', { headers: { Authorization: 'Bearer ' + 'c'.repeat(40) } });
  assert.equal(r.status, 200); assert.ok('billing' in r.json() && 'retention' in r.json());
});
