# Deployment review and fixes - 8 November 2026

> **Historical record.** This review describes the earlier Python/SQLite server. That server has since been replaced by a Node.js function on Vercel with Supabase and Cloudinary; the same behaviours and their tests were carried over. For the current setup, see [GO-LIVE.md](../GO-LIVE.md) and [free-hosting.md](free-hosting.md).

The application issues from the initial review have been addressed. This is not a claim that a production host, legal documents, business settings or live payments have been approved. Use `GO-LIVE.md` as the release checklist.

## Implemented

- **Payment concurrency:** payment creation, verification, recurring billing, invoice payment, transfer confirmation and subscription changes share an OS-backed lock across threads and processes on the same persistent disk. Renewal orders record their subscription period, with a unique database constraint for active/paid attempts. Unknown gateway results remain pending for reconciliation; they do not authorize a new charge. Pending card payments cannot be reported or manually confirmed as transfers under the same reference; the client can request a provider status check. Currency checks apply on renewal recovery too.
- **Staff access:** account security now supports password changes, encrypted authenticator enrollment and one-time-code login with replay protection. Changes and enrollment revoke sessions. Owners can reset staff passwords; an operator recovery CLI handles lost owner access/authenticators. Production prevents access to client/payment records before MFA enrollment. The environment owner password is explicitly documented as bootstrap-only.
- **Request and file handling:** content checks reject disguised files, unsafe archives, encrypted archives, oversized decompression totals and macro-bearing Office archives. Both declared and streamed request bodies are capped. Production uploads require a successful ClamAV scan; scanner failure blocks the upload. Scanning runs outside the request event loop. These controls complement private storage and download authorization; they do not replace identity verification or policy review.
- **Operational safeguards:** SQLite connections close after transactions. Rate limits persist in SQLite. Health checks verify database access and writable file storage. Docker has a health check, includes ClamAV/age, refreshes scanner signatures at startup, and supports the provider's PORT setting. Compose persists the database, files and scanner signatures.
- **Backups:** the backup tool coordinates with payment and file writes, uses SQLite's backup API and atomically publishes archives. Production requires age encryption using a public recipient key. The restore tool refuses nonempty destinations, rejects unsafe archive entries and verifies database integrity. Keep private decryption keys off the app server.
- **Dependencies and release checks:** direct runtime versions and the full transitive lockfile are pinned. The initially installed versions produced advisory findings; the updated 21-package runtime lockfile produced zero known findings with pip-audit. A GitHub Actions workflow runs tests, syntax checks, auditing and a Docker build when the project is pushed to GitHub.
- **Configuration and public content:** `.env` loads without overriding host environment settings. A generator creates private development secrets without overwriting existing configuration. Production startup rejects missing security settings. Missing bank details no longer enable transfer checkout. Placeholder gallery photos and unavailable library entries are hidden.
- **Documentation:** launch instructions now treat draft legal policies as a release gate, explain staff recovery, encrypted backup/restore, actual-host acceptance and free-host storage limitations.

## Verification

- Full application/regression suite: **35 passed** in a fresh project virtual environment using the pinned runtime dependencies. Two dependency deprecation warnings remain in test tooling. The existing environment also passed all 35 tests.
- Twelve new tests cover cross-thread/process billing exclusion, cancellation during a charge, unknown gateway responses, renewal-period uniqueness, password/session revocation, owner recovery and staff reset permissions, mandatory MFA/encryption/replay, unsafe files, scanner failure, health/body limits, connection closure, and a database-plus-file backup/restore round trip.
- Nine JavaScript files passed syntax checks.
- Chromium passed required-MFA setup routing, enrollment/sign-out, authenticator login, all 11 desk sections, password-change sign-out, mobile security layout, placeholder hiding and available library content. A separate client browser check verified pending-card status checks and absence of bank-transfer instructions for that payment. No JavaScript/CSP errors were observed.
- Dependency audit of all 21 pinned runtime packages: **zero known vulnerabilities**. This is an advisory check, not proof that the software has no vulnerabilities. See `dependency-audit.json` for the version snapshot.
- Fresh `.venv` installation from `requirements-dev.txt` completed successfully. `python -m pip check` reported no broken requirements; JavaScript syntax checks passed after the final UI changes.

## Still required on the chosen host

1. Supply actual secrets, bank/contact/company details and approve real service prices. The local database's 77 proposed prices were deliberately not approved automatically.
2. Approve the draft terms/privacy/retention/refund procedures with the responsible business owners and advisers. Define suitable client identity verification before sensitive transactions/documents.
3. Build/run Docker on the actual Linux host. Docker is unavailable on this review machine, so the image, ClamAV initialization and age CLI integration have not been exercised here.
4. Configure DNS, HTTPS, trusted proxy settings, a single persistent app volume, monitoring, daily billing/retention, antivirus updates and off-server encrypted backups.
5. Complete a real host restore drill, staff enrollment/recovery and Paystack test checkout/webhook/renewal reconciliation before enabling live keys.
6. Publish the source to a version-controlled repository so CI can run. No remote repository or hosting service was created by these local fixes.

## Hosting recommendation

See `free-hosting.md` for current provider sources and setup. Oracle Always Free is the closest architectural fit because a VM can retain the SQLite database and files. Render Free and Koyeb Free are appropriate only for disposable fictional-data demos of the current app; their free runtimes do not offer the persistent volume this production deployment needs.
