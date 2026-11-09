# Deploying Hamzury

The site runs on three services:

| Part | Service | What it holds |
|---|---|---|
| Pages and the API | **Vercel** | The pages in `static/`, served from Vercel's CDN, and one serverless function, `api/index.js`, that runs every `/api/*` call |
| Database | **Supabase** (Postgres) | Clients, plans, orders, staff, audit log: the 18 tables in `lib/schema.sql` |
| Private files | **Cloudinary** | Client onboarding documents and delivered work, stored with `authenticated` delivery so no public link exists |

The server connects to Supabase with the database password. Row level security is switched on for every table with no policies, so Supabase's public API keys cannot read or change anything. Never put the database password or the Cloudinary secret in browser code.

## 1. Create the database (Supabase)

1. Create a project at supabase.com. Pick the region closest to Nigeria that is offered (for example `eu-west`), and save the database password somewhere private.
2. Open **Project Settings > Database > Connection string**, choose **Transaction pooler** (port 6543), and copy the URI. Put your database password in it. This is `DATABASE_URL`.
3. Optional: open the **SQL editor** and run `lib/schema.sql`. If you skip this, the server creates the tables the first time it starts. The script is safe to run more than once.

## 2. Create file storage (Cloudinary)

1. Create an account at cloudinary.com.
2. On the dashboard, copy the **API environment variable** (`cloudinary://API_KEY:API_SECRET@CLOUD_NAME`). This is `CLOUDINARY_URL`.
3. Files are uploaded as private "raw" files under the folder in `HAMZURY_CLOUDINARY_FOLDER` (default `hamzury`). Downloads are short-lived signed links that the server creates only after checking who is asking.

The free Cloudinary plan limits raw files to **10 MB**, while the app accepts up to 25 MB. A larger file shows "upload failed" to the person uploading. Upgrade the Cloudinary plan if you need larger files.

## 3. Deploy (Vercel)

1. On vercel.com, choose **Add New > Project** and import the GitHub repository. Vercel reads `vercel.json`: there is no framework, the build is `node tools/build.js`, and the output is `public/`.
2. Under **Settings > Environment Variables**, add:

| Variable | Value |
|---|---|
| `HAMZURY_ENV` | `production` |
| `DATABASE_URL` | from step 1 |
| `CLOUDINARY_URL` | from step 2 |
| `HAMZURY_ADMIN_PASSWORD` | 12+ characters. Used only to create the first owner |
| `HAMZURY_ADMIN_EMAIL` | `admin@hamzury.com` (or your chosen owner login email) |
| `HAMZURY_SECRET` | 32+ random characters. Keep it stable: it encrypts staff authenticator secrets and signs upload tickets |
| `HAMZURY_PUBLIC_BASE_URL` | your HTTPS address, e.g. `https://hamzury.com` |
| `HAMZURY_SECURE_COOKIES` | `1` |
| `HAMZURY_BILLING_KEY` | 32+ random characters, for manual `POST /api/daily/run` calls |
| `CRON_SECRET` | a long random value. Vercel sends it to the daily job |
| `HAMZURY_REQUIRE_STAFF_MFA` | `1` |
| `HAMZURY_REQUIRE_UPLOAD_SCAN` | `1` |
| `HAMZURY_UPLOAD_SCAN_URL`, `HAMZURY_UPLOAD_SCAN_TOKEN` | your file scanning service (see below) |
| `HAMZURY_BANK_DETAILS`, `HAMZURY_WHATSAPP_NUMBER`, `HAMZURY_CONTACT_EMAIL` | the real business details |
| `HAMZURY_PAYSTACK_SECRET_KEY` | the Paystack **test** secret first |

`node tools/configure.js` generates strong random values in a local `.env` that you can copy from. In production the app refuses to start without strong secrets, HTTPS, secure cookies, a billing key, staff MFA, upload scanning, `DATABASE_URL` and `CLOUDINARY_URL`. The API then answers with an error until the missing setting is added.

3. Deploy, add your domain under **Settings > Domains**, and check `https://YOUR-DOMAIN/api/health`. It checks the database and Cloudinary.

**Plans:** Vercel's free Hobby plan is for personal, non-commercial use. A business taking client payments needs the Pro plan. Supabase's free plan pauses a project after a week without activity and has no downloadable backups. Use Supabase Pro for live clients.

### Upload scanning

The old server scanned uploads with ClamAV on its own disk. Serverless functions cannot run ClamAV, so production sends each upload to a scanning service at `HAMZURY_UPLOAD_SCAN_URL` before keeping it. The service receives the file bytes (`POST`, `application/octet-stream`, with an `x-file-name` header and `Authorization: Bearer HAMZURY_UPLOAD_SCAN_TOKEN`) and must answer `{"clean": true}` or `{"clean": false}`. Anything else, including no answer, blocks the upload. You can run ClamAV behind a small HTTP endpoint on any host, or use a commercial scanning API with a small adapter.

Every upload still passes the content checks either way: the contents must match the file type, archives must be safe, and macro-bearing Office files are refused.

## 4. Secure accounts and approve the business setup

1. Sign in at `/admin` with the email in `HAMZURY_ADMIN_EMAIL` and the existing owner password. Under **account security**, add the setup key to an authenticator app and confirm a code. Enrolling signs out every session; wait for the next code before signing in again.
2. Change the owner's bootstrap password under **account security**.
3. Add individual staff accounts with unique login emails. For existing staff without email addresses, use **team > set login email**. Production blocks client and payment records until each staff member enrolls an authenticator.
4. Under **catalogue**, review and approve real prices. Proposed prices are never approved automatically.
5. Configure the registered invoicing entity and finance settings. Confirm tax treatment with the responsible finance adviser.
6. Have the draft terms, privacy notice and operating policies approved by the appropriate advisers, then update the displayed text and `TERMS_VERSION` in `lib/app.js` together. This is a launch gate for real client use.

An owner can reset another staff member's password from **team**. For owner recovery or a lost authenticator, a trusted operator runs this on their own computer with `DATABASE_URL` set in `.env`:

```sh
node tools/manage.js reset-password admin@hamzury.com
# only after verifying identity, if the authenticator was also lost:
node tools/manage.js reset-password admin@hamzury.com --reset-mfa
```

The password is typed privately, not passed as an argument. Recovery is audited and signs out every session.

## 5. Validate payments

Set Paystack's webhook URL to `https://YOUR-DOMAIN/api/paystack/webhook`. Complete a test checkout, confirm the signed webhook and callback, and reconcile the reference, amount and currency in Paystack. Also test manual transfer confirmation, cancellation, failed payments and a recurring renewal. Only then switch to live keys.

Payment operations share a lock row in the database (`op_locks`), so only one runs at a time across every Vercel instance. An overlapping operation receives HTTP 409 and can retry. The lock frees itself after two minutes if an instance stops mid-operation. Renewal orders record their subscription period with a unique constraint. If the gateway result is unknown, the attempt is kept for reconciliation instead of charging again.

## 6. Daily work and backups

Vercel runs `/api/cron/daily` every day at 06:00 UTC (07:00 in Lagos), as set in `vercel.json`. It does monthly billing, then scheduled deletion. Monthly billing alone can also be run from the payments page. To run both by hand:

```sh
curl -X POST -H "X-Billing-Key: YOUR_BILLING_KEY" https://YOUR-DOMAIN/api/daily/run
```

Check the cron's runs under **Vercel > Settings > Cron Jobs** and the function logs.

Back up the database regularly. Supabase Pro keeps daily backups. You can also make your own copy with the Postgres tools:

```sh
pg_dump "YOUR_DATABASE_URL_WITH_PORT_5432" --no-owner --format=custom --file hamzury-YYYY-MM-DD.dump
```

Use the **session** connection string (port 5432) for `pg_dump`. Keep the copies encrypted and off any shared machine. Cloudinary keeps the files; export them from Cloudinary's media library if you need an off-site copy.

## 7. Release acceptance

Run `npm test`. The GitHub Actions workflow runs the tests, syntax checks, a dependency audit and the build on every push.

Before announcing: on the real HTTPS site, go through intake, price approval, recommendation, checkout, onboarding upload, assignment, venture report, holding approval, delivery and authorized download. Confirm another client's documents cannot be opened. Verify the daily job, upload scanning and staff recovery.

## Local development

```sh
npm install
node tools/configure.js   # creates a private .env; refuses to overwrite
npm run dev               # http://127.0.0.1:8000
```

Without `DATABASE_URL` and `CLOUDINARY_URL`, local runs use an embedded Postgres in `data/pglite` and files in `data/files`. Set them in `.env` to work against the real services.

## Email sign-in migration

Staff sign in using email and password, with the same authenticator when enabled. `HAMZURY_CONTACT_EMAIL` is only the public contact address. Existing usernames remain internal identifiers for audit records and recovery; username sign-in is no longer accepted.

Set `HAMZURY_ADMIN_EMAIL=admin@hamzury.com` in the local `.env` and in Vercel environment variables before deploying this version. Restart the local server or redeploy Vercel, and refresh the dashboard. The schema adds a case-insensitive unique email index. If automatic schema migration is disabled, apply the updated `lib/schema.sql` before deployment.

The owner email is assigned from configuration only when the existing owner has no email. Subsequent environment changes do not overwrite an assigned email. Change it through **account security**, or recover with `node tools/manage.js set-email owner admin@hamzury.com`. Passwords, MFA secrets, roles and staff IDs are preserved. Assigning/changing an email revokes existing sessions. Email is a login identifier; this change does not send verification or password-reset messages.
