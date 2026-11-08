"""hamzury holding | guided client platform (v6).

the journey: start here (one question per screen) -> hamzury id -> holding prepares a
recommendation from the package catalogue -> client chooses packages and pays -> onboarding
for what they bought -> progress per package -> download when delivered.

SQLite-backed. Requires security and legal review and HTTPS before handling real client data.
Prices only come from the catalogue the holding team enters. Nothing is invented.
"""
from __future__ import annotations

import calendar
import base64
import datetime
import functools
import hashlib
import hmac
import io
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import subprocess
import tempfile
import time
import zipfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Literal

import pyotp
from cryptography.fernet import Fernet, InvalidToken
from dotenv import load_dotenv
from filelock import FileLock, Timeout as LockTimeout
from PIL import Image, UnidentifiedImageError
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env', override=False)
DB = Path(os.getenv('HAMZURY_DB', str(ROOT / 'data' / 'hamzury-v4.sqlite3'))).resolve()
DB.parent.mkdir(parents=True, exist_ok=True)
FILES = Path(os.getenv('HAMZURY_FILES', str(DB.parent / 'files'))).resolve()
FILES.mkdir(parents=True, exist_ok=True)
ADMIN_USERNAME = os.getenv('HAMZURY_ADMIN_USERNAME', 'owner')
ADMIN_PASSWORD = os.getenv('HAMZURY_ADMIN_PASSWORD', '')
SECRET = os.getenv('HAMZURY_SECRET', '')
BASE_URL = os.getenv('HAMZURY_PUBLIC_BASE_URL', '').rstrip('/')
SECURE_COOKIES = os.getenv('HAMZURY_SECURE_COOKIES', '0') == '1'
UPDATE_HOURS = max(1, int(os.getenv('HAMZURY_UPDATE_HOURS', '48') or 48))
CONTACT_EMAIL = os.getenv('HAMZURY_CONTACT_EMAIL', 'desk@hamzury.com')
PAYSTACK_SECRET = os.getenv('HAMZURY_PAYSTACK_SECRET_KEY', '')
BANK_DETAILS = os.getenv('HAMZURY_BANK_DETAILS', '')  # e.g. "bank: ..., account name: ..., account number: ..."
MAX_UPLOAD = 25 * 1024 * 1024
READY = len(ADMIN_PASSWORD) >= 12 and len(SECRET) >= 32
PRODUCTION = os.getenv('HAMZURY_ENV', 'development') == 'production'
REQUIRE_MFA = os.getenv('HAMZURY_REQUIRE_STAFF_MFA', '1' if PRODUCTION else '0') == '1'
REQUIRE_SCAN = os.getenv('HAMZURY_REQUIRE_UPLOAD_SCAN', '1' if PRODUCTION else '0') == '1'
UPLOAD_SCANNER = os.getenv('HAMZURY_UPLOAD_SCANNER', 'clamscan')
PAYMENT_LOCK = FileLock(str(DB.parent / '.payments.lock'), timeout=0)
STORAGE_LOCK = FileLock(str(DB.parent / '.storage.lock'), timeout=0)

if PRODUCTION and (not READY or not SECURE_COOKIES or not BASE_URL.startswith('https://')
                   or len(os.getenv('HAMZURY_BILLING_KEY', '')) < 32 or not REQUIRE_MFA or not REQUIRE_SCAN):
    raise RuntimeError('production requires strong secrets, HTTPS URL, secure cookies, billing key (32+), staff MFA and upload scanning')

VENTURES = ('bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin')
OWNERS = VENTURES + ('holding', 'finance')  # who is accountable for a catalogue item
import catalogue as CAT  # noqa: E402  the master service catalogue
STAGES = ('awareness', 'strategy', 'structure', 'systems', 'success')
ROLE_HOLDING = ('holding_owner', 'holding_admin')
CLIENT_STATES = ('new', 'reviewing', 'recommended', 'active', 'completed', 'closed')
WORK_STATES = ('awaiting_onboarding', 'onboarding_received', 'in_progress', 'review', 'delivered')
WORK_LABEL = {
    'awaiting_onboarding': 'waiting for your details', 'onboarding_received': 'details received, starting soon',
    'in_progress': 'in progress', 'review': 'final quality check', 'delivered': 'delivered',
}
# the questions asked on "start here". keys are fixed so the desk can read them reliably.
INTAKE_KEYS = {
    'path': 40, 'business': 150, 'industry': 600, 'stage': 60, 'registered': 30, 'needs': 900,
    'challenge': 1500, 'tried': 300, 'impact': 300, 'importance': 4, 'goal': 80, 'timing': 60, 'team': 30,
    'location': 120, 'venture': 20, 'route': 10, 'urgency': 40, 'src': 20, 'note': 800,
    'industry_other': 120, 'challenge_other': 300, 'needs_other': 300,
    'situation': 80, 'situation_q': 120, 'details': 900, 'details_other': 300, 'details_q': 120, 'format': 40,
}
WHATSAPP_NUMBER = re.sub(r'\D', '', os.getenv('HAMZURY_WHATSAPP_NUMBER', ''))
QUICK_REPLY_HOURS = max(1, int(os.getenv('HAMZURY_QUICK_REPLY_HOURS', '24') or 24))
PLAN_NUDGE_HOURS = max(1, int(os.getenv('HAMZURY_PLAN_NUDGE_HOURS', '4') or 4))  # remind the desk when a proposal has waited this long
LINK_DESTS = ('home', 'recommendation', 'checkout', 'pay', 'onboarding', 'progress')
# public venture pages. a site address shows only where it is confirmed (brand standard 07, addresses page).
VENTURE_INFO = {
    'bizdoc': {'name': 'bizdoc', 'area': 'registration, documentation and compliance', 'promise': 'registered, compliant, ready.',
               'hook': 'the right papers for your idea, contract or business, done properly.', 'site': os.getenv('HAMZURY_SITE_BIZDOC', 'https://bizdocconsult.com')},
    'medialy': {'name': 'medialy', 'area': 'business management, marketing and growth', 'promise': 'seen, trusted, chosen.',
                'hook': 'people notice you. we help them buy, and come back.', 'site': os.getenv('HAMZURY_SITE_MEDIALY', '')},
    'subt': {'name': 'subt', 'area': 'software, ai and automation', 'promise': 'ai and automation that work for you.',
             'hook': 'less repeated work. more time for what matters.', 'site': os.getenv('HAMZURY_SITE_SUBT', '')},
    'iotics': {'name': 'iotics', 'area': 'smart technology, robotics and installations', 'promise': 'smarter, safer spaces.',
               'hook': 'see, control and protect your space from your phone.', 'site': os.getenv('HAMZURY_SITE_IOTICS', '')},
    'hub': {'name': 'hamzury hub', 'area': 'practical skills and business development', 'promise': 'a team that knows how.',
            'hook': 'practical skills you can use the next day.', 'site': os.getenv('HAMZURY_SITE_HUB', '')},
    'iwiin': {'name': 'iwiin', 'area': 'grants, partnerships and opportunities', 'promise': 'ready for funding.',
              'hook': 'find the right opportunities, and apply well.', 'site': os.getenv('HAMZURY_SITE_IWIIN', 'https://iwiin.hamzury.com')},
}
ALLOWED_UPLOADS = {'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.zip', '.txt', '.csv'}

app = FastAPI(title='hamzury', docs_url=None, redoc_url=None, openapi_url=None)


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        limit = MAX_UPLOAD + 1024 * 1024 if scope['path'].endswith(('/attachment', '/file')) else 256 * 1024
        lengths = [v for k, v in scope['headers'] if k == b'content-length']
        if lengths and (not lengths[0].isdigit() or int(lengths[0]) > limit):
            return await JSONResponse({'detail': 'request is too large'}, status_code=413)(scope, receive, send)
        total = 0

        async def limited_receive():
            nonlocal total
            msg = await receive()
            total += len(msg.get('body', b''))
            if total > limit:
                raise HTTPException(413, 'request is too large')
            return msg
        return await self.app(scope, limited_receive, send)


app.add_middleware(BodyLimitMiddleware)


# ---------------------------------------------------------------- database
class DatabaseConnection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def connect():
    c = sqlite3.connect(DB, timeout=8, factory=DatabaseConnection)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA busy_timeout=8000')
    return c


def payment_operation(fn):
    """Serialize payment side effects across threads/processes sharing this SQLite disk.

    OS locks are released after a crash; no stale lease can allow a second charge.
    Only deploy one app instance with a local persistent volume (not NFS).
    """
    @functools.wraps(fn)
    def guarded(*args, **kwargs):
        try:
            with PAYMENT_LOCK:
                return fn(*args, **kwargs)
        except LockTimeout:
            raise HTTPException(409, 'a payment operation is running. please retry shortly')
    return guarded


def storage_operation(fn):
    @functools.wraps(fn)
    def guarded(*args, **kwargs):
        try:
            with STORAGE_LOCK:
                return fn(*args, **kwargs)
        except LockTimeout:
            raise HTTPException(409, 'file maintenance is running. please retry shortly')
    return guarded


def password_hash(raw):
    salt = secrets.token_bytes(16)
    return 'pbkdf2$310000$' + salt.hex() + '$' + hashlib.pbkdf2_hmac('sha256', raw.encode(), salt, 310_000).hex()


def verify_password(raw, saved):
    try:
        scheme, count, salt, stored = saved.split('$')
        return scheme == 'pbkdf2' and hmac.compare_digest(
            hashlib.pbkdf2_hmac('sha256', raw.encode(), bytes.fromhex(salt), int(count)), bytes.fromhex(stored))
    except (ValueError, TypeError):
        return False


def init_db():
    with connect() as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL, role TEXT NOT NULL, venture TEXT, active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
            expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS clients (
            id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, name TEXT NOT NULL, business TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL, phone_key TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', path TEXT NOT NULL,
            intake TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '',
            owner_user_id INTEGER REFERENCES users(id), last_update_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS client_sessions (
            token_hash TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), csrf TEXT NOT NULL,
            expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS packages (
            id INTEGER PRIMARY KEY, venture TEXT NOT NULL, name TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
            inclusions TEXT NOT NULL DEFAULT '[]', value TEXT NOT NULL DEFAULT '', duration TEXT NOT NULL DEFAULT '',
            price_minor INTEGER NOT NULL, onboarding TEXT NOT NULL DEFAULT '[]', stage TEXT NOT NULL DEFAULT 'structure',
            active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS recommendations (
            id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id),
            heard TEXT NOT NULL DEFAULT '', advice TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
            published_at TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS rec_items (
            id INTEGER PRIMARY KEY, recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
            package_id INTEGER NOT NULL REFERENCES packages(id), price_minor INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 2, stage TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), reference TEXT NOT NULL UNIQUE,
            total_minor INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', method TEXT NOT NULL DEFAULT '',
            transfer_note TEXT NOT NULL DEFAULT '', paid_at TEXT, confirmed_by TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS order_lines (
            id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            rec_item_id INTEGER NOT NULL REFERENCES rec_items(id), price_minor INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS engagements (
            id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), order_id INTEGER NOT NULL REFERENCES orders(id),
            rec_item_id INTEGER NOT NULL UNIQUE REFERENCES rec_items(id), package_id INTEGER NOT NULL REFERENCES packages(id),
            name TEXT NOT NULL, venture TEXT NOT NULL, price_minor INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'awaiting_onboarding', progress INTEGER NOT NULL DEFAULT 0,
            onboarding TEXT NOT NULL DEFAULT '{}', onboarding_at TEXT,
            file_path TEXT, file_name TEXT, delivered_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS updates (
            id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
            engagement_id INTEGER REFERENCES engagements(id), progress TEXT NOT NULL, blocker TEXT NOT NULL DEFAULT '',
            next_action TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY, engagement_id INTEGER NOT NULL REFERENCES engagements(id), author TEXT NOT NULL,
            progress INTEGER NOT NULL, done TEXT NOT NULL, blocker TEXT NOT NULL DEFAULT '', next_step TEXT NOT NULL,
            ready INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'submitted', holding_note TEXT NOT NULL DEFAULT '',
            reviewed_by TEXT, reviewed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS client_links (
            token_hash TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), dest TEXT NOT NULL,
            expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, last_used_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS events (
            day TEXT NOT NULL, flow TEXT NOT NULL, step INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, flow, step));
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, actor TEXT NOT NULL, event TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL,
            summary TEXT NOT NULL DEFAULT '', at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE INDEX IF NOT EXISTS ix_clients_phone ON clients(phone_key);
        CREATE INDEX IF NOT EXISTS ix_eng_client ON engagements(client_id);
        CREATE INDEX IF NOT EXISTS ix_orders_client ON orders(client_id);
        CREATE INDEX IF NOT EXISTS ix_updates_client ON updates(client_id);
        ''')
        cols = {r[1] for r in c.execute('PRAGMA table_info(engagements)')}
        for col, ddl in (('assigned_user_id', 'INTEGER REFERENCES users(id)'), ('due_date', "TEXT NOT NULL DEFAULT ''"), ('brief', "TEXT NOT NULL DEFAULT ''")):
            if col not in cols:
                c.execute(f'ALTER TABLE engagements ADD COLUMN {col} {ddl}')
        rcols = {r[1] for r in c.execute('PRAGMA table_info(rec_items)')}
        if 'level' not in rcols:
            c.execute("ALTER TABLE rec_items ADD COLUMN level TEXT NOT NULL DEFAULT 'standard'")
            c.execute("UPDATE rec_items SET level=CASE priority WHEN 1 THEN 'minimum' WHEN 3 THEN 'scaling' ELSE 'standard' END")
        for col, ddl in (('client_has', 'INTEGER NOT NULL DEFAULT 0'), ('renewal', "TEXT NOT NULL DEFAULT 'none'"), ('renewal_minor', 'INTEGER NOT NULL DEFAULT 0'),
                         ('quote', "TEXT NOT NULL DEFAULT 'fixed'"), ('request', "TEXT NOT NULL DEFAULT ''"), ('requested_at', 'TEXT')):
            if col not in rcols:
                c.execute(f'ALTER TABLE rec_items ADD COLUMN {col} {ddl}')
        if 'management' not in {r[1] for r in c.execute('PRAGMA table_info(recommendations)')}:
            c.execute("ALTER TABLE recommendations ADD COLUMN management TEXT NOT NULL DEFAULT ''")
        pcols = {r[1] for r in c.execute('PRAGMA table_info(packages)')}
        for col, ddl in (('code', "TEXT NOT NULL DEFAULT ''"), ('level', "TEXT NOT NULL DEFAULT 'standard'"), ('exclusions', "TEXT NOT NULL DEFAULT '[]'"),
                         ('basis', "TEXT NOT NULL DEFAULT 'fixed'"), ('price_status', "TEXT NOT NULL DEFAULT 'approved'"), ('external', "TEXT NOT NULL DEFAULT ''"),
                         ('format', "TEXT NOT NULL DEFAULT 'document'"), ('grp', "TEXT NOT NULL DEFAULT ''"), ('requires', "TEXT NOT NULL DEFAULT '[]'"),
                         ('overlaps', "TEXT NOT NULL DEFAULT '[]'"), ('focus', "TEXT NOT NULL DEFAULT ''")):
            if col not in pcols:
                c.execute(f'ALTER TABLE packages ADD COLUMN {col} {ddl}')
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_pkg_code ON packages(code) WHERE code != ''")
        rcols2 = {r[1] for r in c.execute('PRAGMA table_info(rec_items)')}
        for col, ddl in (('assess', "TEXT NOT NULL DEFAULT ''"), ('client_saved', 'INTEGER NOT NULL DEFAULT 0')):
            if col not in rcols2:
                c.execute(f'ALTER TABLE rec_items ADD COLUMN {col} {ddl}')
        reccols = {r[1] for r in c.execute('PRAGMA table_info(recommendations)')}
        if 'auto' not in reccols:
            c.execute('ALTER TABLE recommendations ADD COLUMN auto INTEGER NOT NULL DEFAULT 0')
        ocols = {r[1] for r in c.execute('PRAGMA table_info(orders)')}
        if 'kind' not in ocols:
            c.execute("ALTER TABLE orders ADD COLUMN kind TEXT NOT NULL DEFAULT 'purchase'")
        if 'subscription_id' not in ocols:
            c.execute('ALTER TABLE orders ADD COLUMN subscription_id INTEGER')
        c.executescript('''CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id), engagement_id INTEGER, rec_item_id INTEGER UNIQUE,
            name TEXT NOT NULL, amount_minor INTEGER NOT NULL, method TEXT NOT NULL DEFAULT 'transfer', status TEXT NOT NULL DEFAULT 'active',
            next_due TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, last_paid_at TEXT, cancel_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);''')
        if 'bill_day' not in {r[1] for r in c.execute('PRAGMA table_info(subscriptions)')}:
            c.execute('ALTER TABLE subscriptions ADD COLUMN bill_day INTEGER')
        if 'attachments' not in {r[1] for r in c.execute('PRAGMA table_info(engagements)')}:
            c.execute("ALTER TABLE engagements ADD COLUMN attachments TEXT NOT NULL DEFAULT '{}'")
        ccols = {r[1] for r in c.execute('PRAGMA table_info(clients)')}
        if 'source' not in ccols:
            c.execute("ALTER TABLE clients ADD COLUMN source TEXT NOT NULL DEFAULT 'holding'")
        if 'plan_eta' not in ccols:
            c.execute("ALTER TABLE clients ADD COLUMN plan_eta TEXT NOT NULL DEFAULT ''")
        if 'pay_auth' not in ccols:
            c.execute("ALTER TABLE clients ADD COLUMN pay_auth TEXT NOT NULL DEFAULT ''")
        c.execute('CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT)')
        for table, col, ddl in (('packages', 'vat', 'INTEGER NOT NULL DEFAULT 1'), ('orders', 'subtotal_minor', 'INTEGER'), ('orders', 'vat_minor', 'INTEGER NOT NULL DEFAULT 0'),
                                ('orders', 'terms_version', 'TEXT'), ('orders', 'proposal_version', 'TEXT'), ('orders', 'accepted_at', 'TEXT'), ('orders', 'refunded_at', 'TEXT'),
                                ('engagements', 'assigned_at', 'TEXT'), ('engagements', 'update_requested_at', 'TEXT'), ('engagements', 'handover', "TEXT NOT NULL DEFAULT '{}'"),
                                ('engagements', 'attachments_purged_at', 'TEXT'), ('engagements', 'file_purged_at', 'TEXT'),
                                ('users', 'phone', "TEXT NOT NULL DEFAULT ''"), ('clients', 'hold', 'INTEGER NOT NULL DEFAULT 0'), ('clients', 'purged_at', 'TEXT'), ('clients', 'last_seen_at', 'TEXT')):
            if col not in {r[1] for r in c.execute(f'PRAGMA table_info({table})')}:
                c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {ddl}')
        for col, ddl in (('mfa_secret', "TEXT NOT NULL DEFAULT ''"), ('mfa_pending', "TEXT NOT NULL DEFAULT ''"),
                         ('mfa_last_step', 'INTEGER NOT NULL DEFAULT -1')):
            if col not in {r[1] for r in c.execute('PRAGMA table_info(users)')}:
                c.execute(f'ALTER TABLE users ADD COLUMN {col} {ddl}')
        if 'renewal_period' not in {r[1] for r in c.execute('PRAGMA table_info(orders)')}:
            c.execute('ALTER TABLE orders ADD COLUMN renewal_period TEXT')
        c.execute("""CREATE UNIQUE INDEX IF NOT EXISTS ux_renewal_period ON orders(subscription_id,renewal_period)
                     WHERE kind='renewal' AND renewal_period IS NOT NULL AND status NOT IN ('cancelled','refund_due','refunded')""")
        c.execute('CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, n INTEGER NOT NULL, expires INTEGER NOT NULL)')
        load_catalogue(c, only_missing=True)
        if c.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0 and READY:
            c.execute('INSERT INTO users(username,display_name,password_hash,role) VALUES(?,?,?,?)',
                      (ADMIN_USERNAME, 'holding owner', password_hash(ADMIN_PASSWORD), 'holding_owner'))



def log(c, actor, event, entity, entity_id, summary=''):
    c.execute('INSERT INTO audit(actor,event,entity,entity_id,summary) VALUES(?,?,?,?,?)',
              (actor, event, entity, entity_id, str(summary)[:300]))


def one(c, table, row_id):
    assert table in ('clients', 'packages', 'orders', 'engagements', 'users', 'recommendations', 'subscriptions')
    row = c.execute(f'SELECT * FROM {table} WHERE id=?', (row_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'record not found')
    return row


def phone_key(raw):
    digits = re.sub(r'\D', '', raw or '')
    return digits[-10:]


def new_ref(c, table, column, prefix):
    alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for _ in range(10):
        ref = prefix + ''.join(secrets.choice(alphabet) for _ in range(6))
        if not c.execute(f'SELECT 1 FROM {table} WHERE {column}=?', (ref,)).fetchone():
            return ref
    raise HTTPException(500, 'please try again')


def parse_ts(v):
    try:
        return calendar.timegm(time.strptime(v[:19], '%Y-%m-%d %H:%M:%S')) if v else None
    except ValueError:
        return None




def throttle(kind, request, limit, seconds):
    now = int(time.time())
    host = request.client.host if request.client else 'unknown'
    key = hmac.new(SECRET.encode(), f'{kind}:{host}'.encode(), hashlib.sha256).hexdigest()
    with connect() as c:
        c.execute('DELETE FROM rate_limits WHERE expires<=?', (now,))
        count = c.execute('''INSERT INTO rate_limits(key,n,expires) VALUES(?,1,?)
                             ON CONFLICT(key) DO UPDATE SET n=n+1 RETURNING n''', (key, now + seconds)).fetchone()[0]
    if count > limit:
        raise HTTPException(429, 'too many attempts. please wait a little and try again')
    return key


# ---------------------------------------------------------------- security headers
@app.middleware('http')
async def headers(request, call_next):
    r = await call_next(request)
    r.headers['X-Content-Type-Options'] = 'nosniff'
    r.headers['X-Frame-Options'] = 'DENY'
    r.headers['Referrer-Policy'] = 'no-referrer'
    r.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    private = request.url.path.startswith(('/api/', '/admin', '/track', '/pay/'))
    r.headers['Cache-Control'] = 'no-store' if private else 'public, max-age=300'
    r.headers['Content-Security-Policy'] = ("default-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self'; "
                                            "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
                                            "frame-ancestors 'none'; form-action 'self' https://checkout.paystack.com")
    if SECURE_COOKIES:
        r.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return r


# ---------------------------------------------------------------- staff auth
def staff(request: Request, csrf: str | None = Header(None, alias='X-CSRF-Token')):
    if not READY:
        raise HTTPException(503, 'set HAMZURY_ADMIN_PASSWORD (12+) and HAMZURY_SECRET (32+) first')
    cookie = request.cookies.get('hz_staff', '')
    if not cookie:
        raise HTTPException(401, 'please sign in')
    with connect() as c:
        row = c.execute('''SELECT s.csrf,s.expires_at,u.* FROM sessions s JOIN users u ON u.id=s.user_id
                           WHERE s.token_hash=?''', (hashlib.sha256(cookie.encode()).hexdigest(),)).fetchone()
    if not row or not row['active'] or row['expires_at'] <= time.time():
        raise HTTPException(401, 'session expired. please sign in again')
    if request.method not in ('GET', 'HEAD') and not hmac.compare_digest(csrf or '', row['csrf']):
        raise HTTPException(403, 'session check failed. refresh the page and try again')
    if REQUIRE_MFA and not row['mfa_secret'] and request.url.path not in ('/api/me', '/api/logout') and not request.url.path.startswith('/api/account/'):
        raise HTTPException(403, 'set up an authenticator in account security first')
    return dict(row)


def holding(user=Depends(staff)):
    if user['role'] not in ROLE_HOLDING:
        raise HTTPException(403, 'holding role required')
    return user


def owner(user=Depends(staff)):
    if user['role'] != 'holding_owner':
        raise HTTPException(403, 'holding owner role required')
    return user


def money(user=Depends(staff)):
    if user['role'] not in ROLE_HOLDING + ('finance',):
        raise HTTPException(403, 'holding or finance role required')
    return user


def finance_or_owner(user=Depends(staff)):
    if user['role'] not in ('holding_owner', 'finance'):
        raise HTTPException(403, 'finance or the holding owner only')
    return user


def public_user(u):
    return {k: u[k] for k in ('id', 'username', 'display_name', 'role', 'venture')} | {
        'phone': u['phone'] if 'phone' in u.keys() else '', 'mfa_enabled': bool(u['mfa_secret']), 'mfa_required': REQUIRE_MFA}


class Login(BaseModel):
    username: str = Field(max_length=60)
    password: str = Field(max_length=200)
    otp: str = Field(default='', max_length=6, pattern=r'^(?:[0-9]{6})?$')


def secret_cipher():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(SECRET.encode()).digest()))


def check_otp(c, u, code, encrypted=None):
    try:
        raw = secret_cipher().decrypt((encrypted or u['mfa_secret']).encode()).decode()
    except (InvalidToken, ValueError):
        raise HTTPException(503, 'authenticator unavailable. contact the server operator')
    step = int(time.time()) // 30
    totp = pyotp.TOTP(raw)
    matched = next((n for n in (step - 1, step, step + 1) if n > u['mfa_last_step'] and hmac.compare_digest(totp.at(n * 30), code)), None)
    if matched is None:
        raise HTTPException(401, 'enter a new authenticator code')
    changed = c.execute('UPDATE users SET mfa_last_step=? WHERE id=? AND mfa_last_step<?', (matched, u['id'], matched))
    if changed.rowcount != 1:
        raise HTTPException(401, 'enter a new authenticator code')


@app.post('/api/login')
def login(body: Login, request: Request, response: Response):
    if not READY:
        raise HTTPException(503, 'configure strong application secrets first')
    throttle('staff_login', request, 12, 900)
    with connect() as c:
        u = c.execute('SELECT * FROM users WHERE username=? AND active=1', (body.username.lower(),)).fetchone()
        if not u or not verify_password(body.password, u['password_hash']):
            raise HTTPException(401, 'username or password is not correct')
        if u['mfa_secret']:
            check_otp(c, u, body.otp)
        token, csrf = secrets.token_urlsafe(36), secrets.token_urlsafe(28)
        c.execute('INSERT INTO sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), u['id'], csrf, int(time.time() + 8 * 3600)))
        log(c, u['username'], 'staff.login', 'users', u['id'])
    response.set_cookie('hz_staff', token, httponly=True, secure=SECURE_COOKIES, samesite='strict', max_age=8 * 3600, path='/')
    return {'csrf': csrf, 'user': public_user(u)}


@app.get('/api/me')
def me(user=Depends(staff)):
    return {'user': public_user(user), 'csrf': user['csrf']}


@app.post('/api/logout')
def logout(request: Request, response: Response, user=Depends(staff)):
    with connect() as c:
        c.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(request.cookies.get('hz_staff', '').encode()).hexdigest(),))
    response.delete_cookie('hz_staff', path='/')
    return {'ok': True}


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


@app.post('/api/account/password')
def change_password(body: PasswordChange, request: Request, response: Response, user=Depends(staff)):
    throttle('account_security', request, 12, 900)
    with connect() as c:
        u = one(c, 'users', user['id'])
        if not verify_password(body.current_password, u['password_hash']):
            raise HTTPException(401, 'current password is not correct')
        if body.current_password == body.new_password:
            raise HTTPException(400, 'choose a different password')
        c.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(body.new_password), user['id']))
        c.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        log(c, user['username'], 'staff.password_changed', 'users', user['id'])
    response.delete_cookie('hz_staff', path='/')
    return {'ok': True}


class MFAPassword(BaseModel):
    password: str = Field(max_length=200)


@app.post('/api/account/mfa/setup')
def setup_mfa(body: MFAPassword, request: Request, user=Depends(staff)):
    throttle('account_security', request, 12, 900)
    with connect() as c:
        u = one(c, 'users', user['id'])
        if not verify_password(body.password, u['password_hash']):
            raise HTTPException(401, 'password is not correct')
        if u['mfa_secret']:
            raise HTTPException(409, 'authenticator is already enabled')
        secret = pyotp.random_base32()
        c.execute('UPDATE users SET mfa_pending=? WHERE id=?', (secret_cipher().encrypt(secret.encode()).decode(), user['id']))
    return {'secret': secret, 'uri': pyotp.TOTP(secret).provisioning_uri(user['username'], issuer_name='Hamzury')}


class MFACode(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r'^[0-9]{6}$')


@app.post('/api/account/mfa/enable')
def enable_mfa(body: MFACode, request: Request, response: Response, user=Depends(staff)):
    throttle('account_security', request, 12, 900)
    with connect() as c:
        u = one(c, 'users', user['id'])
        if not u['mfa_pending'] or u['mfa_secret']:
            raise HTTPException(409, 'start authenticator setup first')
        check_otp(c, u, body.code, u['mfa_pending'])
        c.execute("UPDATE users SET mfa_secret=mfa_pending,mfa_pending='' WHERE id=?", (user['id'],))
        c.execute('DELETE FROM sessions WHERE user_id=?', (user['id'],))
        log(c, user['username'], 'staff.mfa_enabled', 'users', user['id'])
    response.delete_cookie('hz_staff', path='/')
    return {'ok': True}


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r'^[a-zA-Z0-9_.-]+$')
    display_name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=12, max_length=200)
    role: Literal['holding_admin', 'venture_ceo', 'venture_admin', 'finance']
    phone: str = Field(default='', max_length=30)
    venture: Literal['bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin'] | None = None


@app.get('/api/users')
def users(user=Depends(holding)):
    with connect() as c:
        return [public_user(u) | {'active': bool(u['active'])} for u in c.execute('SELECT * FROM users ORDER BY id')]


@app.post('/api/users')
def create_user(body: UserIn, user=Depends(owner)):
    if body.role.startswith('venture') and not body.venture:
        raise HTTPException(400, 'choose a venture for venture staff')
    with connect() as c:
        try:
            cur = c.execute('INSERT INTO users(username,display_name,password_hash,role,venture,phone) VALUES(?,?,?,?,?,?)',
                            (body.username.lower(), body.display_name, password_hash(body.password), body.role,
                             body.venture if body.role.startswith('venture') else None, body.phone.strip()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'that username is taken')
        log(c, user['username'], 'staff.created', 'users', cur.lastrowid)
    return {'id': cur.lastrowid}


@app.post('/api/users/{uid}/deactivate')
def deactivate(uid: int, user=Depends(owner)):
    if uid == user['id']:
        raise HTTPException(400, 'you cannot deactivate your own account')
    with connect() as c:
        one(c, 'users', uid)
        c.execute('UPDATE users SET active=0 WHERE id=?', (uid,))
        c.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
        log(c, user['username'], 'staff.deactivated', 'users', uid)
    return {'ok': True}


class StaffPasswordReset(BaseModel):
    owner_password: str = Field(max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


@app.post('/api/users/{uid}/password')
def reset_staff_password(uid: int, body: StaffPasswordReset, request: Request, user=Depends(owner)):
    throttle('account_security', request, 12, 900)
    with connect() as c:
        actor = one(c, 'users', user['id'])
        target = one(c, 'users', uid)
        if not verify_password(body.owner_password, actor['password_hash']):
            raise HTTPException(401, 'owner password is not correct')
        if target['role'] == 'holding_owner':
            raise HTTPException(400, 'use account security to change your own password')
        c.execute('UPDATE users SET password_hash=? WHERE id=?', (password_hash(body.new_password), uid))
        c.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
        log(c, user['username'], 'staff.password_reset', 'users', uid)
    return {'ok': True}


# ---------------------------------------------------------------- start here (public intake)
class StartIn(BaseModel):
    answers: dict[str, str | list[str]]
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=40)
    email: str = Field(default='', max_length=160)
    consent: bool = False
    website: str = Field(default='', max_length=200)  # honeypot


def clean_answers(raw):
    out = {}
    for key, limit in INTAKE_KEYS.items():
        v = raw.get(key, '')
        if isinstance(v, list):
            v = [str(x)[:80] for x in v][:14]
            if sum(len(x) for x in v) > limit:
                raise HTTPException(400, 'answer is too long')
        else:
            v = str(v).strip()[:limit]
        out[key] = v
    if out['route'] not in ('', 'quick', 'full', 'venture'):
        out['route'] = ''
    if out['route'] == 'quick' and not out['path']:
        out['path'] = 'quick'
    if out['path'] not in ('start', 'contract', 'grow', 'service', 'partnership', 'quick'):
        raise HTTPException(400, 'please choose what describes you')
    if out['venture'] and out['venture'] not in VENTURES:
        out['venture'] = ''
    if out['importance'] and not (isinstance(out['importance'], str) and out['importance'].isdigit() and 1 <= int(out['importance']) <= 10):
        out['importance'] = ''
    return out


def client_cookie(response, c, client_id):
    token, csrf = secrets.token_urlsafe(36), secrets.token_urlsafe(28)
    c.execute('INSERT INTO client_sessions VALUES(?,?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), client_id, csrf, int(time.time() + 30 * 86400)))
    response.set_cookie('hz_client', token, httponly=True, secure=SECURE_COOKIES, samesite='lax', max_age=30 * 86400, path='/')
    return csrf


@app.post('/api/start')
def start(body: StartIn, request: Request, response: Response):
    throttle('start', request, 8, 3600)
    if body.website.strip():
        return {'ref': 'HZ-' + secrets.token_hex(3).upper(), 'csrf': ''}
    if not body.consent:
        raise HTTPException(400, 'please confirm we may use your details to prepare your recommendation')
    if len(phone_key(body.phone)) < 7:
        raise HTTPException(400, 'please check your phone number')
    if body.email and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', body.email.strip()):
        raise HTTPException(400, 'please check your email address')
    answers = clean_answers(body.answers)
    with connect() as c:
        ref = new_ref(c, 'clients', 'ref', 'HZ-')
        cur = c.execute('''INSERT INTO clients(ref,name,business,phone,phone_key,email,path,intake,source) VALUES(?,?,?,?,?,?,?,?,?)''',
                        (ref, body.name.strip(), answers['business'], body.phone.strip(), phone_key(body.phone),
                         body.email.strip().lower(), answers['path'], json.dumps(answers), answers['venture'] or 'holding'))
        log(c, 'client', 'client.started', 'clients', cur.lastrowid, answers['path'])
        focus = draft_from_answers(c, cur.lastrowid, answers)
        csrf = client_cookie(response, c, cur.lastrowid)
    return {'ref': ref, 'csrf': csrf, 'review_hours': UPDATE_HOURS, 'focus': focus}


def draft_focus(c, cid):
    codes = [r['code'] for r in c.execute('''SELECT p.code FROM recommendations rc JOIN rec_items ri ON ri.recommendation_id=rc.id
                                             JOIN packages p ON p.id=ri.package_id WHERE rc.client_id=? AND p.code!='' ORDER BY ri.priority, ri.sort''', (cid,))]
    return CAT.focus_lines([{'code': x} for x in codes if x in CAT.BY_CODE])


def draft_from_answers(c, cid, answers):
    """turn the client's answers into a draft roadmap for the holding to review. the client sees only plain focus lines, never prices."""
    try:
        sug = CAT.suggest(answers)
    except Exception:
        return []
    rows = []
    for s in sug:
        p = c.execute('SELECT * FROM packages WHERE code=? AND active=1', (s['code'],)).fetchone()
        if p:
            rows.append((s, p))
    if not rows:
        return []
    focus = CAT.focus_lines([s for s, _ in rows])
    advice = ('first, ' + focus[0] + (f'. then, {focus[1]}' if len(focus) > 1 else '') + '.') if focus else ''
    rec_id = c.execute("INSERT INTO recommendations(client_id,heard,advice,status,auto) VALUES(?,?,?,'draft',1)", (cid, '', advice)).lastrowid
    for k, (s, p) in enumerate(rows):
        verify = 'we will check' in s['reason'] or 'we will confirm' in s['reason']
        monthly = p['basis'] == 'monthly'
        c.execute('''INSERT INTO rec_items(recommendation_id,package_id,price_minor,note,priority,stage,sort,level,quote,assess,renewal,renewal_minor)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''', (rec_id, p['id'], p['price_minor'], s['reason'], s['urgency'], p['stage'], k, p['level'],
                                                        'ask' if p['basis'] == 'quote' else 'fixed', 'verify' if verify else '',
                                                        'monthly' if monthly else 'none', p['price_minor'] if monthly else 0))
    log(c, 'system', 'draft.created', 'clients', cid, ','.join(s['code'] for s, _ in rows))
    return focus


# ---------------------------------------------------------------- client session
def client(request: Request, csrf: str | None = Header(None, alias='X-CSRF-Token')):
    cookie = request.cookies.get('hz_client', '')
    if not cookie:
        raise HTTPException(401, 'please enter your hamzury id')
    with connect() as c:
        row = c.execute('''SELECT s.csrf,s.expires_at,c.* FROM client_sessions s JOIN clients c ON c.id=s.client_id
                           WHERE s.token_hash=?''', (hashlib.sha256(cookie.encode()).hexdigest(),)).fetchone()
    if not row or row['expires_at'] <= time.time() or row['status'] == 'closed':
        raise HTTPException(401, 'please enter your hamzury id again')
    if request.method not in ('GET', 'HEAD') and not hmac.compare_digest(csrf or '', row['csrf']):
        raise HTTPException(403, 'please refresh the page and try again')
    return dict(row)


class TrackIn(BaseModel):
    ref: str = Field(min_length=4, max_length=20)
    phone: str = Field(min_length=7, max_length=40)


@app.get('/api/public/config')
def public_config():
    return {'whatsapp': WHATSAPP_NUMBER, 'contact_email': CONTACT_EMAIL, 'review_hours': UPDATE_HOURS, 'quick_reply_hours': QUICK_REPLY_HOURS}


class EventIn(BaseModel):
    flow: Literal['route', 'quick', 'full']
    step: int = Field(ge=0, le=40)


@app.post('/api/events')
def record_event(body: EventIn, request: Request):
    """anonymous funnel counts: which screen people reach. no personal data, no identifiers."""
    try:
        throttle('event', request, 400, 3600)
    except HTTPException:
        return {'ok': True}
    with connect() as c:
        c.execute('INSERT INTO events(day,flow,step,n) VALUES(date(\'now\'),?,?,1) ON CONFLICT(day,flow,step) DO UPDATE SET n=n+1', (body.flow, body.step))
    return {'ok': True}


class LinkLogin(BaseModel):
    token: str = Field(min_length=20, max_length=120)


@app.post('/api/client/link')
def client_link_login(body: LinkLogin, request: Request, response: Response):
    """a private link sent on whatsapp opens the right step without typing the id and phone."""
    throttle('client_link', request, 30, 900)
    with connect() as c:
        row = c.execute('''SELECT l.*,c.status AS client_status,c.owner_user_id FROM client_links l JOIN clients c ON c.id=l.client_id
                           WHERE l.token_hash=?''', (hashlib.sha256(body.token.encode()).hexdigest(),)).fetchone()
        if not row or row['expires_at'] <= time.time() or row['client_status'] == 'closed':
            raise HTTPException(401, 'this link has expired. please use your hamzury id and phone number, or ask us for a new link')
        c.execute('UPDATE client_links SET last_used_at=CURRENT_TIMESTAMP WHERE token_hash=?', (row['token_hash'],))
        sender = c.execute('SELECT display_name FROM users WHERE id=?', (row['owner_user_id'],)).fetchone() if row['owner_user_id'] else None
        csrf = client_cookie(response, c, row['client_id'])
        log(c, 'client', 'client.link_opened', 'clients', row['client_id'], row['dest'])
    return {'csrf': csrf, 'dest': row['dest'], 'sender': sender['display_name'] if sender else 'the hamzury desk'}


@app.post('/api/client/login')
def client_login(body: TrackIn, request: Request, response: Response):
    throttle('client_login', request, 10, 900)
    ref = body.ref.strip().upper().replace(' ', '')
    if not ref.startswith('HZ-'):
        ref = 'HZ-' + ref.removeprefix('HZ')
    with connect() as c:
        row = c.execute("SELECT * FROM clients WHERE ref=? AND status!='closed'", (ref,)).fetchone()
        if not row or not hmac.compare_digest(row['phone_key'], phone_key(body.phone)):
            raise HTTPException(401, 'we could not find that id with that phone number. please check both')
        csrf = client_cookie(response, c, row['id'])
        log(c, 'client', 'client.login', 'clients', row['id'])
    return {'csrf': csrf}


@app.post('/api/client/logout')
def client_logout(request: Request, response: Response, me=Depends(client)):
    with connect() as c:
        c.execute('DELETE FROM client_sessions WHERE token_hash=?', (hashlib.sha256(request.cookies.get('hz_client', '').encode()).hexdigest(),))
    response.delete_cookie('hz_client', path='/')
    return {'ok': True}


def package_view(p, price=None):
    k = p.keys()
    g = lambda col, d: p[col] if col in k else d
    return {'id': p['id'], 'venture': p['venture'], 'name': p['name'], 'summary': p['summary'],
            'inclusions': json.loads(p['inclusions']), 'value': p['value'], 'duration': p['duration'],
            'price_minor': p['price_minor'] if price is None else price, 'onboarding': json.loads(p['onboarding']),
            'code': g('code', ''), 'level': g('level', 'standard'), 'exclusions': json.loads(g('exclusions', '[]')), 'basis': g('basis', 'fixed'),
            'price_status': g('price_status', 'approved'), 'external': g('external', ''), 'format': g('format', 'document'), 'vat': bool(g('vat', 1)),
            'group': g('grp', ''), 'requires': json.loads(g('requires', '[]')), 'overlaps': json.loads(g('overlaps', '[]'))}


def load_catalogue(c, only_missing=False):
    """bring the master catalogue into the packages table, matched by code.
    never touches a price or its approval once it exists: those belong to the holding."""
    added = updated = 0
    for i in CAT.CATALOGUE:
        row = c.execute('SELECT id FROM packages WHERE code=?', (i['code'],)).fetchone()
        text = (i['owner'], i['name'], i['value'].split('.')[0][:400], json.dumps(i['inclusions']), i['value'], i['duration'], json.dumps(i['onboarding']),
                i['stage'], i['level'], json.dumps(i['exclusions']), i['basis'], i['external'], i['format'], i['group'], json.dumps(i['requires']),
                json.dumps(i['overlaps']), i['focus'])
        if row:
            if not only_missing:
                c.execute('''UPDATE packages SET venture=?,name=?,summary=?,inclusions=?,value=?,duration=?,onboarding=?,stage=?,level=?,exclusions=?,basis=?,
                             external=?,format=?,grp=?,requires=?,overlaps=?,focus=? WHERE id=?''', (*text, row['id']))
                updated += 1
            continue
        c.execute('''INSERT INTO packages(venture,name,summary,inclusions,value,duration,onboarding,stage,level,exclusions,basis,external,format,grp,requires,overlaps,focus,
                     code,price_minor,price_status,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)''',
                  (*text, i['code'], i['price_minor'], i['status']))
        added += 1
    return {'added': added, 'updated': updated}


init_db()


def journey_step(status, rec_published, paid_any, needs_onboarding, all_delivered):
    """1 tell us, 2 recommendation, 3 choose and pay, 4 onboarding, 5 progress, 6 delivered."""
    if all_delivered:
        return 6
    if paid_any and needs_onboarding:
        return 4
    if paid_any:
        return 5
    if rec_published:
        return 3
    return 2


LEVELS = ('minimum', 'standard', 'protection', 'scaling')
ALL_LEVELS = LEVELS + ('renewals',)  # renewals and changes: always open, never blocks, usually priced after a few questions


@app.get('/api/client/me')
def client_me(me=Depends(client)):
    with connect() as c:
        # activity for the keeping rules: a client who signs in is not an abandoned enquiry
        c.execute("UPDATE clients SET last_seen_at=CURRENT_TIMESTAMP WHERE id=? AND (last_seen_at IS NULL OR last_seen_at < datetime('now','-1 hour'))", (me['id'],))
        rec = c.execute("SELECT * FROM recommendations WHERE client_id=? AND status='published'", (me['id'],)).fetchone()
        items = []
        owned_ids = {r[0] for r in c.execute('SELECT rec_item_id FROM engagements WHERE client_id=?', (me['id'],))}
        if rec:
            for it in c.execute('''SELECT r.*, p.venture,p.name,p.summary,p.inclusions,p.value,p.duration,p.onboarding,p.price_minor AS list_price, p.id AS pid,
                                   p.code,p.exclusions,p.basis,p.external,p.format,p.grp,p.requires,p.overlaps,p.price_status
                                   FROM rec_items r JOIN packages p ON p.id=r.package_id WHERE r.recommendation_id=? ORDER BY r.sort,r.id''', (rec['id'],)):
                fee_open = it['quote'] == 'fixed' and (dict(it).get('price_status') or 'approved') != 'approved' and it['id'] not in owned_ids
                items.append({'id': it['id'], 'stage': it['stage'], 'priority': it['priority'], 'note': it['note'],
                              'level': it['level'], 'client_has': bool(it['client_has']), 'quote': it['quote'],
                              'requested': bool(it['requested_at']), 'assess': 'verify' if fee_open else it['assess'], 'saved': bool(it['client_saved']),
                              'fee_pending': fee_open, 'renewal': it['renewal'], 'renewal_minor': 0 if fee_open else it['renewal_minor'],
                              'package': package_view({**dict(it), 'id': it['pid']}, 0 if fee_open else it['price_minor'])})
        engagements = [dict(e) for e in c.execute('SELECT * FROM engagements WHERE client_id=? ORDER BY id', (me['id'],))]
        bought = {e['rec_item_id']: e for e in engagements}
        for it in items:
            e = bought.get(it['id'])
            it['owned'] = bool(e)
            if e:
                it['engagement'] = {'id': e['id'], 'status': e['status'], 'status_label': WORK_LABEL[e['status']],
                                    'progress': e['progress'], 'has_file': bool(e['file_path']) and e['status'] == 'delivered',
                                    'file_name': e['file_name'] if e['status'] == 'delivered' else None,
                                    'onboarding_done': bool(e['onboarding_at']), 'delivered_at': e['delivered_at'],
                                    'attachments': {k: v['name'] for k, v in json.loads(e['attachments'] or '{}').items()},
                                    'files_until': (datetime.date.fromisoformat(e['delivered_at'][:10]) + datetime.timedelta(days=DELIVERED_DAYS)).isoformat() if e['delivered_at'] else None,
                                    'file_removed': bool(e['file_purged_at']),
                                    'handover': {k: v for k, v in json.loads(e['handover'] or '{}').items() if k in ('accounts', 'copies_given', 'client_owns_accounts', 'staff_access_removed')},
                                    'asked_at': e['update_requested_at']}
        orders = [dict(o) for o in c.execute("SELECT id,reference,total_minor,subtotal_minor,vat_minor,status,method,created_at,paid_at FROM orders WHERE client_id=? AND kind='purchase' ORDER BY id DESC", (me['id'],))]
        focus = [] if rec else draft_focus(c, me['id'])
        pr = pricing(c)
        vat_flags = {r['id']: bool(r['vat']) for r in c.execute('SELECT id,vat FROM packages')}
        agreements = [dict(o) for o in c.execute('''SELECT reference,total_minor,subtotal_minor,vat_minor,status,terms_version,proposal_version,accepted_at,paid_at FROM orders
                                                    WHERE client_id=? AND kind='purchase' AND accepted_at IS NOT NULL AND status IN ('paid','awaiting_confirmation','pending','refund_due','refunded')
                                                    ORDER BY id DESC''', (me['id'],))]
        subs = [dict(s) for s in c.execute('''SELECT id,name,amount_minor,method,status,next_due,cancel_at FROM subscriptions
                                              WHERE client_id=? AND status!='cancelled' ORDER BY id''', (me['id'],))]
        invoices = [dict(o) for o in c.execute('''SELECT o.id,o.reference,o.total_minor,o.subtotal_minor,o.vat_minor,o.status,o.method,s.name,s.next_due FROM orders o
                                                  JOIN subscriptions s ON s.id=o.subscription_id
                                                  WHERE o.client_id=? AND o.kind='renewal' AND o.status IN ('pending','awaiting_confirmation') ORDER BY o.id''', (me['id'],))]
        for o in orders:
            o['lines'] = [x['rec_item_id'] for x in c.execute('SELECT rec_item_id FROM order_lines WHERE order_id=?', (o['id'],))]
        ups = [dict(u) for u in c.execute('''SELECT u.progress,u.blocker,u.next_action,u.created_at,e.name AS package
                                             FROM updates u LEFT JOIN engagements e ON e.id=u.engagement_id
                                             WHERE u.client_id=? ORDER BY u.id DESC LIMIT 10''', (me['id'],))]
        contact = c.execute('SELECT display_name FROM users WHERE id=?', (me['owner_user_id'],)).fetchone() if me['owner_user_id'] else None
    needs_onb = any(e['status'] == 'awaiting_onboarding' for e in engagements)
    all_done = bool(engagements) and all(e['status'] == 'delivered' for e in engagements) and all(i['owned'] for i in items)
    return {
        'told': {k: json.loads(me['intake']).get(k, '') for k in ('challenge', 'challenge_other', 'note', 'impact', 'importance', 'stage', 'tried', 'route')},
        'whatsapp': WHATSAPP_NUMBER,
        'csrf': me['csrf'], 'ref': me['ref'], 'name': me['name'], 'business': me['business'], 'status': me['status'],
        'step': journey_step(me['status'], bool(rec), bool(engagements), needs_onb, all_done),
        'review_hours': UPDATE_HOURS, 'contact': contact['display_name'] if contact else 'the hamzury desk',
        'contact_email': CONTACT_EMAIL, 'created_at': me['created_at'],
        'recommendation': {'heard': rec['heard'], 'advice': rec['advice'], 'management': rec['management'],
                           'published_at': rec['published_at'], 'items': items} if rec else None,
        'levels': list(ALL_LEVELS), 'plan_eta': me['plan_eta'], 'focus': focus, 'subscriptions': subs, 'invoices': invoices, 'pricing': pr, 'agreements': agreements,
        'vat_flags': {str(k): v for k, v in vat_flags.items()},
        'orders': orders, 'updates': ups,
        'payment': {'paystack': bool(PAYSTACK_SECRET), 'transfer': bool(BANK_DETAILS),
                    'bank_details': BANK_DETAILS or 'your hamzury contact will send the account details on whatsapp.'},
    }


class CheckoutIn(BaseModel):
    items: list[int] = Field(min_length=1, max_length=40)
    method: Literal['paystack', 'transfer']
    email: str = Field(default='', max_length=160)
    accept_terms: bool = False  # the client accepts the master terms and this proposal


def add_month(d, anchor=None):
    """the billing day next month, clamped to the month's last day (31 jan -> 28/29 feb -> 31 mar: no drift)."""
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return datetime.date(y, m, min(anchor or d.day, calendar.monthrange(y, m)[1]))


def today():
    """the date in nigeria (west africa time, utc+1, no daylight saving), whatever the server clock says."""
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=1)).date()


def mark_paid(c, order, actor):
    """Create one engagement per bought package, start monthly services, or renew one.
    Idempotent and safe if two callers race: only the caller that flips the order to paid does the work.
    Money that arrives on a replaced order, or for a service that has ended, is recorded as refund_due for the desk.
    Returns True when this call recorded the payment."""
    if order is None:
        return False
    if order['status'] == 'cancelled':
        cur = c.execute("UPDATE orders SET status='refund_due',paid_at=CURRENT_TIMESTAMP,confirmed_by=? WHERE id=? AND status='cancelled'", (actor, order['id']))
        if cur.rowcount:
            log(c, actor, 'order.refund_due', 'orders', order['id'], order['reference'] + ' paid after it was replaced')
        return False
    if order['kind'] == 'renewal':
        s = c.execute('SELECT * FROM subscriptions WHERE id=?', (order['subscription_id'],)).fetchone()
        ended = (not s or s['status'] == 'cancelled' or (s['cancel_at'] and s['cancel_at'] <= s['next_due'])
                 or (order['renewal_period'] and order['renewal_period'] != s['next_due']))
        cur = c.execute("UPDATE orders SET status=?,paid_at=CURRENT_TIMESTAMP,confirmed_by=? WHERE id=? AND status IN ('pending','awaiting_confirmation')",
                        ('refund_due' if ended else 'paid', actor, order['id']))
        if not cur.rowcount:
            return False
        if ended:
            log(c, actor, 'order.refund_due', 'orders', order['id'], order['reference'] + ' paid for a service that is ending')
            return False
        due = datetime.date.fromisoformat(s['next_due'])
        if s['status'] == 'paused':  # a paused service restarts from the day it is paid
            due = max(due, today())
        c.execute("""UPDATE subscriptions SET next_due=?,status='active',failures=0,last_paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                  (add_month(due, s['bill_day']).isoformat(), s['id']))
        log(c, actor, 'renewal.paid', 'orders', order['id'], order['reference'])
        return True
    gone = c.execute('SELECT purged_at FROM clients WHERE id=?', (order['client_id'],)).fetchone()
    if gone and gone['purged_at']:  # the enquiry was removed under the keeping rules: never start work for it, refund instead
        cur = c.execute("UPDATE orders SET status='refund_due',paid_at=CURRENT_TIMESTAMP,confirmed_by=? WHERE id=? AND status IN ('pending','awaiting_confirmation')", (actor, order['id']))
        if cur.rowcount:
            log(c, actor, 'order.refund_due', 'orders', order['id'], order['reference'] + ' paid for a removed enquiry')
        return False
    cur = c.execute("UPDATE orders SET status='paid',paid_at=CURRENT_TIMESTAMP,confirmed_by=? WHERE id=? AND status IN ('pending','awaiting_confirmation')", (actor, order['id']))
    if not cur.rowcount:
        return False
    for line in c.execute('''SELECT l.rec_item_id,l.price_minor,r.package_id,p.name,p.venture,p.onboarding FROM order_lines l
                             JOIN rec_items r ON r.id=l.rec_item_id JOIN packages p ON p.id=r.package_id WHERE l.order_id=?''', (order['id'],)).fetchall():
        status = 'awaiting_onboarding' if json.loads(line['onboarding']) else 'onboarding_received'
        c.execute('''INSERT OR IGNORE INTO engagements(client_id,order_id,rec_item_id,package_id,name,venture,price_minor,status)
                     VALUES(?,?,?,?,?,?,?,?)''', (order['client_id'], order['id'], line['rec_item_id'], line['package_id'],
                                                  line['name'], line['venture'], line['price_minor'], status))
    # monthly services: the first month is paid now, the next falls due in a month at the agreed monthly fee
    start = today()
    for line in c.execute('''SELECT l.rec_item_id,l.price_minor,r.renewal_minor,p.name FROM order_lines l JOIN rec_items r ON r.id=l.rec_item_id
                             JOIN packages p ON p.id=r.package_id WHERE l.order_id=? AND p.basis='monthly' ''', (order['id'],)).fetchall():
        eng = c.execute('SELECT id FROM engagements WHERE rec_item_id=?', (line['rec_item_id'],)).fetchone()
        fee = line['renewal_minor'] or line['price_minor']
        old = c.execute('SELECT id,status FROM subscriptions WHERE rec_item_id=?', (line['rec_item_id'],)).fetchone()
        if old:  # bought again after it ended: start it again
            c.execute("""UPDATE subscriptions SET status='active',cancel_at=NULL,failures=0,amount_minor=?,method=?,next_due=?,bill_day=?,
                         last_paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                      (fee, order['method'] or 'transfer', add_month(start).isoformat(), start.day, old['id']))
            continue
        c.execute('''INSERT INTO subscriptions(client_id,engagement_id,rec_item_id,name,amount_minor,method,next_due,bill_day,last_paid_at)
                     VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)''', (order['client_id'], eng['id'] if eng else None, line['rec_item_id'], line['name'],
                                                                   fee, order['method'] or 'transfer', add_month(start).isoformat(), start.day))
    c.execute("UPDATE clients SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('new','reviewing','recommended')", (order['client_id'],))
    log(c, actor, 'order.paid', 'orders', order['id'], order['reference'])
    return True


def paystack(method, path, payload=None):
    req = urllib.request.Request('https://api.paystack.co' + path, method=method,
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={'Authorization': 'Bearer ' + PAYSTACK_SECRET, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode())
    except (urllib.error.URLError, ValueError, TimeoutError):
        raise HTTPException(502, 'the payment service is not responding. please try again in a moment')


@app.post('/api/client/checkout')
@payment_operation
def checkout(body: CheckoutIn, me=Depends(client)):
    if not body.accept_terms:
        raise HTTPException(400, 'please read and accept the terms to continue')
    if body.method == 'transfer' and not BANK_DETAILS.strip():
        raise HTTPException(400, 'bank transfer is not configured. please contact the desk')
    with connect() as c:
        rec = c.execute("SELECT * FROM recommendations WHERE client_id=? AND status='published'", (me['id'],)).fetchone()
        if not rec:
            raise HTTPException(409, 'your recommendation is not ready yet')
        chosen = sorted(set(body.items))
        rows = c.execute(f'''SELECT * FROM rec_items WHERE recommendation_id=? AND id IN ({','.join('?' * len(chosen))})''',
                         (rec['id'], *chosen)).fetchall()
        if len(rows) != len(chosen):
            raise HTTPException(400, 'one of the packages is no longer available. please refresh')
        if c.execute("SELECT 1 FROM orders WHERE client_id=? AND kind='purchase' AND status='awaiting_confirmation'", (me['id'],)).fetchone():
            raise HTTPException(409, 'we are still confirming your last payment. once it is confirmed, you can choose more')
        ended = {r[0] for r in c.execute("SELECT rec_item_id FROM subscriptions WHERE client_id=? AND status='cancelled'", (me['id'],))}
        owned = {r[0] for r in c.execute('SELECT rec_item_id FROM engagements WHERE client_id=?', (me['id'],))} - ended
        if owned & set(chosen):
            raise HTTPException(409, 'you already have one of these packages')
        all_items = [dict(r) for r in c.execute('''SELECT ri.id,ri.client_has,p.code,p.grp,p.name,p.requires FROM rec_items ri JOIN packages p ON p.id=ri.package_id
                                                   WHERE ri.recommendation_id=?''', (rec['id'],))]
        by_id = {i['id']: i for i in all_items}
        if any(r['quote'] == 'ask' for r in rows):
            raise HTTPException(400, 'we send you the route and the fee for this first. tap get my route')
        unapproved = c.execute(f'''SELECT p.name FROM rec_items ri JOIN packages p ON p.id=ri.package_id WHERE ri.id IN ({','.join('?' * len(chosen))})
                                    AND ri.quote='fixed' AND p.price_status!='approved' ''', chosen).fetchone()
        if any(r['assess'] == 'verify' for r in rows) or unapproved:
            raise HTTPException(400, 'we are still checking one of these for you. we will confirm it before you can choose it')
        # choose one: a registration type or scuml category can only be chosen once
        taken = {}
        for i in all_items:
            if i['grp'] and (i['id'] in owned or i['client_has']):
                taken[i['grp']] = i['name']
        for r in rows:
            g = by_id[r['id']]['grp']
            if not g:
                continue
            if g in taken:
                raise HTTPException(409, f"you can choose one of these. you already chose {taken[g]}")
            taken[g] = by_id[r['id']]['name']
        # needs first: an item that depends on another in your roadmap needs it chosen, bought or already in place
        covered_codes = {by_id[i]['code'] for i in (owned | set(chosen) | {i['id'] for i in all_items if i['client_has']}) if i in by_id}
        present = {i['code'] for i in all_items}
        for r in rows:
            for req in json.loads(by_id[r['id']]['requires'] or '[]'):
                if req in present and req not in covered_codes:
                    need = next(i['name'] for i in all_items if i['code'] == req)
                    raise HTTPException(400, f"please add {need} too. it is needed before {by_id[r['id']]['name']}")
        # one open order at a time: replace an unpaid one (monthly invoices are separate and stay)
        for o in c.execute("SELECT id FROM orders WHERE client_id=? AND kind='purchase' AND status='pending'", (me['id'],)).fetchall():
            c.execute("UPDATE orders SET status='cancelled' WHERE id=?", (o['id'],))
        pr = pricing(c)
        taxable = {r['id']: r['vat'] for r in c.execute(f'''SELECT ri.id,p.vat FROM rec_items ri JOIN packages p ON p.id=ri.package_id WHERE ri.id IN ({','.join('?' * len(chosen))})''', chosen)}
        subtotal = sum(r['price_minor'] for r in rows)
        vat = sum(vat_of(r['price_minor'], taxable[r['id']], pr) for r in rows)
        total = subtotal + vat
        reference = new_ref(c, 'orders', 'reference', 'HZP-')
        cur = c.execute('''INSERT INTO orders(client_id,reference,total_minor,method,subtotal_minor,vat_minor,terms_version,proposal_version,accepted_at)
                           VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)''',
                        (me['id'], reference, total, body.method, subtotal, vat, TERMS_VERSION, proposal_version(c, rec)))
        for r in rows:
            c.execute('INSERT INTO order_lines(order_id,rec_item_id,price_minor) VALUES(?,?,?)', (cur.lastrowid, r['id'], r['price_minor']))
        log(c, 'client', 'order.created', 'orders', cur.lastrowid, f'{reference} {total}')
        order_id = cur.lastrowid
        email = (body.email or me['email']).strip().lower()
        if body.method == 'paystack':
            if not PAYSTACK_SECRET:
                raise HTTPException(400, 'card payment is not available yet. please choose bank transfer')
            if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
                raise HTTPException(400, 'please enter your email for the payment receipt')
            if email != me['email']:
                c.execute('UPDATE clients SET email=? WHERE id=?', (email, me['id']))
    if body.method == 'paystack':
        callback = (BASE_URL or '') + '/pay/callback'
        res = paystack('POST', '/transaction/initialize', {'email': email, 'amount': total, 'reference': reference,
                                                           'currency': 'NGN', 'callback_url': callback,
                                                           'metadata': {'hamzury_id': me['ref']}})
        if not res.get('status'):
            raise HTTPException(502, 'we could not start the payment. please try again')
        return {'order_id': order_id, 'reference': reference, 'total_minor': total, 'subtotal_minor': subtotal, 'vat_minor': vat, 'redirect': res['data']['authorization_url']}
    return {'order_id': order_id, 'reference': reference, 'total_minor': total, 'subtotal_minor': subtotal, 'vat_minor': vat, 'redirect': None}


class HaveIn(BaseModel):
    has: bool


@app.post('/api/client/items/{item_id}/have')
def item_have(item_id: int, body: HaveIn, me=Depends(client)):
    """The client tells us they already have this, so it stops blocking the next level. The desk sees it."""
    with connect() as c:
        it = c.execute('''SELECT r.* FROM rec_items r JOIN recommendations rc ON rc.id=r.recommendation_id
                          WHERE r.id=? AND rc.client_id=? AND rc.status='published' ''', (item_id, me['id'])).fetchone()
        if not it:
            raise HTTPException(404, 'record not found')
        if c.execute('SELECT 1 FROM engagements WHERE rec_item_id=?', (item_id,)).fetchone():
            raise HTTPException(409, 'this is already in your plan')
        c.execute('UPDATE rec_items SET client_has=?,client_saved=0 WHERE id=?', (int(body.has), item_id))
        log(c, 'client', 'item.has' if body.has else 'item.has_undone', 'clients', me['id'], str(item_id))
    return {'ok': True}


class RouteIn(BaseModel):
    answers: dict[str, str] = Field(default_factory=dict, max_length=12)


@app.post('/api/client/items/{item_id}/request')
def item_request(item_id: int, body: RouteIn, me=Depends(client)):
    """For items we do not quote up front (renewals, tax, changes): the client answers a few questions, the desk replies with the route and fee."""
    answers = {str(k)[:200]: str(v).strip()[:1500] for k, v in body.answers.items() if str(v).strip()}
    if not answers:
        raise HTTPException(400, 'please answer at least one question')
    with connect() as c:
        it = c.execute('''SELECT r.* FROM rec_items r JOIN recommendations rc ON rc.id=r.recommendation_id
                          WHERE r.id=? AND rc.client_id=? AND rc.status='published' ''', (item_id, me['id'])).fetchone()
        if not it:
            raise HTTPException(404, 'record not found')
        c.execute('UPDATE rec_items SET request=?,requested_at=CURRENT_TIMESTAMP WHERE id=?', (json.dumps(answers), item_id))
        log(c, 'client', 'route.requested', 'clients', me['id'], str(item_id))
    return {'ok': True}


class SaveIn(BaseModel):
    saved: bool


@app.post('/api/client/items/{item_id}/save')
def item_save(item_id: int, body: SaveIn, me=Depends(client)):
    with connect() as c:
        it = c.execute('''SELECT r.id FROM rec_items r JOIN recommendations rc ON rc.id=r.recommendation_id
                          WHERE r.id=? AND rc.client_id=? AND rc.status='published' ''', (item_id, me['id'])).fetchone()
        if not it:
            raise HTTPException(404, 'record not found')
        c.execute('UPDATE rec_items SET client_saved=? WHERE id=?', (int(body.saved), item_id))
    return {'ok': True}


class TransferIn(BaseModel):
    note: str = Field(default='', max_length=300)


@app.post('/api/client/orders/{order_id}/transfer')
@payment_operation
def transfer_sent(order_id: int, body: TransferIn, me=Depends(client)):
    with connect() as c:
        o = one(c, 'orders', order_id)
        if o['client_id'] != me['id']:
            raise HTTPException(404, 'record not found')
        if o['status'] not in ('pending', 'awaiting_confirmation'):
            raise HTTPException(409, 'this payment is already closed')
        if o['method'] == 'paystack':
            raise HTTPException(409, 'check the card payment first. do not send another payment against this reference')
        c.execute("UPDATE orders SET status='awaiting_confirmation',method='transfer',transfer_note=? WHERE id=?", (body.note.strip(), order_id))
        log(c, 'client', 'order.transfer_reported', 'orders', order_id, body.note)
    return {'ok': True}


@app.post('/api/client/orders/{order_id}/check')
def check_client_payment(order_id: int, request: Request, me=Depends(client)):
    throttle('payment_check', request, 30, 300)
    with connect() as c:
        o = one(c, 'orders', order_id)
        if o['client_id'] != me['id']:
            raise HTTPException(404, 'record not found')
        if o['method'] != 'paystack' or not PAYSTACK_SECRET:
            raise HTTPException(400, 'this payment does not use card verification')
    verify_paystack(o['reference'])
    with connect() as c:
        return {'status': one(c, 'orders', order_id)['status']}


@payment_operation
def verify_paystack(reference):
    with connect() as c:
        o = c.execute('SELECT * FROM orders WHERE reference=?', (reference,)).fetchone()
        if not o:
            return None
        if o['status'] == 'paid':
            return o
    res = paystack('GET', '/transaction/verify/' + urllib.parse.quote(reference))
    d = res.get('data') or {}
    with connect() as c:
        o = c.execute('SELECT * FROM orders WHERE reference=?', (reference,)).fetchone()
        if res.get('status') and d.get('status') == 'success' and int(d.get('amount', -1)) == o['total_minor'] and d.get('currency') == 'NGN':
            recorded = mark_paid(c, o, 'paystack')
            auth = d.get('authorization') or {}
            if recorded and auth.get('reusable') and auth.get('authorization_code'):
                # the card is kept for the monthly services paid in this payment only, which the client chose to pay by card
                c.execute('UPDATE clients SET pay_auth=? WHERE id=?', (auth['authorization_code'], o['client_id']))
                c.execute('''UPDATE subscriptions SET method='paystack' WHERE status!='cancelled' AND (id=? OR rec_item_id IN (SELECT rec_item_id FROM order_lines WHERE order_id=?))''',
                          (o['subscription_id'], o['id']))
        return o


@app.get('/pay/callback')
def pay_callback(reference: str = ''):
    o = None
    if PAYSTACK_SECRET and re.fullmatch(r'HZP-[A-Z0-9]{6}', reference):
        o = verify_paystack(reference)
    renewal = bool(o) and o['kind'] == 'renewal'
    return RedirectResponse('/track' if renewal else '/track#progress', status_code=303)


@app.post('/api/paystack/webhook')
async def paystack_webhook(request: Request):
    raw = await request.body()
    sig = request.headers.get('x-paystack-signature', '')
    if not PAYSTACK_SECRET or not hmac.compare_digest(hmac.new(PAYSTACK_SECRET.encode(), raw, hashlib.sha512).hexdigest(), sig):
        raise HTTPException(401, 'invalid signature')
    event = json.loads(raw or b'{}')
    if event.get('event') == 'charge.success':
        ref = (event.get('data') or {}).get('reference', '')
        if re.fullmatch(r'HZP-[A-Z0-9]{6}', ref):
            await run_in_threadpool(verify_paystack, ref)  # re-verify without blocking other requests
    return {'ok': True}


GRACE_DAYS = 7          # a missed monthly payment pauses the service after this many days
INVOICE_AHEAD_DAYS = 3  # transfer payers get their invoice this many days before the due date
RETRY_EVERY_DAYS = 2    # a declined card is tried again every two days inside the grace period
BILLING_KEY = os.getenv('HAMZURY_BILLING_KEY', '')


def renewal_order(c, s, method):
    ref = new_ref(c, 'orders', 'reference', 'HZP-')
    taxable = c.execute('SELECT p.vat FROM rec_items r JOIN packages p ON p.id=r.package_id WHERE r.id=?', (s['rec_item_id'],)).fetchone()
    vat = vat_of(s['amount_minor'], taxable['vat'] if taxable else 1, pricing(c))
    cur = c.execute("INSERT INTO orders(client_id,reference,total_minor,method,kind,subscription_id,subtotal_minor,vat_minor,renewal_period) VALUES(?,?,?,?,'renewal',?,?,?,?)",
                    (s['client_id'], ref, s['amount_minor'] + vat, method, s['id'], s['amount_minor'], vat, s['next_due']))
    c.execute('INSERT INTO order_lines(order_id,rec_item_id,price_minor) VALUES(?,?,?)', (cur.lastrowid, s['rec_item_id'], s['amount_minor']))
    return c.execute('SELECT * FROM orders WHERE id=?', (cur.lastrowid,)).fetchone()


@payment_operation
def billing_run(day, actor='billing'):
    """the daily monthly-services run. safe to run more than once a day.
    card on file: charged on the due date, retried every 2 days, paused after 7 days unpaid (only after at least one try).
    transfer: an invoice 3 days before the due date, reminders through the desk, paused after 7 days unpaid.
    cancelled: the service ends on its next due date, with no new charge.
    each subscription is its own short transaction, and calls to paystack happen outside any transaction."""
    out = {'charged': 0, 'invoiced': 0, 'declined': 0, 'paused': 0, 'ended': 0}
    with connect() as c:
        ids = [r[0] for r in c.execute("SELECT id FROM subscriptions WHERE status IN ('active','grace') ORDER BY id")]
    for sid in ids:
        with connect() as c:
            s = c.execute("SELECT s.*,cl.email,cl.pay_auth FROM subscriptions s JOIN clients cl ON cl.id=s.client_id WHERE s.id=? AND s.status IN ('active','grace')", (sid,)).fetchone()
            if not s:
                continue
            due = datetime.date.fromisoformat(s['next_due'])
            if s['cancel_at'] and datetime.date.fromisoformat(s['cancel_at']) <= day:
                c.execute("UPDATE subscriptions SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?", (sid,))
                c.execute("UPDATE orders SET status='cancelled' WHERE subscription_id=? AND status='pending'", (sid,))
                log(c, actor, 'subscription.ended', 'subscriptions', sid)
                out['ended'] += 1
                continue
            if s['cancel_at']:
                continue  # ending soon: no new invoice
            open_o = c.execute("SELECT * FROM orders WHERE subscription_id=? AND status IN ('pending','awaiting_confirmation') ORDER BY id DESC", (sid,)).fetchone()
            if open_o and open_o['status'] == 'awaiting_confirmation':
                continue  # a transfer waiting for our check is not their fault: no charge, no pause
            card = bool(s['method'] == 'paystack' and s['pay_auth'] and PAYSTACK_SECRET) and not (open_o and open_o['method'] == 'transfer')
            if day > due + datetime.timedelta(days=GRACE_DAYS) and (not card or s['failures'] > 0):
                c.execute("UPDATE subscriptions SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE id=?", (sid,))
                log(c, actor, 'subscription.paused', 'subscriptions', sid, f'unpaid since {due}')
                out['paused'] += 1
                continue
            if not card:
                if day >= due - datetime.timedelta(days=INVOICE_AHEAD_DAYS):
                    if not open_o:
                        renewal_order(c, s, 'transfer')
                        log(c, actor, 'renewal.invoiced', 'subscriptions', sid, str(due))
                        out['invoiced'] += 1
                    if day > due and s['status'] != 'grace':
                        c.execute("UPDATE subscriptions SET status='grace',updated_at=CURRENT_TIMESTAMP WHERE id=?", (sid,))
                continue
            if day < due:
                continue
            if open_o and time.time() - parse_ts(open_o['created_at']) < RETRY_EVERY_DAYS * 86400 - 3600:
                continue
            prev = dict(open_o) if open_o else None
        # before trying again, ask paystack what happened to the last attempt: never charge twice for one month
        if prev:
            try:
                v = paystack('GET', '/transaction/verify/' + urllib.parse.quote(prev['reference']))
            except HTTPException:
                continue
            vd = v.get('data') or {}
            if v.get('status') and vd.get('status') == 'success' and int(vd.get('amount', -1)) == prev['total_minor'] and vd.get('currency') == 'NGN':
                with connect() as c:
                    if mark_paid(c, c.execute('SELECT * FROM orders WHERE id=?', (prev['id'],)).fetchone(), 'paystack'):
                        out['charged'] += 1
                continue
            if not v.get('status') or vd.get('status') not in ('failed', 'abandoned', 'reversed'):
                continue  # still with the bank: wait for its answer
        with connect() as c:
            if prev:
                c.execute("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'", (prev['id'],))
            o = dict(renewal_order(c, s, 'paystack'))
        try:
            res = paystack('POST', '/transaction/charge_authorization', {'email': s['email'], 'amount': o['total_minor'], 'currency': 'NGN',
                                                                         'authorization_code': s['pay_auth'], 'reference': o['reference']})
        except HTTPException:
            res = {}
        d = res.get('data') or {}
        with connect() as c:
            if res.get('status') and d.get('status') == 'success' and int(d.get('amount', -1)) == o['total_minor'] and d.get('currency') == 'NGN':
                if mark_paid(c, c.execute('SELECT * FROM orders WHERE id=?', (o['id'],)).fetchone(), 'paystack'):
                    out['charged'] += 1
            else:  # declined, or waiting on the bank: the invoice stays open and the client can pay it themselves
                c.execute("UPDATE subscriptions SET status='grace',failures=failures+1,updated_at=CURRENT_TIMESTAMP WHERE id=?", (sid,))
                log(c, actor, 'renewal.declined', 'orders', o['id'], str(d.get('gateway_response') or d.get('status') or 'no response'))
                out['declined'] += 1
    return out


@app.post('/api/admin/billing/run')
def billing_run_now(user=Depends(money)):
    return billing_run(today(), user['username'])


@app.post('/api/billing/run')
def billing_run_cron(key: str | None = Header(None, alias='X-Billing-Key')):
    """for a daily scheduler: curl -X POST -H "X-Billing-Key: $HAMZURY_BILLING_KEY" https://hamzury.com/api/billing/run"""
    if not BILLING_KEY or not key or not hmac.compare_digest(key.encode('utf-8', 'ignore'), BILLING_KEY.encode()):
        raise HTTPException(401, 'invalid key')
    return billing_run(today())


def sub_view(s):
    return {k: s[k] for k in ('id', 'name', 'amount_minor', 'method', 'status', 'next_due', 'cancel_at', 'failures', 'last_paid_at')}


@app.post('/api/client/subscriptions/{sid}/cancel')
@payment_operation
def sub_cancel(sid: int, me=Depends(client)):
    """stops the next charge. the service runs to the end of the month already paid for."""
    with connect() as c:
        s = c.execute("SELECT * FROM subscriptions WHERE id=? AND client_id=? AND status!='cancelled'", (sid, me['id'])).fetchone()
        if not s:
            raise HTTPException(404, 'record not found')
        if s['status'] == 'paused':
            c.execute("UPDATE subscriptions SET status='cancelled',cancel_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?", (today().isoformat(), sid))
        else:
            c.execute('UPDATE subscriptions SET cancel_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (s['next_due'], sid))
        c.execute("UPDATE orders SET status='cancelled' WHERE subscription_id=? AND status='pending'", (sid,))
        log(c, 'client', 'subscription.cancel', 'subscriptions', sid)
        return sub_view(c.execute('SELECT * FROM subscriptions WHERE id=?', (sid,)).fetchone())


@app.post('/api/client/subscriptions/{sid}/keep')
@payment_operation
def sub_keep(sid: int, me=Depends(client)):
    """undo a cancel before it takes effect."""
    with connect() as c:
        s = c.execute("SELECT * FROM subscriptions WHERE id=? AND client_id=? AND status IN ('active','grace') AND cancel_at IS NOT NULL", (sid, me['id'])).fetchone()
        if not s:
            raise HTTPException(404, 'record not found')
        c.execute('UPDATE subscriptions SET cancel_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?', (sid,))
        log(c, 'client', 'subscription.keep', 'subscriptions', sid)
        return sub_view(c.execute('SELECT * FROM subscriptions WHERE id=?', (sid,)).fetchone())


class RenewPayIn(BaseModel):
    email: str = Field(default='', max_length=160)


@app.post('/api/client/orders/{order_id}/pay')
@payment_operation
def renewal_pay(order_id: int, body: RenewPayIn | None = None, me=Depends(client)):
    """pay an open monthly invoice by card. never renames a reference a bank may still be processing:
    if an earlier card attempt exists, ask paystack about it first, then open a fresh invoice for the new attempt."""
    if not PAYSTACK_SECRET:
        raise HTTPException(400, 'card payment is not available yet. please pay by bank transfer')
    email = ((body.email if body else '') or me['email'] or '').strip().lower()
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
        raise HTTPException(400, 'please enter your email for the payment receipt')
    with connect() as c:
        o = c.execute("SELECT * FROM orders WHERE id=? AND client_id=? AND kind='renewal' AND status='pending'", (order_id, me['id'])).fetchone()
        if not o:
            raise HTTPException(404, 'record not found')
        if email != (me['email'] or ''):
            c.execute('UPDATE clients SET email=? WHERE id=?', (email, me['id']))
    if o['method'] == 'paystack':
        v = paystack('GET', '/transaction/verify/' + urllib.parse.quote(o['reference']))
        vd = v.get('data') or {}
        if v.get('status') and vd.get('status') == 'success' and int(vd.get('amount', -1)) == o['total_minor'] and vd.get('currency') == 'NGN':
            with connect() as c:
                mark_paid(c, c.execute('SELECT * FROM orders WHERE id=?', (o['id'],)).fetchone(), 'paystack')
            raise HTTPException(409, 'this invoice is already paid. thank you')
        if not v.get('status') or vd.get('status') not in ('failed', 'abandoned', 'reversed'):
            raise HTTPException(409, 'your bank is still processing the last attempt. please check again in a few minutes')
        with connect() as c:
            s = c.execute('SELECT * FROM subscriptions WHERE id=?', (o['subscription_id'],)).fetchone()
            c.execute("UPDATE orders SET status='cancelled' WHERE id=? AND status='pending'", (o['id'],))
            o = dict(renewal_order(c, s, 'paystack'))
    else:
        with connect() as c:
            c.execute("UPDATE orders SET method='paystack' WHERE id=?", (o['id'],))
    res = paystack('POST', '/transaction/initialize', {'email': email, 'amount': o['total_minor'], 'reference': o['reference'], 'currency': 'NGN',
                                                       'callback_url': (BASE_URL or '') + '/pay/callback', 'metadata': {'hamzury_id': me['ref']}})
    if not res.get('status'):
        raise HTTPException(502, 'we could not start the payment. please try again')
    return {'redirect': res['data']['authorization_url']}


class RejectIn(BaseModel):
    note: str = Field(default='', max_length=300)


@app.post('/api/admin/orders/{oid}/reject')
@payment_operation
def reject_transfer(oid: int, body: RejectIn, user=Depends(money)):
    """the transfer the client reported has not arrived: the order goes back to waiting for payment."""
    with connect() as c:
        o = one(c, 'orders', oid)
        if o['status'] != 'awaiting_confirmation':
            raise HTTPException(409, 'this order is not waiting for a check')
        c.execute("UPDATE orders SET status='pending',transfer_note=? WHERE id=?", (('not received yet. ' + body.note.strip()).strip(), oid))
        log(c, user['username'], 'order.transfer_not_found', 'orders', oid, body.note)
    return {'ok': True}


@app.get('/api/admin/subscriptions')
def subs_list(user=Depends(money)):
    with connect() as c:
        rows = c.execute("""SELECT s.*,c.ref,c.name AS cname,c.business,c.phone FROM subscriptions s JOIN clients c ON c.id=s.client_id
                            ORDER BY CASE s.status WHEN 'grace' THEN 0 WHEN 'paused' THEN 1 WHEN 'active' THEN 2 ELSE 3 END, s.next_due""").fetchall()
        return [{**sub_view(s), 'client_id': s['client_id'], 'ref': s['ref'], 'client': s['cname'], 'business': s['business'], 'phone': s['phone']} for s in rows]


class SubPatch(BaseModel):
    status: Literal['active', 'paused', 'cancelled'] | None = None
    next_due: str | None = Field(None, pattern=r'^\d{4}-\d{2}-\d{2}$')


@app.patch('/api/admin/subscriptions/{sid}')
@payment_operation
def sub_patch(sid: int, body: SubPatch, user=Depends(money)):
    with connect() as c:
        one(c, 'subscriptions', sid)
        if body.next_due:
            try:
                datetime.date.fromisoformat(body.next_due)
            except ValueError:
                raise HTTPException(400, 'please enter a real date')
            c.execute('UPDATE subscriptions SET next_due=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (body.next_due, sid))
        if body.status:
            c.execute("UPDATE subscriptions SET status=?,cancel_at=CASE WHEN ?='active' THEN NULL ELSE cancel_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                      (body.status, body.status, sid))
            if body.status == 'cancelled':
                c.execute("UPDATE orders SET status='cancelled' WHERE subscription_id=? AND status='pending'", (sid,))
        log(c, user['username'], 'subscription.update', 'subscriptions', sid, body.model_dump_json(exclude_none=True))
        return sub_view(c.execute('SELECT * FROM subscriptions WHERE id=?', (sid,)).fetchone())


# ---------------------------------------------------------------- launch: settings, vat, finance, venture follow-up, retention, handover
TERMS_VERSION = '2026-11-07'
DEFAULT_SETTINGS = {'entity_name': 'hamzury holding', 'entity_rc': '', 'vat_registered': '0', 'vat_rate_bp': '750', 'vat_tin': ''}
FINANCE_CHECKS = [
    ('entity', 'confirm the company that invoices clients, and its tax treatment'),
    ('margins', 'review item costs, margins and the profit on monthly services'),
    ('invoices', 'approve the invoice layout and the categories in the records'),
    ('services', 'define the bookkeeping and tax services hamzury can responsibly offer'),
    ('dashboards', 'check the numbers and definitions on financial dashboards'),
]


def setting(c, key):
    r = c.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    return r['value'] if r else DEFAULT_SETTINGS.get(key, '')


def pricing(c):
    """what every bill shows: the invoicing company and whether vat applies. vat stays off until finance turns it on."""
    return {'entity_name': setting(c, 'entity_name'), 'entity_rc': setting(c, 'entity_rc'), 'vat_registered': setting(c, 'vat_registered') == '1',
            'vat_rate_bp': int(setting(c, 'vat_rate_bp') or 750), 'vat_tin': setting(c, 'vat_tin'), 'terms_version': TERMS_VERSION}


def vat_of(amount, taxable, pr):
    return (amount * pr['vat_rate_bp'] + 5000) // 10000 if pr['vat_registered'] and taxable else 0  # half up, as the page shows it


class SettingsIn(BaseModel):
    entity_name: str = Field(min_length=2, max_length=160)
    entity_rc: str = Field(default='', max_length=40)
    vat_registered: bool = False
    vat_rate_bp: int = Field(default=750, ge=0, le=2500)
    vat_tin: str = Field(default='', max_length=40)


@app.get('/api/admin/settings')
def get_settings(user=Depends(money)):
    with connect() as c:
        checks = json.loads(setting(c, 'finance_checks') or '{}')
        return {**pricing(c), 'finance_checks': [{'key': k, 'label': l, **checks.get(k, {'done': False})} for k, l in FINANCE_CHECKS]}


@app.put('/api/admin/settings')
def put_settings(body: SettingsIn, user=Depends(finance_or_owner)):
    with connect() as c:
        for k, v in (('entity_name', body.entity_name.strip()), ('entity_rc', body.entity_rc.strip()), ('vat_registered', '1' if body.vat_registered else '0'),
                     ('vat_rate_bp', str(body.vat_rate_bp)), ('vat_tin', body.vat_tin.strip())):
            c.execute('INSERT INTO settings(key,value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
                      (k, v, user['username']))
        log(c, user['username'], 'settings.money', 'settings', 0, body.model_dump_json())
    return get_settings(user)


class CheckIn(BaseModel):
    done: bool
    note: str = Field(default='', max_length=400)


@app.put('/api/admin/finance-checks/{key}')
def put_check(key: str, body: CheckIn, user=Depends(finance_or_owner)):
    if key not in dict(FINANCE_CHECKS):
        raise HTTPException(404, 'record not found')
    with connect() as c:
        checks = json.loads(setting(c, 'finance_checks') or '{}')
        checks[key] = {'done': body.done, 'note': body.note.strip(), 'by': user['display_name'], 'at': today().isoformat()}
        c.execute("INSERT INTO settings(key,value,updated_by,updated_at) VALUES('finance_checks',?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  (json.dumps(checks), user['username']))
        log(c, user['username'], 'finance.check', 'settings', 0, f'{key} {body.done}')
    return {'ok': True}


class VatFlagIn(BaseModel):
    vat: bool


@app.patch('/api/admin/packages/{pid}/vat')
def package_vat(pid: int, body: VatFlagIn, user=Depends(money)):
    """finance classifies each service: vat applies to our professional fee, or it does not."""
    with connect() as c:
        one(c, 'packages', pid)
        c.execute('UPDATE packages SET vat=? WHERE id=?', (int(body.vat), pid))
        log(c, user['username'], 'package.vat', 'packages', pid, str(body.vat))
    return {'ok': True}


@app.post('/api/admin/orders/{oid}/refunded')
@payment_operation
def order_refunded(oid: int, user=Depends(money)):
    with connect() as c:
        o = one(c, 'orders', oid)
        if o['status'] != 'refund_due':
            raise HTTPException(409, 'this payment is not waiting for a refund')
        c.execute("UPDATE orders SET status='refunded',refunded_at=CURRENT_TIMESTAMP WHERE id=?", (oid,))
        log(c, user['username'], 'order.refunded', 'orders', oid, o['reference'])
    return {'ok': True}


def proposal_version(c, rec):
    """identifies exactly what was accepted: the published plan and a fingerprint of its items, prices and advice."""
    rows = c.execute('SELECT id,package_id,price_minor,quote,renewal_minor FROM rec_items WHERE recommendation_id=? ORDER BY id', (rec['id'],)).fetchall()
    raw = json.dumps([rec['advice'], [list(r) for r in rows]], sort_keys=True)
    return f"{rec['id']}-{(rec['published_at'] or '')[:10]}-{hashlib.sha256(raw.encode()).hexdigest()[:10]}"


@app.get('/api/admin/money')
def money_overview(user=Depends(money)):
    """the finance desk's today page."""
    with connect() as c:
        q = lambda sql, *a: c.execute(sql, a).fetchone()[0]
        return {
            'transfers_to_confirm': q("SELECT COUNT(*) FROM orders WHERE status='awaiting_confirmation'"),
            'refunds_due': q("SELECT COUNT(*) FROM orders WHERE status='refund_due'"),
            'paid_this_month_minor': q("SELECT COALESCE(SUM(total_minor),0) FROM orders WHERE status='paid' AND paid_at>=date('now','start of month')"),
            'vat_this_month_minor': q("SELECT COALESCE(SUM(vat_minor),0) FROM orders WHERE status='paid' AND paid_at>=date('now','start of month')"),
            'monthly_active': q("SELECT COUNT(*) FROM subscriptions WHERE status IN ('active','grace')"),
            'monthly_due_minor': q("SELECT COALESCE(SUM(amount_minor),0) FROM subscriptions WHERE status IN ('active','grace') AND cancel_at IS NULL"),
            'monthly_overdue': q("SELECT COUNT(*) FROM subscriptions WHERE status='grace'"),
            'paused': q("SELECT COUNT(*) FROM subscriptions WHERE status='paused'"),
            'prices_to_approve': q("SELECT COUNT(*) FROM packages WHERE active=1 AND price_status!='approved' AND basis!='quote'"),
        }


# ---- venture follow-up: every assigned job has an update rhythm, and the holding sees who is late

def days_in(duration):
    m = re.match(r'(?:within\s+)?(\d+)\s*(?:to\s*\d+\s*)?(day|week)', (duration or '').strip())
    if not m:
        return 0
    return int(m.group(1)) * (7 if m.group(2) == 'week' else 1)


def eng_follow(c, e):
    """update rhythm for one job: when the next venture update is due, and whether the job is past its due date."""
    out = {'update_state': 'not_required', 'update_due_at': None, 'past_due': False}
    if e['status'] == 'delivered':
        return out
    if e['due_date'] and e['due_date'] < today().isoformat():
        out['past_due'] = True
    if e['status'] in ('awaiting_onboarding', 'review') or not e['assigned_user_id']:  # review: the venture is waiting on holding's final check
        return out
    last = c.execute('SELECT MAX(created_at) FROM reports WHERE engagement_id=?', (e['id'],)).fetchone()[0]
    base = max(parse_ts(x) or 0 for x in (last, e['assigned_at'], e['onboarding_at'], e['created_at']))
    due = base + UPDATE_HOURS * 3600
    left = due - time.time()
    out['update_due_at'] = datetime.datetime.fromtimestamp(due + 3600, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')  # nigeria time
    out['update_state'] = 'overdue' if left <= 0 else 'due_soon' if left <= UPDATE_HOURS * 900 else 'on_track'
    return out


@app.post('/api/client/engagements/{eid}/ask')
def client_ask_update(eid: int, me=Depends(client)):
    """the client asks for an update. the holding and the venture both see it at once."""
    with connect() as c:
        e = c.execute('SELECT * FROM engagements WHERE id=? AND client_id=?', (eid, me['id'])).fetchone()
        if not e or e['status'] == 'delivered':
            raise HTTPException(404, 'record not found')
        if e['update_requested_at'] and hours_since(e['update_requested_at']) < 24:
            raise HTTPException(429, 'you asked today. we will reply soon')
        c.execute('UPDATE engagements SET update_requested_at=CURRENT_TIMESTAMP WHERE id=?', (eid,))
        log(c, 'client', 'update.requested', 'engagements', eid)
    return {'ok': True}


@app.get('/api/admin/scoreboard')
def scoreboard(user=Depends(holding)):
    """per venture: open work, late updates, late jobs, and delivery against the date we promised."""
    out = {v: {'venture': v, 'open': 0, 'unassigned': 0, 'updates_overdue': 0, 'past_due': 0, 'asked_by_client': 0, 'delivered': 0, 'on_time': 0, 'returned_reports': 0, 'days': []}
           for v in VENTURES}
    with connect() as c:
        for e in c.execute('SELECT * FROM engagements').fetchall():
            s = out.get(e['venture'])
            if not s:
                continue
            if e['status'] == 'delivered':
                s['delivered'] += 1
                if not e['due_date'] or (e['delivered_at'] or '')[:10] <= e['due_date']:
                    s['on_time'] += 1
                start = parse_ts(e['assigned_at'] or e['onboarding_at'] or e['created_at'])
                if start and parse_ts(e['delivered_at']):
                    s['days'].append((parse_ts(e['delivered_at']) - start) / 86400)
                continue
            s['open'] += 1
            s['unassigned'] += 0 if e['assigned_user_id'] else 1
            f = eng_follow(c, e)
            s['updates_overdue'] += f['update_state'] == 'overdue'
            s['past_due'] += f['past_due']
            s['asked_by_client'] += bool(e['update_requested_at'])
        for r in c.execute("SELECT e.venture,COUNT(*) n FROM reports r JOIN engagements e ON e.id=r.engagement_id WHERE r.status='returned' GROUP BY e.venture"):
            if r['venture'] in out:
                out[r['venture']]['returned_reports'] = r['n']
    for s in out.values():
        d = s.pop('days')
        s['avg_days'] = round(sum(d) / len(d), 1) if d else None
    return list(out.values())


SECRET_WORDS = re.compile(r'\b(pass\s*words?|passwords?|passcode|pwd|pin|otp|secret\s*key)\b', re.I)


class HandoverIn(BaseModel):
    accounts: list[dict[str, str]] = Field(default_factory=list, max_length=30)
    copies_given: bool = False
    client_owns_accounts: bool = False
    sent_securely: bool = False
    staff_access_removed: bool = False
    notes: str = Field(default='', max_length=1500)


@app.put('/api/admin/engagements/{eid}/handover')
def save_handover(eid: int, body: HandoverIn, user=Depends(staff)):
    """what the client now owns: logins (addresses and account emails only, never passwords), who owns recovery, and that our access is removed."""
    accts = []
    for a in body.accounts:
        row = {k: str(a.get(k, '')).strip()[:200] for k in ('service', 'login_url', 'account_email', 'recovery_owner')}
        if SECRET_WORDS.search(' '.join(row.values())):
            raise HTTPException(400, 'never write passwords here. send them through an invitation or a password manager')
        if row['service']:
            accts.append(row)
    if SECRET_WORDS.search(body.notes):
        raise HTTPException(400, 'never write passwords here. send them through an invitation or a password manager')
    with connect() as c:
        e = access_engagement(c, user, eid)
        data = {**body.model_dump(), 'accounts': accts, 'by': user['display_name'], 'at': today().isoformat()}
        c.execute('UPDATE engagements SET handover=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (json.dumps(data), e['id']))
        log(c, user['username'], 'handover.saved', 'engagements', eid)
    return {'ok': True}


class HoldIn(BaseModel):
    hold: bool


@app.post('/api/admin/clients/{cid}/hold')
def client_hold(cid: int, body: HoldIn, user=Depends(owner)):
    """a keep flag: legal or required retention. routine deletion skips this client."""
    with connect() as c:
        one(c, 'clients', cid)
        c.execute('UPDATE clients SET hold=? WHERE id=?', (int(body.hold), cid))
        log(c, user['username'], 'client.hold', 'clients', cid, str(body.hold))
    return {'ok': True}


ENQUIRY_DAYS = 90       # abandoned enquiries (never paid, no activity) are removed after 90 days
UPLOAD_DAYS = 90        # client uploads (including id documents) are removed 90 days after the work is delivered
DELIVERED_DAYS = 365    # delivered files stay in the portal 12 months after handover, or while a monthly service is active
NOTICE_DAYS = 30        # clients are reminded 30 days before delivered files are removed


def remove_file(stored):
    if stored:
        try:
            p = (FILES / stored).resolve()
            if p.parent == FILES.resolve() and p.exists():
                p.unlink()
        except OSError:
            pass


@storage_operation
def retention_run(day, actor='retention'):
    """scheduled deletion, never indefinite storage. invoices, payments, contracts and the audit log are kept on their own schedule."""
    out = {'enquiries_removed': 0, 'uploads_removed': 0, 'files_removed': 0}
    cutoff = lambda d: (day - datetime.timedelta(days=d)).isoformat()
    with connect() as c:
        for cl in c.execute('''SELECT * FROM clients WHERE hold=0 AND purged_at IS NULL AND status IN ('new','reviewing','recommended','closed')
                               AND substr(updated_at,1,10) < ? AND substr(COALESCE(last_seen_at,'0'),1,10) < ? AND substr(created_at,1,10) < ?
                               AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=clients.id AND (o.status!='cancelled' OR substr(o.created_at,1,10) >= ?))
                               AND NOT EXISTS (SELECT 1 FROM engagements e WHERE e.client_id=clients.id)
                               AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.client_id=clients.id AND substr(r.updated_at,1,10) >= ?)''',
                            (cutoff(ENQUIRY_DAYS),) * 5).fetchall():
            c.execute('''UPDATE clients SET name='removed',business='',phone='',phone_key=?,email='',intake='{}',status='closed',purged_at=CURRENT_TIMESTAMP WHERE id=?''',
                      ('removed-' + str(cl['id']), cl['id']))
            c.execute("UPDATE clients SET notes='' WHERE id=?", (cl['id'],))
            c.execute('DELETE FROM client_sessions WHERE client_id=?', (cl['id'],))
            c.execute('DELETE FROM client_links WHERE client_id=?', (cl['id'],))
            c.execute('DELETE FROM updates WHERE client_id=?', (cl['id'],))
            c.execute("UPDATE recommendations SET heard='',advice='' WHERE client_id=?", (cl['id'],))
            c.execute('''UPDATE rec_items SET note='',request='' WHERE recommendation_id IN (SELECT id FROM recommendations WHERE client_id=?)''', (cl['id'],))
            log(c, actor, 'retention.enquiry', 'clients', cl['id'], 'no activity for 90 days')
            out['enquiries_removed'] += 1
        for e in c.execute('''SELECT e.* FROM engagements e JOIN clients cl ON cl.id=e.client_id WHERE cl.hold=0 AND e.status='delivered'
                              AND e.attachments_purged_at IS NULL AND substr(e.delivered_at,1,10) < ?''', (cutoff(UPLOAD_DAYS),)).fetchall():
            for f in json.loads(e['attachments'] or '{}').values():
                remove_file(f.get('stored'))
            c.execute("UPDATE engagements SET attachments='{}',attachments_purged_at=CURRENT_TIMESTAMP WHERE id=?", (e['id'],))
            log(c, actor, 'retention.uploads', 'engagements', e['id'], '90 days after delivery')
            out['uploads_removed'] += 1
        for e in c.execute('''SELECT e.* FROM engagements e JOIN clients cl ON cl.id=e.client_id WHERE cl.hold=0 AND e.status='delivered' AND e.file_path IS NOT NULL
                              AND e.file_purged_at IS NULL AND substr(e.delivered_at,1,10) < ?
                              AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.client_id=e.client_id AND s.status IN ('active','grace','paused'))''', (cutoff(DELIVERED_DAYS),)).fetchall():
            remove_file(e['file_path'])
            c.execute('UPDATE engagements SET file_path=NULL,file_purged_at=CURRENT_TIMESTAMP WHERE id=?', (e['id'],))
            log(c, actor, 'retention.delivered', 'engagements', e['id'], '12 months after handover')
            out['files_removed'] += 1
    return out


@app.post('/api/admin/retention/run')
def retention_now(user=Depends(owner)):
    return retention_run(today(), user['username'])


@app.post('/api/daily/run')
def daily_run(key: str | None = Header(None, alias='X-Billing-Key')):
    """one daily call for the scheduler: monthly billing, then scheduled deletion."""
    if not BILLING_KEY or not key or not hmac.compare_digest(key.encode('utf-8', 'ignore'), BILLING_KEY.encode()):
        raise HTTPException(401, 'invalid key')
    return {'billing': billing_run(today()), 'retention': retention_run(today())}


class OnboardingIn(BaseModel):
    answers: dict[str, str] = Field(max_length=40)


def validate_upload(name, data):
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_UPLOADS or not data or len(data) > MAX_UPLOAD:
        raise HTTPException(400, 'choose a supported, non-empty file of 25 mb or less')
    valid = True
    if ext == '.pdf':
        valid = data.startswith(b'%PDF-')
    elif ext in ('.png', '.jpg', '.jpeg'):
        try:
            with Image.open(io.BytesIO(data)) as im:
                valid = im.format == ('PNG' if ext == '.png' else 'JPEG') and im.width * im.height <= 40_000_000
                im.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            valid = False
    elif ext in ('.doc', '.xls', '.ppt'):
        valid = data.startswith(bytes.fromhex('D0CF11E0A1B11AE1'))
    elif ext in ('.docx', '.xlsx', '.pptx', '.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                paths = {i.filename for i in entries}
                valid = len(entries) <= 2000 and sum(i.file_size for i in entries) <= 100 * 1024 * 1024
                for item in entries:
                    parts = item.filename.replace('\\', '/').split('/')
                    if (item.flag_bits & 1 or item.filename.startswith(('/', '\\')) or '..' in parts
                        or ':' in item.filename or (item.external_attr >> 16) & 0o170000 == 0o120000
                        or Path(item.filename).suffix.lower() in {'.exe', '.dll', '.bat', '.cmd', '.ps1', '.js', '.vbs', '.sh', '.com', '.scr'}
                        or 'vbaproject.bin' in item.filename.lower()):
                        valid = False
                required = {'.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml'}.get(ext)
                if required:
                    valid = valid and required in paths and '[Content_Types].xml' in paths
                if valid:
                    valid = archive.testzip() is None
        except (zipfile.BadZipFile, RuntimeError, OSError, NotImplementedError):
            valid = False
    else:
        try:
            text = data.decode('utf-8-sig')
            valid = '\x00' not in text and not any(ord(c) < 32 and c not in '\t\r\n' for c in text)
        except UnicodeDecodeError:
            valid = False
    if not valid:
        raise HTTPException(400, 'file contents do not match the type, or the archive contains unsafe content')
    if REQUIRE_SCAN:
        with tempfile.TemporaryDirectory(prefix='hamzury-scan-') as tmp:
            quarantine = Path(tmp) / ('upload' + ext)
            quarantine.write_bytes(data)
            try:
                result = subprocess.run([UPLOAD_SCANNER, '--no-summary', str(quarantine)], capture_output=True, timeout=60, check=False)
            except (OSError, subprocess.TimeoutExpired):
                raise HTTPException(503, 'file security scanner is unavailable. please try later')
            if result.returncode == 1:
                raise HTTPException(400, 'file failed the security scan')
            if result.returncode != 0:
                raise HTTPException(503, 'file security scanner is unavailable. please try later')


@app.post('/api/client/engagements/{eid}/onboarding')
def submit_onboarding(eid: int, body: OnboardingIn, me=Depends(client)):
    with connect() as c:
        e = one(c, 'engagements', eid)
        if e['client_id'] != me['id']:
            raise HTTPException(404, 'record not found')
        questions = json.loads(one(c, 'packages', e['package_id'])['onboarding'])
        answers = {}
        files = json.loads(e['attachments'] or '{}')
        for k, q in enumerate(questions):
            if q.get('kind') == 'file':
                f = files.get(str(k))
                if q.get('required', True) and not f:
                    raise HTTPException(400, 'please attach: ' + q['label'])
                answers[q['label']] = ('file: ' + f['name']) if f else ''
                continue
            v = str(body.answers.get(q['label'], '')).strip()[:3000]
            if q.get('required', True) and not v:
                raise HTTPException(400, 'please answer: ' + q['label'])
            answers[q['label']] = v
        status = 'onboarding_received' if e['status'] == 'awaiting_onboarding' else e['status']
        c.execute('UPDATE engagements SET onboarding=?,onboarding_at=CURRENT_TIMESTAMP,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                  (json.dumps(answers), status, eid))
        log(c, 'client', 'onboarding.received', 'engagements', eid)
    return {'ok': True}


@app.post('/api/client/engagements/{eid}/attachment')
async def client_attachment(eid: int, q: int = 0, file: UploadFile = File(...), me=Depends(client)):
    """the client attaches a document an onboarding requirement asks for. stored privately; only staff can open it."""
    name = Path(file.filename or 'document').name[:120]
    if Path(name).suffix.lower() not in ALLOWED_UPLOADS:
        raise HTTPException(400, 'please upload one of: ' + ', '.join(sorted(ALLOWED_UPLOADS)))
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, 'the file is larger than 25 mb')
    if not data:
        raise HTTPException(400, 'the file is empty')
    with connect() as c:
        e = one(c, 'engagements', eid)
        if e['client_id'] != me['id']:
            raise HTTPException(404, 'record not found')
        if e['status'] == 'delivered':
            raise HTTPException(409, 'this part is already delivered')
        questions = json.loads(one(c, 'packages', e['package_id'])['onboarding'])
        if not (0 <= q < len(questions)) or questions[q].get('kind') != 'file':
            raise HTTPException(400, 'this requirement does not take a file')
    await run_in_threadpool(validate_upload, name, data)
    return await run_in_threadpool(save_client_attachment, eid, q, name, data, me)


@storage_operation
def save_client_attachment(eid, q, name, data, me):
    with connect() as c:
        # Recheck after scanning: delivery may have completed during the scan.
        e = one(c, 'engagements', eid)
        if e['client_id'] != me['id'] or e['status'] == 'delivered':
            raise HTTPException(409, 'this work no longer accepts attachments')
        questions = json.loads(one(c, 'packages', e['package_id'])['onboarding'])
        if not (0 <= q < len(questions)) or questions[q].get('kind') != 'file':
            raise HTTPException(400, 'this requirement does not take a file')
        files = json.loads(e['attachments'] or '{}')
        stored = 'in-' + secrets.token_hex(16) + Path(name).suffix.lower()
        (FILES / stored).write_bytes(data)
        old = files.get(str(q))
        if old:
            op = (FILES / old['stored']).resolve()
            if FILES in op.parents and op.exists():
                op.unlink()
        files[str(q)] = {'stored': stored, 'name': name, 'size': len(data)}
        c.execute('UPDATE engagements SET attachments=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (json.dumps(files), eid))
        log(c, 'client', 'onboarding.file', 'engagements', eid, questions[q]['label'])
    return {'ok': True, 'name': name}


@app.get('/api/admin/engagements/{eid}/attachment/{q}')
def staff_attachment(eid: int, q: str, user=Depends(staff)):
    with connect() as c:
        e = access_engagement(c, user, eid)
    f = json.loads(e['attachments'] or '{}').get(q)
    if not f:
        raise HTTPException(404, 'no file')
    path = (FILES / f['stored']).resolve()
    if FILES not in path.parents or not path.exists():
        raise HTTPException(404, 'no file')
    return FileResponse(path, filename=f['name'], media_type=mimetypes.guess_type(f['name'])[0] or 'application/octet-stream')


@app.get('/api/client/engagements/{eid}/download')
def client_download(eid: int, me=Depends(client)):
    with connect() as c:
        e = one(c, 'engagements', eid)
    if e['client_id'] != me['id'] or e['status'] != 'delivered' or not e['file_path']:
        raise HTTPException(404, 'this file is not available yet')
    path = (FILES / e['file_path']).resolve()
    if FILES not in path.parents or not path.exists():
        raise HTTPException(404, 'this file is not available yet')
    return FileResponse(path, filename=e['file_name'], media_type=mimetypes.guess_type(e['file_name'])[0] or 'application/octet-stream')


# ---------------------------------------------------------------- admin: overview and clients
def update_state(row):
    if row['status'] != 'active':
        return 'not_required'
    last = parse_ts(row['last_update_at']) or parse_ts(row['created_at'])
    hours = (time.time() - last) / 3600 if last else UPDATE_HOURS
    return 'overdue' if hours >= UPDATE_HOURS else 'due_soon' if hours >= UPDATE_HOURS * .75 else 'on_track'


def venture_scope(user):
    if user['role'] == 'finance':
        raise HTTPException(403, 'the finance desk sees payments, not client work')
    return None if user['role'] in ROLE_HOLDING else user['venture']


@app.get('/api/admin/overview')
def overview(user=Depends(staff)):
    if user['role'] == 'finance':
        return {'finance': True}
    v = venture_scope(user)
    with connect() as c:
        if v:
            work = [dict(x) for x in c.execute("SELECT status,COUNT(*) n FROM engagements WHERE venture=? GROUP BY status", (v,))]
            mine = c.execute("SELECT COUNT(*) FROM engagements WHERE assigned_user_id=? AND status!='delivered'", (user['id'],)).fetchone()[0]
            returned = c.execute('''SELECT COUNT(*) FROM reports r JOIN engagements e ON e.id=r.engagement_id
                                    WHERE e.venture=? AND r.status='returned' ''', (v,)).fetchone()[0]
            waiting = c.execute('''SELECT COUNT(*) FROM reports r JOIN engagements e ON e.id=r.engagement_id
                                   WHERE e.venture=? AND r.status='submitted' ''', (v,)).fetchone()[0]
            return {'venture': v, 'work': work, 'assigned_to_me': mine, 'returned': returned, 'waiting_for_holding': waiting}
        clients = c.execute('SELECT id,status,last_update_at,created_at FROM clients').fetchall()
        return {
            'new_clients': sum(1 for x in clients if x['status'] == 'new'),
            'reviewing': sum(1 for x in clients if x['status'] == 'reviewing'),
            'payments_to_confirm': c.execute("SELECT COUNT(*) FROM orders WHERE status='awaiting_confirmation'").fetchone()[0],
            'onboarding_received': c.execute("SELECT COUNT(*) FROM engagements WHERE status='onboarding_received'").fetchone()[0],
            'in_review': c.execute("SELECT COUNT(*) FROM engagements WHERE status='review'").fetchone()[0],
            'updates_due': sum(1 for x in clients if update_state(x) in ('due_soon', 'overdue')),
            'overdue': sum(1 for x in clients if update_state(x) == 'overdue'),
            'revenue_paid_minor': c.execute("SELECT COALESCE(SUM(total_minor),0) FROM orders WHERE status='paid'").fetchone()[0],
            'reports_to_review': c.execute("SELECT COUNT(*) FROM reports WHERE status='submitted'").fetchone()[0],
            'unassigned': c.execute("SELECT COUNT(*) FROM engagements WHERE assigned_user_id IS NULL AND status!='delivered'").fetchone()[0],
            'update_hours': UPDATE_HOURS,
        }


@app.get('/api/admin/clients')
def admin_clients(user=Depends(holding)):
    with connect() as c:
        rows = c.execute('''SELECT c.id,c.ref,c.name,c.business,c.phone,c.path,c.status,c.created_at,c.last_update_at,c.intake,c.source,
                            u.display_name AS owner_name,
                            (SELECT status FROM recommendations r WHERE r.client_id=c.id) AS rec_status,
                            (SELECT COALESCE(SUM(total_minor),0) FROM orders o WHERE o.client_id=c.id AND o.status='paid') AS paid_minor
                            FROM clients c LEFT JOIN users u ON u.id=c.owner_user_id ORDER BY c.id DESC''').fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d['intake'] = json.loads(d['intake'])
            d['update_state'] = update_state(r)
            out.append(d)
        return out


@app.get('/api/admin/clients/{cid}')
def admin_client(cid: int, user=Depends(holding)):
    with connect() as c:
        cl = dict(one(c, 'clients', cid))
        cl['intake'] = json.loads(cl['intake'])
        cl['update_state'] = update_state(cl)
        rec = c.execute('SELECT * FROM recommendations WHERE client_id=?', (cid,)).fetchone()
        cl['recommendation'] = None
        if rec:
            cl['recommendation'] = dict(rec) | {'items': [dict(x) | {'package_name': x['name'], 'venture': x['venture']} for x in c.execute(
                '''SELECT r.*,p.name,p.venture,p.code,p.price_status,p.basis,p.grp,p.requires,p.overlaps,p.price_minor AS list_price
                   FROM rec_items r JOIN packages p ON p.id=r.package_id WHERE recommendation_id=? ORDER BY sort,r.id''', (rec['id'],))]}
        cl['orders'] = [dict(o) for o in c.execute('SELECT * FROM orders WHERE client_id=? ORDER BY id DESC', (cid,))]
        cl['engagements'] = [dict(e) | {'onboarding': json.loads(e['onboarding']), 'attachments': attachment_list(e)} for e in c.execute('SELECT * FROM engagements WHERE client_id=? ORDER BY id', (cid,))]
        cl['updates'] = [dict(u) for u in c.execute('SELECT * FROM updates WHERE client_id=? ORDER BY id DESC LIMIT 30', (cid,))]
        cl['activity'] = [dict(a) for a in c.execute('''SELECT actor,event,summary,at FROM audit WHERE (entity='clients' AND entity_id=?)
                          OR (entity='orders' AND entity_id IN (SELECT id FROM orders WHERE client_id=?))
                          OR (entity='engagements' AND entity_id IN (SELECT id FROM engagements WHERE client_id=?))
                          ORDER BY id DESC LIMIT 40''', (cid, cid, cid))]
        return cl


class ClientPatch(BaseModel):
    status: Literal['new', 'reviewing', 'recommended', 'active', 'completed', 'closed'] | None = None
    owner_user_id: int | None = None
    notes: str | None = Field(default=None, max_length=4000)
    plan_eta: str | None = Field(default=None, max_length=60)


@app.patch('/api/admin/clients/{cid}')
def patch_client(cid: int, body: ClientPatch, user=Depends(holding)):
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, 'nothing to change')
    with connect() as c:
        one(c, 'clients', cid)
        if data.get('owner_user_id') is not None and not c.execute('SELECT 1 FROM users WHERE id=? AND active=1', (data['owner_user_id'],)).fetchone():
            raise HTTPException(400, 'choose an active staff member')
        c.execute('UPDATE clients SET ' + ','.join(f'{k}=?' for k in data) + ',updated_at=CURRENT_TIMESTAMP WHERE id=?', (*data.values(), cid))
        log(c, user['username'], 'client.updated', 'clients', cid, ', '.join(data))
    return {'ok': True}


class LinkIn(BaseModel):
    dest: Literal['home', 'recommendation', 'roadmap', 'checkout', 'pay', 'onboarding', 'progress', 'files'] = 'home'
    days: int = Field(default=14, ge=1, le=60)


@app.post('/api/admin/clients/{cid}/link')
def create_client_link(cid: int, body: LinkIn, user=Depends(holding)):
    with connect() as c:
        one(c, 'clients', cid)
        token = secrets.token_urlsafe(32)
        c.execute('INSERT INTO client_links(token_hash,client_id,dest,expires_at,created_by) VALUES(?,?,?,?,?)',
                  (hashlib.sha256(token.encode()).hexdigest(), cid, body.dest, int(time.time() + body.days * 86400), user['username']))
        log(c, user['username'], 'client.link_created', 'clients', cid, body.dest)
    path = f'/track?t={token}#{body.dest}'
    return {'url': (BASE_URL + path) if BASE_URL else path, 'path': path, 'expires_days': body.days}


def hours_since(v):
    t = parse_ts(v)
    return (time.time() - t) / 3600 if t else 0


@app.get('/api/admin/nudges')
def nudges(user=Depends(holding)):
    """who to follow up with today, and which message to send."""
    out = []
    with connect() as c:
        for r in c.execute('''SELECT c.id,c.ref,c.name,c.business,c.phone,c.created_at,c.intake FROM clients c
                              WHERE c.status IN ('new','reviewing') ORDER BY c.id'''):
            h = hours_since(r['created_at'])
            urgent = json.loads(r['intake']).get('route') == 'quick'
            if urgent or h >= PLAN_NUDGE_HOURS:
                out.append({'kind': 'urgent' if urgent else 'plan_due', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'],
                            'detail': ('asked for help fast. ' if urgent else '') + f'{int(h)} hours since they started', 'template': 'quick_reply' if urgent else 'plan_coming', 'dest': 'home'})
        for r in c.execute('''SELECT c.id,c.ref,c.name,c.business,c.phone,rc.published_at FROM clients c JOIN recommendations rc ON rc.client_id=c.id
                              WHERE rc.status='published' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=c.id AND o.status!='cancelled')'''):
            h = hours_since(r['published_at'])
            if h >= 48:
                out.append({'kind': 'plan_not_chosen', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'],
                            'detail': f'plan published {int(h // 24)} days ago, nothing chosen yet', 'template': 'plan_reminder', 'dest': 'recommendation'})
        for r in c.execute('''SELECT p.name AS package,c.id,c.ref,c.name,c.business,c.phone FROM rec_items ri JOIN packages p ON p.id=ri.package_id
                              JOIN recommendations rc ON rc.id=ri.recommendation_id JOIN clients c ON c.id=rc.client_id
                              WHERE ri.quote='ask' AND ri.requested_at IS NOT NULL'''):
            out.append({'kind': 'route_requested', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'],
                        'detail': 'answered the questions for ' + r['package'] + '. send their route and set the fee', 'template': 'route_reply', 'dest': 'roadmap', 'package': r['package']})
        for r in c.execute('''SELECT o.created_at,o.total_minor,c.id,c.ref,c.name,c.business,c.phone FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.status='pending' AND o.kind='purchase' '''):
            if hours_since(r['created_at']) >= 24:
                out.append({'kind': 'payment_pending', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'],
                            'detail': 'chose packages but has not paid yet', 'template': 'payment_reminder', 'dest': 'pay', 'amount_minor': r['total_minor']})
        for r in c.execute('''SELECT e.name AS package,e.updated_at,c.id,c.ref,c.name,c.business,c.phone FROM engagements e JOIN clients c ON c.id=e.client_id
                              WHERE e.status='awaiting_onboarding' '''):
            if hours_since(r['updated_at']) >= 24:
                out.append({'kind': 'onboarding_missing', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'],
                            'detail': 'paid, but has not sent the details for ' + r['package'], 'template': 'onboarding_reminder', 'dest': 'onboarding', 'package': r['package']})
        for r in c.execute('''SELECT c.id,c.ref,c.name,c.business,c.phone,
                              (SELECT e.name FROM engagements e WHERE e.client_id=c.id AND e.status='delivered' ORDER BY e.delivered_at DESC LIMIT 1) AS done
                              FROM clients c WHERE EXISTS (SELECT 1 FROM engagements e WHERE e.client_id=c.id AND e.status='delivered')
                              AND EXISTS (SELECT 1 FROM rec_items ri JOIN recommendations rc ON rc.id=ri.recommendation_id
                                          WHERE rc.client_id=c.id AND rc.status='published' AND ri.id NOT IN (SELECT rec_item_id FROM engagements))
                              AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.client_id=c.id AND o.kind='purchase' AND o.status IN ('pending','awaiting_confirmation'))'''):
            out.append({'kind': 'next_step', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'],
                        'detail': f'{r["done"]} delivered. the next step on their roadmap is waiting', 'template': 'next_step', 'dest': 'progress', 'package': r['done']})
        for e in c.execute('''SELECT e.*,c.ref,c.name AS cname,c.business,c.phone AS cphone,u.display_name AS staff_name,u.phone AS staff_phone
                              FROM engagements e JOIN clients c ON c.id=e.client_id LEFT JOIN users u ON u.id=e.assigned_user_id
                              WHERE e.status NOT IN ('delivered')''').fetchall():
            base = {'client_id': e['client_id'], 'ref': e['ref'], 'name': e['cname'], 'business': e['business'], 'package': e['name'], 'venture': e['venture']}
            if e['update_requested_at']:
                out.append({**base, 'kind': 'client_asked', 'phone': e['cphone'], 'detail': f"asked for an update on {e['name']}. ask {e['venture']} for a report, then publish it",
                            'template': 'update_coming', 'dest': 'progress'})
            f = eng_follow(c, e)
            if f['update_state'] == 'overdue':
                out.append({**base, 'kind': 'venture_late', 'to': 'venture', 'phone': e['staff_phone'] or '', 'staff': e['staff_name'] or e['venture'],
                            'detail': f"{e['staff_name'] or e['venture']} has not sent an update on {e['name']} in {UPDATE_HOURS} hours", 'template': 'venture_chase', 'dest': 'progress'})
            if f['past_due']:
                out.append({**base, 'kind': 'work_late', 'to': 'venture', 'phone': e['staff_phone'] or '', 'staff': e['staff_name'] or e['venture'],
                            'detail': f"{e['name']} was due on {e['due_date']}. agree a new date and tell the client", 'template': 'venture_late', 'dest': 'progress'})
        for e in c.execute('''SELECT e.name AS package,e.delivered_at,c.id,c.ref,c.name,c.business,c.phone FROM engagements e JOIN clients c ON c.id=e.client_id
                              WHERE e.status='delivered' AND e.file_path IS NOT NULL AND e.file_purged_at IS NULL AND c.hold=0
                              AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.client_id=c.id AND s.status IN ('active','grace','paused'))''').fetchall():
            ends = datetime.date.fromisoformat(e['delivered_at'][:10]) + datetime.timedelta(days=DELIVERED_DAYS)
            if 0 <= (ends - today()).days <= NOTICE_DAYS:
                out.append({'kind': 'files_expiring', 'client_id': e['id'], 'ref': e['ref'], 'name': e['name'], 'business': e['business'], 'phone': e['phone'], 'package': e['package'],
                            'detail': f"the file for {e['package']} leaves their dashboard on {ends.isoformat()}. remind them to download it", 'template': 'files_expiring', 'dest': 'files'})
        for r in c.execute('''SELECT r.blocker,e.name AS package,e.venture,c.id,c.ref,c.name,c.business,c.phone FROM reports r JOIN engagements e ON e.id=r.engagement_id
                              JOIN clients c ON c.id=e.client_id WHERE r.status='submitted' AND r.blocker!='' '''):
            out.append({'kind': 'blocker', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'], 'phone': r['phone'], 'package': r['package'],
                        'venture': r['venture'], 'detail': f"{r['venture']} is blocked on {r['package']}: {r['blocker'][:140]}", 'template': 'update_coming', 'dest': 'progress'})
        for r in c.execute('''SELECT s.name AS package,s.next_due,s.status,s.amount_minor,c.id,c.ref,c.name,c.business,c.phone FROM subscriptions s
                              JOIN clients c ON c.id=s.client_id
                              WHERE s.status IN ('active','grace') AND s.cancel_at IS NULL
                              AND EXISTS (SELECT 1 FROM orders o WHERE o.subscription_id=s.id AND o.status='pending')'''):
            late = r['status'] == 'grace'
            out.append({'kind': 'renewal_overdue' if late else 'renewal_due', 'client_id': r['id'], 'ref': r['ref'], 'name': r['name'], 'business': r['business'],
                        'phone': r['phone'], 'detail': f"{r['package']} {'was due' if late else 'is due'} on {r['next_due']}",
                        'template': 'renewal_overdue' if late else 'renewal_due', 'dest': 'progress', 'package': r['package'], 'amount_minor': r['amount_minor']})
    order = {'files_expiring': 4, 'urgent': 0, 'client_asked': 0, 'blocker': 1, 'work_late': 1, 'venture_late': 1, 'route_requested': 1, 'renewal_overdue': 2, 'payment_pending': 2, 'renewal_due': 3, 'onboarding_missing': 3, 'plan_due': 4, 'plan_not_chosen': 5, 'next_step': 6}
    out.sort(key=lambda x: order[x['kind']])
    return out


@app.get('/api/admin/insights')
def insights(user=Depends(holding)):
    with connect() as c:
        clients = [dict(x) for x in c.execute('SELECT id,intake,source,created_at FROM clients')]
        pub = {r['client_id']: r['published_at'] for r in c.execute("SELECT client_id,published_at FROM recommendations WHERE status='published'")}
        paid = {}
        for r in c.execute("SELECT client_id,MIN(paid_at) p,SUM(total_minor) t FROM orders WHERE status='paid' GROUP BY client_id"):
            paid[r['client_id']] = (r['p'], r['t'])
        delivered = {r[0] for r in c.execute("SELECT DISTINCT client_id FROM engagements WHERE status='delivered'")}
        repeat = {r[0] for r in c.execute("SELECT client_id FROM orders WHERE status='paid' GROUP BY client_id HAVING COUNT(*)>1")}
        steps = {}
        for r in c.execute("SELECT flow,step,SUM(n) n FROM events WHERE day>=date('now','-30 day') GROUP BY flow,step ORDER BY flow,step"):
            steps.setdefault(r['flow'], []).append({'step': r['step'], 'n': r['n']})
    def avg(pairs):
        vals = [(parse_ts(b) - parse_ts(a)) / 3600 for a, b in pairs if parse_ts(a) and parse_ts(b)]
        return round(sum(vals) / len(vals), 1) if vals else None
    by_route, by_source = {}, {}
    for cl in clients:
        i = json.loads(cl['intake'])
        by_route[i.get('route') or 'full'] = by_route.get(i.get('route') or 'full', 0) + 1
        src = {'wa': 'whatsapp', 'tt': 'tiktok', 'ig': 'instagram', 'fb': 'facebook', 'bn': 'banner'}.get(i.get('src'), cl['source'] or 'holding')
        by_source[src] = by_source.get(src, 0) + 1
    created = {cl['id']: cl['created_at'] for cl in clients}
    return {
        'funnel': {'started_questions': sum(x['n'] for x in steps.get('route', []) if x['step'] == 0), 'finished_questions': len(clients),
                   'plan_published': len(pub), 'paid': len(paid), 'delivered': len(delivered), 'bought_again': len(repeat)},
        'revenue_minor': sum(t for _, t in paid.values()),
        'hours_to_plan': avg([(created[k], v) for k, v in pub.items() if k in created]),
        'hours_plan_to_paid': avg([(pub[k], v[0]) for k, v in paid.items() if k in pub]),
        'by_route': by_route, 'by_source': by_source, 'steps': steps,
    }


# ---------------------------------------------------------------- admin: catalogue
class Question(BaseModel):
    label: str = Field(min_length=2, max_length=200)
    kind: Literal['text', 'long', 'choice', 'file'] = 'text'
    options: list[str] = Field(default_factory=list, max_length=12)
    required: bool = True
    why: str = Field(default='', max_length=300)  # shown to the client: why we need this


class PackageIn(BaseModel):
    venture: Literal['bizdoc', 'medialy', 'subt', 'iotics', 'hub', 'iwiin', 'holding', 'finance']
    code: str = Field(default='', max_length=12, pattern=r'^([A-Z]{2}-\d{2,3})?$')
    level: Literal['minimum', 'standard', 'protection', 'scaling', 'renewals'] = 'standard'
    exclusions: list[str] = Field(default_factory=list, max_length=15)
    basis: Literal['fixed', 'from', 'monthly', 'session', 'request', 'workflow', 'quote'] = 'fixed'
    price_status: Literal['proposed', 'approved'] = 'approved'
    external: str = Field(default='', max_length=400)
    format: Literal['file', 'document', 'workbook', 'folder', 'bundle', 'workspace', 'website', 'guide', 'service'] = 'document'
    group: str = Field(default='', max_length=40)
    requires: list[str] = Field(default_factory=list, max_length=8)
    overlaps: list[str] = Field(default_factory=list, max_length=8)
    name: str = Field(min_length=2, max_length=120)
    summary: str = Field(default='', max_length=400)
    inclusions: list[str] = Field(default_factory=list, max_length=25)
    value: str = Field(default='', max_length=800)
    duration: str = Field(default='', max_length=80)
    price_minor: int = Field(ge=0, le=5_000_000_000_00)
    onboarding: list[Question] = Field(default_factory=list, max_length=20)
    stage: Literal['awareness', 'strategy', 'structure', 'systems', 'success'] = 'structure'
    active: bool = True


@app.get('/api/admin/packages')
def list_packages(user=Depends(staff)):
    with connect() as c:
        return [package_view(p) | {'stage': p['stage'], 'active': bool(p['active'])} for p in c.execute("SELECT * FROM packages ORDER BY CASE WHEN code='' THEN 1 ELSE 0 END, code, venture, name")]


@app.post('/api/admin/packages')
def create_package(body: PackageIn, user=Depends(holding)):
    with connect() as c:
        if body.code and c.execute('SELECT 1 FROM packages WHERE code=?', (body.code,)).fetchone():
            raise HTTPException(409, 'that code is already used')
        cur = c.execute('''INSERT INTO packages(venture,name,summary,inclusions,value,duration,price_minor,onboarding,stage,active,
                           code,level,exclusions,basis,price_status,external,format,grp,requires,overlaps)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (body.venture, body.name, body.summary, json.dumps([x.strip() for x in body.inclusions if x.strip()]),
                           body.value, body.duration, body.price_minor, json.dumps([q.model_dump() for q in body.onboarding]), body.stage, int(body.active),
                           body.code, body.level, json.dumps([x.strip() for x in body.exclusions if x.strip()]), body.basis, body.price_status, body.external,
                           body.format, body.group, json.dumps(body.requires), json.dumps(body.overlaps)))
        log(c, user['username'], 'package.created', 'packages', cur.lastrowid, body.name)
    return {'id': cur.lastrowid}


@app.put('/api/admin/packages/{pid}')
def update_package(pid: int, body: PackageIn, user=Depends(holding)):
    with connect() as c:
        one(c, 'packages', pid)
        if body.code and c.execute('SELECT 1 FROM packages WHERE code=? AND id!=?', (body.code, pid)).fetchone():
            raise HTTPException(409, 'that code is already used')
        c.execute('''UPDATE packages SET venture=?,name=?,summary=?,inclusions=?,value=?,duration=?,price_minor=?,onboarding=?,stage=?,active=?,
                     code=?,level=?,exclusions=?,basis=?,price_status=?,external=?,format=?,grp=?,requires=?,overlaps=? WHERE id=?''',
                  (body.venture, body.name, body.summary, json.dumps([x.strip() for x in body.inclusions if x.strip()]), body.value, body.duration,
                   body.price_minor, json.dumps([q.model_dump() for q in body.onboarding]), body.stage, int(body.active),
                   body.code, body.level, json.dumps([x.strip() for x in body.exclusions if x.strip()]), body.basis, body.price_status, body.external,
                   body.format, body.group, json.dumps(body.requires), json.dumps(body.overlaps), pid))
        log(c, user['username'], 'package.updated', 'packages', pid, body.name)
    return {'ok': True}


class ApproveIn(BaseModel):
    price_minor: int | None = Field(default=None, gt=0, le=5_000_000_000_00)


@app.post('/api/admin/packages/{pid}/approve')
def approve_price(pid: int, body: ApproveIn, user=Depends(holding)):
    """the holding approves a catalogue price (optionally changing it). only approved prices reach clients."""
    with connect() as c:
        p = one(c, 'packages', pid)
        if p['basis'] == 'quote':
            raise HTTPException(400, 'this service is quoted for each client after a few questions. set its fee in their roadmap')
        price = p['price_minor'] if body.price_minor is None else body.price_minor
        if price <= 0:
            raise HTTPException(400, 'please enter a price above zero')
        c.execute("UPDATE packages SET price_minor=?,price_status='approved' WHERE id=?", (price, pid))
        # roadmaps pick up the approved price (unless the desk set a custom one), for anything not yet ordered or paid
        c.execute('''UPDATE rec_items SET price_minor=?,renewal_minor=CASE WHEN renewal='monthly' THEN ? ELSE renewal_minor END
                     WHERE package_id=? AND price_minor=?
                     AND id NOT IN (SELECT l.rec_item_id FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status IN ('pending','awaiting_confirmation','paid','refund_due'))''',
                  (price, price, pid, p['price_minor']))
        log(c, user['username'], 'price.approved', 'packages', pid, f"{p['code']} {price}")
    return {'ok': True}


@app.post('/api/admin/catalogue/load')
def admin_load_catalogue(user=Depends(holding)):
    with connect() as c:
        res = load_catalogue(c, only_missing=False)
        log(c, user['username'], 'catalogue.loaded', 'packages', None, json.dumps(res))
    return res


# ---------------------------------------------------------------- admin: recommendation builder
class RecItemIn(BaseModel):
    package_id: int
    price_minor: int | None = Field(default=None, ge=0, le=5_000_000_000_00)
    note: str = Field(default='', max_length=600)
    priority: int = Field(default=2, ge=1, le=3)  # urgency: 1 needed now (red), 2 needed soon (amber), 3 optional (blue)
    assess: Literal['', 'verify', 'improve'] = ''      # verify: we are checking before we promise or charge
    has: bool = False                                    # assessed as already adequate: the client sees "you have this"
    stage: Literal['awareness', 'strategy', 'structure', 'systems', 'success'] | None = None
    level: Literal['minimum', 'standard', 'protection', 'scaling', 'renewals'] = 'standard'
    quote: Literal['fixed', 'ask'] = 'fixed'
    renewal: Literal['none', 'monthly', 'yearly'] = 'none'
    renewal_minor: int = Field(default=0, ge=0, le=5_000_000_000_00)


class RecIn(BaseModel):
    heard: str = Field(default='', max_length=2000)
    advice: str = Field(default='', max_length=3000)
    management: str = Field(default='', max_length=2000)
    items: list[RecItemIn] = Field(default_factory=list, max_length=30)


@app.put('/api/admin/clients/{cid}/recommendation')
def save_recommendation(cid: int, body: RecIn, user=Depends(holding)):
    with connect() as c:
        one(c, 'clients', cid)
        rec = c.execute('SELECT * FROM recommendations WHERE client_id=?', (cid,)).fetchone()
        if rec is None:
            rec_id = c.execute('INSERT INTO recommendations(client_id) VALUES(?)', (cid,)).lastrowid
        else:
            rec_id = rec['id']
        c.execute('UPDATE recommendations SET heard=?,advice=?,management=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (body.heard, body.advice, body.management, rec_id))
        owned = {r[0] for r in c.execute('SELECT rec_item_id FROM engagements WHERE client_id=?', (cid,))}
        existing = {r['package_id']: r for r in c.execute('SELECT * FROM rec_items WHERE recommendation_id=?', (rec_id,))}
        keep = set()
        for i, it in enumerate(body.items):
            p = one(c, 'packages', it.package_id)
            price = p['price_minor'] if it.price_minor is None else it.price_minor
            stage = it.stage or p['stage']
            if it.package_id in existing:
                r = existing[it.package_id]
                keep.add(r['id'])
                if r['id'] in owned:  # never reprice what the client already paid for
                    c.execute('UPDATE rec_items SET note=?,sort=?,renewal=?,renewal_minor=? WHERE id=?', (it.note, i, it.renewal, it.renewal_minor, r['id']))
                else:
                    c.execute('UPDATE rec_items SET price_minor=?,note=?,priority=?,stage=?,sort=?,level=?,renewal=?,renewal_minor=?,quote=?,assess=?,client_has=? WHERE id=?',
                              (price, it.note, it.priority, stage, i, it.level, it.renewal, it.renewal_minor, it.quote, it.assess, int(it.has), r['id']))
            else:
                keep.add(c.execute('INSERT INTO rec_items(recommendation_id,package_id,price_minor,note,priority,stage,sort,level,renewal,renewal_minor,quote,assess,client_has) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                                   (rec_id, it.package_id, price, it.note, it.priority, stage, i, it.level, it.renewal, it.renewal_minor, it.quote, it.assess, int(it.has))).lastrowid)
        for pid, r in existing.items():
            if r['id'] not in keep:
                if r['id'] in owned or c.execute('SELECT 1 FROM order_lines WHERE rec_item_id=?', (r['id'],)).fetchone():
                    raise HTTPException(409, 'a package the client has ordered cannot be removed')
                c.execute('DELETE FROM rec_items WHERE id=?', (r['id'],))
        if c.execute("SELECT status FROM clients WHERE id=?", (cid,)).fetchone()[0] == 'new':
            c.execute("UPDATE clients SET status='reviewing' WHERE id=?", (cid,))
        log(c, user['username'], 'recommendation.saved', 'clients', cid, f'{len(body.items)} packages')
    return {'ok': True}


@app.post('/api/admin/clients/{cid}/recommendation/publish')
def publish_recommendation(cid: int, user=Depends(holding)):
    with connect() as c:
        rec = c.execute('SELECT * FROM recommendations WHERE client_id=?', (cid,)).fetchone()
        if not rec or not c.execute('SELECT 1 FROM rec_items WHERE recommendation_id=?', (rec['id'],)).fetchone():
            raise HTTPException(400, 'add at least one package first')
        if not rec['advice'].strip():
            raise HTTPException(400, 'write your recommendation summary first')
        unapproved = [r['name'] for r in c.execute('''SELECT p.name FROM rec_items ri JOIN packages p ON p.id=ri.package_id
                       WHERE ri.recommendation_id=? AND ri.quote='fixed' AND ri.assess!='verify' AND p.price_status!='approved' ''', (rec['id'],))]
        if unapproved:
            raise HTTPException(400, 'approve these prices in the catalogue first: ' + ', '.join(unapproved))
        groups = {}
        for r in c.execute('''SELECT p.grp,p.name FROM rec_items ri JOIN packages p ON p.id=ri.package_id WHERE ri.recommendation_id=? AND p.grp!='' ''', (rec['id'],)):
            groups.setdefault(r['grp'], []).append(r['name'])
        # alternatives (one registration type, one scuml category) may both be offered: the client can choose one
        c.execute("UPDATE recommendations SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=?", (rec['id'],))
        c.execute("UPDATE clients SET status='recommended',last_update_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('new','reviewing')", (cid,))
        log(c, user['username'], 'recommendation.published', 'clients', cid)
    return {'ok': True}


# ---------------------------------------------------------------- admin: payments
@app.get('/api/admin/orders')
def admin_orders(user=Depends(money)):
    with connect() as c:
        rows = [dict(o) for o in c.execute('''SELECT o.*,c.ref,c.name,c.business FROM orders o JOIN clients c ON c.id=o.client_id
                                              WHERE o.status!='cancelled' ORDER BY (o.status='awaiting_confirmation') DESC,o.id DESC LIMIT 300''')]
        for o in rows:
            o['lines'] = [dict(x) for x in c.execute('''SELECT l.price_minor,p.name,p.venture FROM order_lines l JOIN rec_items r ON r.id=l.rec_item_id
                                                        JOIN packages p ON p.id=r.package_id WHERE l.order_id=?''', (o['id'],))]
        return rows


@app.post('/api/admin/orders/{oid}/confirm')
@payment_operation
def confirm_order(oid: int, user=Depends(money)):
    with connect() as c:
        o = one(c, 'orders', oid)
        if o['status'] not in ('pending', 'awaiting_confirmation'):
            raise HTTPException(409, 'this order is not waiting for payment')
        if o['method'] != 'transfer':
            raise HTTPException(409, 'card payments must be verified with the payment provider')
        mark_paid(c, o, user['username'])
    return {'ok': True}


# ---------------------------------------------------------------- admin: delivery
@app.get('/api/admin/engagements')
def admin_engagements(user=Depends(staff)):
    v = venture_scope(user)
    with connect() as c:
        q = '''SELECT e.*,c.ref,c.name AS client_name,c.business,c.intake,u.display_name AS assigned_name FROM engagements e
               JOIN clients c ON c.id=e.client_id LEFT JOIN users u ON u.id=e.assigned_user_id'''
        rows = c.execute(q + (' WHERE e.venture=?' if v else '') + ' ORDER BY e.updated_at DESC', (v,) if v else ()).fetchall()
        out = []
        for e in rows:
            d = dict(e)
            intake = json.loads(d.pop('intake'))
            d['situation'] = {k: intake.get(k, '') for k in ('industry', 'stage', 'challenge', 'location', 'team')}
            d['onboarding'] = json.loads(e['onboarding']); d['attachments'] = attachment_list(e)
            d['status_label'] = WORK_LABEL[e['status']]
            d['reports'] = [dict(r) for r in c.execute('SELECT * FROM reports WHERE engagement_id=? ORDER BY id DESC LIMIT 10', (e['id'],))]
            d.update(eng_follow(c, e))
            d['handover'] = json.loads(e['handover'] or '{}')
            d.pop('file_path', None)
            out.append(d)
        return out


class WorkPatch(BaseModel):
    status: Literal['onboarding_received', 'in_progress', 'review', 'delivered'] | None = None
    progress: int | None = Field(default=None, ge=0, le=100)


def attachment_list(e):
    """files the client attached, without their private storage names: [{q, name, size}]."""
    return [{'q': k, 'name': v['name'], 'size': v.get('size', 0)} for k, v in sorted(json.loads(e['attachments'] or '{}').items())]


def access_engagement(c, user, eid):
    e = one(c, 'engagements', eid)
    if user['role'] not in ROLE_HOLDING and user['venture'] != e['venture']:
        raise HTTPException(403, 'this work belongs to another venture')
    return e


class AssignIn(BaseModel):
    assigned_user_id: int | None = None
    due_date: str = Field(default='', max_length=10, pattern=r'^(\d{4}-\d{2}-\d{2})?$')
    brief: str = Field(default='', max_length=3000)


@app.post('/api/admin/engagements/{eid}/assign')
def assign_engagement(eid: int, body: AssignIn, user=Depends(holding)):
    """holding hands a paid package to a named venture staff member, with a brief and a due date."""
    with connect() as c:
        e = one(c, 'engagements', eid)
        if body.assigned_user_id is not None:
            u = c.execute('SELECT * FROM users WHERE id=? AND active=1', (body.assigned_user_id,)).fetchone()
            if not u or (u['role'] not in ROLE_HOLDING and u['venture'] != e['venture']):
                raise HTTPException(400, 'choose an active staff member from ' + e['venture'])
        due = body.due_date
        if not due and body.assigned_user_id:
            d = days_in(c.execute('SELECT duration FROM packages WHERE id=?', (e['package_id'],)).fetchone()['duration'])
            due = (today() + datetime.timedelta(days=d)).isoformat() if d else ''
        changed = body.assigned_user_id != e['assigned_user_id']
        c.execute('''UPDATE engagements SET assigned_user_id=?,due_date=?,brief=?,assigned_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE assigned_at END,
                     updated_at=CURRENT_TIMESTAMP WHERE id=?''', (body.assigned_user_id, due, body.brief.strip(), int(changed), eid))
        log(c, user['username'], 'work.assigned', 'engagements', eid, str(body.assigned_user_id))
    return {'ok': True}


class ReportIn(BaseModel):
    progress: int = Field(ge=0, le=100)
    done: str = Field(min_length=3, max_length=1500)
    blocker: str = Field(default='', max_length=800)
    next_step: str = Field(min_length=3, max_length=800)
    ready: bool = False  # ready for holding's final quality check


@app.post('/api/admin/engagements/{eid}/reports')
def submit_report(eid: int, body: ReportIn, user=Depends(staff)):
    """ventures report to holding. holding decides what the client sees."""
    with connect() as c:
        e = access_engagement(c, user, eid)
        if e['status'] == 'delivered':
            raise HTTPException(409, 'this package is already delivered')
        if e['status'] == 'awaiting_onboarding':
            raise HTTPException(409, 'waiting for the client to send their details')
        cur = c.execute('INSERT INTO reports(engagement_id,author,progress,done,blocker,next_step,ready) VALUES(?,?,?,?,?,?,?)',
                        (eid, user['username'], body.progress, body.done.strip(), body.blocker.strip(), body.next_step.strip(), int(body.ready)))
        log(c, user['username'], 'report.submitted', 'engagements', eid, f'{body.progress}%')
    return {'id': cur.lastrowid}


@app.get('/api/admin/reports')
def list_reports(user=Depends(staff)):
    v = venture_scope(user)
    with connect() as c:
        q = '''SELECT r.*,e.name AS package,e.venture,e.client_id,e.progress AS client_progress,c.ref,c.business,c.name AS client_name
               FROM reports r JOIN engagements e ON e.id=r.engagement_id JOIN clients c ON c.id=e.client_id'''
        rows = c.execute(q + (' WHERE e.venture=?' if v else '') + " ORDER BY (r.status='submitted') DESC, r.id DESC LIMIT 200", (v,) if v else ())
        return [dict(r) for r in rows]


class PublishIn(BaseModel):
    progress: int = Field(ge=0, le=100)
    done: str = Field(min_length=3, max_length=1500)
    blocker: str = Field(default='', max_length=800)
    next_step: str = Field(min_length=3, max_length=800)


def whatsapp_update(cl, progress, blocker, next_action):
    first = cl['name'].split()[0].lower() if cl['name'].strip() else ''
    return '\n'.join([f'hello {first},', '', 'here is your hamzury update.', '', 'progress: ' + progress,
                      'anything holding us back: ' + (blocker or 'nothing at the moment.'), 'next step: ' + next_action, '',
                      f'you can follow every step with your hamzury id ({cl["ref"]}) at {BASE_URL or "our website"}/track.'])


@app.post('/api/admin/reports/{rid}/publish')
def publish_report(rid: int, body: PublishIn, user=Depends(holding)):
    """holding checks the venture report, edits the wording for the client, and publishes it."""
    with connect() as c:
        r = c.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone()
        if not r:
            raise HTTPException(404, 'record not found')
        if r['status'] != 'submitted':
            raise HTTPException(409, 'this report was already reviewed')
        e = one(c, 'engagements', r['engagement_id'])
        cl = one(c, 'clients', e['client_id'])
        status = 'review' if r['ready'] else 'in_progress'
        if e['status'] == 'delivered':
            raise HTTPException(409, 'this package is already delivered')
        c.execute('UPDATE engagements SET progress=?,status=?,update_requested_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?', (min(body.progress, 99), status, e['id']))
        c.execute('INSERT INTO updates(client_id,engagement_id,progress,blocker,next_action,author) VALUES(?,?,?,?,?,?)',
                  (cl['id'], e['id'], body.done.strip(), body.blocker.strip(), body.next_step.strip(), user['username']))
        c.execute('UPDATE clients SET last_update_at=CURRENT_TIMESTAMP WHERE id=?', (cl['id'],))
        c.execute("UPDATE reports SET status='published',reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?", (user['username'], rid))
        log(c, user['username'], 'report.published', 'engagements', e['id'], f'{body.progress}%')
    return {'ok': True, 'whatsapp_text': whatsapp_update(cl, body.done.strip(), body.blocker.strip(), body.next_step.strip())}


class ReturnIn(BaseModel):
    note: str = Field(min_length=3, max_length=800)


@app.post('/api/admin/reports/{rid}/return')
def return_report(rid: int, body: ReturnIn, user=Depends(holding)):
    with connect() as c:
        r = c.execute('SELECT * FROM reports WHERE id=?', (rid,)).fetchone()
        if not r:
            raise HTTPException(404, 'record not found')
        if r['status'] != 'submitted':
            raise HTTPException(409, 'this report was already reviewed')
        c.execute("UPDATE reports SET status='returned',holding_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
                  (body.note.strip(), user['username'], rid))
        log(c, user['username'], 'report.returned', 'engagements', r['engagement_id'], body.note)
    return {'ok': True}


@app.patch('/api/admin/engagements/{eid}')
def patch_engagement(eid: int, body: WorkPatch, user=Depends(holding)):
    data = body.model_dump(exclude_unset=True)
    with connect() as c:
        e = access_engagement(c, user, eid)
        if data.get('status') == 'delivered':
            if not e['file_path']:
                raise HTTPException(400, 'upload the deliverable first so the client can download it')
            data['progress'] = 100
        if e['status'] == 'delivered' and 'status' in data and data['status'] != 'delivered':
            raise HTTPException(409, 'delivered work cannot be reopened here')
        if not data:
            raise HTTPException(400, 'nothing to change')
        sets = ','.join(f'{k}=?' for k in data) + (',delivered_at=CURRENT_TIMESTAMP' if data.get('status') == 'delivered' else '')
        c.execute(f'UPDATE engagements SET {sets},updated_at=CURRENT_TIMESTAMP WHERE id=?', (*data.values(), eid))
        if data.get('status') == 'delivered':
            left = c.execute("SELECT COUNT(*) FROM engagements WHERE client_id=? AND status!='delivered'", (e['client_id'],)).fetchone()[0]
            c.execute('UPDATE clients SET last_update_at=CURRENT_TIMESTAMP' + (",status='completed'" if left == 0 else '') + ' WHERE id=?', (e['client_id'],))
        log(c, user['username'], 'work.updated', 'engagements', eid, json.dumps(data))
    return {'ok': True}


@app.post('/api/admin/engagements/{eid}/file')
async def upload_file(eid: int, file: UploadFile = File(...), user=Depends(staff)):
    name = Path(file.filename or 'deliverable').name[:120]
    if Path(name).suffix.lower() not in ALLOWED_UPLOADS:
        raise HTTPException(400, 'allowed files: ' + ', '.join(sorted(ALLOWED_UPLOADS)))
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, 'the file is larger than 25 mb')
    with connect() as c:
        access_engagement(c, user, eid)
    await run_in_threadpool(validate_upload, name, data)
    return await run_in_threadpool(save_deliverable, eid, name, data, user)


@storage_operation
def save_deliverable(eid, name, data, user):
    stored = secrets.token_hex(16) + Path(name).suffix.lower()
    with connect() as c:
        e = access_engagement(c, user, eid)
        (FILES / stored).write_bytes(data)
        if e['file_path']:
            old = (FILES / e['file_path']).resolve()
            if FILES in old.parents and old.exists():
                old.unlink()
        c.execute('UPDATE engagements SET file_path=?,file_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', (stored, name, eid))
        log(c, user['username'], 'work.file_uploaded', 'engagements', eid, name)
    return {'ok': True, 'file_name': name}


class UpdateIn(BaseModel):
    engagement_id: int | None = None
    progress: str = Field(min_length=3, max_length=1200)
    blocker: str = Field(default='', max_length=800)
    next_action: str = Field(min_length=3, max_length=600)


@app.post('/api/admin/clients/{cid}/updates')
def post_update(cid: int, body: UpdateIn, user=Depends(holding)):
    with connect() as c:
        cl = one(c, 'clients', cid)
        if body.engagement_id:
            e = access_engagement(c, user, body.engagement_id)
            if e['client_id'] != cid:
                raise HTTPException(400, 'that work belongs to another client')
        c.execute('INSERT INTO updates(client_id,engagement_id,progress,blocker,next_action,author) VALUES(?,?,?,?,?,?)',
                  (cid, body.engagement_id, body.progress.strip(), body.blocker.strip(), body.next_action.strip(), user['username']))
        c.execute('UPDATE clients SET last_update_at=CURRENT_TIMESTAMP WHERE id=?', (cid,))
        log(c, user['username'], 'update.posted', 'clients', cid, body.next_action)
    return {'ok': True, 'whatsapp_text': whatsapp_update(cl, body.progress.strip(), body.blocker.strip(), body.next_action.strip())}


# ---------------------------------------------------------------- pages
@app.get('/api/health')
def health():
    try:
        with connect() as c:
            c.execute('SELECT 1 FROM users LIMIT 1').fetchone()
        with tempfile.TemporaryFile(dir=FILES) as probe:
            probe.write(b'ok')
            probe.flush()
        return {'ok': True, 'configured': READY, 'paystack': bool(PAYSTACK_SECRET)}
    except (sqlite3.Error, OSError):
        return JSONResponse({'ok': False, 'configured': READY}, status_code=503)


def page(name):
    return FileResponse(ROOT / 'static' / name)


@app.get('/')
def home():
    return page('index.html')


@app.get('/api/public/ventures/{v}')
def public_venture(v: str):
    if v not in VENTURE_INFO:
        raise HTTPException(404, 'not found')
    with connect() as c:
        services = [{'name': p['name'], 'summary': p['summary'], 'inclusions': json.loads(p['inclusions']), 'duration': p['duration'], 'value': p['value']}
                    for p in c.execute('SELECT * FROM packages WHERE venture=? AND active=1 ORDER BY code=\'\',code,name', (v,))]
    return {'key': v, **VENTURE_INFO[v], 'services': services}


@app.get('/v/{v}')
def venture_page(v: str):
    if v not in VENTURE_INFO:
        raise HTTPException(404, 'not found')
    return page('venture.html')


@app.get('/start')
def start_page():
    return page('start.html')


@app.get('/track')
def track_page():
    return page('track.html')


@app.get('/admin')
def admin_page():
    return page('admin.html')


@app.get('/privacy')
def privacy_page():
    return page('privacy.html')


@app.get('/terms')
def terms_page():
    return page('terms.html')


# our offices. the short links are made for sharing on whatsapp: they open the office straight in google maps.
OFFICE_MAPS = {
    'abuja': 'https://www.google.com/maps/search/?api=1&query=9.028329%2C7.478382',
    'jos': 'https://www.google.com/maps/place/hamzury+innovation+hub/@9.9303296,8.8896841,17z/data=!3m1!4b1!4m6!3m5!1s0x1053738fbdc0e88f:0x1d70274660173290!8m2!3d9.9303296!4d8.892259',
}


@app.get('/visit')
def visit_page():
    return page('visit.html')


@app.get('/visit/{office}')
def visit_office(office: str):
    url = OFFICE_MAPS.get(office.lower())
    return RedirectResponse(url, status_code=302) if url else RedirectResponse('/visit', status_code=302)


@app.get('/library')
def library_page():
    return page('library.html')


@app.get('/library/profile')
def profile_page():
    return page('profile.html')


@app.get('/gallery')
def gallery_page():
    return page('gallery.html')


@app.get('/robots.txt')
def robots():
    return PlainTextResponse('User-agent: *\nDisallow: /admin\nDisallow: /track\nDisallow: /api/\n')


@app.get('/favicon.ico')
def favicon():
    return FileResponse(ROOT / 'static' / 'img' / 'hamzury-mark.png', media_type='image/png')


mimetypes.add_type('application/manifest+json', '.webmanifest')
app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
