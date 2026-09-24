# Portfolio website analytics

This site is a static Netlify site. The browser loads `analytics.js` once per page load and posts to `/.netlify/functions/track`. The function validates and filters the event, then writes a row to Supabase. At 00:00 UTC each day, Netlify runs `daily-report` to summarize the preceding UTC calendar day and send one plain-text email through Resend.

The former per-visit email script (`visit-notify.js`) is no longer loaded by the page, so visitors do not generate both immediate and daily emails. The legacy function remains in the repository for now and can be removed separately.

## Setup

1. Create a Supabase project. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). The table has row-level security enabled and no browser/public access policy. Copy the project URL and its **service role/secret key** from project settings. Never paste the service key into HTML, browser JavaScript, or a public repository.
2. Run `npm install` from this directory. Node.js 22 or newer is required.
3. Create a Resend API key and verify a sending domain. In the Netlify site’s environment-variable settings, add these variables with **Functions** scope (and for the production deploy context):

   | Variable | Value |
   | --- | --- |
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SERVICE_KEY` | Supabase service role/secret key |
   | `RESEND_API_KEY` | Resend API key |
   | `REPORT_EMAIL` | Your recipient email |
   | `REPORT_FROM` | Sender on your verified Resend domain, e.g. `Website <reports@example.com>` |
   | `ANALYTICS_SITE_ORIGIN` | Exact public site origin, e.g. `https://jiazhouwu.netlify.app` |

   Optional: `ANALYTICS_BOT_TOKENS` is a comma-separated, case-insensitive set of user-agent substrings. Its default is `bot,crawler,spider,headless`. Do not put these values in `netlify.toml` or source code. `.env.example` lists the complete configuration. The `VISIT_NOTIFY_*` settings are only for the former immediate-email function and are not needed for daily analytics. If that function was previously enabled in Netlify, set `VISIT_NOTIFICATIONS_ENABLED=false` there to keep reporting daily-only.
4. Deploy the repository/directory through the existing Netlify site. Its build command is `npm run build`, publish directory is `public`, and functions directory is `netlify/functions` (all already set in `netlify.toml`). The scheduled report uses `0 0 * * *`, meaning UTC midnight. Scheduled functions run automatically only on the published deploy.

## Local test

Copy `.env.example` to a local `.env` and fill in test credentials; `.env` is ignored by Git. Set `ANALYTICS_SITE_ORIGIN` to the actual local origin shown by Netlify Dev (usually `http://localhost:8888`) for this test. Install the Netlify CLI if needed (`npm install -g netlify-cli`), then run `netlify dev` from this directory. Open the local site and inspect the `/.netlify/functions/track` response in the browser network panel. A `200` with `recorded: true` means Supabase accepted the row. Confirm the row in Supabase Table Editor.

To call the daily report without waiting for midnight, run `netlify functions:invoke daily-report` while Netlify Dev is running. This sends a real email and reports the preceding UTC day. Netlify also provides a **Run now** button for deployed scheduled functions. Run `npm test` for the offline unit tests and `npm run build` to check the static output.

## Data and privacy

The browser sends the page path, a timestamp, referrer origin, user agent, language, and timezone. It does not send the referrer's path/query/fragment, page query parameters, cookies, local-storage identifiers, or IP address. The function uses the request's real user-agent header rather than trusting a browser-supplied value. Netlify's country code is stored when available; no exact location is stored. The database-generated `created_at` determines reporting windows, not the user-supplied timestamp. Do Not Track and automated browsers are skipped by the frontend; configured bot agents are filtered again on the server.

These figures are page-load counts, **not unique visitors**. Browser blockers, disabled JavaScript, bot filters, network failures, and repeated reloads can affect the count. Consider adding a retention policy, a privacy notice appropriate to your audience, and a server-side aggregate query as traffic grows. The separated event, table, and report code allow future unique-visitor logic (with careful consent/privacy review), charts, weekly digests, page-specific alerts, or richer country analytics.
