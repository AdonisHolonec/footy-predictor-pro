# Footy Predictor UI

React + Vite frontend; API routes under `api/` (Vercel serverless). Copy `.env.example` to `.env.local` and fill values.

## Cron and internal API auth

Protected endpoints use `isAuthorizedCronOrInternalRequest` from `server-utils/cronRequestAuth.js`:

- `api/history/sync.js`
- `api/cache/prewarm.js`
- `api/backtest/snapshot.js`
- `api/notifications/dispatch.js`
- `api/cron/warm-predict.js`

**Production** (`VERCEL_ENV=production` or `NODE_ENV=production`): requests must present `CRON_SECRET` via `Authorization: Bearer <secret>`, header `x-cron-secret`, or query `secret`. Vercel Cron sends the Bearer token when `CRON_SECRET` is set in the project. Without a matching secret, these routes return **401**.

**Non-production**: same secret headers work; if the secret is unset, calls are allowed for local development. If the secret is set, browser same-origin (`Origin` / `Referer` matching `Host`) is also accepted.

**Exception — `POST /api/history/sync`**: in production, a valid **Supabase user** JWT (`Authorization: Bearer <access_token>`) is also accepted so the browser can refresh match scores after Predict without embedding `CRON_SECRET` in the client. Cron jobs can still use `CRON_SECRET` as above.

## Cron: automated Warm + Predict

`GET` or `POST` **`/api/cron/warm-predict`** (see `vercel.json`) runs after Vercel invokes it with **`Authorization: Bearer` + `CRON_SECRET`**. The handler then calls this deployment’s **`/api/warm`** (with `standings=1` & `teamstats=1`) and **`/api/predict`** over HTTPS, **without** a user JWT, so **no per-user daily Warm/Predict quota** applies (anonymous path; optional KV hourly limits still apply if configured).

- **Schedule** in `vercel.json` is UTC (`2 21 * * *` by default: ~00:02 Europe/Bucharest during EEST; adjust for winter or exact minute).
- **`CRON_WARM_PREDICT_DATE`**: optional `YYYY-MM-DD`; otherwise **today** in `Europe/Bucharest`.
- **`CRON_WARM_PREDICT_LEAGUE_IDS`**: optional; defaults to **`PREWARM_LEAGUE_IDS`** or the built-in elite list.
- **`CRON_WARM_PREDICT_BASE_URL`**: optional absolute origin (e.g. `https://your-app.vercel.app`); if unset, uses `https://${VERCEL_URL}` on Vercel.
- **`maxDuration`** for this function is set to **300** seconds in `vercel.json` because Warm + Predict can exceed the default limit.

## Optional: anonymous rate limits (Warm / Predict)

Unauthenticated calls to `/api/warm` and `/api/predict` can be capped per IP per hour using **Vercel KV** (or compatible REST URL + token). Configure either:

- `STORAGEE_KV_REST_API_URL` and `STORAGEE_KV_REST_API_TOKEN`, or
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`

Tune limits with `ANON_RATE_WARM_PER_HOUR` and `ANON_RATE_PREDICT_PER_HOUR` (see `.env.example`). If KV is missing or errors, checks are skipped so local dev keeps working.

Authenticated users are not subject to this anonymous IP limit (they use the separate usage limits in Supabase).
