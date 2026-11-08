// passwords, staff authenticator codes (totp), tokens and secret encryption.
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(crypto.pbkdf2);

// same format as before ('pbkdf2$310000$salt$hash'), so existing staff passwords keep working
export async function passwordHash(raw) {
  const salt = crypto.randomBytes(16);
  return 'pbkdf2$310000$' + salt.toString('hex') + '$' + (await pbkdf2(raw, salt, 310000, 32, 'sha256')).toString('hex');
}

export async function verifyPassword(raw, saved) {
  try {
    const [scheme, count, salt, stored] = String(saved).split('$');
    if (scheme !== 'pbkdf2' || !/^\d+$/.test(count) || !/^[0-9a-f]*$/i.test(salt) || !/^[0-9a-f]+$/i.test(stored)) return false;
    const want = Buffer.from(stored, 'hex');
    const got = await pbkdf2(raw, Buffer.from(salt, 'hex'), Number(count), want.length, 'sha256');
    return crypto.timingSafeEqual(got, want);
  } catch {
    return false;
  }
}

export const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
export const tokenUrlsafe = n => crypto.randomBytes(n).toString('base64url');
export const tokenHex = n => crypto.randomBytes(n).toString('hex');
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''), 'utf8'), y = Buffer.from(String(b ?? ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export const hmacHex = (key, msg, algo = 'sha256') => crypto.createHmac(algo, key).update(msg).digest('hex');

export function randomChoice(alphabet, n) {
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}

// ---- totp (rfc 6238, sha1, 6 digits, 30 seconds), compatible with every authenticator app
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const randomBase32 = (n = 32) => randomChoice(B32, n);
function base32Decode(s) {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6;
  return String(code).padStart(6, '0');
}
export const totpUri = (secret, account, issuer = 'Hamzury') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

// ---- authenticator secrets are stored encrypted with a key derived from HAMZURY_SECRET (aes-256-gcm)
const keyOf = secret => crypto.createHash('sha256').update(secret).digest();
export function encrypt(secret, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}
export function decrypt(secret, token) {
  if (!String(token).startsWith('v1.')) throw new Error('unknown format');
  const raw = Buffer.from(token.slice(3), 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
