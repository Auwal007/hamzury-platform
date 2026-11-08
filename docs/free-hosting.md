# Hosting

The app runs on Vercel (pages and API), Supabase (database) and Cloudinary (private files). All three have free plans. Each one has a limit that matters for a business that takes payments. Check each provider's current pricing page before you rely on these, because plans change.

| Service | Free plan is fine for | Limit that matters |
|---|---|---|
| Vercel Hobby | Testing and demos | Personal, non-commercial use only. A business taking client payments needs **Pro**. Function calls stop after 60 seconds, and cron jobs run at most once a day (the app needs once a day). |
| Supabase Free | Testing and demos | The project **pauses after a week without activity**, and there are no downloadable daily backups. Use **Pro** for live clients, or at least take your own `pg_dump` copies (see GO-LIVE.md). |
| Cloudinary Free | Testing and early use | Raw files (documents) are limited to **10 MB** each, while the app accepts 25 MB. Monthly credits cover storage plus bandwidth. |

## Recommendation

- **To show the app to people:** the free plans of all three are enough. Use fictional data only.
- **For real clients:** Vercel Pro and Supabase Pro, plus the Cloudinary plan that fits your file sizes. Add a file scanning service (`HAMZURY_UPLOAD_SCAN_URL`): production refuses uploads without one.

Follow [GO-LIVE.md](../GO-LIVE.md) for setup, secrets, staff authenticators, payments testing, the daily job and backups.

Static hosting on its own (GitHub Pages, Netlify without functions) cannot run the API, private documents, payment verification or the staff desk.
