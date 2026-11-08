# hamzury holding | guided client platform

**Architecture update (8 November 2026):** the Python/SQLite server has been rewritten as one Node.js serverless function on **Vercel**, with the database on **Supabase** (Postgres) and private files on **Cloudinary**. Every page, screen and rule is the same; the full test suite was ported and passes. Use [GO-LIVE.md](GO-LIVE.md) for the release steps and [hosting](docs/free-hosting.md) for plan limits. Business details, approved prices, legal review and payment acceptance remain launch requirements.

**working full-stack MVP.** your journey. a clear roadmap.

## the journey

| | client | holding desk |
|---|---|---|
| 1 | **home**: a short hook, then two doors: **start here** (new) and **track my progress** (hamzury id + phone number) | |
| 2 | **start here**: one question per screen (12 screens), contact details last | the answers arrive under **clients**, marked new |
| 3 | gets a **hamzury id** (e.g. HZ-7K2M9P) and opens their dashboard: "we are preparing your recommendation" | |
| 4 | | opens the client, reads their answers, picks packages from the **catalogue**, sets priority (essential / recommended / optional), roadmap stage, fee and a note, then **publishes** |
| 5 | "your recommendation is ready" → **see our recommendation**: what we heard, what we recommend, packages grouped by roadmap stage with fees | |
| 6 | taps a package: what is inside, the value, the duration, the fee. adds only what they want. the total grows in a bar at the bottom | |
| 7 | **checkout**: paystack (card, transfer, ussd) when keys are set, or bank transfer with "i have made the transfer" | online payments confirm themselves. transfers appear under **payments** to confirm |
| 8 | **onboarding**: only the questions for the packages they paid for | answers appear in **delivery** |
| 9 | **progress**: each paid package with status and a progress bar. unpaid ones are locked, with "see and add" | **delivery**: set status and progress, upload the finished file, holding confirms delivery |
| 10 | **download** each delivered package | updates (progress, blocker, next step) show on the client dashboard, with ready whatsapp text |

venture staff see only the packages for their venture. only holding confirms payments and delivery.

## version 6: built to convert

- **home:** a sales-grade hook with the client's business as the hero, an "ai and automation, explained simply" section, and venture tiles that **open in place** with services, "start here with [venture]" and "visit the [venture] site".
- **start here has two routes:** *i need help fast* (4 questions, about 1 minute, flagged **urgent** in the desk) and *show me the full picture* (the full clarity journey). `?route=quick` or `?route=full` skips the choice; `?src=wa` shows a whatsapp welcome banner and adds **back to whatsapp** at the end.
- **multi-choice with "other":** what the business does, what slows it down and what to take on are multi-choice; choosing *other* opens a box for their own words.
- **private whatsapp links:** from any client page, **message on whatsapp** builds a ready message (plan ready, payment, onboarding, update, delivered, next step and more) with a private link (`/track?t=...#step`, 14 days) that opens the right step with no id or phone to type, under a banner saying who sent it and what to do. **open in whatsapp** pre-fills the message to the client's number. the message also opens automatically after you publish a plan, confirm a payment or deliver.
- **follow-ups:** who to message today (urgent requests, unpaid choices, missing onboarding, plans not chosen, next locked step), each with one tap to a ready message.
- **insights:** the journey from opening start here to paying and buying again, average hours to plan and to payment, routes, sources, and **which screen people stop at** (anonymous counts, no personal data).
- **whatsapp kit:** greeting message, away message, quick replies and venture start links ready to paste into whatsapp business.
- **mobile:** "my hamzury" can be added to the phone home screen (web app manifest).

new settings: `HAMZURY_WHATSAPP_NUMBER` (international format, e.g. 2348012345678) and `HAMZURY_QUICK_REPLY_HOURS` (the promise on the fast route, default 24).

## version 7: the master catalogue, in its place

- **lib/catalogue-data.json** is the source of truth: 80 services across bizdoc, medialy, subt, iotics, hamzury hub, iwiin, holding and finance, each with a code, level, what is inside and not inside, duration, how it is charged (fixed, from, monthly, per session, per request, per workflow, quoted) and its rules. it loads on start and never overwrites a price you have set. `POST /api/admin/catalogue/load` refreshes the wording.
- **prices are proposed until the holding approves them.** clients only see approved prices. the catalogue page has a "prices to approve" filter, and the recommendation builder approves inline. a plan with an unapproved price cannot be published.
- **durations:** scuml (all categories) 5 days, cac limited company 5 days, cac incorporated trustees 30 days, other cac 14 days, anything we produce 7 days at most, anything waiting for an outside approval (tin, trademark, licences, nsitf, pencom, bpp) 14 days.
- **answers become a draft.** when someone finishes start here, the rules in `lib/catalogue.js` draft a roadmap for the desk to check, and the client sees only the type of things they need (no prices) until you publish.
- **no level lock.** the roadmap shows levels for reading and urgency in colour for acting: red needed now, amber needed soon, blue optional, green you have this, grey saved for later. a "start here first" strip leads. choose-one groups (business name vs limited company vs trustees, scuml categories) swap automatically; items that need another first (for example a board resolution needs the limited company) add it with them. the server enforces the same rules.
- **monthly services:** the first month is paid at checkout. cards are charged automatically on the due date (retried every 2 days, never twice for one month); transfer payers get an invoice 3 days before. unpaid for 7 days: paused. clients can stop a service any time; it runs to the end of the month already paid. vercel runs billing every morning (`/api/cron/daily`, see `vercel.json`); you can also press "run monthly billing now" on the payments page.

## version 8: delivery and operations

- **go live:** follow `GO-LIVE.md`, step by step.
- **logins for everyone:** holding desk, one login per venture lead or staff member (they see only their venture's work), and a **finance** login (payments, monthly billing, refunds, vat, never client documents).
- **follow-up loop:** holding assigns a job (the due date fills in from the catalogue duration). the venture owes an update every `HAMZURY_UPDATE_HOURS` (48 by default). late updates, past due dates, blockers and "client asked for an update" appear in follow-ups, with a ready whatsapp message to the venture lead. the ventures page shows each team's open work, late updates and on-time delivery.
- **vat and invoicing company:** set by finance in money settings. bills show fees, vat (only when switched on, only on services marked taxable) and the total before payment.
- **terms:** `/terms` and an updated `/privacy`. the client accepts at checkout; the order records the proposal version, terms version and date.
- **files and handover:** the client's "my files and agreements" screen shows what they accepted, finished work (available 12 months), their accounts (addresses and emails only, never passwords) and what they sent us. scheduled deletion follows the privacy note; the owner can set a keep flag on a client.
- **first industries:** cleaning services, interior decoration and painting, fashion and tailoring each get a starter roadmap from their answers.
- **one daily call:** vercel's daily cron (`/api/cron/daily`), or `POST /api/daily/run` with `X-Billing-Key`, runs monthly billing and scheduled deletion.

## venture pages

every venture has its own page at `/v/bizdoc`, `/v/medialy`, `/v/subt`, `/v/iotics`, `/v/hub`, `/v/iwiin`, in its own colours, listing its active catalogue services (no fees: fees appear in the client's recommendation). two buttons:

- **start here with bizdoc**: the same start here, branded for the venture, asking about that venture's services. the client still goes to the holding desk, tagged with the venture it came from.
- **explore the bizdoc site**: shown only where the address is confirmed (`HAMZURY_SITE_BIZDOC`, `HAMZURY_SITE_MEDIALY`, ... default: bizdocconsult.com and iwiin.hamzury.com).

## ventures deliver, holding speaks to the client

1. holding **assigns** each paid package to a venture staff member, with a brief and a due date.
2. the venture signs in to its own branded desk and sees **my work**: the brief, the client's situation and onboarding details.
3. the venture uploads the file and **sends a report to holding** (progress, what was done, blocker, next step, ready for final check).
4. holding **publishes** the report to the client, editing the wording if needed, or **returns** it with a note. the client sees nothing until holding publishes.
5. holding confirms **delivery**; the client downloads.

ventures cannot message clients, change client-visible progress, confirm payments or deliver.

## start here: understood, not pressured

the questions include what the client has tried, what would change if it was sorted, and how important it is now (1 to 10). short reflection screens play their own words back, and a **clarity snapshot** shows everything they said before they share contact details. the recommendation opens with "you told us", then "build your plan": the client chooses. after each delivery, the dashboard shows the next locked step on their roadmap with an unlock button. no invented numbers, no countdowns, no false scarcity.

## start locally

Node.js 20 or newer.

```bash
cd hamzury-platform
npm install
node tools/configure.js          # creates a private development .env; refuses to overwrite
# read the generated owner password in .env locally; enter actual bank/contact details there
npm run dev
```

- website: http://127.0.0.1:8000/
- start here: /start
- client app: /track
- staff desk: /admin (username `owner`, the password you set)

with no `DATABASE_URL` or `CLOUDINARY_URL` in `.env`, local runs use an embedded postgres in `data/pglite` and keep files in `data/files`. add them to work against supabase and cloudinary.

## settings

| variable | what it does |
|---|---|
| `HAMZURY_ADMIN_PASSWORD`, `HAMZURY_SECRET` | required. owner password (12+) and app secret (32+) |
| `DATABASE_URL` | the supabase connection string (transaction pooler, port 6543) |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud`, for private file storage |
| `HAMZURY_PAYSTACK_SECRET_KEY` | turns on paystack checkout. add the webhook `https://your-domain/api/paystack/webhook` in paystack |
| `HAMZURY_BANK_DETAILS` | the account clients see for bank transfer |
| `HAMZURY_PUBLIC_BASE_URL` | your https address, used for the paystack return link and update messages |
| `HAMZURY_SECURE_COOKIES=1` | set when served over https |
| `HAMZURY_UPDATE_HOURS` | review and update standard, default 48 |
| `CRON_SECRET` | sent by vercel to the daily job (billing, then scheduled deletion) |
| `HAMZURY_BILLING_KEY` | a long random key for calling `POST /api/daily/run` yourself |
| `HAMZURY_UPLOAD_SCAN_URL` | the file scanning service uploads are checked with (required in production) |

## safety built in

- client sign-in needs the hamzury id **and** the phone number; sessions are random, http-only cookies with a csrf token.
- payments: paystack is always re-verified with paystack's api (amount and currency checked) before anything unlocks; webhooks are signature-checked. bank transfers unlock only when holding confirms. one payment operation runs at a time, across every server instance.
- a paid package can never be repriced or removed from a recommendation.
- downloads only for the signed-in client, only after delivery, through short-lived signed links. uploads limited to 25 mb and common document types, checked against their contents.
- the database is closed to supabase's public api (row level security on, no policies). only the server can read it.
- prices come only from the catalogue you enter.

**before going live:** https on your domain, database backups, legal review of `/privacy` (nigeria data protection act 2023), paystack live keys, and real catalogue prices. see `GO-LIVE.md`, `docs/production-readiness.md` and `docs/recommendations.md`.

## tests

```bash
npm test
```

each test gets a fresh embedded postgres. covers the catalogue rules (choose one, needs first, i have this, save for later, no level lock), drafts from answers and the price approval gate, monthly billing by transfer and by card (invoices, reminders, grace, pause, cancel, retries without double charging, the cron key), the fast route and "other" answers, private whatsapp links (open, expire, reject), anonymous events, follow-ups, insights, venture pages and branded start, assignment, venture reports (submit, return, publish), the full journey (start, id login, recommendation draft and publish, partial purchase, transfer confirmation, onboarding, delivery, file download), client isolation and csrf, venture scoping, paystack verification including a wrong-amount payment, payment locking across instances, staff mfa and recovery, unsafe uploads, signed direct uploads, body limits and the production gate.

change existing passwords in **account security**, or recover with `node tools/manage.js reset-password owner`; editing the bootstrap environment password does not rotate an existing account.

## files

```
api/index.js           the vercel function: every /api/* call and /pay/callback
lib/app.js             setup, sign-in, the client journey, checkout, payments, monthly billing, uploads
lib/desk.js            the staff desk: clients, catalogue, recommendations, finance, delivery, reports, follow-ups, retention
lib/catalogue.js       the roadmap rules (answers -> draft); lib/catalogue-data.json holds the 80 services
lib/schema.sql         the database tables (supabase postgres)
lib/db.js              database access (supabase in production, embedded postgres locally and in tests)
lib/storage.js         private files (cloudinary in production, a folder locally)
lib/uploads.js         file content checks and the scanning hook
lib/security.js        passwords, authenticator codes, encryption
static/index.html      home (hook + start here + track)
static/venture.html    venture pages (venture.js)
static/start.html      start here, one question per screen (start.js)
static/track.html      the client app (track.js)
static/admin.html      the staff desk (desk.js)
static/style.css       brand standard 07, mobile first
vercel.json            pages, security headers, api routing and the daily cron
tools/dev.js           run locally
tools/manage.js        staff recovery
tests/                 node:test suites
```
