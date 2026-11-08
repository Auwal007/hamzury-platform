// reads .env into process.env for local tools (vercel sets real environment variables itself). existing values win.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function loadEnv(file = path.resolve('.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
