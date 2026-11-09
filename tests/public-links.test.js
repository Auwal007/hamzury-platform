import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../lib/app.js';
import { Client, makeApp, staff, start } from './helpers.js';

const origin = 'https://www.hamzury.com';

test('public URL must be a website origin and is normalized', () => {
  assert.equal(loadConfig({ HAMZURY_PUBLIC_BASE_URL: ' https://WWW.HAMZURY.COM/ ' }).BASE_URL, origin);
  for (const value of ['hamzury.com', 'javascript:alert(1)', 'https://user:password@hamzury.com', `${origin}/track`, `${origin}?x=1`, `${origin}#home`]) {
    assert.throws(() => loadConfig({ HAMZURY_PUBLIC_BASE_URL: value }), /HAMZURY_PUBLIC_BASE_URL/);
  }
});

test('Vercel rejects local links even when HAMZURY_ENV was left as development', () => {
  for (const VERCEL_ENV of ['production', 'preview']) {
    for (const value of ['', 'http://www.hamzury.com', 'http://127.0.0.1:8000', 'https://localhost', 'https://127.1', 'https://[::1]', 'https://local.localhost.']) {
      assert.throws(() => loadConfig({ VERCEL: '1', VERCEL_ENV, HAMZURY_ENV: 'development', HAMZURY_PUBLIC_BASE_URL: value }), /public HTTPS website/);
    }
    assert.equal(loadConfig({ VERCEL: '1', VERCEL_ENV, HAMZURY_PUBLIC_BASE_URL: origin }).BASE_URL, origin);
  }
  assert.throws(() => loadConfig({ HAMZURY_ENV: 'production', HAMZURY_PUBLIC_BASE_URL: 'https://localhost' }), /public HTTPS website/);
});

test('local development can deliberately use a local server', () => {
  assert.equal(loadConfig({ HAMZURY_PUBLIC_BASE_URL: 'http://127.0.0.1:8000/' }).BASE_URL, 'http://127.0.0.1:8000');
  assert.equal(loadConfig({}).BASE_URL, '');
});

test('client links use the configured production origin and keep working tokens', async () => {
  const app = await makeApp({ HAMZURY_PUBLIC_BASE_URL: origin });
  try {
    const [, ref] = await start(app);
    const admin = await staff(app);
    const client = (await admin.get('/api/admin/clients')).json()[0];
    const config = (await admin.get('/api/public/config')).json();
    assert.equal(config.public_base_url, origin);
    const response = await admin.post(`/api/admin/clients/${client.id}/link`, { json: { dest: 'recommendation' } });
    assert.equal(response.status, 200);
    const link = response.json();
    assert.equal(link.url, origin + link.path);
    const url = new URL(link.url);
    assert.equal(url.hash, '#recommendation');
    const visitor = new Client(app);
    const login = await visitor.post('/api/client/link', { json: { token: url.searchParams.get('t') } });
    assert.equal(login.status, 200);
    assert.equal((await visitor.get('/api/client/me')).json().ref, ref);
  } finally { await app.db.close(); }
});
