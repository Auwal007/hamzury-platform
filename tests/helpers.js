// test helpers: a fresh embedded database and file folder per test, and a small client with a cookie jar.
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.js';
import { openDb } from '../lib/db.js';
import { openStorage } from '../lib/storage.js';

export const PASS = 'local-test-only-not-a-real-password';
export const SECRET = 'local-test-secret-independent-and-at-least-32-characters-123';

export async function makeApp(env = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hamzury-test-'));
  const db = await openDb('pglite:memory');
  const storage = openStorage({ HAMZURY_FILES: path.join(dir, 'files') });
  const app = createApp({ db, storage, env: {
    HAMZURY_ENV: 'development', HAMZURY_REQUIRE_STAFF_MFA: '0', HAMZURY_REQUIRE_UPLOAD_SCAN: '0',
    HAMZURY_ADMIN_PASSWORD: PASS, HAMZURY_SECRET: SECRET, HAMZURY_BANK_DETAILS: 'sample bank details for testing', ...env } });
  app.dir = dir;
  // run sql directly, like the old tests did with app.connect()
  app.sql = (sql, ...params) => db.tx(c => c.all(sql, ...params));
  await app.init();
  return app;
}

export class Client {
  constructor(app) { this.app = app; this.cookies = {}; this.headers = {}; }
  async request(method, url, { json, files, content, headers = {} } = {}) {
    const u = new URL(url, 'http://testserver');
    const h = Object.fromEntries(Object.entries({ ...this.headers, ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
    let body = Buffer.alloc(0);
    if (json !== undefined) { body = Buffer.from(JSON.stringify(json)); h['content-type'] = 'application/json'; }
    if (files) {
      const fd = new FormData();
      const [name, data, type] = files.file;
      fd.append('file', new Blob([data], { type: type || 'application/octet-stream' }), name);
      const r = new Request('http://x', { method: 'POST', body: fd });
      body = Buffer.from(await r.arrayBuffer());
      h['content-type'] = r.headers.get('content-type');
    }
    if (content !== undefined) body = Buffer.from(content);
    if (Object.keys(this.cookies).length) h.cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    const out = await this.app.handle({ method, path: u.pathname, query: u.searchParams, headers: h, body, ip: 'testclient' });
    for (const sc of [].concat(out.headers['set-cookie'] || [])) {
      const [kv] = sc.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
      if (/Max-Age=0/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    const raw = Buffer.isBuffer(out.body) ? out.body : Buffer.from(out.body ?? '');
    return { status: out.status, headers: out.headers, content: raw, text: raw.toString('utf8'), json: () => JSON.parse(raw.toString('utf8')) };
  }
  get(url, o) { return this.request('GET', url, o); }
  post(url, o) { return this.request('POST', url, o); }
  put(url, o) { return this.request('PUT', url, o); }
  patch(url, o) { return this.request('PATCH', url, o); }
}

export async function staff(app, username = 'owner', password = PASS) {
  const t = new Client(app);
  const r = await t.post('/api/login', { json: { username, password } });
  if (r.status !== 200) throw new Error(`login ${r.status} ${r.text}`);
  t.headers['X-CSRF-Token'] = r.json().csrf;
  return t;
}

export const ANSWERS = { path: 'grow', business: 'Ada Foods (fictional)', industry: 'food and drink', stage: 'running 1 to 3 years',
  registered: 'yes', needs: ['more customers', 'a website'], challenge: 'orders come in on whatsapp and we lose track',
  goal: 'more customers', timing: 'this month', team: '2 to 5', location: 'kaduna' };

export async function start(app) {
  const t = new Client(app);
  const r = await t.post('/api/start', { json: { answers: ANSWERS, name: 'Ada Test', phone: '+234 803 000 0001', consent: true } });
  if (r.status !== 200) throw new Error(r.text);
  t.headers['X-CSRF-Token'] = r.json().csrf;
  return [t, r.json().ref];
}

export async function pkg(admin, code) {
  return (await admin.get('/api/admin/packages')).json().find(p => p.code === code);
}

export async function publish(admin, cid, items, advice = 'a') {
  const r = await admin.put(`/api/admin/clients/${cid}/recommendation`, { json: { heard: '', advice, items } });
  if (r.status !== 200) throw new Error(r.text);
  return admin.post(`/api/admin/clients/${cid}/recommendation/publish`);
}

export async function setupMonthly(app) {
  const [client] = await start(app);
  const admin = await staff(app);
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const m = (await admin.get('/api/admin/packages')).json().find(p => p.basis === 'monthly');
  await admin.post(`/api/admin/packages/${m.id}/approve`, { json: {} });
  const r = await publish(admin, cid, [{ package_id: m.id, priority: 2, renewal: 'monthly', renewal_minor: m.price_minor }]);
  if (r.status !== 200) throw new Error(r.text);
  const item = (await client.get('/api/client/me')).json().recommendation.items[0].id;
  return { client, admin, cid, m, item };
}

// a client with one paid, one-off package (ST-04, 7 days) and its engagement
export async function paidJob(app) {
  const [client] = await start(app);
  const admin = await staff(app);
  const cid = (await admin.get('/api/admin/clients')).json()[0].id;
  const p = await pkg(admin, 'ST-04');
  await admin.post(`/api/admin/packages/${p.id}/approve`, { json: {} });
  await publish(admin, cid, [{ package_id: p.id, priority: 1 }]);
  const item = (await client.get('/api/client/me')).json().recommendation.items[0].id;
  const r = (await client.post('/api/client/checkout', { json: { accept_terms: true, items: [item], method: 'transfer' } })).json();
  await admin.post(`/api/admin/orders/${r.order_id}/confirm`);
  const eng = (await admin.get('/api/admin/engagements')).json()[0];
  return { client, admin, cid, p, eng };
}
