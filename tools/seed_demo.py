"""Load a SAMPLE catalogue for testing the journey. Names and fees are examples only.

usage:  HAMZURY_DB=... HAMZURY_ADMIN_PASSWORD=... HAMZURY_SECRET=... python tools/seed_demo.py
replace every sample with your approved packages and fees before real use.
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

SAMPLES = [
    ('bizdoc', 'structure', 'business name registration (sample)', 'register your business name with cac.',
     ['name availability search', 'registration filing', 'certificate delivered as pdf', 'next compliance dates explained'],
     'you can open a business account, sign contracts and apply for opportunities with confidence.', '1 to 2 weeks', 5000000,
     [{'label': 'three name options, in order of preference', 'kind': 'long', 'why': 'cac may reject a name that is taken, so we check all three in order.'},
      {'label': 'what will the business do?', 'kind': 'long', 'why': 'the registration needs a clear description of your business activity.'},
      {'label': 'a valid id for each owner (nin slip, passport or driver\'s licence)', 'kind': 'file', 'why': 'cac asks for proof of identity for every owner.'}]),
    ('bizdoc', 'structure', 'annual compliance pack (sample)', 'stay ready for checks all year.',
     ['annual returns filing', 'compliance calendar', 'reminders before each deadline'], 'no penalties and no last-minute panic.', '2 weeks', 7500000,
     [{'label': 'your cac registration number', 'kind': 'text', 'why': 'we use it to find your records and file the returns for the right company.'},
      {'label': 'your last annual return, if you have it', 'kind': 'file', 'required': False, 'why': 'it shows which years are already filed, so you never pay twice.'}]),
    ('medialy', 'strategy', 'brand starter (sample)', 'a clear, consistent look and message.',
     ['logo refresh', 'colours and fonts', 'one-page brand guide', '5 social media templates'], 'customers recognise and trust you everywhere they see you.', '3 weeks', 15000000,
     [{'label': 'link to your current logo or social page', 'kind': 'text', 'required': False}, {'label': 'describe your ideal customer', 'kind': 'long'},
      {'label': 'preferred style', 'kind': 'choice', 'options': ['warm and friendly', 'clean and modern', 'bold and loud', 'no preference']}]),
    ('medialy', 'systems', 'monthly social media care (sample)', '12 posts a month, planned and published.',
     ['content plan', '12 designed posts', 'publishing', 'monthly results summary'], 'a steady presence without you doing it yourself.', 'monthly', 12000000,
     [{'label': 'which platforms do you use?', 'kind': 'text'}]),
    ('subt', 'systems', 'order tracker (sample)', 'stop losing orders that come in on whatsapp.',
     ['simple order form', 'order list you can see on your phone', 'daily summary', '1 hour training'], 'every order is recorded, nobody has to remember.', '4 weeks', 20000000,
     [{'label': 'how do orders reach you today?', 'kind': 'long'}, {'label': 'how many orders in a normal week?', 'kind': 'text'}]),
    ('subt', 'systems', 'business website (sample)', 'a fast, simple website customers can find.',
     ['up to 5 pages', 'whatsapp contact button', 'google business profile', 'hosting setup guidance'], 'people can find you and contact you any time.', '3 to 4 weeks', 35000000,
     [{'label': 'pages you want', 'kind': 'long'}]),
    ('iotics', 'structure', 'cctv assessment and install (sample)', 'see your shop or office from your phone.',
     ['site assessment', 'up to 4 cameras installed', 'phone viewing setup'], 'peace of mind when you are away.', '1 week', 45000000,
     [{'label': 'address of the site', 'kind': 'text'}]),
    ('hub', 'systems', 'team customer service training (sample)', 'a practical one-day session.',
     ['one day session for up to 10 people', 'scripts for common questions', 'certificate of attendance'], 'customers get the same good answer from anyone on your team.', '1 day', 10000000,
     [{'label': 'how many people will attend?', 'kind': 'text'}]),
    ('iwiin', 'strategy', 'grant readiness review (sample)', 'find out what you qualify for.',
     ['eligibility check on 3 opportunities', 'readiness checklist', 'application calendar'], 'you spend time only on opportunities you can win.', '2 weeks', 15000000,
     [{'label': 'what would you use funding for?', 'kind': 'long'}]),
]

with server.connect() as c:
    if c.execute('SELECT COUNT(*) FROM packages').fetchone()[0]:
        print('catalogue already has packages, nothing added'); sys.exit(0)
    for v, stage, name, summary, inc, value, dur, price, onb in SAMPLES:
        c.execute('INSERT INTO packages(venture,name,summary,inclusions,value,duration,price_minor,onboarding,stage) VALUES(?,?,?,?,?,?,?,?,?)',
                  (v, name, summary, json.dumps(inc), value, dur, price, json.dumps(onb), stage))
print(f'added {len(SAMPLES)} sample packages. replace them with approved packages and fees before real use.')
