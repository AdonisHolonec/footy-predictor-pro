# Footy Predictor UI

React + Vite frontend; API routes under `api/` (Vercel serverless). Copy `.env.example` to `.env.local` and fill values.

## Cron and internal API auth

Protected endpoints use `isAuthorizedCronOrInternalRequest` from `server-utils/cronRequestAuth.js`:

- `api/history/sync.js`
- `api/cache/prewarm.js`
- `api/backtest/snapshot.js`
- `api/notifications/dispatch.js`

**Production** (`VERCEL_ENV=production` or `NODE_ENV=production`): requests must present `CRON_SECRET` via `Authorization: Bearer <secret>`, header `x-cron-secret`, or query `secret`. Vercel Cron sends the Bearer token when `CRON_SECRET` is set in the project. Without a matching secret, these routes return **401**.

**Non-production**: same secret headers work; if the secret is unset, calls are allowed for local development. If the secret is set, browser same-origin (`Origin` / `Referer` matching `Host`) is also accepted.

## Optional: anonymous rate limits (Warm / Predict)

Unauthenticated calls to `/api/warm` and `/api/predict` can be capped per IP per hour using **Vercel KV** (or compatible REST URL + token). Configure either:

- `STORAGEE_KV_REST_API_URL` and `STORAGEE_KV_REST_API_TOKEN`, or
- `KV_REST_API_URL` and `KV_REST_API_TOKEN`

Tune limits with `ANON_RATE_WARM_PER_HOUR` and `ANON_RATE_PREDICT_PER_HOUR` (see `.env.example`). If KV is missing or errors, checks are skipped so local dev keeps working.

Authenticated users are not subject to this anonymous IP limit (they use the separate usage limits in Supabase).
