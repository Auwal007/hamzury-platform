# Deploying Hamzury

Use one app instance with a local persistent disk. SQLite, payment locks, and uploaded files share that disk. Do not run replicas or put this database on NFS. For free hosting options, see [free-hosting.md](docs/free-hosting.md).

## 1. Prepare configuration

Install Python 3.13 and the reviewed dependencies:

```sh
python -m pip install -r requirements.lock
python tools/configure.py
```

The generator creates a private development `.env` with unique secrets. It refuses to overwrite an existing file and does not print secrets. Read the generated owner password locally. It is only used when creating the first owner: editing it later does not reset an account.

On Windows, protect `.env` with your account's filesystem permissions. Never commit it, paste its contents into chat, or upload it as a public artifact.

For a public production host, edit `.env`:

- Set `HAMZURY_ENV=production`, `HAMZURY_PUBLIC_BASE_URL` to the real HTTPS address, and `HAMZURY_SECURE_COOKIES=1`.
- Set `HAMZURY_REQUIRE_STAFF_MFA=1` and `HAMZURY_REQUIRE_UPLOAD_SCAN=1`.
- Keep the generated strong secret and billing key. Keep `HAMZURY_SECRET` stable: it encrypts staff authenticator secrets. Back it up separately and privately.
- Enter real bank details and the business WhatsApp/contact details. Add the Paystack **test** secret first.
- Set `HAMZURY_BACKUP_RECIPIENT` to an age public recipient key. Generate the corresponding private identity on a separate trusted machine with `age-keygen -o hamzury-backup.key`; keep that private identity off the app server.
- Set `HAMZURY_DB` and, if needed, `HAMZURY_FILES` when running without Compose. In Compose these live under `/app/data` in the persistent volume.

The production startup checks enforce strong secrets, HTTPS settings, a billing key, MFA, and scanning. They cannot approve company information, prices, policies, or the host's security configuration.

## 2. Start the server

Use a Linux VM with Docker and enough memory for ClamAV; 4 GB is a practical starting allocation. The image includes ClamAV and age. Startup downloads/refreshes antivirus signatures before starting the app, so the first startup can take several minutes and needs outbound access. Uploads fail closed if scanning is unavailable.

```sh
docker compose up -d --build
docker compose logs --tail 50 hamzury
```

The app listens on host loopback port 8000. Configure DNS and HTTPS using Caddy on the host. The supplied `Caddyfile` reads the `HAMZURY_DOMAIN` environment variable; set it in the Caddy service environment (the app's `.env` is not automatically read by Caddy). Open ports 80/443 and keep port 8000 private.

The proxy limits request size to 26 MB. The app also limits requests, including uploads without a Content-Length header. Trust forwarded headers only from the actual proxy. Compose trusts forwarded headers because its published app port is loopback-only; a different hosting layout must configure `HAMZURY_FORWARDED_ALLOW_IPS` appropriately.

Check `https://YOUR-DOMAIN/api/health`: it checks database access and writable file storage. Use host monitoring to alert on HTTP errors, disk usage, failed jobs and failed backups. `tools/run.py` supports a hosting provider's `PORT` variable.

## 3. Secure accounts and approve the business setup

1. Sign in at `/admin` as `owner`. Under **account security**, add the setup key to an authenticator app and confirm a code. After enrollment, all sessions are revoked; wait for the next authenticator code before signing in again.
2. Change the owner's bootstrap password under **account security**. Password changes revoke all staff sessions for that account.
3. Add individual staff accounts. Production blocks access to client/payment records until each staff member enrolls an authenticator.
4. Under **catalogue**, review and approve actual prices for the services you will offer. Existing proposed prices are not automatically approved.
5. Configure the registered invoicing entity and finance settings. Confirm tax treatment with the responsible finance adviser.
6. Have the draft terms/privacy notice and operating policies approved by the appropriate advisers, then update the displayed text and `TERMS_VERSION` together. This is a launch gate for real client use.

An owner can reset another staff member's password from **team**. MFA is preserved. For owner recovery or a lost authenticator, the trusted server operator can run:

```sh
docker compose exec hamzury python tools/manage.py reset-password owner
# Only after verifying identity, if the authenticator was also lost:
docker compose exec hamzury python tools/manage.py reset-password owner --reset-mfa
```

Passwords are read privately rather than passed as command arguments. Recovery is audited, revokes sessions, and requires MFA enrollment again when MFA is reset. Do not expose this operator access to application users.

## 4. Validate payments

Set Paystack's webhook URL to `https://YOUR-DOMAIN/api/paystack/webhook`. Complete a test checkout, confirm the signed webhook/callback, and reconcile the reference, amount and currency in Paystack. Also test manual transfer confirmation, cancellation, failed payments and a recurring renewal. Only then configure live keys.

Payment operations share a process-safe file lock, and renewal orders record their subscription period. An overlapping operation receives HTTP 409 and can retry. If the gateway outcome is unknown, the existing attempt is retained for reconciliation rather than creating another charge. Do not manually replace an uncertain attempt without checking the gateway.

## 5. Daily work and backups

Run `POST /api/daily/run` once daily with the `X-Billing-Key` header. It runs renewal billing and retention. Store the key in a root/operator-readable curl config file rather than in the scheduler command. For example, `/etc/hamzury/daily.curl`:

```text
url = "https://YOUR-DOMAIN/api/daily/run"
request = "POST"
header = "X-Billing-Key: YOUR_PRIVATE_BILLING_KEY"
fail-with-body
silent
show-error
```

Set that file's mode to 600 and schedule `curl --config /etc/hamzury/daily.curl`. Use `CRON_TZ=Africa/Lagos` if your cron supports it, or translate the desired time into the server's timezone. Capture failures in your monitoring; do not discard errors.

Refresh scanner signatures daily with `docker compose exec -T hamzury freshclam --stdout` and alert on failures.

Back up nightly:

```sh
docker compose exec -T hamzury python tools/backup.py
```

Production backups require the age recipient key and are encrypted as `/app/data/backups/hamzury-YYYY-MM-DD.tgz.age`. The backup coordinates with payment and file writes, uses SQLite's online backup API, publishes completed archives atomically, and keeps 30 days. Copy the encrypted archives off the server; a backup only inside the same volume is insufficient.

Test restoring on a separate trusted machine with age installed:

```sh
python tools/restore.py hamzury-YYYY-MM-DD.tgz.age restored-data --identity hamzury-backup.key
```

Restore refuses a nonempty destination, rejects unsafe archive entries, and checks SQLite integrity. For a rollback, stop the app, preserve the current volume, restore into a separate empty directory/volume, and configure the previous compatible application release to use it. Never overwrite an actively used database or assume schema changes can be reversed in place.

## 6. Release acceptance

Run `python -m pytest -q tests` and `python -m pip_audit -r requirements.lock`. A GitHub Actions workflow now runs tests, JavaScript syntax checks, dependency auditing, and a Docker build when this folder is pushed to GitHub.

Before announcing: complete intake, price approval, recommendation, checkout, onboarding upload, assignment, venture report, holding approval, delivery and authorized download on the actual HTTPS host. Confirm another client's documents cannot be opened. Verify backup restore, daily jobs, scanning and staff recovery on that host.

The gallery hides placeholder photos and the library hides unavailable entries. Add real approved content when ready.
