import io
import os
import sqlite3
import subprocess
import sys
import threading
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pyotp
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from test_flows import app, staff, setup_monthly, paid_job, PASS


def card_subscription(app):
    client, admin, cid, package, item = setup_monthly(app)
    order = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    assert admin.post(f"/api/admin/orders/{order['order_id']}/confirm").status_code == 200
    with app.connect() as c:
        c.execute("UPDATE subscriptions SET method='paystack'")
        c.execute("UPDATE clients SET email='audit@example.com',pay_auth='AUTH_TEST'")
        due = app.datetime.date.fromisoformat(c.execute('SELECT next_due FROM subscriptions').fetchone()[0])
    app.PAYSTACK_SECRET = 'sk_test_fake'
    return client, admin, due


def test_overlapping_billing_and_cancellation_cannot_double_charge(app, monkeypatch):
    client, admin, due = card_subscription(app)
    started, release = threading.Event(), threading.Event()
    charges = []

    def gateway(method, path, payload=None):
        assert path == '/transaction/charge_authorization'
        charges.append(payload['reference'])
        started.set()
        assert release.wait(10)
        return {'status': True, 'data': {'status': 'success', 'amount': payload['amount'], 'currency': 'NGN'}}

    monkeypatch.setattr(app, 'paystack', gateway)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(app.billing_run, due)
        try:
            assert started.wait(10)
            with pytest.raises(HTTPException) as busy:
                app.billing_run(due)
            assert busy.value.status_code == 409
            sid = client.get('/api/client/me').json()['subscriptions'][0]['id']
            assert client.post(f'/api/client/subscriptions/{sid}/cancel').status_code == 409
            # Another OS process is excluded too, not just another Python thread.
            result = subprocess.run([sys.executable, '-c',
                'from filelock import FileLock,Timeout; import sys\n'
                'try:\n with FileLock(sys.argv[1],timeout=0): sys.exit(2)\n'
                'except Timeout: sys.exit(0)', str(app.DB.parent / '.payments.lock')], timeout=10)
            assert result.returncode == 0
        finally:
            release.set()
        assert first.result(timeout=10)['charged'] == 1
    assert app.billing_run(due)['charged'] == 0
    assert len(charges) == 1
    with app.connect() as c:
        assert c.execute("SELECT count(*) FROM orders WHERE kind='renewal' AND status='paid'").fetchone()[0] == 1


def test_unknown_gateway_result_does_not_create_a_new_charge(app, monkeypatch):
    client, admin, due = card_subscription(app)
    charges = []

    def gateway(method, path, payload=None):
        if method == 'POST':
            charges.append(payload['reference'])
            raise HTTPException(502, 'simulated lost response')
        return {'status': False, 'message': 'verification unavailable'}

    monkeypatch.setattr(app, 'paystack', gateway)
    assert app.billing_run(due)['declined'] == 1
    invoice = client.get('/api/client/me').json()['invoices'][0]
    assert client.post(f"/api/client/orders/{invoice['id']}/transfer", json={'note': 'sent'}).status_code == 409
    assert admin.post(f"/api/admin/orders/{invoice['id']}/confirm").status_code == 409
    assert client.post(f"/api/client/orders/{invoice['id']}/check").json()['status'] == 'pending'
    with app.connect() as c:
        c.execute("UPDATE orders SET created_at=datetime('now','-3 day') WHERE kind='renewal'")
    app.billing_run(due + app.datetime.timedelta(days=2))
    assert len(charges) == 1
    with app.connect() as c:
        assert c.execute("SELECT count(*) FROM orders WHERE kind='renewal'").fetchone()[0] == 1


def test_password_change_revokes_every_session_and_recovery_works(app):
    one, two = staff(app), staff(app)
    assert one.post('/api/account/password', json={'current_password': 'wrong', 'new_password': 'new-unique-password-123'}).status_code == 401
    assert one.post('/api/account/password', json={'current_password': PASS, 'new_password': 'new-unique-password-123'}).status_code == 200
    assert one.get('/api/me').status_code == two.get('/api/me').status_code == 401
    assert TestClient(app.app).post('/api/login', json={'username': 'owner', 'password': PASS}).status_code == 401
    current = staff(app, password='new-unique-password-123')
    from tools.manage import reset_password
    reset_password('owner', 'recovered-password-123')
    assert current.get('/api/me').status_code == 401
    assert staff(app, password='recovered-password-123').get('/api/me').status_code == 200


def test_owner_can_reset_staff_but_staff_cannot_reset_owner(app):
    admin = staff(app)
    uid = admin.post('/api/users', json={'username': 'finance-test', 'display_name': 'Finance', 'role': 'finance', 'password': 'finance-original-password'}).json()['id']
    finance = staff(app, 'finance-test', 'finance-original-password')
    payload = {'owner_password': PASS, 'new_password': 'replacement-staff-password'}
    assert finance.post('/api/users/1/password', json=payload).status_code == 403
    assert admin.post(f'/api/users/{uid}/password', json=payload).status_code == 200
    assert finance.get('/api/me').status_code == 401
    assert staff(app, 'finance-test', payload['new_password']).get('/api/me').status_code == 200


def test_required_mfa_setup_encryption_replay_and_recovery(app, monkeypatch):
    monkeypatch.setattr(app, 'REQUIRE_MFA', True)
    clock = int(app.time.time())
    monkeypatch.setattr(app.time, 'time', lambda: clock)
    admin = staff(app)
    assert admin.get('/api/admin/clients').status_code == 403
    result = admin.post('/api/account/mfa/setup', json={'password': PASS})
    assert result.status_code == 200
    key = result.json()['secret']
    otp = pyotp.TOTP(key)
    assert admin.post('/api/account/mfa/enable', json={'code': otp.at(clock)}).status_code == 200
    assert admin.get('/api/me').status_code == 401
    with app.connect() as c:
        assert c.execute('SELECT mfa_secret FROM users').fetchone()[0] != key
    t = TestClient(app.app)
    assert t.post('/api/login', json={'username': 'owner', 'password': PASS}).status_code == 401
    assert t.post('/api/login', json={'username': 'owner', 'password': PASS, 'otp': otp.at(clock)}).status_code == 401
    clock += 30
    login = t.post('/api/login', json={'username': 'owner', 'password': PASS, 'otp': otp.at(clock)})
    assert login.status_code == 200
    t.headers['X-CSRF-Token'] = login.json()['csrf']
    assert t.get('/api/admin/clients').status_code == 200
    from tools.manage import reset_password
    reset_password('owner', 'recovered-owner-password', reset_mfa=True)
    recovered = staff(app, password='recovered-owner-password')
    assert recovered.get('/api/admin/clients').status_code == 403
    assert recovered.get('/api/me').json()['user']['mfa_enabled'] is False


def test_disguised_uploads_and_unsafe_archives_are_rejected(app):
    client, admin, cid, package, eng = paid_job(app)
    url = f"/api/admin/engagements/{eng['id']}/file"
    assert admin.post(url, files={'file': ('fake.pdf', b'MZ executable')}).status_code == 400
    assert admin.post(url, files={'file': ('empty.pdf', b'')}).status_code == 400
    assert admin.post(url, files={'file': ('fake.png', b'%PDF-1.4')}).status_code == 400
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as z:
        z.writestr('../escape.txt', 'bad')
    assert admin.post(url, files={'file': ('bad.zip', archive.getvalue())}).status_code == 400
    assert admin.post(url, files={'file': ('bad.docx', archive.getvalue())}).status_code == 400
    assert admin.post(url, files={'file': ('valid.pdf', b'%PDF-1.4 test')}).status_code == 200


def test_production_upload_scan_fails_closed(app, monkeypatch):
    monkeypatch.setattr(app, 'REQUIRE_SCAN', True)
    monkeypatch.setattr(app, 'UPLOAD_SCANNER', 'hamzury-nonexistent-scanner')
    with pytest.raises(HTTPException) as unavailable:
        app.validate_upload('file.pdf', b'%PDF-1.4 test')
    assert unavailable.value.status_code == 503
    monkeypatch.setattr(app.subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess(a, 1))
    with pytest.raises(HTTPException) as infected:
        app.validate_upload('file.pdf', b'%PDF-1.4 test')
    assert infected.value.status_code == 400


def test_health_checks_real_storage_and_body_limits(app, monkeypatch, tmp_path):
    t = TestClient(app.app)
    assert t.get('/api/health').status_code == 200
    bad = tmp_path / 'not-a-directory'
    bad.write_text('x')
    monkeypatch.setattr(app, 'FILES', bad)
    assert t.get('/api/health').status_code == 503
    assert t.post('/api/login', content=b'x' * (256 * 1024 + 1)).status_code == 413
    assert t.post('/api/login', content=iter([b'x' * (256 * 1024 + 1)]), headers={'Content-Type': 'application/json'}).status_code == 413


def test_database_connections_are_closed(app):
    with app.connect() as connection:
        assert connection.execute('SELECT 1').fetchone()[0] == 1
    with pytest.raises(sqlite3.ProgrammingError):
        connection.execute('SELECT 1')


def test_backup_restore_roundtrip_and_production_encryption_gate(app, monkeypatch, tmp_path):
    from tools import backup, restore
    client, admin, cid, package, eng = paid_job(app)
    payload = b'%PDF-1.4 backed-up delivery'
    assert admin.post(f"/api/admin/engagements/{eng['id']}/file", files={'file': ('delivery.pdf', payload)}).status_code == 200
    monkeypatch.setattr(backup, 'DB', app.DB)
    monkeypatch.setattr(backup, 'FILES', app.FILES)
    monkeypatch.setattr(backup, 'OUT', tmp_path / 'backups')
    monkeypatch.setattr(backup, 'RECIPIENT', '')
    backup.main()
    archive = next(backup.OUT.glob('*.tgz'))
    target = tmp_path / 'restored'
    restore.restore(archive, target)
    connection = sqlite3.connect(target / 'hamzury.sqlite3')
    try:
        stored = connection.execute('SELECT file_path FROM engagements WHERE id=?', (eng['id'],)).fetchone()[0]
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    finally:
        connection.close()
    assert (target / 'files' / stored).read_bytes() == payload
    with pytest.raises(ValueError, match='empty'):
        restore.restore(archive, target)
    monkeypatch.setenv('HAMZURY_ENV', 'production')
    with pytest.raises(RuntimeError, match='RECIPIENT'):
        backup.main()


def test_renewal_period_constraint_prevents_duplicate_paid_period(app, monkeypatch):
    client, admin, due = card_subscription(app)
    monkeypatch.setattr(app, 'paystack', lambda method, path, payload: {
        'status': True, 'data': {'status': 'success', 'amount': payload['amount'], 'currency': 'NGN'}})
    assert app.billing_run(due)['charged'] == 1
    with app.connect() as c:
        subscription = dict(c.execute('SELECT * FROM subscriptions').fetchone())
    subscription['next_due'] = due.isoformat()
    with pytest.raises(sqlite3.IntegrityError):
        with app.connect() as c:
            app.renewal_order(c, subscription, 'paystack')


def test_production_refuses_disabled_security_controls(app):
    env = os.environ.copy()
    env.update(HAMZURY_ENV='production', HAMZURY_SECURE_COOKIES='1',
               HAMZURY_PUBLIC_BASE_URL='https://example.test', HAMZURY_BILLING_KEY='b' * 40,
               HAMZURY_REQUIRE_STAFF_MFA='0', HAMZURY_REQUIRE_UPLOAD_SCAN='0')
    result = subprocess.run([sys.executable, '-c', 'import server'], env=env, capture_output=True, timeout=15)
    assert result.returncode != 0
    assert b'production requires' in result.stderr
