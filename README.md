[English](README.md) | [简体中文](README.zh-CN.md)

# Gmail Auto Clean + Daily Digest Dashboard

**Live Google Apps Script project:** `GmailAutoCleanV6`. This repo is a git-backed mirror of that project's code — Apps Script has no native git integration, so keep the two in sync manually (paste from Apps Script → diff → push, same workflow as the `Twilio-V2` repo).

Automated Gmail management powered by Google Apps Script and Gemini AI, with a Cloudflare-hosted web dashboard for browsing daily digests.

## What it does

Three trigger functions handle different parts of the pipeline:

**`gmailPinOnly`** — runs every 5–10 minutes:
- Pins important emails back to inbox (banks, school, government)

**`gmailAutoCleanLight`** — runs once daily (recommended 6 am):
- Cleans categories — marks Updates/Forums/Social as read, archives Promotions
- Labels emails automatically — `! AUTO/Finance`, `! AUTO/School`, `! AUTO/Work`

**`gmailAutoCleanAI`** — runs once daily (recommended 7 am):
- AI analysis (Gemini) — classifies each unread inbox email into:
  - `must_do` — starred, added to Google Calendar if due date found
  - `schedule_later` — logged only
  - `info_only` — no action
- Post-processes AI results:
  - **Blocklist senders** (`aiActionBlocklistSenders`) — demotes `must_do` → `schedule_later`
  - **Promote senders** (`aiActionScheduleLaterSenders`) — promotes `info_only` → `schedule_later`
- Sends a summary email with a link to the web dashboard
- Saves the digest to Cloudflare KV so every day's results are permanently accessible

**Call Reminder** (`CallReminder.gs`) runs every minute and:

- Watches for emails labelled `! Call`
- Creates a 1-hour Google Calendar event in the "Call" calendar at 7 pm (tomorrow if already past 7 pm)
- Uses Gemini to generate a 2–3 sentence summary in the event description
- Removes `! Call`, adds `! Call - Done`, and marks the thread as read
- Night throttle (11 pm – 7 am): fires at most once per hour

**Telegram Bot** (`TelegramBot.gs`) runs every minute (polling mode) and:

- Accepts commands from your private Telegram chat
- `/run` — triggers Gmail Auto Clean immediately
- `/call` — triggers Call Reminder check immediately
- `/donetasks` — marks all `! AUTO` Google Tasks as completed
- `/help` — lists all commands

---

## Web Dashboard

**URL:** `https://dash-gmail.1000600.xyz`

- Browse any day via `https://dash-gmail.1000600.xyz/YYYY-MM-DD`
- Navigate between days with ← Prev / Next → buttons
- Must Do / Schedule Later / Info Only sections with AI due-date badges
- Hover over any item for a full email preview popover showing received time, sender, subject, body snippet, and AI reason
- Hovering dims the rest of the page so the popover stands out clearly
- Click **Open →** to jump straight to the Gmail thread

---

## Repository structure

```
code.gs                      # Main Apps Script — daily clean, AI analysis, digest
CallReminder.gs              # Call Reminder — watches ! Call label, creates Calendar events
TelegramBot.gs               # Telegram Bot — polling mode, remote trigger commands
index.html                   # Cloudflare Pages dashboard UI
functions/
  api/
    latest-run.js            # GET  — reads latest digest (KV → Apps Script fallback)
    write-run.js             # POST — called by Apps Script to save each day's digest
    run/[date].js            # GET  — reads a specific day's digest from KV
_redirects                   # SPA routing for date URLs + 301 redirects for removed pages
```

---

## Setup

### 1 — Google Apps Script

1. Open [script.google.com](https://script.google.com), create a new project
2. Paste the contents of `code.gs` into the default file
3. Create additional script files and paste `CallReminder.gs` and `TelegramBot.gs`
4. Enable **Tasks API** and **Calendar API** in Services
5. Add the following **Script Properties** (Project Settings → Script Properties):

| Property | Value |
|---|---|
| `GEMINI_API_KEY` | Your Gemini API key |
| `DASHBOARD_TOKEN` | Any long random string (shared secret) |
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token (from @BotFather) |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |

6. Deploy as **Web App**: Execute as *Me*, Who has access *Anyone*
7. Copy the Web App URL

> **Always `git pull` before editing locally or pushing**, especially if you've made any changes directly on GitHub web. This prevents your local copy from overwriting changes made on GitHub.
>
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

### 3 — Triggers

Set triggers in Apps Script (Triggers → Add trigger):

| Function | Schedule | Description |
|---|---|---|
| `gmailPinOnly` | Time-driven → Every 5–10 minutes | Pin important emails to inbox only |
| `gmailAutoCleanLight` | Time-driven → Day timer (recommended 6 am) | Category clean + auto labels |
| `gmailAutoCleanAI` | Time-driven → Day timer (recommended 7 am) | AI analysis, actions, dashboard write, summary email |
| `checkCallLabelAndCreateEvent` | Time-driven → Every minute | Call Reminder — watches `! Call` label |
| `pollTelegramMessages` | Time-driven → Every minute | Telegram Bot — polls for new commands |

Run `setupCallReminderTrigger()` and `setupTelegramPollingTrigger()` once manually to create the minute-level triggers automatically.

### 4 — Telegram Bot setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → copy the token
2. Send any message to your new bot, then visit:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Copy the `chat.id` value from the response
3. Add both values as Script Properties (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
4. Run `setupTelegramPollingTrigger()` once to activate polling

### 5 — Call Reminder label setup

Create the Gmail label `! Call` manually in Gmail. The script auto-creates `! Call - Done` on first use.

---

## Configuration

### code.gs — `CONFIG` object

| Setting | Description |
|---|---|
| `dryRun` | Set `true` to simulate without making any changes |
| `whitelistSenders` | Senders skipped entirely by cleaning and AI |
| `aiActionBlocklistSenders` | Senders whose `must_do` items are demoted to `schedule_later` |
| `aiActionScheduleLaterSenders` | Senders whose `info_only` items are promoted to `schedule_later` |
| `categories` | Enable/disable and configure each Gmail category |
| `labelRules` | Keywords and senders used for auto-labelling |
| `aiModel` | Gemini model (default: `gemini-2.5-flash`) |
| `aiMaxThreads` | Max emails sent to AI per run (default: 20) |
| `pinCriteria` | Gmail search queries for emails to pin to inbox |
| `dashboardSpreadsheetId` | Google Sheets ID for the raw data log |

### CallReminder.gs — `CALL_REMINDER_CONFIG` object

| Setting | Description |
|---|---|
| `labelName` | Gmail label to watch (default: `! Call`) |
| `labelDoneName` | Label applied after processing (default: `! Call - Done`) |
| `calendarName` | Google Calendar to create events in (default: `Call`) |
| `eventStartHour` | Hour for the calendar event, 24h (default: `19` = 7 pm) |
| `eventDurationHours` | Event length in hours (default: `1`) |
| `titleMaxLength` | Max characters taken from email subject for event title (default: `30`) |
| `nightStartHour` | Night throttle start, 24h (default: `23` = 11 pm) |
| `nightEndHour` | Night throttle end, 24h (default: `7` = 7 am) |
| `dryRun` | Set `true` to simulate without creating events or modifying labels |
