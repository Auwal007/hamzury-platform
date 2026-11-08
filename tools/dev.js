// run the whole site on your computer: http://127.0.0.1:8000
// uses DATABASE_URL and CLOUDINARY_URL from .env when set, otherwise an embedded database in data/pglite and files in data/files.
import http from 'node:http';
import { createApp } from '../lib/app.js';
import { openDb } from '../lib/db.js';
import { openStorage } from '../lib/storage.js';
import { loadEnv } from './env.js';

loadEnv();
process.env.DATABASE_URL ||= 'pglite:data/pglite';
const db = await openDb(process.env.DATABASE_URL);
const app = createApp({ db, storage: openStorage() });
await app.init();
const port = Number(process.env.PORT || 8000);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const url = new URL(req.url, 'http://local');
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]));
  const out = await app.handle({ method: req.method, path: url.pathname, query: url.searchParams, headers, body: Buffer.concat(chunks), ip: req.socket.remoteAddress || 'local' });
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}).listen(port, '127.0.0.1', () => {
  console.log(`hamzury running at http://127.0.0.1:${port}  (desk: /admin, user ${app.cfg.ADMIN_USERNAME})`);
  console.log(`database: ${db.kind === 'pglite' ? 'embedded (' + process.env.DATABASE_URL.replace('pglite:', '') + ')' : 'supabase'}, files: ${app.storage.kind === 'local' ? 'local folder' : 'cloudinary'}`);
});
