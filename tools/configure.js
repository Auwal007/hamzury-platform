// generate a private development .env without overwriting existing configuration.
import crypto from 'node:crypto';
import { openSync, readFileSync, writeSync, closeSync } from 'node:fs';

const token = n => crypto.randomBytes(n).toString('base64url');
let settings = readFileSync('.env.example', 'utf8');
for (const [key, value] of Object.entries({
  HAMZURY_ADMIN_PASSWORD: token(24),
  HAMZURY_SECRET: token(48),
  HAMZURY_BILLING_KEY: token(48),
  CRON_SECRET: token(32),
  HAMZURY_PUBLIC_BASE_URL: 'https://www.hamzury.com',
  HAMZURY_SECURE_COOKIES: '0',
  HAMZURY_REQUIRE_STAFF_MFA: '0',
  HAMZURY_REQUIRE_UPLOAD_SCAN: '0',
})) {
  settings = settings.split(/\r?\n/).map(line => (line.startsWith(key + '=') ? `${key}=${value}` : line)).join('\n');
}
let fd;
try { fd = openSync('.env', 'wx', 0o600); } catch {
  console.error('.env already exists. nothing was changed.');
  process.exit(1);
}
writeSync(fd, settings.endsWith('\n') ? settings : settings + '\n');
closeSync(fd);
console.log('Created .env with private development secrets. Read it locally; do not share its contents.');
console.log('For production, set the same variables in Vercel (Settings > Environment Variables), with HAMZURY_ENV=production.');
console.log('An existing owner keeps their password. Recover access with: node tools/manage.js reset-password owner');
