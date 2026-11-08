// hamzury holding | guided client platform (v7: serverless).
//
// the journey: start here (one question per screen) -> hamzury id -> holding prepares a recommendation from the
// package catalogue -> client chooses packages and pays -> onboarding for what they bought -> progress per package
// -> download when delivered.
//
// runs as one vercel function. data lives in supabase postgres, private files in cloudinary.
// requires security and legal review and https before handling real client data.
// prices only come from the catalogue the holding team enters. nothing is invented.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CAT from './catalogue.js';
import { HttpError, Reply, Router, clearCookie, cookie, f, fail, intParam, parseCookies, validate } from './http.js';
import { decrypt, encrypt, hmacHex, passwordHash, randomBase32, randomChoice, safeEqual, sha256hex, tokenHex, tokenUrlsafe, totpAt, totpUri, verifyPassword } from './security.js';
import { ALLOWED_UPLOADS, MAX_UPLOAD, baseName, extOf, validateUpload } from './uploads.js';
import { registerDesk } from './desk.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const VENTURES = ['bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin'];
export const ROLE_HOLDING = ['holding_owner', 'holding_admin'];
export const WORK_LABEL = {
  awaiting_onboarding: 'waiting for your details', onboarding_received: 'details received, starting soon',
  in_progress: 'in progress', review: 'final quality check', delivered: 'delivered',
};
// the questions asked on "start here". keys are fixed so the desk can read them reliably.
const INTAKE_KEYS = {
  path: 40, business: 150, industry: 600, stage: 60, registered: 30, needs: 900,
  challenge: 1500, tried: 300, impact: 300, importance: 4, goal: 80, timing: 60, team: 30,
  location: 120, venture: 20, route: 10, urgency: 40, src: 20, note: 800,
  industry_other: 120, challenge_other: 300, needs_other: 300,
  situation: 80, situation_q: 120, details: 900, details_other: 300, details_q: 120, format: 40,
};
export const TERMS_VERSION = '2026-11-07';
export const LEVELS = ['minimum', 'standard', 'protection', 'scaling'];
const ALL_LEVELS = [...LEVELS, 'renewals'];  // renewals and changes: always open, never blocks, usually priced after a few questions
export const GRACE_DAYS = 7;          // a missed monthly payment pauses the service after this many days
export const INVOICE_AHEAD_DAYS = 3;  // transfer payers get their invoice this many days before the due date
export const RETRY_EVERY_DAYS = 2;    // a declined card is tried again every two days inside the grace period
export const ENQUIRY_DAYS = 90;       // abandoned enquiries (never paid, no activity) are removed after 90 days
export const UPLOAD_DAYS = 90;        // client uploads (including id documents) are removed 90 days after the work is delivered
export const DELIVERED_DAYS = 365;    // delivered files stay in the portal 12 months after handover, or while a monthly service is active
export const NOTICE_DAYS = 30;        // clients are reminded 30 days before delivered files are removed
export const SECRET_WORDS = /\b(pass\s*words?|passwords?|passcode|pwd|pin|otp|secret\s*key)\b/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ORDER_REF = /^HZP-[A-Z0-9]{6}$/;

// ---------------------------------------------------------------- small helpers
export const cut = (s, n) => { const a = Array.from(String(s)); return a.length > n ? a.slice(0, n).join('') : String(s); };
export const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const dayFrom = iso => new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
export const addDays = (iso, n) => isoDay(new Date(dayFrom(iso).getTime() + n * 86400000));
export const daysBetween = (a, b) => Math.round((dayFrom(b) - dayFrom(a)) / 86400000);
export function validDay(s) { const d = dayFrom(s); return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(d.getTime()) && isoDay(d) === s; }
// the billing day next month, clamped to the month's last day (31 jan -> 28/29 feb -> 31 mar: no drift)
export function addMonth(iso, anchor) {
  const d = dayFrom(iso);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 2;
  if (m === 13) { y += 1; m = 1; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(anchor || d.getUTCDate(), last))}`;
}
// 'YYYY-MM-DD HH:MM:SS' (utc) -> seconds
export function parseTs(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(v || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : null;
}
export const vatOf = (amount, taxable, pr) => (pr.vat_registered && taxable ? Math.floor((amount * pr.vat_rate_bp + 5000) / 10000) : 0);  // half up, as the page shows it
export function daysIn(duration) {
  const m = /^(?:within\s+)?(\d+)\s*(?:to\s*\d+\s*)?(day|week)/.exec(String(duration || '').trim());
  return m ? Number(m[1]) * (m[2] === 'week' ? 7 : 1) : 0;
}
export const phoneKey = raw => String(raw || '').replace(/\D/g, '').slice(-10);
export function journeyStep(status, recPublished, paidAny, needsOnboarding, allDelivered) {
  // 1 tell us, 2 recommendation, 3 choose and pay, 4 onboarding, 5 progress, 6 delivered
  if (allDelivered) return 6;
  if (paidAny && needsOnboarding) return 4;
  if (paidAny) return 5;
  if (recPublished) return 3;
  return 2;
}

export function packageView(p, price) {
  const g = (col, d) => (col in p ? p[col] : d);
  return {
    id: p.id, venture: p.venture, name: p.name, summary: p.summary, inclusions: parseJson(p.inclusions, []), value: p.value, duration: p.duration,
    price_minor: price === undefined ? p.price_minor : price, onboarding: parseJson(p.onboarding, []),
    code: g('code', ''), level: g('level', 'standard'), exclusions: parseJson(g('exclusions', '[]'), []), basis: g('basis', 'fixed'),
    price_status: g('price_status', 'approved'), external: g('external', ''), format: g('format', 'document'), vat: Boolean(g('vat', 1)),
    group: g('grp', ''), requires: parseJson(g('requires', '[]'), []), overlaps: parseJson(g('overlaps', '[]'), []),
  };
}
export const attachmentList = e => Object.entries(parseJson(e.attachments || '{}', {})).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([k, v]) => ({ q: k, name: v.name, size: v.size || 0 }));

const MIME = { '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
export const mimeOf = name => MIME[extOf(name)] || 'application/octet-stream';
const disposition = name => (/^[\x20-\x7e]*$/.test(name) && !/["\\]/.test(name) ? `attachment; filename="${name}"` : `attachment; filename*=utf-8''${encodeURIComponent(name)}`);

// security headers for every response (vercel.json sets the same ones on the static pages)
export function securityHeaders(urlPath, secureCookies) {
  const priv = ['/api/', '/admin', '/track', '/pay/'].some(p => urlPath.startsWith(p));
  return {
    'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cache-control': priv ? 'no-store' : 'public, max-age=300',
    'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self'; script-src 'self'; "
      + "connect-src 'self' https://api.cloudinary.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://checkout.paystack.com",
    ...(secureCookies ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

// ---------------------------------------------------------------- configuration
export function loadConfig(env = process.env) {
  const production = (env.HAMZURY_ENV || 'development') === 'production';
  const num = (v, d) => Math.max(1, parseInt(v || d, 10) || d);
  const cfg = {
    PRODUCTION: production,
    ADMIN_USERNAME: env.HAMZURY_ADMIN_USERNAME || 'owner',
    ADMIN_PASSWORD: env.HAMZURY_ADMIN_PASSWORD || '',
    SECRET: env.HAMZURY_SECRET || '',
    BASE_URL: (env.HAMZURY_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    SECURE_COOKIES: env.HAMZURY_SECURE_COOKIES === '1',
    UPDATE_HOURS: num(env.HAMZURY_UPDATE_HOURS, 48),
    CONTACT_EMAIL: env.HAMZURY_CONTACT_EMAIL || 'desk@hamzury.com',
    PAYSTACK_SECRET: env.HAMZURY_PAYSTACK_SECRET_KEY || '',
    BANK_DETAILS: env.HAMZURY_BANK_DETAILS || '',  // e.g. "bank: ..., account name: ..., account number: ..."
    REQUIRE_MFA: (env.HAMZURY_REQUIRE_STAFF_MFA || (production ? '1' : '0')) === '1',
    REQUIRE_SCAN: (env.HAMZURY_REQUIRE_UPLOAD_SCAN || (production ? '1' : '0')) === '1',
    SCAN_URL: env.HAMZURY_UPLOAD_SCAN_URL || '',
    SCAN_TOKEN: env.HAMZURY_UPLOAD_SCAN_TOKEN || '',
    BILLING_KEY: env.HAMZURY_BILLING_KEY || '',
    CRON_SECRET: env.CRON_SECRET || '',
    WHATSAPP_NUMBER: (env.HAMZURY_WHATSAPP_NUMBER || '').replace(/\D/g, ''),
    QUICK_REPLY_HOURS: num(env.HAMZURY_QUICK_REPLY_HOURS, 24),
    PLAN_NUDGE_HOURS: num(env.HAMZURY_PLAN_NUDGE_HOURS, 4),  // remind the desk when a proposal has waited this long
    // public venture pages. a site address shows only where it is confirmed (brand standard 07, addresses page).
    VENTURE_INFO: {
      bizdoc: { name: 'bizdoc', area: 'registration, documentation and compliance', promise: 'registered, compliant, ready.',
        hook: 'the right papers for your idea, contract or business, done properly.', site: env.HAMZURY_SITE_BIZDOC ?? 'https://bizdocconsult.com' },
      medialy: { name: 'medialy', area: 'business management, marketing and growth', promise: 'seen, trusted, chosen.',
        hook: 'people notice you. we help them buy, and come back.', site: env.HAMZURY_SITE_MEDIALY || '' },
      subt: { name: 'subt', area: 'software, ai and automation', promise: 'ai and automation that work for you.',
        hook: 'less repeated work. more time for what matters.', site: env.HAMZURY_SITE_SUBT || '' },
      iotics: { name: 'iotics', area: 'smart technology, robotics and installations', promise: 'smarter, safer spaces.',
        hook: 'see, control and protect your space from your phone.', site: env.HAMZURY_SITE_IOTICS || '' },
      hub: { name: 'hamzury hub', area: 'practical skills and business development', promise: 'a team that knows how.',
        hook: 'practical skills you can use the next day.', site: env.HAMZURY_SITE_HUB || '' },
      iwiin: { name: 'iwiin', area: 'grants, partnerships and opportunities', promise: 'ready for funding.',
        hook: 'find the right opportunities, and apply well.', site: env.HAMZURY_SITE_IWIIN ?? 'https://iwiin.hamzury.com' },
    },
  };
  Object.defineProperty(cfg, 'READY', { get() { return this.ADMIN_PASSWORD.length >= 12 && this.SECRET.length >= 32; }, enumerable: true });
  if (production) {
    const problems = [];
    if (!cfg.READY) problems.push('strong secrets');
    if (!cfg.SECURE_COOKIES) problems.push('secure cookies');
    if (!cfg.BASE_URL.startsWith('https://')) problems.push('HTTPS URL');
    if (cfg.BILLING_KEY.length < 32) problems.push('billing key (32+)');
    if (!cfg.REQUIRE_MFA) problems.push('staff MFA');
    if (!cfg.REQUIRE_SCAN || !cfg.SCAN_URL) problems.push('upload scanning');
    if (!env.DATABASE_URL || env.DATABASE_URL.startsWith('pglite:')) problems.push('a supabase DATABASE_URL');
    if (!env.CLOUDINARY_URL) problems.push('CLOUDINARY_URL');
    if (problems.length) throw new Error('production requires strong secrets, HTTPS URL, secure cookies, billing key (32+), staff MFA, upload scanning, DATABASE_URL and CLOUDINARY_URL. missing: ' + problems.join(', '));
  }
  return cfg;
}

// ---------------------------------------------------------------- the app
export function createApp({ env = process.env, db, storage }) {
  const cfg = loadConfig(env);
  const router = new Router();
  const app = { cfg, db, storage, router, TERMS_VERSION, SECRET_WORDS };
  app.time = () => Date.now() / 1000;  // replaceable in tests
  // the date in nigeria (west africa time, utc+1, no daylight saving), whatever the server clock says
  app.today = () => isoDay(new Date(app.time() * 1000 + 3600000));
  const tx = fn => db.tx(fn);

  const log = (c, actor, event, entity, entityId, summary = '') =>
    c.run('INSERT INTO audit(actor,event,entity,entity_id,summary) VALUES(?,?,?,?,?)', actor, event, entity, entityId ?? null, cut(String(summary ?? ''), 300));
  const TABLES = ['clients', 'packages', 'orders', 'engagements', 'users', 'recommendations', 'subscriptions'];
  async function one(c, table, id) {
    if (!TABLES.includes(table)) throw new Error('bad table');
    const row = await c.get(`SELECT * FROM ${table} WHERE id=?`, id);
    if (!row) fail(404, 'record not found');
    return row;
  }
  async function newRef(c, table, column, prefix) {
    for (let i = 0; i < 10; i++) {
      const ref = prefix + randomChoice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
      if (!(await c.get(`SELECT 1 FROM ${table} WHERE ${column}=?`, ref))) return ref;
    }
    fail(500, 'please try again');
  }
  const hoursSince = v => { const t = parseTs(v); return t ? (app.time() - t) / 3600 : 0; };
  app.helpers = { one, log, newRef, hoursSince, tx };

  async function throttle(kind, ctx, limit, seconds) {
    const now = Math.floor(app.time());
    const key = hmacHex(cfg.SECRET, `${kind}:${ctx.ip}`);
    const count = await tx(async c => {
      await c.run('DELETE FROM rate_limits WHERE expires<=?', now);
      return c.val('INSERT INTO rate_limits(key,n,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=rate_limits.n+1 RETURNING n', key, now + seconds);
    });
    if (count > limit) fail(429, 'too many attempts. please wait a little and try again');
    return key;
  }

  // one payment (or file) operation at a time, across every serverless instance. a lease frees itself if an instance dies.
  async function locked(name, busyMessage, fn) {
    const holder = tokenHex(12), now = Math.floor(app.time());
    const got = await tx(c => c.get(`INSERT INTO op_locks(name,holder,until) VALUES(?,?,?)
      ON CONFLICT(name) DO UPDATE SET holder=excluded.holder,until=excluded.until WHERE op_locks.until<? RETURNING holder`, name, holder, now + 120, now));
    if (!got) fail(409, busyMessage);
    try {
      return await fn();
    } finally {
      await tx(c => c.run('DELETE FROM op_locks WHERE name=? AND holder=?', name, holder)).catch(() => {});
    }
  }
  const paymentOp = fn => locked('payments', 'a payment operation is running. please retry shortly', fn);
  const storageOp = fn => locked('storage', 'file maintenance is running. please retry shortly', fn);
  app.locks = { paymentOp, storageOp };

  // ---------------------------------------------------------------- setup (once per cold start)
  async function loadCatalogue(c, onlyMissing = false) {
    // bring the master catalogue into the packages table, matched by code.
    // never touches a price or its approval once it exists: those belong to the holding.
    let added = 0, updated = 0;
    const have = new Map((await c.all("SELECT id,code FROM packages WHERE code!=''")).map(r => [r.code, r.id]));
    for (const i of CAT.CATALOGUE) {
      const text = [i.owner, i.name, cut(i.value.split('.')[0], 400), JSON.stringify(i.inclusions), i.value, i.duration, JSON.stringify(i.onboarding),
        i.stage, i.level, JSON.stringify(i.exclusions), i.basis, i.external, i.format, i.group, JSON.stringify(i.requires), JSON.stringify(i.overlaps), i.focus];
      if (have.has(i.code)) {
        if (!onlyMissing) {
          await c.run(`UPDATE packages SET venture=?,name=?,summary=?,inclusions=?,value=?,duration=?,onboarding=?,stage=?,level=?,exclusions=?,basis=?,
                       external=?,format=?,grp=?,requires=?,"overlaps"=?,focus=? WHERE id=?`, ...text, have.get(i.code));
          updated += 1;
        }
        continue;
      }
      await c.run(`INSERT INTO packages(venture,name,summary,inclusions,value,duration,onboarding,stage,level,exclusions,basis,external,format,grp,requires,"overlaps",focus,
                   code,price_minor,price_status,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`, ...text, i.code, i.price_minor, i.status);
      added += 1;
    }
    return { added, updated };
  }
  app.loadCatalogue = loadCatalogue;
  let ready;
  app.init = () => (ready ??= tx(async c => {
    await loadCatalogue(c, true);
    if (Number(await c.val('SELECT COUNT(*) FROM users')) === 0 && cfg.READY) {
      await c.run('INSERT INTO users(username,display_name,password_hash,role) VALUES(?,?,?,?) ON CONFLICT(username) DO NOTHING',
        cfg.ADMIN_USERNAME, 'holding owner', await passwordHash(cfg.ADMIN_PASSWORD), 'holding_owner');
    }
  }).catch(e => { ready = undefined; throw e; }));

  // ---------------------------------------------------------------- staff auth
  async function staff(ctx) {
    if (!cfg.READY) fail(503, 'set HAMZURY_ADMIN_PASSWORD (12+) and HAMZURY_SECRET (32+) first');
    const token = ctx.cookies.hz_staff || '';
    if (!token) fail(401, 'please sign in');
    const row = await tx(c => c.get('SELECT s.csrf,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?', sha256hex(token)));
    if (!row || !row.active || row.expires_at <= app.time()) fail(401, 'session expired. please sign in again');
    if (!['GET', 'HEAD'].includes(ctx.method) && !safeEqual(ctx.headers['x-csrf-token'] || '', row.csrf)) fail(403, 'session check failed. refresh the page and try again');
    if (cfg.REQUIRE_MFA && !row.mfa_secret && !['/api/me', '/api/logout'].includes(ctx.path) && !ctx.path.startsWith('/api/account/')) {
      fail(403, 'set up an authenticator in account security first');
    }
    return row;
  }
  const roleCheck = (roles, msg) => async ctx => { const u = await staff(ctx); if (!roles.includes(u.role)) fail(403, msg); return u; };
  const auth = {
    staff,
    holding: roleCheck(ROLE_HOLDING, 'holding role required'),
    owner: roleCheck(['holding_owner'], 'holding owner role required'),
    money: roleCheck([...ROLE_HOLDING, 'finance'], 'holding or finance role required'),
    financeOrOwner: roleCheck(['holding_owner', 'finance'], 'finance or the holding owner only'),
  };
  const publicUser = u => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, venture: u.venture,
    phone: u.phone ?? '', mfa_enabled: Boolean(u.mfa_secret), mfa_required: cfg.REQUIRE_MFA });

  async function checkOtp(c, u, code, encrypted) {
    let raw;
    try { raw = decrypt(cfg.SECRET, encrypted || u.mfa_secret); } catch { fail(503, 'authenticator unavailable. contact the server operator'); }
    const step = Math.floor(app.time() / 30);
    const matched = [step - 1, step, step + 1].find(n => n > u.mfa_last_step && safeEqual(totpAt(raw, n), code));
    if (matched === undefined) fail(401, 'enter a new authenticator code');
    const changed = await c.run('UPDATE users SET mfa_last_step=? WHERE id=? AND mfa_last_step<?', matched, u.id, matched);
    if (changed.rowCount !== 1) fail(401, 'enter a new authenticator code');
  }
  const staffCookie = (ctx, token) => ctx.setCookie(cookie('hz_staff', token, { maxAge: 8 * 3600, secure: cfg.SECURE_COOKIES, sameSite: 'strict' }));

  const R = (method, pattern, handler) => router.add(method, pattern, handler);
  const body = (ctx, fields) => validate(fields, ctx.json());

  R('POST', '/api/login', async ctx => {
    if (!cfg.READY) fail(503, 'configure strong application secrets first');
    const b = body(ctx, { username: f.str({ max: 60 }), password: f.str({ max: 200 }), otp: f.str({ default: '', max: 6, pattern: /^(?:[0-9]{6})?$/ }) });
    await throttle('staff_login', ctx, 12, 900);
    const out = await tx(async c => {
      const u = await c.get('SELECT * FROM users WHERE username=? AND active=1', b.username.toLowerCase());
      if (!u || !(await verifyPassword(b.password, u.password_hash))) fail(401, 'username or password is not correct');
      if (u.mfa_secret) await checkOtp(c, u, b.otp);
      const token = tokenUrlsafe(36), csrf = tokenUrlsafe(28);
      await c.run('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)', sha256hex(token), u.id, csrf, Math.floor(app.time() + 8 * 3600));
      await log(c, u.username, 'staff.login', 'users', u.id);
      return { token, csrf, u };
    });
    staffCookie(ctx, out.token);
    return { csrf: out.csrf, user: publicUser(out.u) };
  });

  R('GET', '/api/me', async ctx => { const u = await staff(ctx); return { user: publicUser(u), csrf: u.csrf }; });

  R('POST', '/api/logout', async ctx => {
    await staff(ctx);
    await tx(c => c.run('DELETE FROM sessions WHERE token_hash=?', sha256hex(ctx.cookies.hz_staff || '')));
    ctx.setCookie(clearCookie('hz_staff'));
    return { ok: true };
  });

  R('POST', '/api/account/password', async ctx => {
    const user = await staff(ctx);
    const b = body(ctx, { current_password: f.str({ max: 200 }), new_password: f.str({ min: 12, max: 200 }) });
    await throttle('account_security', ctx, 12, 900);
    await tx(async c => {
      const u = await one(c, 'users', user.id);
      if (!(await verifyPassword(b.current_password, u.password_hash))) fail(401, 'current password is not correct');
      if (b.current_password === b.new_password) fail(400, 'choose a different password');
      await c.run('UPDATE users SET password_hash=? WHERE id=?', await passwordHash(b.new_password), user.id);
      await c.run('DELETE FROM sessions WHERE user_id=?', user.id);
      await log(c, user.username, 'staff.password_changed', 'users', user.id);
    });
    ctx.setCookie(clearCookie('hz_staff'));
    return { ok: true };
  });

  R('POST', '/api/account/mfa/setup', async ctx => {
    const user = await staff(ctx);
    const b = body(ctx, { password: f.str({ max: 200 }) });
    await throttle('account_security', ctx, 12, 900);
    const secret = randomBase32(32);
    await tx(async c => {
      const u = await one(c, 'users', user.id);
      if (!(await verifyPassword(b.password, u.password_hash))) fail(401, 'password is not correct');
      if (u.mfa_secret) fail(409, 'authenticator is already enabled');
      await c.run('UPDATE users SET mfa_pending=? WHERE id=?', encrypt(cfg.SECRET, secret), user.id);
    });
    return { secret, uri: totpUri(secret, user.username) };
  });

  R('POST', '/api/account/mfa/enable', async ctx => {
    const user = await staff(ctx);
    const b = body(ctx, { code: f.str({ min: 6, max: 6, pattern: /^[0-9]{6}$/ }) });
    await throttle('account_security', ctx, 12, 900);
    await tx(async c => {
      const u = await one(c, 'users', user.id);
      if (!u.mfa_pending || u.mfa_secret) fail(409, 'start authenticator setup first');
      await checkOtp(c, u, b.code, u.mfa_pending);
      await c.run("UPDATE users SET mfa_secret=mfa_pending,mfa_pending='' WHERE id=?", user.id);
      await c.run('DELETE FROM sessions WHERE user_id=?', user.id);
      await log(c, user.username, 'staff.mfa_enabled', 'users', user.id);
    });
    ctx.setCookie(clearCookie('hz_staff'));
    return { ok: true };
  });

  R('GET', '/api/users', async ctx => {
    await auth.holding(ctx);
    return tx(async c => (await c.all('SELECT * FROM users ORDER BY id')).map(u => ({ ...publicUser(u), active: Boolean(u.active) })));
  });

  R('POST', '/api/users', async ctx => {
    const user = await auth.owner(ctx);
    const b = body(ctx, {
      username: f.str({ min: 3, max: 40, pattern: /^[a-zA-Z0-9_.-]+$/ }), display_name: f.str({ min: 2, max: 100 }), password: f.str({ min: 12, max: 200 }),
      role: f.oneOf(['holding_admin', 'venture_ceo', 'venture_admin', 'finance']), phone: f.str({ default: '', max: 30 }),
      venture: f.oneOf(VENTURES, { default: null, nullable: true }),
    });
    if (b.role.startsWith('venture') && !b.venture) fail(400, 'choose a venture for venture staff');
    const hash = await passwordHash(b.password);
    const id = await tx(async c => {
      if (await c.get('SELECT 1 FROM users WHERE username=?', b.username.toLowerCase())) fail(409, 'that username is taken');
      const nid = await c.val('INSERT INTO users(username,display_name,password_hash,role,venture,phone) VALUES(?,?,?,?,?,?) RETURNING id',
        b.username.toLowerCase(), b.display_name, hash, b.role, b.role.startsWith('venture') ? b.venture : null, b.phone.trim());
      await log(c, user.username, 'staff.created', 'users', nid);
      return nid;
    });
    return { id };
  });

  R('POST', '/api/users/{uid}/deactivate', async ctx => {
    const uid = intParam(ctx.params.uid, 'uid');
    const user = await auth.owner(ctx);
    if (uid === user.id) fail(400, 'you cannot deactivate your own account');
    await tx(async c => {
      await one(c, 'users', uid);
      await c.run('UPDATE users SET active=0 WHERE id=?', uid);
      await c.run('DELETE FROM sessions WHERE user_id=?', uid);
      await log(c, user.username, 'staff.deactivated', 'users', uid);
    });
    return { ok: true };
  });

  R('POST', '/api/users/{uid}/password', async ctx => {
    const uid = intParam(ctx.params.uid, 'uid');
    const user = await auth.owner(ctx);
    const b = body(ctx, { owner_password: f.str({ max: 200 }), new_password: f.str({ min: 12, max: 200 }) });
    await throttle('account_security', ctx, 12, 900);
    const hash = await passwordHash(b.new_password);
    await tx(async c => {
      const actor = await one(c, 'users', user.id);
      const target = await one(c, 'users', uid);
      if (!(await verifyPassword(b.owner_password, actor.password_hash))) fail(401, 'owner password is not correct');
      if (target.role === 'holding_owner') fail(400, 'use account security to change your own password');
      await c.run('UPDATE users SET password_hash=? WHERE id=?', hash, uid);
      await c.run('DELETE FROM sessions WHERE user_id=?', uid);
      await log(c, user.username, 'staff.password_reset', 'users', uid);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- start here (public intake)
  function cleanAnswers(raw) {
    const out = {};
    for (const [key, limit] of Object.entries(INTAKE_KEYS)) {
      let v = Object.hasOwn(raw, key) ? raw[key] : '';
      if (Array.isArray(v)) {
        v = v.map(x => cut(String(x), 80)).slice(0, 14);
        if (v.reduce((s, x) => s + Array.from(x).length, 0) > limit) fail(400, 'answer is too long');
      } else {
        v = cut(String(v).trim(), limit);
      }
      out[key] = v;
    }
    if (!['', 'quick', 'full', 'venture'].includes(out.route)) out.route = '';
    if (out.route === 'quick' && !out.path) out.path = 'quick';
    if (!['start', 'contract', 'grow', 'service', 'partnership', 'quick'].includes(out.path)) fail(400, 'please choose what describes you');
    if (out.venture && !VENTURES.includes(out.venture)) out.venture = '';
    if (out.importance && !(typeof out.importance === 'string' && /^\d+$/.test(out.importance) && +out.importance >= 1 && +out.importance <= 10)) out.importance = '';
    return out;
  }

  async function clientCookie(ctx, c, clientId) {
    const token = tokenUrlsafe(36), csrf = tokenUrlsafe(28);
    await c.run('INSERT INTO client_sessions(token_hash,client_id,csrf,expires_at) VALUES(?,?,?,?)', sha256hex(token), clientId, csrf, Math.floor(app.time() + 30 * 86400));
    ctx.setCookie(cookie('hz_client', token, { maxAge: 30 * 86400, secure: cfg.SECURE_COOKIES, sameSite: 'lax' }));
    return csrf;
  }

  async function draftFocus(c, cid) {
    const codes = (await c.all(`SELECT p.code FROM recommendations rc JOIN rec_items ri ON ri.recommendation_id=rc.id
                                JOIN packages p ON p.id=ri.package_id WHERE rc.client_id=? AND p.code!='' ORDER BY ri.priority, ri.sort`, cid)).map(r => r.code);
    return CAT.focusLines(codes.filter(x => x in CAT.BY_CODE).map(code => ({ code })));
  }

  // turn the client's answers into a draft roadmap for the holding to review. the client sees only plain focus lines, never prices.
  async function draftFromAnswers(c, cid, answers) {
    let sug;
    try { sug = CAT.suggest(answers); } catch { return []; }
    const rows = [];
    for (const s of sug) {
      const p = await c.get('SELECT * FROM packages WHERE code=? AND active=1', s.code);
      if (p) rows.push([s, p]);
    }
    if (!rows.length) return [];
    const focus = CAT.focusLines(rows.map(([s]) => s));
    const advice = focus.length ? 'first, ' + focus[0] + (focus.length > 1 ? `. then, ${focus[1]}` : '') + '.' : '';
    const recId = await c.val("INSERT INTO recommendations(client_id,heard,advice,status,auto) VALUES(?,?,?,'draft',1) RETURNING id", cid, '', advice);
    for (const [k, [s, p]] of rows.entries()) {
      const verify = s.reason.includes('we will check') || s.reason.includes('we will confirm');
      const monthly = p.basis === 'monthly';
      await c.run(`INSERT INTO rec_items(recommendation_id,package_id,price_minor,note,priority,stage,sort,level,quote,assess,renewal,renewal_minor)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, recId, p.id, p.price_minor, s.reason, s.urgency, p.stage, k, p.level,
      p.basis === 'quote' ? 'ask' : 'fixed', verify ? 'verify' : '', monthly ? 'monthly' : 'none', monthly ? p.price_minor : 0);
    }
    await log(c, 'system', 'draft.created', 'clients', cid, rows.map(([s]) => s.code).join(','));
    return focus;
  }

  R('POST', '/api/start', async ctx => {
    const b = body(ctx, {
      answers: f.dict(f.strOrList()), name: f.str({ min: 2, max: 120 }), phone: f.str({ min: 7, max: 40 }),
      email: f.str({ default: '', max: 160 }), consent: f.bool({ default: false }), website: f.str({ default: '', max: 200 }),  // website: honeypot
    });
    await throttle('start', ctx, 8, 3600);
    if (b.website.trim()) return { ref: 'HZ-' + tokenHex(3).toUpperCase(), csrf: '' };
    if (!b.consent) fail(400, 'please confirm we may use your details to prepare your recommendation');
    if (phoneKey(b.phone).length < 7) fail(400, 'please check your phone number');
    if (b.email && !EMAIL.test(b.email.trim())) fail(400, 'please check your email address');
    const answers = cleanAnswers(b.answers);
    return tx(async c => {
      const ref = await newRef(c, 'clients', 'ref', 'HZ-');
      const id = await c.val('INSERT INTO clients(ref,name,business,phone,phone_key,email,path,intake,source) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id',
        ref, b.name.trim(), answers.business, b.phone.trim(), phoneKey(b.phone), b.email.trim().toLowerCase(), answers.path, JSON.stringify(answers), answers.venture || 'holding');
      await log(c, 'client', 'client.started', 'clients', id, answers.path);
      const focus = await draftFromAnswers(c, id, answers);
      const csrf = await clientCookie(ctx, c, id);
      return { ref, csrf, review_hours: cfg.UPDATE_HOURS, focus };
    });
  });

  // ---------------------------------------------------------------- client session
  async function client(ctx) {
    const token = ctx.cookies.hz_client || '';
    if (!token) fail(401, 'please enter your hamzury id');
    const row = await tx(c => c.get('SELECT s.csrf,s.expires_at,c.* FROM client_sessions s JOIN clients c ON c.id=s.client_id WHERE s.token_hash=?', sha256hex(token)));
    if (!row || row.expires_at <= app.time() || row.status === 'closed') fail(401, 'please enter your hamzury id again');
    if (!['GET', 'HEAD'].includes(ctx.method) && !safeEqual(ctx.headers['x-csrf-token'] || '', row.csrf)) fail(403, 'please refresh the page and try again');
    return row;
  }
  auth.client = client;

  R('GET', '/api/public/config', async () => ({ whatsapp: cfg.WHATSAPP_NUMBER, contact_email: cfg.CONTACT_EMAIL, review_hours: cfg.UPDATE_HOURS, quick_reply_hours: cfg.QUICK_REPLY_HOURS }));

  // anonymous funnel counts: which screen people reach. no personal data, no identifiers.
  R('POST', '/api/events', async ctx => {
    const b = body(ctx, { flow: f.oneOf(['route', 'quick', 'full']), step: f.int({ ge: 0, le: 40 }) });
    try { await throttle('event', ctx, 400, 3600); } catch (e) { if (e instanceof HttpError) return { ok: true }; throw e; }
    await tx(c => c.run('INSERT INTO events(day,flow,step,n) VALUES(utc_day(),?,?,1) ON CONFLICT(day,flow,step) DO UPDATE SET n=events.n+1', b.flow, b.step));
    return { ok: true };
  });

  // a private link sent on whatsapp opens the right step without typing the id and phone
  R('POST', '/api/client/link', async ctx => {
    const b = body(ctx, { token: f.str({ min: 20, max: 120 }) });
    await throttle('client_link', ctx, 30, 900);
    return tx(async c => {
      const row = await c.get(`SELECT l.*,c.status AS client_status,c.owner_user_id FROM client_links l JOIN clients c ON c.id=l.client_id
                               WHERE l.token_hash=?`, sha256hex(b.token));
      if (!row || row.expires_at <= app.time() || row.client_status === 'closed') fail(401, 'this link has expired. please use your hamzury id and phone number, or ask us for a new link');
      await c.run('UPDATE client_links SET last_used_at=now_ts() WHERE token_hash=?', row.token_hash);
      const sender = row.owner_user_id ? await c.get('SELECT display_name FROM users WHERE id=?', row.owner_user_id) : null;
      const csrf = await clientCookie(ctx, c, row.client_id);
      await log(c, 'client', 'client.link_opened', 'clients', row.client_id, row.dest);
      return { csrf, dest: row.dest, sender: sender ? sender.display_name : 'the hamzury desk' };
    });
  });

  R('POST', '/api/client/login', async ctx => {
    const b = body(ctx, { ref: f.str({ min: 4, max: 20 }), phone: f.str({ min: 7, max: 40 }) });
    await throttle('client_login', ctx, 10, 900);
    let ref = b.ref.trim().toUpperCase().replace(/ /g, '');
    if (!ref.startsWith('HZ-')) ref = 'HZ-' + (ref.startsWith('HZ') ? ref.slice(2) : ref);
    return tx(async c => {
      const row = await c.get("SELECT * FROM clients WHERE ref=? AND status!='closed'", ref);
      if (!row || !safeEqual(row.phone_key, phoneKey(b.phone))) fail(401, 'we could not find that id with that phone number. please check both');
      const csrf = await clientCookie(ctx, c, row.id);
      await log(c, 'client', 'client.login', 'clients', row.id);
      return { csrf };
    });
  });

  R('POST', '/api/client/logout', async ctx => {
    await client(ctx);
    await tx(c => c.run('DELETE FROM client_sessions WHERE token_hash=?', sha256hex(ctx.cookies.hz_client || '')));
    ctx.setCookie(clearCookie('hz_client'));
    return { ok: true };
  });

  // ---------------------------------------------------------------- settings, vat
  const DEFAULT_SETTINGS = { entity_name: 'hamzury holding', entity_rc: '', vat_registered: '0', vat_rate_bp: '750', vat_tin: '' };
  const setting = async (c, key) => { const r = await c.get('SELECT value FROM settings WHERE key=?', key); return r ? r.value : (DEFAULT_SETTINGS[key] ?? ''); };
  // what every bill shows: the invoicing company and whether vat applies. vat stays off until finance turns it on.
  async function pricing(c) {
    return { entity_name: await setting(c, 'entity_name'), entity_rc: await setting(c, 'entity_rc'), vat_registered: (await setting(c, 'vat_registered')) === '1',
      vat_rate_bp: parseInt(await setting(c, 'vat_rate_bp'), 10) || 750, vat_tin: await setting(c, 'vat_tin'), terms_version: TERMS_VERSION };
  }
  app.helpers.setting = setting;
  app.helpers.pricing = pricing;

  // identifies exactly what was accepted: the published plan and a fingerprint of its items, prices and advice
  async function proposalVersion(c, rec) {
    const rows = await c.all('SELECT id,package_id,price_minor,quote,renewal_minor FROM rec_items WHERE recommendation_id=? ORDER BY id', rec.id);
    const raw = JSON.stringify([rec.advice, rows.map(r => [r.id, r.package_id, r.price_minor, r.quote, r.renewal_minor])]);
    return `${rec.id}-${(rec.published_at || '').slice(0, 10)}-${sha256hex(raw).slice(0, 10)}`;
  }

  // ---------------------------------------------------------------- the client's dashboard
  R('GET', '/api/client/me', async ctx => {
    const me = await client(ctx);
    const d = await tx(async c => {
      // activity for the keeping rules: a client who signs in is not an abandoned enquiry
      await c.run("UPDATE clients SET last_seen_at=now_ts() WHERE id=? AND (last_seen_at IS NULL OR last_seen_at < ts_ago('1 hour'))", me.id);
      const rec = await c.get("SELECT * FROM recommendations WHERE client_id=? AND status='published'", me.id);
      const items = [];
      const ownedIds = new Set((await c.all('SELECT rec_item_id FROM engagements WHERE client_id=?', me.id)).map(r => r.rec_item_id));
      if (rec) {
        for (const it of await c.all(`SELECT r.*, p.venture,p.name,p.summary,p.inclusions,p.value,p.duration,p.onboarding,p.price_minor AS list_price, p.id AS pid,
                                     p.code,p.exclusions,p.basis,p.external,p.format,p.grp,p.requires,p."overlaps",p.price_status
                                     FROM rec_items r JOIN packages p ON p.id=r.package_id WHERE r.recommendation_id=? ORDER BY r.sort,r.id`, rec.id)) {
          const feeOpen = it.quote === 'fixed' && (it.price_status || 'approved') !== 'approved' && !ownedIds.has(it.id);
          items.push({ id: it.id, stage: it.stage, priority: it.priority, note: it.note, level: it.level, client_has: Boolean(it.client_has), quote: it.quote,
            requested: Boolean(it.requested_at), assess: feeOpen ? 'verify' : it.assess, saved: Boolean(it.client_saved),
            fee_pending: feeOpen, renewal: it.renewal, renewal_minor: feeOpen ? 0 : it.renewal_minor,
            package: packageView({ ...it, id: it.pid }, feeOpen ? 0 : it.price_minor) });
        }
      }
      const engagements = await c.all('SELECT * FROM engagements WHERE client_id=? ORDER BY id', me.id);
      const bought = new Map(engagements.map(e => [e.rec_item_id, e]));
      for (const it of items) {
        const e = bought.get(it.id);
        it.owned = Boolean(e);
        if (e) {
          it.engagement = { id: e.id, status: e.status, status_label: WORK_LABEL[e.status], progress: e.progress,
            has_file: Boolean(e.file_path) && e.status === 'delivered', file_name: e.status === 'delivered' ? e.file_name : null,
            onboarding_done: Boolean(e.onboarding_at), delivered_at: e.delivered_at,
            attachments: Object.fromEntries(Object.entries(parseJson(e.attachments || '{}', {})).map(([k, v]) => [k, v.name])),
            files_until: e.delivered_at ? addDays(e.delivered_at, DELIVERED_DAYS) : null,
            file_removed: Boolean(e.file_purged_at),
            handover: Object.fromEntries(Object.entries(parseJson(e.handover || '{}', {})).filter(([k]) => ['accounts', 'copies_given', 'client_owns_accounts', 'staff_access_removed'].includes(k))),
            asked_at: e.update_requested_at };
        }
      }
      const orders = await c.all("SELECT id,reference,total_minor,subtotal_minor,vat_minor,status,method,created_at,paid_at FROM orders WHERE client_id=? AND kind='purchase' ORDER BY id DESC", me.id);
      const focus = rec ? [] : await draftFocus(c, me.id);
      const pr = await pricing(c);
      const vatFlags = Object.fromEntries((await c.all('SELECT id,vat FROM packages')).map(r => [String(r.id), Boolean(r.vat)]));
      const agreements = await c.all(`SELECT reference,total_minor,subtotal_minor,vat_minor,status,terms_version,proposal_version,accepted_at,paid_at FROM orders
                                      WHERE client_id=? AND kind='purchase' AND accepted_at IS NOT NULL AND status IN ('paid','awaiting_confirmation','pending','refund_due','refunded')
                                      ORDER BY id DESC`, me.id);
      const subs = await c.all(`SELECT id,name,amount_minor,method,status,next_due,cancel_at FROM subscriptions
                                WHERE client_id=? AND status!='cancelled' ORDER BY id`, me.id);
      const invoices = await c.all(`SELECT o.id,o.reference,o.total_minor,o.subtotal_minor,o.vat_minor,o.status,o.method,s.name,s.next_due FROM orders o
                                    JOIN subscriptions s ON s.id=o.subscription_id
                                    WHERE o.client_id=? AND o.kind='renewal' AND o.status IN ('pending','awaiting_confirmation') ORDER BY o.id`, me.id);
      for (const o of orders) o.lines = (await c.all('SELECT rec_item_id FROM order_lines WHERE order_id=?', o.id)).map(x => x.rec_item_id);
      const ups = await c.all(`SELECT u.progress,u.blocker,u.next_action,u.created_at,e.name AS package
                               FROM updates u LEFT JOIN engagements e ON e.id=u.engagement_id
                               WHERE u.client_id=? ORDER BY u.id DESC LIMIT 10`, me.id);
      const contact = me.owner_user_id ? await c.get('SELECT display_name FROM users WHERE id=?', me.owner_user_id) : null;
      return { rec, items, engagements, orders, focus, pr, vatFlags, agreements, subs, invoices, ups, contact };
    });
    const { rec, items, engagements } = d;
    const needsOnb = engagements.some(e => e.status === 'awaiting_onboarding');
    const allDone = engagements.length > 0 && engagements.every(e => e.status === 'delivered') && items.every(i => i.owned);
    const intake = parseJson(me.intake, {});
    return {
      told: Object.fromEntries(['challenge', 'challenge_other', 'note', 'impact', 'importance', 'stage', 'tried', 'route'].map(k => [k, intake[k] ?? ''])),
      whatsapp: cfg.WHATSAPP_NUMBER,
      csrf: me.csrf, ref: me.ref, name: me.name, business: me.business, status: me.status,
      step: journeyStep(me.status, Boolean(rec), engagements.length > 0, needsOnb, allDone),
      review_hours: cfg.UPDATE_HOURS, contact: d.contact ? d.contact.display_name : 'the hamzury desk',
      contact_email: cfg.CONTACT_EMAIL, created_at: me.created_at,
      recommendation: rec ? { heard: rec.heard, advice: rec.advice, management: rec.management, published_at: rec.published_at, items } : null,
      levels: ALL_LEVELS, plan_eta: me.plan_eta, focus: d.focus, subscriptions: d.subs, invoices: d.invoices, pricing: d.pr, agreements: d.agreements,
      vat_flags: d.vatFlags,
      orders: d.orders, updates: d.ups,
      payment: { paystack: Boolean(cfg.PAYSTACK_SECRET), transfer: Boolean(cfg.BANK_DETAILS),
        bank_details: cfg.BANK_DETAILS || 'your hamzury contact will send the account details on whatsapp.' },
    };
  });

  // ---------------------------------------------------------------- payments
  // Create one engagement per bought package, start monthly services, or renew one.
  // Idempotent and safe if two callers race: only the caller that flips the order to paid does the work.
  // Money that arrives on a replaced order, or for a service that has ended, is recorded as refund_due for the desk.
  // Returns true when this call recorded the payment.
  async function markPaid(c, order, actor) {
    if (!order) return false;
    if (order.status === 'cancelled') {
      const cur = await c.run("UPDATE orders SET status='refund_due',paid_at=now_ts(),confirmed_by=? WHERE id=? AND status='cancelled'", actor, order.id);
      if (cur.rowCount) await log(c, actor, 'order.refund_due', 'orders', order.id, order.reference + ' paid after it was replaced');
      return false;
    }
    if (order.kind === 'renewal') {
      const s = await c.get('SELECT * FROM subscriptions WHERE id=?', order.subscription_id);
      const ended = !s || s.status === 'cancelled' || Boolean(s.cancel_at && s.cancel_at <= s.next_due) || Boolean(order.renewal_period && order.renewal_period !== s.next_due);
      const cur = await c.run("UPDATE orders SET status=?,paid_at=now_ts(),confirmed_by=? WHERE id=? AND status IN ('pending','awaiting_confirmation')",
        ended ? 'refund_due' : 'paid', actor, order.id);
      if (!cur.rowCount) return false;
      if (ended) {
        await log(c, actor, 'order.refund_due', 'orders', order.id, order.reference + ' paid for a service that is ending');
        return false;
      }
      let due = s.next_due;
      if (s.status === 'paused' && app.today() > due) due = app.today();  // a paused service restarts from the day it is paid
      await c.run("UPDATE subscriptions SET next_due=?,status='active',failures=0,last_paid_at=now_ts(),updated_at=now_ts() WHERE id=?", addMonth(due, s.bill_day), s.id);
      await log(c, actor, 'renewal.paid', 'orders', order.id, order.reference);
      return true;
    }
    const gone = await c.get('SELECT purged_at FROM clients WHERE id=?', order.client_id);
    if (gone && gone.purged_at) {  // the enquiry was removed under the keeping rules: never start work for it, refund instead
      const cur = await c.run("UPDATE orders SET status='refund_due',paid_at=now_ts(),confirmed_by=? WHERE id=? AND status IN ('pending','awaiting_confirmation')", actor, order.id);
      if (cur.rowCount) await log(c, actor, 'order.refund_due', 'orders', order.id, order.reference + ' paid for a removed enquiry');
      return false;
    }
    const cur = await c.run("UPDATE orders SET status='paid',paid_at=now_ts(),confirmed_by=? WHERE id=? AND status IN ('pending','awaiting_confirmation')", actor, order.id);
    if (!cur.rowCount) return false;
    for (const line of await c.all(`SELECT l.rec_item_id,l.price_minor,r.package_id,p.name,p.venture,p.onboarding FROM order_lines l
                                    JOIN rec_items r ON r.id=l.rec_item_id JOIN packages p ON p.id=r.package_id WHERE l.order_id=?`, order.id)) {
      const status = parseJson(line.onboarding, []).length ? 'awaiting_onboarding' : 'onboarding_received';
      await c.run(`INSERT INTO engagements(client_id,order_id,rec_item_id,package_id,name,venture,price_minor,status)
                   VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, order.client_id, order.id, line.rec_item_id, line.package_id, line.name, line.venture, line.price_minor, status);
    }
    // monthly services: the first month is paid now, the next falls due in a month at the agreed monthly fee
    const start = app.today();
    for (const line of await c.all(`SELECT l.rec_item_id,l.price_minor,r.renewal_minor,p.name FROM order_lines l JOIN rec_items r ON r.id=l.rec_item_id
                                    JOIN packages p ON p.id=r.package_id WHERE l.order_id=? AND p.basis='monthly'`, order.id)) {
      const eng = await c.get('SELECT id FROM engagements WHERE rec_item_id=?', line.rec_item_id);
      const fee = line.renewal_minor || line.price_minor;
      const old = await c.get('SELECT id,status FROM subscriptions WHERE rec_item_id=?', line.rec_item_id);
      if (old) {  // bought again after it ended: start it again
        await c.run(`UPDATE subscriptions SET status='active',cancel_at=NULL,failures=0,amount_minor=?,method=?,next_due=?,bill_day=?,
                     last_paid_at=now_ts(),updated_at=now_ts() WHERE id=?`, fee, order.method || 'transfer', addMonth(start), dayFrom(start).getUTCDate(), old.id);
        continue;
      }
      await c.run(`INSERT INTO subscriptions(client_id,engagement_id,rec_item_id,name,amount_minor,method,next_due,bill_day,last_paid_at)
                   VALUES(?,?,?,?,?,?,?,?,now_ts())`, order.client_id, eng ? eng.id : null, line.rec_item_id, line.name, fee, order.method || 'transfer', addMonth(start), dayFrom(start).getUTCDate());
    }
    await c.run("UPDATE clients SET status='active',updated_at=now_ts() WHERE id=? AND status IN ('new','reviewing','recommended')", order.client_id);
    await log(c, actor, 'order.paid', 'orders', order.id, order.reference);
    return true;
  }
  app.markPaid = markPaid;

  // the payment provider. tests replace app.paystack.
  app.paystack = async (method, apiPath, payload) => {
    try {
      const r = await fetch('https://api.paystack.co' + apiPath, { method, signal: AbortSignal.timeout(20000),
        headers: { authorization: 'Bearer ' + cfg.PAYSTACK_SECRET, 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload) });
      return JSON.parse(await r.text());
    } catch {
      fail(502, 'the payment service is not responding. please try again in a moment');
    }
  };
  const paidOk = (res, total) => { const d = res?.data || {}; return Boolean(res?.status) && d.status === 'success' && Number(d.amount ?? -1) === total && d.currency === 'NGN'; };
  app.paidOk = paidOk;

  R('POST', '/api/client/checkout', async ctx => {
    const me = await client(ctx);
    const b = body(ctx, { items: f.list(f.int(), { min: 1, max: 40 }), method: f.oneOf(['paystack', 'transfer']), email: f.str({ default: '', max: 160 }), accept_terms: f.bool({ default: false }) });
    return paymentOp(async () => {
      if (!b.accept_terms) fail(400, 'please read and accept the terms to continue');
      if (b.method === 'transfer' && !cfg.BANK_DETAILS.trim()) fail(400, 'bank transfer is not configured. please contact the desk');
      const o = await tx(async c => {
        const rec = await c.get("SELECT * FROM recommendations WHERE client_id=? AND status='published'", me.id);
        if (!rec) fail(409, 'your recommendation is not ready yet');
        const chosen = [...new Set(b.items)].sort((x, y) => x - y);
        const marks = chosen.map(() => '?').join(',');
        const rows = await c.all(`SELECT * FROM rec_items WHERE recommendation_id=? AND id IN (${marks})`, rec.id, ...chosen);
        if (rows.length !== chosen.length) fail(400, 'one of the packages is no longer available. please refresh');
        if (await c.get("SELECT 1 FROM orders WHERE client_id=? AND kind='purchase' AND status='awaiting_confirmation'", me.id)) {
          fail(409, 'we are still confirming your last payment. once it is confirmed, you can choose more');
        }
        const ended = new Set((await c.all("SELECT rec_item_id FROM subscriptions WHERE client_id=? AND status='cancelled'", me.id)).map(r => r.rec_item_id));
        const owned = new Set((await c.all('SELECT rec_item_id FROM engagements WHERE client_id=?', me.id)).map(r => r.rec_item_id).filter(x => !ended.has(x)));
        if (chosen.some(x => owned.has(x))) fail(409, 'you already have one of these packages');
        const allItems = await c.all(`SELECT ri.id,ri.client_has,p.code,p.grp,p.name,p.requires FROM rec_items ri JOIN packages p ON p.id=ri.package_id
                                      WHERE ri.recommendation_id=?`, rec.id);
        const byId = new Map(allItems.map(i => [i.id, i]));
        if (rows.some(r => r.quote === 'ask')) fail(400, 'we send you the route and the fee for this first. tap get my route');
        const unapproved = await c.get(`SELECT p.name FROM rec_items ri JOIN packages p ON p.id=ri.package_id WHERE ri.id IN (${marks})
                                        AND ri.quote='fixed' AND p.price_status!='approved'`, ...chosen);
        if (rows.some(r => r.assess === 'verify') || unapproved) fail(400, 'we are still checking one of these for you. we will confirm it before you can choose it');
        // choose one: a registration type or scuml category can only be chosen once
        const taken = new Map();
        for (const i of allItems) if (i.grp && (owned.has(i.id) || i.client_has)) taken.set(i.grp, i.name);
        for (const r of rows) {
          const g = byId.get(r.id).grp;
          if (!g) continue;
          if (taken.has(g)) fail(409, `you can choose one of these. you already chose ${taken.get(g)}`);
          taken.set(g, byId.get(r.id).name);
        }
        // needs first: an item that depends on another in your roadmap needs it chosen, bought or already in place
        const coveredIds = new Set([...owned, ...chosen, ...allItems.filter(i => i.client_has).map(i => i.id)]);
        const covered = new Set([...coveredIds].filter(i => byId.has(i)).map(i => byId.get(i).code));
        const present = new Set(allItems.map(i => i.code));
        for (const r of rows) {
          for (const req of parseJson(byId.get(r.id).requires || '[]', [])) {
            if (present.has(req) && !covered.has(req)) {
              const need = allItems.find(i => i.code === req).name;
              fail(400, `please add ${need} too. it is needed before ${byId.get(r.id).name}`);
            }
          }
        }
        // one open order at a time: replace an unpaid one (monthly invoices are separate and stay)
        await c.run("UPDATE orders SET status='cancelled' WHERE client_id=? AND kind='purchase' AND status='pending'", me.id);
        const pr = await pricing(c);
        const taxable = new Map((await c.all(`SELECT ri.id,p.vat FROM rec_items ri JOIN packages p ON p.id=ri.package_id WHERE ri.id IN (${marks})`, ...chosen)).map(r => [r.id, r.vat]));
        const subtotal = rows.reduce((s, r) => s + r.price_minor, 0);
        const vat = rows.reduce((s, r) => s + vatOf(r.price_minor, taxable.get(r.id), pr), 0);
        const total = subtotal + vat;
        const reference = await newRef(c, 'orders', 'reference', 'HZP-');
        const orderId = await c.val(`INSERT INTO orders(client_id,reference,total_minor,method,subtotal_minor,vat_minor,terms_version,proposal_version,accepted_at)
                                     VALUES(?,?,?,?,?,?,?,?,now_ts()) RETURNING id`, me.id, reference, total, b.method, subtotal, vat, TERMS_VERSION, await proposalVersion(c, rec));
        for (const r of rows) await c.run('INSERT INTO order_lines(order_id,rec_item_id,price_minor) VALUES(?,?,?)', orderId, r.id, r.price_minor);
        await log(c, 'client', 'order.created', 'orders', orderId, `${reference} ${total}`);
        const email = (b.email || me.email).trim().toLowerCase();
        if (b.method === 'paystack') {
          if (!cfg.PAYSTACK_SECRET) fail(400, 'card payment is not available yet. please choose bank transfer');
          if (!EMAIL.test(email)) fail(400, 'please enter your email for the payment receipt');
          if (email !== me.email) await c.run('UPDATE clients SET email=? WHERE id=?', email, me.id);
        }
        return { orderId, reference, total, subtotal, vat, email };
      });
      const out = { order_id: o.orderId, reference: o.reference, total_minor: o.total, subtotal_minor: o.subtotal, vat_minor: o.vat, redirect: null };
      if (b.method === 'paystack') {
        const res = await app.paystack('POST', '/transaction/initialize', { email: o.email, amount: o.total, reference: o.reference, currency: 'NGN',
          callback_url: (cfg.BASE_URL || '') + '/pay/callback', metadata: { hamzury_id: me.ref } });
        if (!res?.status) fail(502, 'we could not start the payment. please try again');
        out.redirect = res.data.authorization_url;
      }
      return out;
    });
  });

  // a published item of this client's plan, or 404
  const myItem = (c, itemId, cid, cols = 'r.*') => c.get(`SELECT ${cols} FROM rec_items r JOIN recommendations rc ON rc.id=r.recommendation_id
                                                         WHERE r.id=? AND rc.client_id=? AND rc.status='published'`, itemId, cid);

  // the client tells us they already have this, so it stops blocking the next level. the desk sees it.
  R('POST', '/api/client/items/{item_id}/have', async ctx => {
    const itemId = intParam(ctx.params.item_id, 'item_id');
    const me = await client(ctx);
    const b = body(ctx, { has: f.bool() });
    await tx(async c => {
      if (!(await myItem(c, itemId, me.id))) fail(404, 'record not found');
      if (await c.get('SELECT 1 FROM engagements WHERE rec_item_id=?', itemId)) fail(409, 'this is already in your plan');
      await c.run('UPDATE rec_items SET client_has=?,client_saved=0 WHERE id=?', b.has ? 1 : 0, itemId);
      await log(c, 'client', b.has ? 'item.has' : 'item.has_undone', 'clients', me.id, String(itemId));
    });
    return { ok: true };
  });

  // for items we do not quote up front (renewals, tax, changes): the client answers a few questions, the desk replies with the route and fee
  R('POST', '/api/client/items/{item_id}/request', async ctx => {
    const itemId = intParam(ctx.params.item_id, 'item_id');
    const me = await client(ctx);
    const b = body(ctx, { answers: f.dict(f.str(), { default: {}, max: 12 }) });
    const answers = Object.fromEntries(Object.entries(b.answers).filter(([, v]) => String(v).trim()).map(([k, v]) => [cut(k, 200), cut(String(v).trim(), 1500)]));
    if (!Object.keys(answers).length) fail(400, 'please answer at least one question');
    await tx(async c => {
      if (!(await myItem(c, itemId, me.id))) fail(404, 'record not found');
      await c.run('UPDATE rec_items SET request=?,requested_at=now_ts() WHERE id=?', JSON.stringify(answers), itemId);
      await log(c, 'client', 'route.requested', 'clients', me.id, String(itemId));
    });
    return { ok: true };
  });

  R('POST', '/api/client/items/{item_id}/save', async ctx => {
    const itemId = intParam(ctx.params.item_id, 'item_id');
    const me = await client(ctx);
    const b = body(ctx, { saved: f.bool() });
    await tx(async c => {
      if (!(await myItem(c, itemId, me.id, 'r.id'))) fail(404, 'record not found');
      await c.run('UPDATE rec_items SET client_saved=? WHERE id=?', b.saved ? 1 : 0, itemId);
    });
    return { ok: true };
  });

  R('POST', '/api/client/orders/{order_id}/transfer', async ctx => {
    const orderId = intParam(ctx.params.order_id, 'order_id');
    const me = await client(ctx);
    const b = body(ctx, { note: f.str({ default: '', max: 300 }) });
    return paymentOp(() => tx(async c => {
      const o = await one(c, 'orders', orderId);
      if (o.client_id !== me.id) fail(404, 'record not found');
      if (!['pending', 'awaiting_confirmation'].includes(o.status)) fail(409, 'this payment is already closed');
      if (o.method === 'paystack') fail(409, 'check the card payment first. do not send another payment against this reference');
      await c.run("UPDATE orders SET status='awaiting_confirmation',method='transfer',transfer_note=? WHERE id=?", b.note.trim(), orderId);
      await log(c, 'client', 'order.transfer_reported', 'orders', orderId, b.note);
      return { ok: true };
    }));
  });

  R('POST', '/api/client/orders/{order_id}/check', async ctx => {
    const orderId = intParam(ctx.params.order_id, 'order_id');
    const me = await client(ctx);
    await throttle('payment_check', ctx, 30, 300);
    const o = await tx(c => one(c, 'orders', orderId));
    if (o.client_id !== me.id) fail(404, 'record not found');
    if (o.method !== 'paystack' || !cfg.PAYSTACK_SECRET) fail(400, 'this payment does not use card verification');
    await verifyPaystack(o.reference);
    return { status: (await tx(c => one(c, 'orders', orderId))).status };
  });

  function verifyPaystack(reference) {
    return paymentOp(async () => {
      const first = await tx(c => c.get('SELECT * FROM orders WHERE reference=?', reference));
      if (!first) return null;
      if (first.status === 'paid') return first;
      const res = await app.paystack('GET', '/transaction/verify/' + encodeURIComponent(reference));
      const d = res?.data || {};
      return tx(async c => {
        const o = await c.get('SELECT * FROM orders WHERE reference=?', reference);
        if (paidOk(res, o.total_minor)) {
          const recorded = await markPaid(c, o, 'paystack');
          const authz = d.authorization || {};
          if (recorded && authz.reusable && authz.authorization_code) {
            // the card is kept for the monthly services paid in this payment only, which the client chose to pay by card
            await c.run('UPDATE clients SET pay_auth=? WHERE id=?', authz.authorization_code, o.client_id);
            await c.run(`UPDATE subscriptions SET method='paystack' WHERE status!='cancelled' AND (id=? OR rec_item_id IN (SELECT rec_item_id FROM order_lines WHERE order_id=?))`,
              o.subscription_id, o.id);
          }
        }
        return o;
      });
    });
  }
  app.verifyPaystack = verifyPaystack;

  R('GET', '/pay/callback', async ctx => {
    const reference = ctx.query.get('reference') || '';
    let o = null;
    if (cfg.PAYSTACK_SECRET && ORDER_REF.test(reference)) o = await verifyPaystack(reference);
    return Reply.redirect(o && o.kind === 'renewal' ? '/track' : '/track#progress', 303);
  });

  R('POST', '/api/paystack/webhook', async ctx => {
    const raw = ctx.rawBody;
    const sig = ctx.headers['x-paystack-signature'] || '';
    if (!cfg.PAYSTACK_SECRET || !safeEqual(hmacHex(cfg.PAYSTACK_SECRET, raw, 'sha512'), sig)) fail(401, 'invalid signature');
    const event = parseJson(raw.toString('utf8') || '{}', {});
    if (event.event === 'charge.success') {
      const ref = (event.data || {}).reference || '';
      if (ORDER_REF.test(ref)) await verifyPaystack(ref);
    }
    return { ok: true };
  });

  // ---------------------------------------------------------------- monthly services
  async function renewalOrder(c, s, method) {
    const ref = await newRef(c, 'orders', 'reference', 'HZP-');
    const taxable = await c.get('SELECT p.vat FROM rec_items r JOIN packages p ON p.id=r.package_id WHERE r.id=?', s.rec_item_id);
    const vat = vatOf(s.amount_minor, taxable ? taxable.vat : 1, await pricing(c));
    const id = await c.val("INSERT INTO orders(client_id,reference,total_minor,method,kind,subscription_id,subtotal_minor,vat_minor,renewal_period) VALUES(?,?,?,?,'renewal',?,?,?,?) RETURNING id",
      s.client_id, ref, s.amount_minor + vat, method, s.id, s.amount_minor, vat, s.next_due);
    await c.run('INSERT INTO order_lines(order_id,rec_item_id,price_minor) VALUES(?,?,?)', id, s.rec_item_id, s.amount_minor);
    return c.get('SELECT * FROM orders WHERE id=?', id);
  }
  app.renewalOrder = renewalOrder;

  // the daily monthly-services run. safe to run more than once a day.
  // card on file: charged on the due date, retried every 2 days, paused after 7 days unpaid (only after at least one try).
  // transfer: an invoice 3 days before the due date, reminders through the desk, paused after 7 days unpaid.
  // cancelled: the service ends on its next due date, with no new charge.
  // each subscription is its own short transaction, and calls to paystack happen outside any transaction.
  app.billingRun = (day, actor = 'billing') => paymentOp(async () => {
    const out = { charged: 0, invoiced: 0, declined: 0, paused: 0, ended: 0 };
    const ids = (await tx(c => c.all("SELECT id FROM subscriptions WHERE status IN ('active','grace') ORDER BY id"))).map(r => r.id);
    for (const sid of ids) {
      const step = await tx(async c => {
        const s = await c.get("SELECT s.*,cl.email,cl.pay_auth FROM subscriptions s JOIN clients cl ON cl.id=s.client_id WHERE s.id=? AND s.status IN ('active','grace')", sid);
        if (!s) return null;
        const due = s.next_due;
        if (s.cancel_at && s.cancel_at.slice(0, 10) <= day) {
          await c.run("UPDATE subscriptions SET status='cancelled',updated_at=now_ts() WHERE id=?", sid);
          await c.run("UPDATE orders SET status='cancelled' WHERE subscription_id=? AND status='pending'", sid);
          await log(c, actor, 'subscription.ended', 'subscriptions', sid);
          out.ended += 1;
          return null;
        }
        if (s.cancel_at) return null;  // ending soon: no new invoice
        const openO = await c.get("SELECT * FROM orders WHERE subscription_id=? AND status IN ('pending','awaiting_confirmation') ORDER BY id DESC", sid);
        if (openO && openO.status === 'awaiting_confirmation') return null;  // a transfer waiting for our check is not their fault: no charge, no pause
        const card = Boolean(s.method === 'paystack' && s.pay_auth && cfg.PAYSTACK_SECRET) && !(openO && openO.method === 'transfer');
        if (day > addDays(due, GRACE_DAYS) && (!card || s.failures > 0)) {
          await c.run("UPDATE subscriptions SET status='paused',updated_at=now_ts() WHERE id=?", sid);
          await log(c, actor, 'subscription.paused', 'subscriptions', sid, `unpaid since ${due}`);
          out.paused += 1;
          return null;
        }
        if (!card) {
          if (day >= addDays(due, -INVOICE_AHEAD_DAYS)) {
            if (!openO) {
              await renewalOrder(c, s, 'transfer');
              await log(c, actor, 'renewal.invoiced', 'subscriptions', sid, due);
              out.invoiced += 1;
            }
            if (day > due && s.status !== 'grace') await c.run("UPDATE subscriptions SET status='grace',updated_at=now_ts() WHERE id=?", sid);
          }
          return null;
        }
        if (day < due) return null;
        if (openO && app.time() - parseTs(openO.created_at) < RETRY_EVERY_DAYS * 86400 - 3600) return null;
        return { s, prev: openO || null };
      });
      if (!step) continue;
      const { s, prev } = step;
      // before trying again, ask paystack what happened to the last attempt: never charge twice for one month
      if (prev) {
        let v;
        try { v = await app.paystack('GET', '/transaction/verify/' + encodeURIComponent(prev.reference)); } catch (e) { if (e instanceof HttpError) continue; throw e; }
        const vd = v?.data || {};
        if (paidOk(v, prev.total_minor)) {
          if (await tx(async c => markPaid(c, await c.get('SELECT * FROM orders WHERE id=?', prev.id), 'paystack'))) out.charged += 1;
          continue;
        }
        if (!v?.status || !['failed', 'abandoned', 'reversed'].includes(vd.status)) continue;  // still with the bank: wait for its answer
      }
      const o = await tx(async c => {
        if (prev) await c.run("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'", prev.id);
        return renewalOrder(c, s, 'paystack');
      });
      let res;
      try {
        res = await app.paystack('POST', '/transaction/charge_authorization', { email: s.email, amount: o.total_minor, currency: 'NGN', authorization_code: s.pay_auth, reference: o.reference });
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        res = {};
      }
      const d = res?.data || {};
      await tx(async c => {
        if (paidOk(res, o.total_minor)) {
          if (await markPaid(c, await c.get('SELECT * FROM orders WHERE id=?', o.id), 'paystack')) out.charged += 1;
        } else {  // declined, or waiting on the bank: the invoice stays open and the client can pay it themselves
          await c.run("UPDATE subscriptions SET status='grace',failures=failures+1,updated_at=now_ts() WHERE id=?", sid);
          await log(c, actor, 'renewal.declined', 'orders', o.id, String(d.gateway_response || d.status || 'no response'));
          out.declined += 1;
        }
      });
    }
    return out;
  });

  const cronKeyOk = key => Boolean(cfg.BILLING_KEY) && Boolean(key) && safeEqual(key, cfg.BILLING_KEY);
  app.billingRunCron = key => { if (!cronKeyOk(key)) fail(401, 'invalid key'); return app.billingRun(app.today()); };

  R('POST', '/api/admin/billing/run', async ctx => { const user = await auth.money(ctx); return app.billingRun(app.today(), user.username); });
  // for a daily scheduler: curl -X POST -H "X-Billing-Key: $HAMZURY_BILLING_KEY" https://hamzury.com/api/billing/run
  R('POST', '/api/billing/run', async ctx => app.billingRunCron(ctx.headers['x-billing-key']));

  const subView = s => Object.fromEntries(['id', 'name', 'amount_minor', 'method', 'status', 'next_due', 'cancel_at', 'failures', 'last_paid_at'].map(k => [k, s[k]]));
  app.helpers.subView = subView;

  // stops the next charge. the service runs to the end of the month already paid for.
  R('POST', '/api/client/subscriptions/{sid}/cancel', async ctx => {
    const sid = intParam(ctx.params.sid, 'sid');
    const me = await client(ctx);
    return paymentOp(() => tx(async c => {
      const s = await c.get("SELECT * FROM subscriptions WHERE id=? AND client_id=? AND status!='cancelled'", sid, me.id);
      if (!s) fail(404, 'record not found');
      if (s.status === 'paused') await c.run("UPDATE subscriptions SET status='cancelled',cancel_at=?,updated_at=now_ts() WHERE id=?", app.today(), sid);
      else await c.run('UPDATE subscriptions SET cancel_at=?,updated_at=now_ts() WHERE id=?', s.next_due, sid);
      await c.run("UPDATE orders SET status='cancelled' WHERE subscription_id=? AND status='pending'", sid);
      await log(c, 'client', 'subscription.cancel', 'subscriptions', sid);
      return subView(await c.get('SELECT * FROM subscriptions WHERE id=?', sid));
    }));
  });

  // undo a cancel before it takes effect
  R('POST', '/api/client/subscriptions/{sid}/keep', async ctx => {
    const sid = intParam(ctx.params.sid, 'sid');
    const me = await client(ctx);
    return paymentOp(() => tx(async c => {
      const s = await c.get("SELECT * FROM subscriptions WHERE id=? AND client_id=? AND status IN ('active','grace') AND cancel_at IS NOT NULL", sid, me.id);
      if (!s) fail(404, 'record not found');
      await c.run('UPDATE subscriptions SET cancel_at=NULL,updated_at=now_ts() WHERE id=?', sid);
      await log(c, 'client', 'subscription.keep', 'subscriptions', sid);
      return subView(await c.get('SELECT * FROM subscriptions WHERE id=?', sid));
    }));
  });

  // pay an open monthly invoice by card. never renames a reference a bank may still be processing:
  // if an earlier card attempt exists, ask paystack about it first, then open a fresh invoice for the new attempt.
  R('POST', '/api/client/orders/{order_id}/pay', async ctx => {
    const orderId = intParam(ctx.params.order_id, 'order_id');
    const me = await client(ctx);
    const b = ctx.rawBody.length ? body(ctx, { email: f.str({ default: '', max: 160 }) }) : null;
    return paymentOp(async () => {
      if (!cfg.PAYSTACK_SECRET) fail(400, 'card payment is not available yet. please pay by bank transfer');
      const email = ((b ? b.email : '') || me.email || '').trim().toLowerCase();
      if (!EMAIL.test(email)) fail(400, 'please enter your email for the payment receipt');
      let o = await tx(async c => {
        const row = await c.get("SELECT * FROM orders WHERE id=? AND client_id=? AND kind='renewal' AND status='pending'", orderId, me.id);
        if (!row) fail(404, 'record not found');
        if (email !== (me.email || '')) await c.run('UPDATE clients SET email=? WHERE id=?', email, me.id);
        return row;
      });
      if (o.method === 'paystack') {
        const v = await app.paystack('GET', '/transaction/verify/' + encodeURIComponent(o.reference));
        const vd = v?.data || {};
        if (paidOk(v, o.total_minor)) {
          await tx(async c => markPaid(c, await c.get('SELECT * FROM orders WHERE id=?', o.id), 'paystack'));
          fail(409, 'this invoice is already paid. thank you');
        }
        if (!v?.status || !['failed', 'abandoned', 'reversed'].includes(vd.status)) fail(409, 'your bank is still processing the last attempt. please check again in a few minutes');
        o = await tx(async c => {
          const s = await c.get('SELECT * FROM subscriptions WHERE id=?', o.subscription_id);
          await c.run("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'", o.id);
          return renewalOrder(c, s, 'paystack');
        });
      } else {
        await tx(c => c.run("UPDATE orders SET method='paystack' WHERE id=?", o.id));
      }
      const res = await app.paystack('POST', '/transaction/initialize', { email, amount: o.total_minor, reference: o.reference, currency: 'NGN',
        callback_url: (cfg.BASE_URL || '') + '/pay/callback', metadata: { hamzury_id: me.ref } });
      if (!res?.status) fail(502, 'we could not start the payment. please try again');
      return { redirect: res.data.authorization_url };
    });
  });

  // ---------------------------------------------------------------- engagements: the client side
  // the client asks for an update. the holding and the venture both see it at once.
  R('POST', '/api/client/engagements/{eid}/ask', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const me = await client(ctx);
    await tx(async c => {
      const e = await c.get('SELECT * FROM engagements WHERE id=? AND client_id=?', eid, me.id);
      if (!e || e.status === 'delivered') fail(404, 'record not found');
      if (e.update_requested_at && hoursSince(e.update_requested_at) < 24) fail(429, 'you asked today. we will reply soon');
      await c.run('UPDATE engagements SET update_requested_at=now_ts() WHERE id=?', eid);
      await log(c, 'client', 'update.requested', 'engagements', eid);
    });
    return { ok: true };
  });

  R('POST', '/api/client/engagements/{eid}/onboarding', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const me = await client(ctx);
    const b = body(ctx, { answers: f.dict(f.str(), { max: 40 }) });
    await tx(async c => {
      const e = await one(c, 'engagements', eid);
      if (e.client_id !== me.id) fail(404, 'record not found');
      const questions = parseJson((await one(c, 'packages', e.package_id)).onboarding, []);
      const answers = {};
      const files = parseJson(e.attachments || '{}', {});
      for (const [k, q] of questions.entries()) {
        const required = q.required ?? true;
        if (q.kind === 'file') {
          const file = files[String(k)];
          if (required && !file) fail(400, 'please attach: ' + q.label);
          answers[q.label] = file ? 'file: ' + file.name : '';
          continue;
        }
        const v = cut(String(b.answers[q.label] ?? '').trim(), 3000);
        if (required && !v) fail(400, 'please answer: ' + q.label);
        answers[q.label] = v;
      }
      const status = e.status === 'awaiting_onboarding' ? 'onboarding_received' : e.status;
      await c.run('UPDATE engagements SET onboarding=?,onboarding_at=now_ts(),status=?,updated_at=now_ts() WHERE id=?', JSON.stringify(answers), status, eid);
      await log(c, 'client', 'onboarding.received', 'engagements', eid);
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- uploads
  // a file arrives one of two ways:
  //   multipart: the file is posted to the server (local storage, and small files).
  //   {upload:'sign'} then {upload:'done'}: the browser sends the file straight to cloudinary with a one-time signature, then
  //   the server fetches it back, checks it, and keeps it only if it passes. large files never pass through the function.
  const UPLOAD_TTL = 900;
  const uploadTicket = (key, scope) => {
    const exp = Math.floor(app.time()) + UPLOAD_TTL;
    return `${key}.${exp}.${hmacHex(cfg.SECRET, `upload:${scope}:${key}:${exp}`)}`;
  };
  function readTicket(ticket, scope) {
    const m = /^([a-z0-9-]+\.[a-z0-9]+)\.(\d+)\.([0-9a-f]{64})$/.exec(String(ticket || ''));
    if (!m || Number(m[2]) < app.time() || !safeEqual(m[3], hmacHex(cfg.SECRET, `upload:${scope}:${m[1]}:${m[2]}`))) fail(400, 'the upload expired. please choose the file again');
    return m[1];
  }
  // returns {name, data, key?}: key is set when the file already sits in storage (direct upload)
  async function receiveFile(ctx, { scope, fallbackName, keyPrefix, extError }) {
    const ctype = ctx.headers['content-type'] || '';
    if (ctype.startsWith('multipart/form-data')) {
      let form;
      try { form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': ctype }, body: ctx.rawBody }).formData(); } catch { form = null; }
      const file = form && form.get('file');
      if (!file || typeof file === 'string') fail(422, [{ type: 'missing', loc: ['body', 'file'], msg: 'Field required', input: null }]);
      const name = baseName(file.name, fallbackName);
      if (!ALLOWED_UPLOADS.includes(extOf(name))) fail(400, extError);
      const data = Buffer.from(await file.arrayBuffer());
      if (data.length > MAX_UPLOAD) fail(400, 'the file is larger than 25 mb');
      return { mode: 'file', name, data };
    }
    const b = body(ctx, { upload: f.oneOf(['sign', 'done']), name: f.str({ max: 400 }), size: f.int({ default: 0, ge: 0 }), ticket: f.str({ default: '', max: 300 }) });
    const name = baseName(b.name, fallbackName);
    if (!ALLOWED_UPLOADS.includes(extOf(name))) fail(400, extError);
    if (b.upload === 'sign') {
      if (b.size > MAX_UPLOAD) fail(400, 'the file is larger than 25 mb');
      const key = keyPrefix + tokenHex(16) + extOf(name);
      const signed = storage.signUpload(key);
      return { mode: 'sign', reply: signed ? { direct: false, ticket: uploadTicket(key, scope), ...signed } : { direct: true } };
    }
    const key = readTicket(b.ticket, scope);
    if (extOf(key) !== extOf(name)) fail(400, extError);
    const data = await storage.get(key);
    if (!data) fail(400, 'the upload did not arrive. please try again');
    if (data.length > MAX_UPLOAD) { await storage.remove(key); fail(400, 'the file is larger than 25 mb'); }
    return { mode: 'file', name, data, key };
  }
  async function checkedUpload(name, data, key) {
    try { await validateUpload({ requireScan: cfg.REQUIRE_SCAN, scanUrl: cfg.SCAN_URL, scanToken: cfg.SCAN_TOKEN }, name, data); }
    catch (e) { if (key) await storage.remove(key); throw e; }
  }
  app.validateUpload = (name, data) => validateUpload({ requireScan: cfg.REQUIRE_SCAN, scanUrl: cfg.SCAN_URL, scanToken: cfg.SCAN_TOKEN }, name, data);

  async function onboardingFileQuestion(c, eid, q, me, recheck) {
    const e = await one(c, 'engagements', eid);
    if (recheck) { if (e.client_id !== me.id || e.status === 'delivered') fail(409, 'this work no longer accepts attachments'); }
    else {
      if (e.client_id !== me.id) fail(404, 'record not found');
      if (e.status === 'delivered') fail(409, 'this part is already delivered');
    }
    const questions = parseJson((await one(c, 'packages', e.package_id)).onboarding, []);
    if (!(q >= 0 && q < questions.length) || questions[q].kind !== 'file') fail(400, 'this requirement does not take a file');
    return { e, questions };
  }

  // the client attaches a document an onboarding requirement asks for. stored privately; only staff can open it.
  R('POST', '/api/client/engagements/{eid}/attachment', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const q = ctx.query.has('q') ? intParam(ctx.query.get('q'), 'q') : 0;
    const me = await client(ctx);
    const got = await receiveFile(ctx, { scope: `att:${eid}:${q}:${me.id}`, fallbackName: 'document', keyPrefix: 'in-',
      extError: 'please upload one of: ' + [...ALLOWED_UPLOADS].sort().join(', ') });
    await tx(c => onboardingFileQuestion(c, eid, q, me, false));
    if (got.mode === 'sign') return got.reply;
    if (!got.data.length) { if (got.key) await storage.remove(got.key); fail(400, 'the file is empty'); }
    await checkedUpload(got.name, got.data, got.key);
    return storageOp(async () => {
      const stored = got.key || 'in-' + tokenHex(16) + extOf(got.name);
      try {
        await tx(async c => {
          // recheck after scanning: delivery may have completed during the scan
          const { e, questions } = await onboardingFileQuestion(c, eid, q, me, true);
          const files = parseJson(e.attachments || '{}', {});
          if (!got.key) await storage.put(stored, got.data, got.name);
          const old = files[String(q)];
          files[String(q)] = { stored, name: got.name, size: got.data.length };
          await c.run('UPDATE engagements SET attachments=?,updated_at=now_ts() WHERE id=?', JSON.stringify(files), eid);
          await log(c, 'client', 'onboarding.file', 'engagements', eid, questions[q].label);
          if (old && old.stored && old.stored !== stored) await storage.remove(old.stored);
        });
      } catch (e) { await storage.remove(stored); throw e; }
      return { ok: true, name: got.name };
    });
  });

  async function sendFile(key, name) {
    const url = await storage.downloadUrl(key, name);
    if (url) return Reply.redirect(url, 302);
    const data = await storage.get(key);
    if (!data) return null;
    return new Reply(200, { 'content-type': mimeOf(name), 'content-disposition': disposition(name) }, data);
  }

  async function accessEngagement(c, user, eid) {
    const e = await one(c, 'engagements', eid);
    if (!ROLE_HOLDING.includes(user.role) && user.venture !== e.venture) fail(403, 'this work belongs to another venture');
    return e;
  }
  app.helpers.accessEngagement = accessEngagement;

  R('GET', '/api/admin/engagements/{eid}/attachment/{q}', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const user = await staff(ctx);
    const e = await tx(c => accessEngagement(c, user, eid));
    const file = parseJson(e.attachments || '{}', {})[ctx.params.q];
    if (!file) fail(404, 'no file');
    return (await sendFile(file.stored, file.name)) || fail(404, 'no file');
  });

  R('GET', '/api/client/engagements/{eid}/download', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const me = await client(ctx);
    const e = await tx(c => one(c, 'engagements', eid));
    if (e.client_id !== me.id || e.status !== 'delivered' || !e.file_path) fail(404, 'this file is not available yet');
    return (await sendFile(e.file_path, e.file_name)) || fail(404, 'this file is not available yet');
  });

  R('POST', '/api/admin/engagements/{eid}/file', async ctx => {
    const eid = intParam(ctx.params.eid, 'eid');
    const user = await staff(ctx);
    const got = await receiveFile(ctx, { scope: `del:${eid}:${user.id}`, fallbackName: 'deliverable', keyPrefix: '',
      extError: 'allowed files: ' + [...ALLOWED_UPLOADS].sort().join(', ') });
    await tx(c => accessEngagement(c, user, eid));
    if (got.mode === 'sign') return got.reply;
    await checkedUpload(got.name, got.data, got.key);
    return storageOp(async () => {
      const stored = got.key || tokenHex(16) + extOf(got.name);
      try {
        await tx(async c => {
          const e = await accessEngagement(c, user, eid);
          if (!got.key) await storage.put(stored, got.data, got.name);
          await c.run('UPDATE engagements SET file_path=?,file_name=?,updated_at=now_ts() WHERE id=?', stored, got.name, eid);
          await log(c, user.username, 'work.file_uploaded', 'engagements', eid, got.name);
          if (e.file_path && e.file_path !== stored) await storage.remove(e.file_path);
        });
      } catch (e) { await storage.remove(stored); throw e; }
      return { ok: true, file_name: got.name };
    });
  });

  // ---------------------------------------------------------------- the desk (staff pages)
  registerDesk(app, { R, auth, body, f, cronKeyOk, pricing, setting, markPaid, accessEngagement, loadCatalogue });

  // ---------------------------------------------------------------- health and public pages
  R('GET', '/api/health', async () => {
    try {
      await tx(c => c.get('SELECT 1 FROM users LIMIT 1'));
      await storage.probe();
      return { ok: true, configured: cfg.READY, paystack: Boolean(cfg.PAYSTACK_SECRET) };
    } catch {
      return new Reply(503, { 'content-type': 'application/json' }, JSON.stringify({ ok: false, configured: cfg.READY }));
    }
  });

  R('GET', '/api/public/ventures/{v}', async ctx => {
    const v = ctx.params.v;
    if (!(v in cfg.VENTURE_INFO)) fail(404, 'not found');
    const services = (await tx(c => c.all(`SELECT * FROM packages WHERE venture=? AND active=1 ORDER BY code='',code COLLATE "C",name COLLATE "C"`, v)))
      .map(p => ({ name: p.name, summary: p.summary, inclusions: parseJson(p.inclusions, []), duration: p.duration, value: p.value }));
    return { key: v, ...cfg.VENTURE_INFO[v], services };
  });

  // pages. on vercel these are served from the cdn (see vercel.json); here for local runs and tests.
  const page = name => async () => new Reply(200, { 'content-type': 'text/html; charset=utf-8' }, await readFile(path.join(ROOT, 'static', name)));
  const PAGES = { '/': 'index.html', '/start': 'start.html', '/track': 'track.html', '/admin': 'admin.html', '/privacy': 'privacy.html', '/terms': 'terms.html',
    '/visit': 'visit.html', '/library': 'library.html', '/library/profile': 'profile.html', '/gallery': 'gallery.html' };
  for (const [p, file] of Object.entries(PAGES)) R('GET', p, page(file));
  R('GET', '/v/{v}', async ctx => { if (!(ctx.params.v in cfg.VENTURE_INFO)) fail(404, 'not found'); return page('venture.html')(); });
  // our offices. the short links are made for sharing on whatsapp: they open the office straight in google maps.
  const OFFICE_MAPS = {
    abuja: 'https://www.google.com/maps/search/?api=1&query=9.028329%2C7.478382',
    jos: 'https://www.google.com/maps/place/hamzury+innovation+hub/@9.9303296,8.8896841,17z/data=!3m1!4b1!4m6!3m5!1s0x1053738fbdc0e88f:0x1d70274660173290!8m2!3d9.9303296!4d8.892259',
  };
  R('GET', '/visit/{office}', async ctx => Reply.redirect(OFFICE_MAPS[ctx.params.office.toLowerCase()] || '/visit', 302));
  R('GET', '/robots.txt', async () => new Reply(200, { 'content-type': 'text/plain; charset=utf-8' }, 'User-agent: *\nDisallow: /admin\nDisallow: /track\nDisallow: /api/\n'));
  R('GET', '/favicon.ico', async () => new Reply(200, { 'content-type': 'image/png' }, await readFile(path.join(ROOT, 'static', 'img', 'hamzury-mark.png'))));

  // ---------------------------------------------------------------- request handling
  app.handle = async req => {
    const headers = securityHeaders(req.path, cfg.SECURE_COOKIES);
    const setCookies = [];
    const respond = (status, payload, extra = {}) => ({ status, headers: { ...headers, ...extra, ...(setCookies.length ? { 'set-cookie': setCookies } : {}) }, body: payload });
    const json = (status, value) => respond(status, JSON.stringify(value), { 'content-type': 'application/json' });
    try {
      const isFile = /\/(attachment|file)$/.test(req.path);
      const limit = isFile ? MAX_UPLOAD + 1024 * 1024 : 256 * 1024;
      const len = req.headers['content-length'];
      if ((len !== undefined && (!/^\d+$/.test(len) || Number(len) > limit)) || req.body.length > limit) return json(413, { detail: 'request is too large' });
      if (req.path.startsWith('/static/') && ['GET', 'HEAD'].includes(req.method)) {
        const rel = path.normalize(decodeURIComponent(req.path.slice(8)));
        const full = path.join(ROOT, 'static', rel);
        if (!rel.startsWith('..') && full.startsWith(path.join(ROOT, 'static'))) {
          try { return respond(200, await readFile(full), { 'content-type': mimeOf(full) }); } catch { /* not found below */ }
        }
        return json(404, { detail: 'Not Found' });
      }
      const m = router.match(req.method, req.path);
      if (m === null) return json(404, { detail: 'Not Found' });
      if (m === 'method') return json(405, { detail: 'Method Not Allowed' });
      await app.init();
      let parsed;
      const ctx = {
        method: req.method, path: req.path, query: req.query, headers: req.headers, params: m.params, ip: req.ip || 'unknown',
        cookies: parseCookies(req.headers.cookie), rawBody: req.body, setCookie: v => setCookies.push(v),
        json() {
          if (parsed === undefined) {
            try { parsed = JSON.parse(req.body.toString('utf8')); } catch {
              throw new HttpError(422, [{ type: 'json_invalid', loc: ['body', 0], msg: 'JSON decode error', input: {} }]);
            }
          }
          return parsed;
        },
      };
      const out = await m.handler(ctx);
      if (out instanceof Reply) return respond(out.status, out.body, out.headers);
      return json(200, out);
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { detail: e.detail });
      console.error(e);
      return json(500, { detail: 'internal server error' });
    }
  };
  return app;
}
