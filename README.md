# Gmail Auto Clean + Daily Digest Dashboard

Automated Gmail management powered by Google Apps Script and Gemini AI, with a Cloudflare-hosted web dashboard for browsing daily digests.

## What it does

Every day the Apps Script runs and:

1. **Pins** important emails back to inbox (banks, school, government)
2. **Cleans** categories — marks Updates/Forums/Social as read, archives Promotions
3. **Labels** emails automatically — `! AUTO/Finance`, `! AUTO/School`, `! AUTO/Work`
4. **AI analysis** (Gemini) — reads unread inbox emails and classifies each into:
   - `must_do` — starred, added to Google Tasks, optionally added to Google Calendar
   - `schedule_later` — added to Google Tasks
   - `info_only` — no action
5. **Sends a summary email** with a link to the web dashboard
6. **Saves the digest** to Cloudflare KV so every day's results are permanently accessible

---

## Web Dashboards

### Daily Digest — `https://dash-gmail.1000600.xyz`

- Browse any day via `https://dash-gmail.1000600.xyz/YYYY-MM-DD`
- Navigate between days with ← Prev / Next → buttons
- Must Do / Schedule Later / Info Only sections with AI due-date badges
- Hover over any item for a full email preview popover
- Click **Open →** to jump straight to the Gmail thread

### ! Call — Done — `https://dash-gmail.1000600.xyz/call-done`

- Reads live from the `! Call - Done` Gmail label
- Date range filter: Within a week / 1 month / 3 months / All
- 10 emails per page with Prev / Next pagination
- Same hover popover with full email preview

---

## Repository structure

```
code.gs                      # Google Apps Script (paste into Apps Script editor)
index.html                   # Daily digest dashboard
call-done.html               # ! Call — Done label dashboard
functions/
  api/
    latest-run.js            # GET  — reads latest digest (KV → Apps Script fallback)
    write-run.js             # POST — called by Apps Script to save each day's digest
    run/[date].js            # GET  — reads a specific day's digest from KV
    call-done.js             # GET  — proxies label search to Apps Script (page + range params)
_redirects                   # Serves index.html for date-based URLs (/2026-05-28)
```

---

## Setup

### 1 — Google Apps Script

1. Open [script.google.com](https://script.google.com), create a new project
2. Paste the contents of `code.gs`
3. Enable **Tasks API** and **Calendar API** in Services
4. Add the following **Script Properties** (Project Settings → Script Properties):

| Property | Value |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key |
| `DASHBOARD_TOKEN` | Any long random string (shared secret) |

5. Deploy as **Web App**: Execute as *Me*, Who has access *Anyone*
6. Copy the Web App URL

> **Updating the script later:** Use **Deploy → Manage deployments → Edit (pencil) → New version → Deploy** to keep the same URL. If you accidentally create a *New deployment* (which generates a new URL), update `APPS_SCRIPT_URL` in Cloudflare env vars and redeploy Pages:
> ```bash
> npx wrangler pages deploy . --project-name gmail-dashboard --branch main
> ```
> If the dashboard returns `{"error":"Unknown action"}`, the Apps Script deployment is serving stale code — create a new deployment and update the env var.

### 2 — Cloudflare Pages

```bash
npx wrangler pages project create gmail-dashboard --production-branch main
npx wrangler pages deploy .
```

In the Cloudflare dashboard → Pages → `gmail-dashboard` → **Settings**:

**Environment variables** (Production):

| Variable | Value |
|---|---|
| `APPS_SCRIPT_URL` | Web App URL from step 1 |
| `DASHBOARD_TOKEN` | Same token as in Script Properties |

**Functions → KV namespace bindings** (Production):

| Variable name | Namespace |
|---|---|
| `GMAIL_DIGEST_KV` | `GMAIL_DIGEST` |

To create the KV namespace:
```bash
npx wrangler kv namespace create GMAIL_DIGEST
```

**Custom domain:** Add `dash-gmail.1000600.xyz` under Custom Domains.

### 3 — Trigger

Set a daily time-driven trigger in Apps Script:
Triggers → Add trigger → `gmailAutoCleanV62` → Time-driven → Day timer

---

## Configuration

All options are in the `CONFIG` object at the top of `code.gs`:

| Setting | Description |
|---|---|
| `dryRun` | Set `true` to simulate without making any changes |
| `whitelistSenders` | Senders always skipped by cleaning and AI |
| `categories` | Enable/disable and configure each Gmail category |
| `labelRules` | Keywords and senders used for auto-labelling |
| `aiModel` | Gemini model (default: `gemini-2.5-flash`) |
| `aiMaxThreads` | Max emails sent to AI per run (default: 20) |
| `pinCriteria` | Gmail search queries for emails to pin to inbox |
| `dashboardSpreadsheetId` | Google Sheets ID for the raw data log |
