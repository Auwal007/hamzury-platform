// the one vercel function: every /api/* call and /pay/callback arrive here (see the rewrites in vercel.json).
import { createApp } from '../lib/app.js';
import { sharedDb } from '../lib/db.js';
import { openStorage } from '../lib/storage.js';

export const config = { api: { bodyParser: false } };

let appPromise;
const getApp = () => (appPromise ??= sharedDb().then(db => createApp({ db, storage: openStorage() })).catch(e => { appPromise = undefined; throw e; }));

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 27 * 1024 * 1024) break;  // the app answers 413 for anything this large
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    const url = new URL(req.url, 'http://local');
    let p = url.pathname;
    if (p === '/api/index' || p === '/api/index.js') { p = url.searchParams.get('__p') || '/'; }
    url.searchParams.delete('__p');
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(', ') : v]));
    const ip = String(headers['x-real-ip'] || (headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || 'unknown').trim();
    const out = await app.handle({ method: req.method, path: p, query: url.searchParams, headers, body: await readBody(req), ip });
    res.statusCode = out.status;
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.end(out.body);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ detail: 'the service is starting or misconfigured. please try again shortly' }));
  }
}
