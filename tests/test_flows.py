import importlib, io, sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

PASS = 'local-test-only-not-a-real-password'
SECRET = 'local-test-secret-independent-and-at-least-32-characters-123'


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv('HAMZURY_ENV', 'development')
    monkeypatch.setenv('HAMZURY_REQUIRE_STAFF_MFA', '0')
    monkeypatch.setenv('HAMZURY_REQUIRE_UPLOAD_SCAN', '0')
    monkeypatch.setenv('HAMZURY_DB', str(tmp_path / 't.sqlite3'))
    monkeypatch.setenv('HAMZURY_FILES', str(tmp_path / 'files'))
    monkeypatch.setenv('HAMZURY_ADMIN_PASSWORD', PASS)
    monkeypatch.setenv('HAMZURY_SECRET', SECRET)
    monkeypatch.setenv('HAMZURY_BANK_DETAILS', 'sample bank details for testing')
    monkeypatch.delenv('HAMZURY_PAYSTACK_SECRET_KEY', raising=False)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import server
    server = importlib.reload(server)
    return server


def staff(server, username='owner', password=PASS):
    t = TestClient(server.app)
    r = t.post('/api/login', json={'username': username, 'password': password})
    assert r.status_code == 200, r.text
    t.headers['X-CSRF-Token'] = r.json()['csrf']
    return t


ANSWERS = {'path': 'grow', 'business': 'Ada Foods (fictional)', 'industry': 'food and drink', 'stage': 'running 1 to 3 years',
           'registered': 'yes', 'needs': ['more customers', 'a website'], 'challenge': 'orders come in on whatsapp and we lose track',
           'goal': 'more customers', 'timing': 'this month', 'team': '2 to 5', 'location': 'kaduna'}


def start(server):
    t = TestClient(server.app)
    r = t.post('/api/start', json={'answers': ANSWERS, 'name': 'Ada Test', 'phone': '+234 803 000 0001', 'consent': True})
    assert r.status_code == 200, r.text
    t.headers['X-CSRF-Token'] = r.json()['csrf']
    return t, r.json()['ref']


def test_pages_and_basics(app):
    t = TestClient(app.app)
    for path in ('/', '/start', '/track', '/admin', '/privacy', '/static/style.css', '/static/img/hamzury.png'):
        assert t.get(path).status_code == 200, path
    assert '—' not in t.get('/').text
    assert t.get('/api/client/me').status_code == 401
    assert t.get('/api/admin/clients').status_code == 401
    assert t.post('/api/start', json={'answers': ANSWERS, 'name': 'Ada', 'phone': '+2348030000001'}).status_code == 400  # consent
    bad = dict(ANSWERS, path='nonsense')
    assert t.post('/api/start', json={'answers': bad, 'name': 'Ada', 'phone': '+2348030000001', 'consent': True}).status_code == 400


def test_full_journey(app, tmp_path):
    client, ref = start(app)
    assert ref.startswith('HZ-')
    me = client.get('/api/client/me').json()
    assert me['step'] == 2 and me['recommendation'] is None
    # returning client logs in with id + phone (any formatting)
    other = TestClient(app.app)
    assert other.post('/api/client/login', json={'ref': ref, 'phone': '08030000002'}).status_code == 401
    assert other.post('/api/client/login', json={'ref': ref.lower().replace('hz-', ''), 'phone': '0803 000 0001'}).status_code == 200

    admin = staff(app)
    p1 = admin.post('/api/admin/packages', json={'venture': 'medialy', 'name': 'brand starter', 'summary': 'a clear brand',
        'inclusions': ['logo refresh', 'brand guide'], 'value': 'look consistent everywhere', 'duration': '3 weeks',
        'price_minor': 15000000, 'stage': 'strategy', 'onboarding': [{'label': 'link to your current logo', 'kind': 'text'}]}).json()['id']
    p2 = admin.post('/api/admin/packages', json={'venture': 'subt', 'name': 'order tracker', 'price_minor': 20000000,
        'inclusions': ['whatsapp order form'], 'duration': '4 weeks', 'onboarding': []}).json()['id']
    cid = admin.get('/api/admin/clients').json()[0]['id']
    assert admin.get(f'/api/admin/clients/{cid}').json()['intake']['challenge'].startswith('orders')
    assert admin.post(f'/api/admin/clients/{cid}/recommendation/publish').status_code == 400
    assert admin.put(f'/api/admin/clients/{cid}/recommendation', json={'heard': 'you lose orders', 'advice': 'start with brand and tracking',
        'items': [{'package_id': p1, 'priority': 1, 'note': 'first'}, {'package_id': p2, 'priority': 2, 'price_minor': 18000000}]}).status_code == 200
    assert client.get('/api/client/me').json()['recommendation'] is None  # drafts stay private
    assert admin.post(f'/api/admin/clients/{cid}/recommendation/publish').status_code == 200

    me = client.get('/api/client/me').json()
    assert me['step'] == 3
    items = me['recommendation']['items']
    assert [i['package']['price_minor'] for i in items] == [15000000, 18000000]
    assert items[0]['package']['inclusions'] == ['logo refresh', 'brand guide']
    # client chooses only the first package and pays by transfer
    assert client.post('/api/client/checkout', json={'accept_terms': True, 'items': [items[0]['id']], 'method': 'paystack'}).status_code == 400  # not configured
    order = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [items[0]['id']], 'method': 'transfer'}).json()
    assert order['total_minor'] == 15000000
    assert client.post(f"/api/client/orders/{order['order_id']}/transfer", json={'note': 'sent from gtb'}).status_code == 200
    assert admin.get('/api/admin/overview').json()['payments_to_confirm'] == 1
    assert admin.post(f"/api/admin/orders/{order['order_id']}/confirm").status_code == 200
    assert admin.post(f"/api/admin/orders/{order['order_id']}/confirm").status_code == 409

    me = client.get('/api/client/me').json()
    assert me['step'] == 4
    owned = [i for i in me['recommendation']['items'] if i['owned']]
    locked = [i for i in me['recommendation']['items'] if not i['owned']]
    assert len(owned) == 1 and len(locked) == 1 and owned[0]['engagement']['status'] == 'awaiting_onboarding'
    eid = owned[0]['engagement']['id']
    assert client.post(f'/api/client/engagements/{eid}/onboarding', json={'answers': {}}).status_code == 400
    assert client.post(f'/api/client/engagements/{eid}/onboarding', json={'answers': {'link to your current logo': 'drive link'}}).status_code == 200
    assert client.get('/api/client/me').json()['step'] == 5
    assert client.get(f'/api/client/engagements/{eid}/download').status_code == 404  # not delivered

    # delivery: cannot deliver without a file; venture staff cannot deliver
    assert admin.patch(f'/api/admin/engagements/{eid}', json={'status': 'in_progress', 'progress': 40}).status_code == 200
    up = admin.post(f'/api/admin/clients/{cid}/updates', json={'engagement_id': eid, 'progress': 'logo drafts done', 'next_action': 'review drafts'})
    assert ref in up.json()['whatsapp_text']
    assert admin.patch(f'/api/admin/engagements/{eid}', json={'status': 'delivered'}).status_code == 400
    assert admin.post(f'/api/admin/engagements/{eid}/file', files={'file': ('run.exe', b'x')}).status_code == 400
    assert admin.post(f'/api/admin/engagements/{eid}/file', files={'file': ('brand-guide.pdf', b'%PDF-1.4 test')}).status_code == 200
    admin.post('/api/users', json={'username': 'med', 'display_name': 'medialy ceo', 'password': 'venture-only-strong-pass', 'role': 'venture_ceo', 'venture': 'medialy'})
    ven = staff(app, 'med', 'venture-only-strong-pass')
    assert ven.get('/api/admin/clients').status_code == 403
    assert len(ven.get('/api/admin/engagements').json()) == 1
    assert ven.patch(f'/api/admin/engagements/{eid}', json={'status': 'delivered'}).status_code == 403
    assert admin.patch(f'/api/admin/engagements/{eid}', json={'status': 'delivered'}).status_code == 200
    me = client.get('/api/client/me').json()
    e = [i for i in me['recommendation']['items'] if i['owned']][0]['engagement']
    assert e['has_file'] and e['progress'] == 100 and me['updates'][0]['progress'] == 'logo drafts done'
    dl = client.get(f'/api/client/engagements/{eid}/download')
    assert dl.status_code == 200 and dl.content.startswith(b'%PDF')
    assert TestClient(app.app).get(f'/api/client/engagements/{eid}/download').status_code == 401
    # the locked package can still be added later; paid ones cannot be bought twice or removed
    assert client.post('/api/client/checkout', json={'accept_terms': True, 'items': [owned[0]['id']], 'method': 'transfer'}).status_code == 409
    assert admin.put(f'/api/admin/clients/{cid}/recommendation', json={'heard': '', 'advice': 'x', 'items': [{'package_id': p2}]}).status_code == 409
    second = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [locked[0]['id']], 'method': 'transfer'}).json()
    assert second['total_minor'] == 18000000


def test_client_isolation(app):
    a, ref_a = start(app)
    b = TestClient(app.app)
    rb = b.post('/api/start', json={'answers': ANSWERS, 'name': 'Bola', 'phone': '+2348039999999', 'consent': True}).json()
    b.headers['X-CSRF-Token'] = rb['csrf']
    admin = staff(app)
    pid = admin.post('/api/admin/packages', json={'venture': 'bizdoc', 'name': 'annual returns', 'price_minor': 5000000}).json()['id']
    ids = {c['ref']: c['id'] for c in admin.get('/api/admin/clients').json()}
    admin.put(f"/api/admin/clients/{ids[ref_a]}/recommendation", json={'advice': 'file returns', 'items': [{'package_id': pid}]})
    admin.post(f"/api/admin/clients/{ids[ref_a]}/recommendation/publish")
    item = a.get('/api/client/me').json()['recommendation']['items'][0]['id']
    assert b.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).status_code == 409  # b has no recommendation
    o = a.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    assert b.post(f"/api/client/orders/{o['order_id']}/transfer", json={}).status_code == 404
    no_csrf = TestClient(app.app)
    no_csrf.cookies = a.cookies
    assert no_csrf.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).status_code == 403


def test_paystack_verification(app, monkeypatch):
    monkeypatch.setattr(app, 'PAYSTACK_SECRET', 'sk_test_fake')
    calls = []

    def fake(method, path, payload=None):
        calls.append((method, path))
        if path == '/transaction/initialize':
            return {'status': True, 'data': {'authorization_url': 'https://checkout.paystack.com/abc'}}
        return {'status': True, 'data': {'status': 'success', 'amount': amount[0], 'currency': 'NGN'}}
    monkeypatch.setattr(app, 'paystack', fake)
    client, ref = start(app)
    admin = staff(app)
    pid = admin.post('/api/admin/packages', json={'venture': 'subt', 'name': 'website', 'price_minor': 30000000}).json()['id']
    cid = admin.get('/api/admin/clients').json()[0]['id']
    admin.put(f'/api/admin/clients/{cid}/recommendation', json={'advice': 'a site', 'items': [{'package_id': pid}]})
    admin.post(f'/api/admin/clients/{cid}/recommendation/publish')
    item = client.get('/api/client/me').json()['recommendation']['items'][0]['id']
    assert client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'paystack'}).status_code == 400  # needs email
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'paystack', 'email': 'ada@example.com'}).json()
    assert r['redirect'].startswith('https://checkout.paystack.com')
    amount = [1]  # wrong amount must not mark paid
    client.get('/pay/callback?reference=' + r['reference'], follow_redirects=False)
    assert client.get('/api/client/me').json()['step'] == 3
    amount = [30000000]
    res = client.get('/pay/callback?reference=' + r['reference'], follow_redirects=False)
    assert res.status_code == 303
    assert client.get('/api/client/me').json()['step'] == 5  # no onboarding questions, straight to progress


def test_venture_pages_and_branded_start(app):
    t = TestClient(app.app)
    admin = staff(app)
    admin.post('/api/admin/packages', json={'venture': 'bizdoc', 'name': 'annual returns', 'price_minor': 5000000, 'inclusions': ['filing']})
    admin.post('/api/admin/packages', json={'venture': 'bizdoc', 'name': 'hidden', 'price_minor': 1, 'active': False})
    assert t.get('/v/bizdoc').status_code == 200 and t.get('/v/nope').status_code == 404
    v = t.get('/api/public/ventures/bizdoc').json()
    assert v['site'] == 'https://bizdocconsult.com' and 'annual returns' in [s['name'] for s in v['services']] and 'hidden' not in [s['name'] for s in v['services']]
    assert 'price_minor' not in v['services'][0]
    assert t.get('/api/public/ventures/medialy').json()['site'] == ''  # unconfirmed address stays hidden
    answers = dict(ANSWERS, venture='bizdoc', tried=['doing it myself'], impact=['less stress'], importance='9')
    r = t.post('/api/start', json={'answers': answers, 'name': 'Bisi', 'phone': '+2348031111111', 'consent': True})
    assert r.status_code == 200
    t.headers['X-CSRF-Token'] = r.json()['csrf']
    assert t.get('/api/client/me').json()['told']['importance'] == '9'
    row = admin.get('/api/admin/clients').json()[0]
    assert row['source'] == 'bizdoc' and row['intake']['impact'] == ['less stress']


def test_assign_report_publish(app):
    client, ref = start(app)
    admin = staff(app)
    pid = admin.post('/api/admin/packages', json={'venture': 'subt', 'name': 'order tracker', 'price_minor': 20000000}).json()['id']
    cid = admin.get('/api/admin/clients').json()[0]['id']
    admin.put(f'/api/admin/clients/{cid}/recommendation', json={'advice': 'tracker', 'items': [{'package_id': pid}]})
    admin.post(f'/api/admin/clients/{cid}/recommendation/publish')
    item = client.get('/api/client/me').json()['recommendation']['items'][0]['id']
    o = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    admin.post(f"/api/admin/orders/{o['order_id']}/confirm")
    eid = admin.get('/api/admin/engagements').json()[0]['id']
    sid = admin.post('/api/users', json={'username': 'subtdev', 'display_name': 'subt dev', 'password': 'venture-only-strong-pass', 'role': 'venture_admin', 'venture': 'subt'}).json()['id']
    mid = admin.post('/api/users', json={'username': 'meddev', 'display_name': 'medialy dev', 'password': 'venture-only-strong-pass', 'role': 'venture_admin', 'venture': 'medialy'}).json()['id']
    assert admin.post(f'/api/admin/engagements/{eid}/assign', json={'assigned_user_id': mid}).status_code == 400  # wrong venture
    assert admin.post(f'/api/admin/engagements/{eid}/assign', json={'assigned_user_id': sid, 'due_date': '2026-12-01', 'brief': 'build the order form'}).status_code == 200
    ven = staff(app, 'subtdev', 'venture-only-strong-pass')
    work = ven.get('/api/admin/engagements').json()
    assert work[0]['brief'] == 'build the order form' and work[0]['situation']['challenge'].startswith('orders')
    assert ven.get('/api/admin/overview').json()['assigned_to_me'] == 1
    # ventures cannot talk to the client or change client-visible progress directly
    assert ven.post(f'/api/admin/clients/{cid}/updates', json={'engagement_id': eid, 'progress': 'x' * 5, 'next_action': 'y' * 5}).status_code == 403
    assert ven.patch(f'/api/admin/engagements/{eid}', json={'progress': 50}).status_code == 403
    rid = ven.post(f'/api/admin/engagements/{eid}/reports', json={'progress': 50, 'done': 'order form built', 'next_step': 'test with client'}).json()['id']
    assert client.get('/api/client/me').json()['recommendation']['items'][0]['engagement']['progress'] == 0  # not yet visible
    assert admin.get('/api/admin/overview').json()['reports_to_review'] == 1
    assert ven.post(f'/api/admin/reports/{rid}/publish', json={'progress': 50, 'done': 'x' * 5, 'next_step': 'y' * 5}).status_code == 403
    assert admin.post(f'/api/admin/reports/{rid}/return', json={'note': 'add a screenshot'}).status_code == 200
    assert ven.get('/api/admin/overview').json()['returned'] == 1
    rid2 = ven.post(f'/api/admin/engagements/{eid}/reports', json={'progress': 80, 'done': 'order form built and tested', 'next_step': 'final check', 'ready': True}).json()['id']
    pub = admin.post(f'/api/admin/reports/{rid2}/publish', json={'progress': 80, 'done': 'your order form is built and tested.', 'next_step': 'we do a final quality check.'})
    assert pub.status_code == 200 and ref in pub.json()['whatsapp_text']
    me = client.get('/api/client/me').json()
    e = me['recommendation']['items'][0]['engagement']
    assert e['progress'] == 80 and e['status'] == 'review' and me['updates'][0]['progress'] == 'your order form is built and tested.'
    assert admin.post(f'/api/admin/reports/{rid2}/publish', json={'progress': 80, 'done': 'xxx', 'next_step': 'yyy'}).status_code == 409


def test_quick_route_links_events_nudges_insights(app):
    t = TestClient(app.app)
    quick = {'route': 'quick', 'needs': ['a website or online shop', 'other'], 'needs_other': 'a booking page', 'urgency': 'this week', 'business': 'Speedy Ltd', 'src': 'wa'}
    r = t.post('/api/start', json={'answers': quick, 'name': 'Kunle', 'phone': '08035550000', 'consent': True})
    assert r.status_code == 200, r.text
    for step in (0, 0, 1, 2):
        assert t.post('/api/events', json={'flow': 'route', 'step': step}).status_code == 200
    assert t.post('/api/events', json={'flow': 'nope', 'step': 1}).status_code == 422
    assert t.get('/api/public/config').json()['quick_reply_hours'] == 24
    admin = staff(app)
    row = admin.get('/api/admin/clients').json()[0]
    assert row['path'] == 'quick' and row['intake']['needs_other'] == 'a booking page'
    n = admin.get('/api/admin/nudges').json()
    assert n[0]['kind'] == 'urgent' and n[0]['template'] == 'quick_reply'
    ins = admin.get('/api/admin/insights').json()
    assert ins['funnel']['started_questions'] == 2 and ins['funnel']['finished_questions'] == 1
    assert ins['by_route'] == {'quick': 1} and ins['by_source'] == {'whatsapp': 1}
    # private whatsapp link opens the client app without id and phone
    link = admin.post(f"/api/admin/clients/{row['id']}/link", json={'dest': 'recommendation'}).json()
    assert link['path'].startswith('/track?t=') and link['path'].endswith('#recommendation')
    token = link['path'].split('t=')[1].split('#')[0]
    fresh = TestClient(app.app)
    assert fresh.get('/api/client/me').status_code == 401
    lg = fresh.post('/api/client/link', json={'token': token})
    assert lg.status_code == 200 and lg.json()['dest'] == 'recommendation'
    fresh.headers['X-CSRF-Token'] = lg.json()['csrf']
    assert fresh.get('/api/client/me').json()['ref'] == row['ref']
    assert TestClient(app.app).post('/api/client/link', json={'token': 'x' * 40}).status_code == 401
    with app.connect() as c:
        c.execute('UPDATE client_links SET expires_at=0')
    assert TestClient(app.app).post('/api/client/link', json={'token': token}).status_code == 401
    assert TestClient(app.app).post('/api/admin/clients/1/link', json={'dest': 'home'}).status_code == 401


def pkg(admin, code):
    return next(p for p in admin.get('/api/admin/packages').json() if p['code'] == code)


def publish(admin, cid, items, advice='a'):
    r = admin.put(f'/api/admin/clients/{cid}/recommendation', json={'heard': '', 'advice': advice, 'items': items})
    assert r.status_code == 200, r.text
    return admin.post(f'/api/admin/clients/{cid}/recommendation/publish')


def test_roadmap_rules_choose_one_needs_first_and_i_have_this(app):
    client, ref = start(app)
    admin = staff(app)
    cid = admin.get('/api/admin/clients').json()[0]['id']
    bn, ltd, ngo, tm, sav = (pkg(admin, x) for x in ('BZ-01', 'BZ-02', 'BZ-16', 'BZ-04', 'MD-01'))
    for p in (bn, ltd, ngo, tm, sav):
        if p['price_status'] != 'approved':
            assert admin.post(f"/api/admin/packages/{p['id']}/approve", json={}).status_code == 200
    assert publish(admin, cid, [{'package_id': bn['id'], 'priority': 1}, {'package_id': ltd['id'], 'priority': 1}, {'package_id': ngo['id'], 'priority': 3},
                                {'package_id': tm['id'], 'priority': 2}, {'package_id': sav['id'], 'priority': 3, 'level': 'scaling'}]).status_code == 200
    me = client.get('/api/client/me').json()
    ids = {i['package']['code']: i for i in me['recommendation']['items']}
    assert ids['BZ-02']['package']['group'] == 'cac-registration' and ids['BZ-04']['package']['requires'] == ['BZ-02']
    assert me['focus'] == []  # published: the roadmap speaks for itself
    co = lambda *codes: client.post('/api/client/checkout', json={'accept_terms': True, 'items': [ids[c]['id'] for c in codes], 'method': 'transfer'})
    # no level lock: a scaling item can be chosen on its own
    assert co('MD-01').status_code == 200
    # choose one: two registration types together are refused
    r = co('BZ-01', 'BZ-02')
    assert r.status_code == 409 and 'choose one' in r.json()['detail']
    # needs first: trademark without the company registration is refused, with both it is fine
    r = co('BZ-04')
    assert r.status_code == 400 and ids['BZ-02']['package']['name'] in r.json()['detail']
    assert co('BZ-02', 'BZ-04').status_code == 200
    # one open purchase at a time: the earlier unpaid one was replaced
    assert [o['status'] for o in client.get('/api/client/me').json()['orders']][:2] == ['pending', 'cancelled']
    # "i have this" covers what is needed first
    assert client.post(f"/api/client/items/{ids['BZ-02']['id']}/have", json={'has': True}).status_code == 200
    assert co('BZ-04').status_code == 200
    # once a group item is bought, its alternatives cannot be bought too
    # "i have this" on one registration type counts as the choice: undo it to choose another
    assert co('BZ-16').status_code == 409
    assert client.post(f"/api/client/items/{ids['BZ-02']['id']}/have", json={'has': False}).status_code == 200
    assert co('BZ-16').status_code == 200
    oid = client.get('/api/client/me').json()['orders'][0]['id']
    assert admin.post(f'/api/admin/orders/{oid}/confirm').status_code == 200
    r = co('BZ-01')
    assert r.status_code == 409 and ngo['name'] in r.json()['detail']
    # save for later
    assert client.post(f"/api/client/items/{ids['MD-01']['id']}/save", json={'saved': True}).status_code == 200
    assert {i['package']['code']: i for i in client.get('/api/client/me').json()['recommendation']['items']}['MD-01']['saved']
    assert client.post(f"/api/client/items/{ids['MD-01']['id']}/have", json={'has': True}).status_code == 200
    assert [i for i in admin.get(f'/api/admin/clients/{cid}').json()['recommendation']['items'] if i['client_has']]
    # another client cannot touch these items
    other = TestClient(app.app)
    o = other.post('/api/start', json={'answers': ANSWERS, 'name': 'Bola', 'phone': '+234 803 000 0009', 'consent': True}).json()
    other.headers['X-CSRF-Token'] = o['csrf']
    assert other.post(f"/api/client/items/{ids['MD-01']['id']}/have", json={'has': True}).status_code == 404
    assert other.post(f"/api/client/items/{ids['MD-01']['id']}/save", json={'saved': True}).status_code == 404


def test_answers_make_a_draft_and_prices_need_approval(app):
    t = TestClient(app.app)
    ans = dict(ANSWERS, path='start', registered='not yet', needs=['register my business'])
    r = t.post('/api/start', json={'answers': ans, 'name': 'Idea Owner', 'phone': '+234 803 000 0011', 'consent': True})
    assert r.status_code == 200 and r.json()['focus'], r.text
    t.headers['X-CSRF-Token'] = r.json()['csrf']
    me = t.get('/api/client/me').json()
    assert me['recommendation'] is None and me['focus'] == r.json()['focus']
    assert '₦' not in ' '.join(me['focus']) and ',000' not in ' '.join(me['focus'])
    admin = staff(app)
    cid = admin.get('/api/admin/clients').json()[0]['id']
    rec = admin.get(f'/api/admin/clients/{cid}').json()['recommendation']
    codes = [i['code'] for i in rec['items']]
    assert 'BZ-01' in codes and rec['status'] == 'draft'
    assert sum(1 for x in codes if x in ('BZ-01', 'BZ-02', 'BZ-16')) == 1  # one registration type
    # proposed prices block publishing until the holding approves them
    r = admin.post(f'/api/admin/clients/{cid}/recommendation/publish')
    assert r.status_code == 400 and 'approve these prices' in r.json()['detail']
    bn = pkg(admin, 'BZ-01')
    assert admin.post(f"/api/admin/packages/{bn['id']}/approve", json={'price_minor': 2500000}).status_code == 200
    items = [{'package_id': bn['id'], 'priority': 1}]
    assert publish(admin, cid, items).status_code == 200
    item = t.get('/api/client/me').json()['recommendation']['items'][0]
    assert item['package']['price_minor'] == 2500000 and item['package']['price_status'] == 'approved'
    # staff without the holding role cannot approve prices
    assert admin.post('/api/users', json={'username': 'bzceo', 'display_name': 'bizdoc ceo', 'role': 'venture_ceo', 'venture': 'bizdoc', 'password': 'venture-only-strong-pass'}).status_code == 200
    bz = staff(app, 'bzceo', 'venture-only-strong-pass')
    assert bz.post(f"/api/admin/packages/{bn['id']}/approve", json={}).status_code in (401, 403)


def test_scuml_free_note_durations_and_catalogue(app):
    import catalogue as CAT
    by = CAT.BY_CODE
    assert all(by[c]['duration'].startswith('5') for c in ('BZ-05', 'BZ-06', 'BZ-07', 'BZ-02'))
    assert by['BZ-16']['duration'].startswith('30') and by['BZ-01']['duration'].startswith('14')
    assert all(by[c]['duration'].startswith('14') for c in ('BZ-17', 'BZ-18', 'BZ-19'))
    assert 'free' in by['BZ-05']['external']
    outside = {'BZ-01', 'BZ-03', 'BZ-11', 'BZ-16', 'BZ-17', 'BZ-18', 'BZ-19', 'BZ-20', 'BZ-21', 'BZ-22', 'BZ-23', 'BZ-24'}  # wait on cac, firs, the trademarks registry, agencies
    for i in CAT.CATALOGUE:
        assert i['name'] == i['name'].lower() and '—' not in i['value'] + i['name']
        d = i['duration'].replace('within ', '')
        if d[0].isdigit() and i['code'] not in outside:
            assert int(d.split()[0]) <= 7, (i['code'], i['duration'])  # anything we produce: 7 days at most
        if i['code'] in outside and i['code'] not in ('BZ-16',):
            assert d.startswith('14'), (i['code'], i['duration'])
    assert CAT.BY_CODE['ST-06']['price_minor'] == 18000000 and CAT.BY_CODE['ST-15']['price_minor'] == 35000000


def setup_monthly(app, method='transfer'):
    client, ref = start(app)
    admin = staff(app)
    cid = admin.get('/api/admin/clients').json()[0]['id']
    m = next(p for p in admin.get('/api/admin/packages').json() if p['basis'] == 'monthly')
    admin.post(f"/api/admin/packages/{m['id']}/approve", json={})
    assert publish(admin, cid, [{'package_id': m['id'], 'priority': 2, 'renewal': 'monthly', 'renewal_minor': m['price_minor']}]).status_code == 200
    item = client.get('/api/client/me').json()['recommendation']['items'][0]['id']
    return client, admin, cid, m, item


def test_monthly_by_transfer_invoices_reminds_pauses_and_cancels(app, monkeypatch):
    client, admin, cid, m, item = setup_monthly(app)
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    assert r['total_minor'] == m['price_minor']  # the first month is paid upfront
    admin.post(f"/api/admin/orders/{r['order_id']}/confirm")
    me = client.get('/api/client/me').json()
    s = me['subscriptions'][0]
    assert s['status'] == 'active' and s['amount_minor'] == m['price_minor']
    due = app.datetime.date.fromisoformat(s['next_due'])
    with app.connect() as c:
        assert app.billing_run(due - app.datetime.timedelta(days=4))['invoiced'] == 0
        assert app.billing_run(due - app.datetime.timedelta(days=3))['invoiced'] == 1
        assert app.billing_run(due - app.datetime.timedelta(days=2))['invoiced'] == 0  # once only
    me = client.get('/api/client/me').json()
    assert len(me['invoices']) == 1 and me['orders'][0]['status'] == 'paid'  # purchases and invoices stay apart
    kinds = [n['kind'] for n in admin.get('/api/admin/nudges').json()]
    assert 'renewal_due' in kinds and 'payment_pending' not in kinds
    with app.connect() as c:
        app.billing_run(due + app.datetime.timedelta(days=1))
    assert 'renewal_overdue' in [n['kind'] for n in admin.get('/api/admin/nudges').json()]
    with app.connect() as c:
        assert app.billing_run(due + app.datetime.timedelta(days=8))['paused'] == 1
    assert client.get('/api/client/me').json()['subscriptions'][0]['status'] == 'paused'
    # paying the invoice late restarts the service from today
    inv = client.get('/api/client/me').json()['invoices'][0]
    assert client.post(f"/api/client/orders/{inv['id']}/transfer", json={'note': 'paid'}).status_code == 200
    admin.post(f"/api/admin/orders/{inv['id']}/confirm")
    s = client.get('/api/client/me').json()['subscriptions'][0]
    assert s['status'] == 'active' and s['next_due'] > due.isoformat()
    # cancel: runs to the end of the paid month, then ends without a new invoice
    assert client.post(f"/api/client/subscriptions/{s['id']}/cancel").json()['cancel_at'] == s['next_due']
    assert client.post(f"/api/client/subscriptions/{s['id']}/keep").json()['cancel_at'] is None
    client.post(f"/api/client/subscriptions/{s['id']}/cancel")
    end = app.datetime.date.fromisoformat(s['next_due'])
    with app.connect() as c:
        assert app.billing_run(end - app.datetime.timedelta(days=3))['invoiced'] == 0
        assert app.billing_run(end)['ended'] == 1
    assert client.get('/api/client/me').json()['subscriptions'] == []
    # the cron door needs the key
    assert TestClient(app.app).post('/api/billing/run').status_code == 401
    monkeypatch.setattr(app, 'BILLING_KEY', 'k' * 40)
    assert TestClient(app.app).post('/api/billing/run', headers={'X-Billing-Key': 'k' * 40}).status_code == 200


def test_monthly_by_card_charges_retries_without_double_charging(app, monkeypatch):
    monkeypatch.setattr(app, 'PAYSTACK_SECRET', 'sk_test_fake')
    state = {'charge': 'success', 'verify': 'success', 'calls': []}

    def fake(method, path, payload=None):
        state['calls'].append(path.split('/')[2] if path.count('/') > 1 else path)
        if path == '/transaction/initialize':
            return {'status': True, 'data': {'authorization_url': 'https://checkout.paystack.com/abc'}}
        if path == '/transaction/charge_authorization':
            return {'status': True, 'data': {'status': state['charge'], 'amount': payload['amount'], 'currency': 'NGN'}}
        with app.connect() as c:
            o = c.execute('SELECT total_minor FROM orders WHERE reference=?', (path.rsplit('/', 1)[1],)).fetchone()
        return {'status': True, 'data': {'status': state['verify'], 'amount': o['total_minor'], 'currency': 'NGN',
                                         'authorization': {'reusable': True, 'authorization_code': 'AUTH_x'}}}
    monkeypatch.setattr(app, 'paystack', fake)
    client, admin, cid, m, item = setup_monthly(app)
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'paystack', 'email': 'ada@example.com'}).json()
    client.get('/pay/callback?reference=' + r['reference'], follow_redirects=False)
    s = client.get('/api/client/me').json()['subscriptions'][0]
    assert s['method'] == 'paystack'
    due = app.datetime.date.fromisoformat(s['next_due'])
    with app.connect() as c:
        assert app.billing_run(due - app.datetime.timedelta(days=1))['charged'] == 0  # cards are charged on the day
        assert app.billing_run(due)['charged'] == 1
    s2 = client.get('/api/client/me').json()['subscriptions'][0]
    assert s2['next_due'] > s['next_due'] and s2['status'] == 'active'
    # a declined card: grace, the invoice stays open for the client, no retry inside two days
    state['charge'] = 'failed'
    due2 = app.datetime.date.fromisoformat(s2['next_due'])
    with app.connect() as c:
        assert app.billing_run(due2)['declined'] == 1
        assert app.billing_run(due2)['declined'] == 0
    me = client.get('/api/client/me').json()
    assert me['subscriptions'][0]['status'] == 'grace' and len(me['invoices']) == 1
    # an attempt still with the bank is never charged again
    with app.connect() as c:
        c.execute("UPDATE orders SET created_at=datetime('now','-3 day') WHERE kind='renewal' AND status='pending'")
    state['verify'] = 'ongoing'
    n = state['calls'].count('charge_authorization')
    with app.connect() as c:
        app.billing_run(due2 + app.datetime.timedelta(days=2))
    assert state['calls'].count('charge_authorization') == n
    # once the bank says it failed, we try again with a fresh reference
    state['verify'], state['charge'] = 'failed', 'success'
    with app.connect() as c:
        assert app.billing_run(due2 + app.datetime.timedelta(days=2))['charged'] == 1
    me = client.get('/api/client/me').json()
    assert me['subscriptions'][0]['status'] == 'active' and me['invoices'] == []


def test_plan_eta_and_ask_first_items(app):
    client, ref = start(app)
    admin = staff(app)
    a = admin.post('/api/admin/packages', json={'venture': 'bizdoc', 'name': 'registration', 'price_minor': 5000000, 'inclusions': [], 'onboarding': []}).json()['id']
    tax = admin.post('/api/admin/packages', json={'venture': 'bizdoc', 'name': 'tax filing', 'price_minor': 0, 'inclusions': [],
        'onboarding': [{'label': 'when is your filing due?', 'kind': 'text'}]}).json()['id']
    cid = admin.get('/api/admin/clients').json()[0]['id']
    assert admin.patch(f'/api/admin/clients/{cid}', json={'plan_eta': 'within 4 working hours'}).status_code == 200
    assert client.get('/api/client/me').json()['plan_eta'] == 'within 4 working hours'
    assert admin.put(f'/api/admin/clients/{cid}/recommendation', json={'heard': '', 'advice': 'a', 'items': [
        {'package_id': a, 'level': 'minimum', 'priority': 1}, {'package_id': tax, 'level': 'renewals', 'quote': 'ask'}]}).status_code == 200
    assert admin.post(f'/api/admin/clients/{cid}/recommendation/publish').status_code == 200
    items = {i['package']['name']: i for i in client.get('/api/client/me').json()['recommendation']['items']}
    assert items['tax filing']['quote'] == 'ask' and items['tax filing']['level'] == 'renewals'
    # renewals is always open, but an ask-first item cannot be paid before the desk sends the route
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [items['tax filing']['id']], 'method': 'transfer'})
    assert r.status_code == 400 and 'route' in r.json()['detail']
    assert client.post(f"/api/client/items/{items['tax filing']['id']}/request", json={'answers': {}}).status_code == 400
    assert client.post(f"/api/client/items/{items['tax filing']['id']}/request", json={'answers': {'when is your filing due?': 'march'}}).status_code == 200
    assert client.get('/api/client/me').json()['recommendation']['items'][1]['requested'] is True
    desk_items = admin.get(f'/api/admin/clients/{cid}').json()['recommendation']['items']
    assert any(i['request'] and 'march' in i['request'] for i in desk_items)
    # the desk sets a fee and switches it to fixed: now it can be paid on its own, without covering minimum
    assert admin.put(f'/api/admin/clients/{cid}/recommendation', json={'heard': '', 'advice': 'a', 'items': [
        {'package_id': a, 'level': 'minimum', 'priority': 1}, {'package_id': tax, 'level': 'renewals', 'quote': 'fixed', 'price_minor': 3000000}]}).status_code == 200
    assert client.post('/api/client/checkout', json={'accept_terms': True, 'items': [items['tax filing']['id']], 'method': 'transfer'}).json()['total_minor'] == 3000000


def test_venture_questions_are_kept(app):
    c = TestClient(app.app)
    r = c.post('/api/start', json={'answers': {'route': 'venture', 'path': 'service', 'venture': 'bizdoc', 'needs': ['licences, permits or approvals for my sector'],
        'situation': 'registered, i need licences or permits', 'situation_q': 'where are your papers right now?', 'details': ['mining'], 'details_q': 'which sector are you in?',
        'urgency': 'within a month'}, 'name': 'Musa Bello', 'phone': '+234 803 000 0042', 'consent': True})
    assert r.status_code == 200, r.text
    admin = staff(app)
    cl = [x for x in admin.get('/api/admin/clients').json() if x['ref'] == r.json()['ref']][0]
    it = admin.get(f"/api/admin/clients/{cl['id']}").json()['intake']
    assert it['route'] == 'venture' and it['situation'].startswith('registered') and it['details'] == ['mining'] and it['situation_q'].startswith('where')


def test_onboarding_attachment_with_reason(app):
    client, ref = start(app)
    admin = staff(app)
    pid = admin.post('/api/admin/packages', json={'venture': 'bizdoc', 'name': 'licence application', 'price_minor': 5000000, 'inclusions': [], 'onboarding': [
        {'label': 'your cac certificate', 'kind': 'file', 'required': True, 'why': 'the licence form asks for your registration number and date.'},
        {'label': 'anything else we should know?', 'kind': 'long', 'required': False}]}).json()['id']
    cid = admin.get('/api/admin/clients').json()[0]['id']
    admin.put(f'/api/admin/clients/{cid}/recommendation', json={'heard': '', 'advice': 'a', 'items': [{'package_id': pid, 'level': 'minimum'}]})
    admin.post(f'/api/admin/clients/{cid}/recommendation/publish')
    item = client.get('/api/client/me').json()['recommendation']['items'][0]
    assert item['package']['onboarding'][0]['why'].startswith('the licence form')
    o = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item['id']], 'method': 'transfer'}).json()
    admin.post(f"/api/admin/orders/{o['order_id']}/confirm")
    eid = client.get('/api/client/me').json()['recommendation']['items'][0]['engagement']['id']
    # a file is required: submitting without it is refused
    r = client.post(f'/api/client/engagements/{eid}/onboarding', json={'answers': {}})
    assert r.status_code == 400 and 'attach' in r.json()['detail']
    # wrong question index and bad file type are refused
    assert client.post(f'/api/client/engagements/{eid}/attachment?q=1', files={'file': ('a.pdf', b'%PDF-1.4 x', 'application/pdf')}).status_code == 400
    assert client.post(f'/api/client/engagements/{eid}/attachment?q=0', files={'file': ('a.exe', b'MZ', 'application/octet-stream')}).status_code == 400
    assert client.post(f'/api/client/engagements/{eid}/attachment?q=0', files={'file': ('cac.pdf', b'%PDF-1.4 cac', 'application/pdf')}).json()['name'] == 'cac.pdf'
    assert client.get('/api/client/me').json()['recommendation']['items'][0]['engagement']['attachments'] == {'0': 'cac.pdf'}
    assert client.post(f'/api/client/engagements/{eid}/onboarding', json={'answers': {}}).status_code == 200
    eng = admin.get(f'/api/admin/clients/{cid}').json()['engagements'][0]
    assert eng['onboarding']['your cac certificate'] == 'file: cac.pdf' and eng['attachments'][0]['name'] == 'cac.pdf' and 'stored' not in eng['attachments'][0]
    got = admin.get(f'/api/admin/engagements/{eid}/attachment/0')
    assert got.status_code == 200 and got.content == b'%PDF-1.4 cac'
    # another client cannot upload to this engagement
    other = TestClient(app.app)
    x = other.post('/api/start', json={'answers': ANSWERS, 'name': 'Bola', 'phone': '+234 803 000 0011', 'consent': True}).json()
    other.headers['X-CSRF-Token'] = x['csrf']
    assert other.post(f'/api/client/engagements/{eid}/attachment?q=0', files={'file': ('b.pdf', b'%PDF', 'application/pdf')}).status_code == 404


def test_money_edge_cases_found_in_review(app, monkeypatch):
    import datetime as dt
    # months keep their billing day: 31 jan -> 28 feb -> 31 mar
    assert app.add_month(dt.date(2027, 1, 31), 31) == dt.date(2027, 2, 28) and app.add_month(dt.date(2027, 2, 28), 31) == dt.date(2027, 3, 31)
    client, admin, cid, m, item = setup_monthly(app)
    # an unapproved price never leaves the server
    bz17 = pkg(admin, 'BZ-17')
    assert bz17['price_status'] == 'proposed'
    rec = admin.get(f'/api/admin/clients/{cid}').json()['recommendation']
    items = [{'package_id': i['package_id'], 'priority': i['priority'], 'renewal': i['renewal'], 'renewal_minor': i['renewal_minor']} for i in rec['items']]
    publish(admin, cid, items + [{'package_id': bz17['id'], 'priority': 2, 'assess': 'verify'}])
    x = {i['package']['code']: i for i in client.get('/api/client/me').json()['recommendation']['items']}['BZ-17']
    assert x['package']['price_minor'] == 0 and x['fee_pending'] and x['assess'] == 'verify'
    # approving after publish reprices the client's unpaid item; zero and quoted prices cannot be approved
    assert admin.post(f"/api/admin/packages/{bz17['id']}/approve", json={'price_minor': 0}).status_code == 422
    assert admin.post(f"/api/admin/packages/{pkg(admin, 'BZ-21')['id']}/approve", json={'price_minor': 100}).status_code == 400
    assert admin.post(f"/api/admin/packages/{bz17['id']}/approve", json={'price_minor': 5500000}).status_code == 200
    publish(admin, cid, items + [{'package_id': bz17['id'], 'priority': 2}])
    x = {i['package']['code']: i for i in client.get('/api/client/me').json()['recommendation']['items']}['BZ-17']
    assert x['package']['price_minor'] == 5500000 and not x['fee_pending']
    # a reported transfer is never cancelled by a new checkout
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    client.post(f"/api/client/orders/{r['order_id']}/transfer", json={'note': 'sent'})
    assert client.post('/api/client/checkout', json={'accept_terms': True, 'items': [x['id']], 'method': 'transfer'}).status_code == 409
    # the desk can say a transfer has not arrived, then confirm it later
    assert admin.post(f"/api/admin/orders/{r['order_id']}/reject", json={'note': 'checked at 2pm'}).status_code == 200
    assert client.get('/api/client/me').json()['orders'][0]['status'] == 'pending'
    with app.connect() as c:
        o = c.execute('SELECT * FROM orders WHERE id=?', (r['order_id'],)).fetchone()
        assert app.mark_paid(c, o, 'a') is True and app.mark_paid(c, o, 'b') is False  # a stale row cannot pay twice
    s = client.get('/api/client/me').json()['subscriptions'][0]
    # the desk buttons work
    assert admin.patch(f"/api/admin/subscriptions/{s['id']}", json={'status': 'paused'}).json()['status'] == 'paused'
    assert admin.patch(f"/api/admin/subscriptions/{s['id']}", json={'status': 'active'}).json()['status'] == 'active'
    # money for a service that has ended is flagged for a refund, not used to extend it
    due = dt.date.fromisoformat(s['next_due'])
    app.billing_run(due - dt.timedelta(days=3))
    inv = client.get('/api/client/me').json()['invoices'][0]
    client.post(f"/api/client/orders/{inv['id']}/transfer", json={'note': 'paid'})
    client.post(f"/api/client/subscriptions/{s['id']}/cancel")
    admin.post(f"/api/admin/orders/{inv['id']}/confirm")
    assert [o for o in admin.get('/api/admin/orders').json() if o['id'] == inv['id']][0]['status'] == 'refund_due'
    app.billing_run(due)
    assert client.get('/api/client/me').json()['subscriptions'] == []
    # an ended monthly service can be bought again, and starts again
    assert client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).status_code == 200
    oid = client.get('/api/client/me').json()['orders'][0]['id']
    admin.post(f'/api/admin/orders/{oid}/confirm')
    assert client.get('/api/client/me').json()['subscriptions'][0]['status'] == 'active'
    # a cron key with odd characters is refused, not a crash
    monkeypatch.setattr(app, 'BILLING_KEY', 'k' * 40)
    with pytest.raises(app.HTTPException) as e:
        app.billing_run_cron(key='kéy')
    assert e.value.status_code == 401


def test_missed_billing_runs_charge_before_pausing(app, monkeypatch):
    monkeypatch.setattr(app, 'PAYSTACK_SECRET', 'sk_test_fake')
    calls = []

    def fake(method, path, payload=None):
        calls.append(path)
        if path == '/transaction/initialize':
            return {'status': True, 'data': {'authorization_url': 'https://checkout.paystack.com/abc'}}
        if path == '/transaction/charge_authorization':
            return {'status': True, 'data': {'status': 'success', 'amount': payload['amount'], 'currency': 'NGN'}}
        with app.connect() as c:
            o = c.execute('SELECT total_minor FROM orders WHERE reference=?', (path.rsplit('/', 1)[1],)).fetchone()
        return {'status': True, 'data': {'status': 'success', 'amount': o['total_minor'], 'currency': 'NGN', 'authorization': {'reusable': True, 'authorization_code': 'AUTH_x'}}}
    monkeypatch.setattr(app, 'paystack', fake)
    client, admin, cid, m, item = setup_monthly(app)
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'paystack', 'email': 'ada@example.com'}).json()
    client.get('/pay/callback?reference=' + r['reference'], follow_redirects=False)
    s = client.get('/api/client/me').json()['subscriptions'][0]
    import datetime as dt
    out = app.billing_run(dt.date.fromisoformat(s['next_due']) + dt.timedelta(days=10))  # the scheduler was down for 10 days
    assert out['charged'] == 1 and out['paused'] == 0


def paid_job(app):
    """a client with one paid, one-off package (ST-04, 7 days) and its engagement."""
    client, ref = start(app)
    admin = staff(app)
    cid = admin.get('/api/admin/clients').json()[0]['id']
    p = pkg(admin, 'ST-04')
    admin.post(f"/api/admin/packages/{p['id']}/approve", json={})
    publish(admin, cid, [{'package_id': p['id'], 'priority': 1}])
    item = client.get('/api/client/me').json()['recommendation']['items'][0]['id']
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    admin.post(f"/api/admin/orders/{r['order_id']}/confirm")
    eng = admin.get('/api/admin/engagements').json()[0]
    return client, admin, cid, p, eng


def test_finance_desk_vat_and_terms(app):
    client, ref = start(app)
    admin = staff(app)
    assert admin.post('/api/users', json={'username': 'finance', 'display_name': 'finance lead', 'role': 'finance', 'password': 'finance-strong-pass-1', 'phone': '+234 800 000 0000'}).status_code == 200
    fin = staff(app, 'finance', 'finance-strong-pass-1')
    # finance sees money, not client work
    assert fin.get('/api/admin/money').status_code == 200 and fin.get('/api/admin/orders').status_code == 200
    assert fin.get('/api/admin/engagements').status_code == 403 and fin.get('/api/admin/clients').status_code == 403
    assert fin.get('/api/admin/overview').json() == {'finance': True}
    # vat is off until finance turns it on; venture staff cannot change it
    assert fin.get('/api/admin/settings').json()['vat_registered'] is False
    assert fin.put('/api/admin/settings', json={'entity_name': 'hamzury holding limited', 'vat_registered': True, 'vat_rate_bp': 750}).status_code == 200
    assert fin.put('/api/admin/finance-checks/entity', json={'done': True}).status_code == 200
    assert [x for x in fin.get('/api/admin/settings').json()['finance_checks'] if x['key'] == 'entity'][0]['done']
    cid = admin.get('/api/admin/clients').json()[0]['id']
    p, gov = pkg(admin, 'ST-04'), pkg(admin, 'BZ-03')
    for x in (p, gov):
        admin.post(f"/api/admin/packages/{x['id']}/approve", json={})
    assert fin.patch(f"/api/admin/packages/{gov['id']}/vat", json={'vat': False}).status_code == 200
    publish(admin, cid, [{'package_id': p['id'], 'priority': 1}, {'package_id': gov['id'], 'priority': 1}])
    me = client.get('/api/client/me').json()
    assert me['pricing']['vat_registered'] and me['pricing']['entity_name'] == 'hamzury holding limited'
    ids = [i['id'] for i in me['recommendation']['items']]
    # terms must be accepted
    assert client.post('/api/client/checkout', json={'items': ids, 'method': 'transfer'}).status_code == 400
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': ids, 'method': 'transfer'}).json()
    assert r['subtotal_minor'] == p['price_minor'] + gov['price_minor']
    assert r['vat_minor'] == round(p['price_minor'] * 0.075) and r['total_minor'] == r['subtotal_minor'] + r['vat_minor']
    ag = client.get('/api/client/me').json()['agreements'][0]
    assert ag['terms_version'] == app.TERMS_VERSION and ag['accepted_at'] and ag['proposal_version']
    # finance confirms the transfer; a refund-due payment can be closed by finance
    assert fin.post(f"/api/admin/orders/{r['order_id']}/confirm").status_code == 200
    assert fin.post(f"/api/admin/orders/{r['order_id']}/refunded").status_code == 409
    assert TestClient(app.app).get('/terms').status_code == 200


def test_venture_follow_up_loop(app, monkeypatch):
    client, admin, cid, p, eng = paid_job(app)
    assert admin.post('/api/users', json={'username': 'subtlead', 'display_name': 'subt lead', 'role': 'venture_ceo', 'venture': 'subt',
                                           'password': 'venture-strong-pass-1', 'phone': '+234 803 222 3333'}).status_code == 200
    uid = [u for u in admin.get('/api/users').json() if u['username'] == 'subtlead'][0]['id']
    # assigning without a date sets one from the catalogue duration (7 days)
    assert admin.post(f"/api/admin/engagements/{eng['id']}/assign", json={'assigned_user_id': uid, 'brief': 'set up the tracker'}).status_code == 200
    e = admin.get('/api/admin/engagements').json()[0]
    import datetime as dt
    assert e['due_date'] == (app.today() + dt.timedelta(days=app.days_in(p['duration']))).isoformat() and e['update_state'] == 'on_track'
    v = staff(app, 'subtlead', 'venture-strong-pass-1')
    assert [x['id'] for x in v.get('/api/admin/engagements').json()] == [eng['id']]
    # no update for 48 hours: the holding is told who to chase
    monkeypatch.setattr(app, 'UPDATE_HOURS', 0)
    n = [x for x in admin.get('/api/admin/nudges').json() if x['kind'] == 'venture_late']
    assert n and n[0]['phone'] == '+234 803 222 3333' and n[0]['to'] == 'venture'
    monkeypatch.setattr(app, 'UPDATE_HOURS', 48)
    # the client asks for an update; once a day
    assert client.post(f"/api/client/engagements/{eng['id']}/ask").status_code == 200
    assert client.post(f"/api/client/engagements/{eng['id']}/ask").status_code == 429
    assert 'client_asked' in [x['kind'] for x in admin.get('/api/admin/nudges').json()]
    assert v.get('/api/admin/engagements').json()[0]['update_requested_at']
    # the venture reports a blocker, the holding publishes, the request is answered
    assert v.post(f"/api/admin/engagements/{eng['id']}/reports", json={'progress': 40, 'done': 'tracker built', 'blocker': 'waiting for the price list', 'next_step': 'load products'}).status_code == 200
    assert 'blocker' in [x['kind'] for x in admin.get('/api/admin/nudges').json()]
    rid = admin.get('/api/admin/reports').json()[0]['id']
    assert admin.post(f'/api/admin/reports/{rid}/publish', json={'progress': 40, 'done': 'tracker built', 'blocker': '', 'next_step': 'load products'}).status_code == 200
    assert not admin.get('/api/admin/engagements').json()[0]['update_requested_at']
    sb = {s['venture']: s for s in admin.get('/api/admin/scoreboard').json()}
    assert sb['subt']['open'] == 1 and sb['subt']['past_due'] == 0
    # handover: never passwords
    assert v.put(f"/api/admin/engagements/{eng['id']}/handover", json={'accounts': [{'service': 'tracker', 'login_url': 'https://x', 'account_email': 'a@b.c', 'recovery_owner': 'password: 123'}]}).status_code == 400
    assert v.put(f"/api/admin/engagements/{eng['id']}/handover", json={'accounts': [{'service': 'tracker', 'login_url': 'https://sheets.example', 'account_email': 'ada@example.com', 'recovery_owner': 'ada'}],
                                                                     'copies_given': True, 'client_owns_accounts': True, 'staff_access_removed': True}).status_code == 200
    item = client.get('/api/client/me').json()['recommendation']['items'][0]
    assert item['engagement']['handover']['accounts'][0]['account_email'] == 'ada@example.com'
    # another venture cannot see or touch it
    admin.post('/api/users', json={'username': 'medlead', 'display_name': 'medialy lead', 'role': 'venture_ceo', 'venture': 'medialy', 'password': 'venture-strong-pass-2'})
    m = staff(app, 'medlead', 'venture-strong-pass-2')
    assert m.get('/api/admin/engagements').json() == [] and m.put(f"/api/admin/engagements/{eng['id']}/handover", json={}).status_code == 403


def test_retention_removes_on_schedule_and_respects_hold(app):
    import datetime as dt
    t = TestClient(app.app)
    t.post('/api/start', json={'answers': ANSWERS, 'name': 'Old Enquiry', 'phone': '+234 803 000 0077', 'consent': True})
    t2 = TestClient(app.app)
    t2.post('/api/start', json={'answers': ANSWERS, 'name': 'Kept Enquiry', 'phone': '+234 803 000 0078', 'consent': True})
    admin = staff(app)
    ids = {c['name']: c['id'] for c in admin.get('/api/admin/clients').json()}
    assert admin.post(f"/api/admin/clients/{ids['Kept Enquiry']}/hold", json={'hold': True}).status_code == 200
    assert app.retention_run(app.today())['enquiries_removed'] == 0  # recent: kept
    out = app.retention_run(app.today() + dt.timedelta(days=91))
    assert out['enquiries_removed'] == 1
    names = {c['id']: c['name'] for c in admin.get('/api/admin/clients').json()}
    assert names[ids['Old Enquiry']] == 'removed' and names[ids['Kept Enquiry']] == 'Kept Enquiry'
    assert TestClient(app.app).post('/api/daily/run').status_code == 401


def test_review_fixes_retention_never_wipes_a_payer(app, monkeypatch):
    import datetime as dt
    client, ref = start(app)
    admin = staff(app)
    cid = admin.get('/api/admin/clients').json()[0]['id']
    p = pkg(admin, 'ST-04')
    admin.post(f"/api/admin/packages/{p['id']}/approve", json={})
    publish(admin, cid, [{'package_id': p['id'], 'priority': 1}])
    item = client.get('/api/client/me').json()['recommendation']['items'][0]['id']
    r = client.post('/api/client/checkout', json={'accept_terms': True, 'items': [item], 'method': 'transfer'}).json()
    # a pending transfer, untouched for 100 days, is never removed
    assert app.retention_run(app.today() + dt.timedelta(days=100))['enquiries_removed'] == 0
    # if an enquiry was removed and money turns up later, it becomes a refund, never work for "removed"
    with app.connect() as c:
        c.execute("UPDATE orders SET status='cancelled' WHERE id=?", (r['order_id'],))
        c.execute("UPDATE clients SET purged_at=CURRENT_TIMESTAMP WHERE id=?", (cid,))
        c.execute("UPDATE orders SET status='pending' WHERE id=?", (r['order_id'],))
    assert admin.post(f"/api/admin/orders/{r['order_id']}/confirm").status_code == 200
    assert [o for o in admin.get('/api/admin/orders').json() if o['id'] == r['order_id']][0]['status'] == 'refund_due'
    assert admin.get('/api/admin/engagements').json() == []
    # vat rounds half up, the same as the page
    pr = {'vat_registered': True, 'vat_rate_bp': 750}
    assert app.vat_of(1500300, True, pr) == 112523 and app.vat_of(1000, False, pr) == 0
    # handover refuses anything that looks like a secret, in notes too
    assert app.SECRET_WORDS.search('pwd 1234') and app.SECRET_WORDS.search('the PIN is') and not app.SECRET_WORDS.search('pinterest page')


def test_review_fixes_follow_up_and_versions(app):
    client, admin, cid, p, eng = paid_job(app)
    with app.connect() as c:
        c.execute("UPDATE engagements SET status='review',assigned_user_id=1,assigned_at=datetime('now','-10 day') WHERE id=?", (eng['id'],))
    assert admin.get('/api/admin/engagements').json()[0]['update_state'] == 'not_required'  # waiting on holding, not the venture
    ag = client.get('/api/client/me').json()['agreements'][0]
    assert len(ag['proposal_version'].split('-')[-1]) == 10


def test_office_page_and_share_links(app):
    t = TestClient(app.app)
    assert t.get('/visit').status_code == 200
    r = t.get('/visit/abuja', follow_redirects=False)
    assert r.status_code == 302 and '9.028329' in r.headers['location']
    r = t.get('/visit/jos', follow_redirects=False)
    assert r.status_code == 302 and 'hamzury+innovation+hub' in r.headers['location']
    assert t.get('/visit/kano', follow_redirects=False).headers['location'] == '/visit'
