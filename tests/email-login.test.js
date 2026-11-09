import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../lib/app.js';
import { encrypt, passwordHash, totpAt } from '../lib/security.js';
import { resetPassword, setEmail } from '../tools/manage.js';
import { Client, makeApp, PASS, SECRET, staff } from './helpers.js';

test('email sign-in normalizes case/whitespace and rejects username-only credentials', async () => {
  const app = await makeApp();
  const t = new Client(app);
  const login = await t.post('/api/login', { json: { email: '  OWNER@Example.Test  ', password: PASS } });
  assert.equal(login.status, 200);
  assert.equal(login.json().user.email, 'owner@example.test');
  assert.equal(login.json().user.password_hash, undefined);
  assert.equal((await t.post('/api/login', { json: { username: 'owner', password: PASS } })).status, 422);
  const wrong = await t.post('/api/login', { json: { email: 'owner@example.test', password: 'wrong' } });
  const missing = await t.post('/api/login', { json: { email: 'missing@example.test', password: PASS } });
  assert.equal(wrong.status, 401); assert.equal(missing.status, 401);
  assert.equal(wrong.json().detail, missing.json().detail);
  assert.equal((await t.post('/api/login', { json: { email: 'not-an-email', password: PASS } })).status, 400);
});

test('new staff require a unique email and can sign in without a username', async () => {
  const app = await makeApp();
  const admin = await staff(app);
  const input = { email: ' Finance@Example.Test ', display_name: 'Finance', role: 'finance', password: 'finance-password-123' };
  const created = await admin.post('/api/users', { json: input });
  assert.equal(created.status, 200);
  const duplicate = await admin.post('/api/users', { json: { ...input, email: 'FINANCE@example.test' } });
  assert.equal(duplicate.status, 409);
  assert.equal((await admin.post('/api/users', { json: { ...input, email: 'invalid' } })).status, 400);
  assert.equal((await admin.post('/api/users', { json: { display_name: 'No email', role: 'finance', password: input.password } })).status, 422);
  const finance = await staff(app, 'finance@example.test', input.password);
  assert.equal((await finance.get('/api/me')).json().user.email, 'finance@example.test');
  assert.equal((await finance.post(`/api/users/${created.json().id}/email`, { json: { email: 'other@example.test', owner_password: PASS } })).status, 403);
  assert.equal((await admin.post(`/api/users/${created.json().id}/deactivate`)).status, 200);
  assert.equal((await new Client(app).post('/api/login', { json: { email: 'finance@example.test', password: input.password } })).status, 401);
});

test('changing own email requires a password, is CSRF-protected and revokes every session', async () => {
  const app = await makeApp();
  const one = await staff(app), two = await staff(app);
  const noCsrf = new Client(app); noCsrf.cookies = { ...one.cookies };
  const payload = { email: 'new-owner@example.test', current_password: PASS };
  assert.equal((await noCsrf.post('/api/account/email', { json: payload })).status, 403);
  assert.equal((await one.post('/api/account/email', { json: { ...payload, current_password: 'wrong' } })).status, 401);
  await app.sql("UPDATE users SET mfa_pending='preserve-pending' WHERE username='owner'");
  const before = (await app.sql("SELECT password_hash FROM users WHERE username='owner'"))[0].password_hash;
  assert.equal((await one.post('/api/account/email', { json: payload })).status, 200);
  assert.equal((await one.get('/api/me')).status, 401); assert.equal((await two.get('/api/me')).status, 401);
  assert.equal((await new Client(app).post('/api/login', { json: { email: 'owner@example.test', password: PASS } })).status, 401);
  assert.equal((await (await staff(app, payload.email)).get('/api/me')).status, 200);
  const row = (await app.sql("SELECT * FROM users WHERE username='owner'"))[0];
  assert.equal(row.password_hash, before); assert.equal(row.mfa_pending, 'preserve-pending');
});

test('owner can assign legacy staff email and duplicate changes leave accounts untouched', async () => {
  const app = await makeApp();
  const admin = await staff(app);
  const hash = await passwordHash('legacy-staff-password');
  const uid = (await app.sql("INSERT INTO users(username,display_name,password_hash,role) VALUES('legacy','Legacy',?,'finance') RETURNING id", hash))[0].id;
  assert.equal((await admin.post(`/api/users/${uid}/email`, { json: { email: 'legacy@example.test', owner_password: 'wrong' } })).status, 401);
  assert.equal((await admin.post(`/api/users/${uid}/email`, { json: { email: ' OWNER@example.test ', owner_password: PASS } })).status, 409);
  assert.equal((await app.sql('SELECT email FROM users WHERE id=?', uid))[0].email, null);
  assert.equal((await admin.post(`/api/users/${uid}/email`, { json: { email: ' Legacy@Example.Test ', owner_password: PASS } })).status, 200);
  const legacy = await staff(app, 'legacy@example.test', 'legacy-staff-password');
  assert.equal((await legacy.get('/api/me')).json().user.id, uid);
  assert.equal((await admin.post('/api/account/email', { json: { email: 'legacy@example.test', current_password: PASS } })).status, 409);
  assert.equal((await admin.get('/api/me')).json().user.email, 'owner@example.test');
});

test('owner email migrates once without replacing the password or authenticator', async () => {
  const app = await makeApp({ HAMZURY_ADMIN_EMAIL: '' });
  const secret = 'JBSWY3DPEHPK3PXP';
  const cipher = encrypt(SECRET, secret);
  await app.sql("UPDATE users SET mfa_secret=? WHERE username='owner'", cipher);
  await app.sql("INSERT INTO sessions VALUES('legacy-token','1','legacy-csrf',9999999999)");
  const before = (await app.sql('SELECT * FROM users'))[0];
  const migrated = createApp({ db: app.db, storage: app.storage, env: {
    HAMZURY_ADMIN_EMAIL: ' Admin@Hamzury.Com ', HAMZURY_ADMIN_PASSWORD: 'different-bootstrap-password', HAMZURY_SECRET: SECRET } });
  await migrated.init();
  const after = (await app.sql('SELECT * FROM users'))[0];
  assert.equal(after.id, before.id); assert.equal(after.email, 'admin@hamzury.com');
  assert.equal(after.password_hash, before.password_hash); assert.equal(after.mfa_secret, cipher);
  assert.equal((await app.sql('SELECT * FROM sessions')).length, 0);
  const login = await new Client(migrated).post('/api/login', { json: { email: 'admin@hamzury.com', password: PASS, otp: totpAt(secret, Math.floor(migrated.time() / 30)) } });
  assert.equal(login.status, 200);
  const restarted = createApp({ db: app.db, storage: app.storage, env: {
    HAMZURY_ADMIN_EMAIL: 'stale-config@example.test', HAMZURY_ADMIN_PASSWORD: PASS, HAMZURY_SECRET: SECRET } });
  await restarted.init();
  assert.equal((await app.sql('SELECT email FROM users'))[0].email, 'admin@hamzury.com');
});

test('operator recovery accepts email and preserves existing security settings', async () => {
  const app = await makeApp();
  const admin = await staff(app);
  await setEmail(app.db, 'owner', ' Recovery@Example.Test ');
  assert.equal((await admin.get('/api/me')).status, 401);
  await resetPassword(app.db, 'RECOVERY@example.test', 'recovered-email-password');
  assert.equal((await (await staff(app, 'recovery@example.test', 'recovered-email-password')).get('/api/me')).status, 200);
});
