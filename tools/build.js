// vercel build: copy the pages and assets into public/, which vercel serves from its cdn.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, 'static'), path.join(out, 'static'), { recursive: true });
await writeFile(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /admin\nDisallow: /track\nDisallow: /api/\n');
console.log('built public/');
