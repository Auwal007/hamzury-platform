// private file storage. production: cloudinary, 'authenticated' delivery (no public link ever exists).
// local and tests: a folder on disk. files are only ever opened through the server's permission checks.
import crypto from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function parseCloudinaryUrl(url) {
  const m = /^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/.exec(url || '');
  return m ? { apiKey: m[1], apiSecret: m[2], cloud: m[3] } : null;
}

function localStorage(dir) {
  const full = key => {
    const p = path.resolve(dir, key);
    if (path.dirname(p) !== path.resolve(dir)) throw new Error('bad key');
    return p;
  };
  return {
    kind: 'local',
    async put(key, data) { await mkdir(dir, { recursive: true }); await writeFile(full(key), data); },
    async get(key) { try { return await readFile(full(key)); } catch { return null; } },
    async remove(key) { try { await unlink(full(key)); } catch { /* already gone */ } },
    signUpload: () => null,         // the browser sends the file to the server directly
    downloadUrl: async () => null,  // the server sends the bytes itself
    async probe() { await mkdir(dir, { recursive: true }); const p = full('.probe-' + crypto.randomUUID()); await writeFile(p, 'ok'); await unlink(p); },
  };
}

function cloudinaryStorage({ apiKey, apiSecret, cloud }, folder = 'hamzury') {
  const api = `https://api.cloudinary.com/v1_1/${cloud}/raw`;
  const sign = params => crypto.createHash('sha1').update(
    Object.keys(params).sort().filter(k => params[k] !== '' && params[k] !== undefined).map(k => `${k}=${params[k]}`).join('&') + apiSecret).digest('hex');
  const now = () => Math.floor(Date.now() / 1000);
  const publicId = key => `${folder}/${key}`;
  const signedDownload = (key, { attachment = false, ttl = 120 } = {}) => {
    const p = { public_id: publicId(key), type: 'authenticated', expires_at: now() + ttl, timestamp: now(), ...(attachment ? { attachment: 'true' } : {}) };
    return api + '/download?' + new URLSearchParams({ ...p, api_key: apiKey, signature: sign(p) });
  };
  const post = async (op, params, file) => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ ...params, api_key: apiKey, signature: sign(params) })) body.append(k, String(v));
    if (file) body.append('file', new Blob([file]));
    const r = await fetch(`${api}/${op}`, { method: 'POST', body, signal: AbortSignal.timeout(60000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error?.message || `cloudinary ${op} failed`);
    return d;
  };
  return {
    kind: 'cloudinary',
    put: (key, data) => post('upload', { public_id: publicId(key), type: 'authenticated', timestamp: now() }, data),
    async get(key) {
      const r = await fetch(signedDownload(key), { signal: AbortSignal.timeout(60000) });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    },
    async remove(key) { try { await post('destroy', { public_id: publicId(key), type: 'authenticated', invalidate: 'true', timestamp: now() }); } catch { /* retried by retention */ } },
    // the browser uploads straight to cloudinary (large files never pass through a serverless function), then the server checks it
    signUpload(key) {
      const fields = { public_id: publicId(key), type: 'authenticated', timestamp: now() };
      return { url: `${api}/upload`, fields: { ...fields, api_key: apiKey, signature: sign(fields) } };
    },
    downloadUrl: async key => signedDownload(key, { attachment: true, ttl: 120 }),
    async probe() {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/usage`, {
        headers: { authorization: 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64') }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('cloudinary unavailable');
    },
  };
}

export function openStorage(env = process.env) {
  const c = parseCloudinaryUrl(env.CLOUDINARY_URL);
  if (c) return cloudinaryStorage(c, env.HAMZURY_CLOUDINARY_FOLDER || 'hamzury');
  return localStorage(path.resolve(env.HAMZURY_FILES || 'data/files'));
}
