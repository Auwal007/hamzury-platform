# Free hosting options

Checked against provider documentation on 8 November 2026. This app stores SQLite data, payment locks and private files on disk. A free Python runtime alone is insufficient: the disk must survive restarts and deployments.

| Provider | Fit for this project | Main limits |
| --- | --- | --- |
| Oracle Cloud Always Free VM | Closest fit for the existing architecture. Run Docker, Caddy, ClamAV and scheduled backups with a persistent disk. | You administer the VM. Capacity may be unavailable and idle instances may be reclaimed. Stay within the Always Free resources shown in your account. |
| Render Free web service | A disposable demo using fictional data. Use the native Python runtime with scanning disabled only for this demo. | Free services sleep after 15 minutes and lose local database/uploads on restart, redeploy or sleep. Free services cannot attach persistent disks. |
| Koyeb Free instance | A disposable demo using fictional data. | Free instances have 512 MB RAM, scale to zero after inactivity, and cannot attach volumes. This is unsuitable for the current persistent production database/files. |

Provider sources: [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Render Free](https://render.com/docs/free), [Koyeb instances](https://www.koyeb.com/docs/reference/instances).

## Recommendation

Choose an Oracle Always Free VM if you need to keep this application architecture and can manage a Linux server. The current Oracle documentation lists an Always Free allowance equivalent to 2 Arm OCPUs and 12 GB RAM, and 200 GB total block storage. Check your tenancy's actual limits before provisioning. Back up off the VM because free capacity is not a continuity guarantee.

Follow [GO-LIVE.md](../GO-LIVE.md): deploy one instance, keep the database/files volume, configure HTTPS and secrets, enroll staff authenticators, enable scanning and encrypted backups, and complete the business/legal checks.

For a quick Render demo, use:

```text
Build command: pip install -r requirements.lock
Start command: python tools/run.py
Health check: /api/health
```

In the provider dashboard set unique `HAMZURY_ADMIN_PASSWORD`, `HAMZURY_SECRET` and `HAMZURY_BILLING_KEY`; set `HAMZURY_ENV=development`, `HAMZURY_SECURE_COOKIES=1`, your assigned HTTPS public URL, and `HAMZURY_REQUIRE_UPLOAD_SCAN=0`. Staff MFA can still be enabled. Do not put live payment keys, real client records or sensitive files in an ephemeral demo. Scanning is intentionally unavailable in this small native-runtime demo; production requires it.

Moving production to an ephemeral free platform would require a separate project to migrate SQLite to a hosted database and private files to durable object storage, including payment concurrency controls suitable for that database. That migration is not part of these fixes.

Static site hosting by itself cannot run the app's Python API, private documents, payment verification or staff desk.
