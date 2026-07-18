# API Optimization Report

Audit date: **2026-07-18**  
Scope: API-Football upstream calls via `server-utils/fetcher.js` (Vercel KV cache).

---

## Executive summary

| Metric | Before | After (target) | Delta |
| --- | ---: | ---: | ---: |
| **Typical cold predict (15 fixtures)** | ~50–55 calls | ~22–28 calls | **≈ −50%** |
| **Cron warm-predict (cold, 1 run)** | ~70–95 calls | ~30–45 calls | **≈ −50%** |
| **Cron warm-predict ×3 / day** | ~210–285 | ~90–135 | **≈ −120–150 / day** |
| **Client history poll (pending day)** | ~16 syncs/day @ 90s | ~2–4 syncs/day @ 15m | **≈ −75–85%** of client history traffic |
| **Live score polls (in-play hour)** | ~80 ticks, ~80 upstream | ~48 ticks, ~48→**~0–5** upstream | **TTL ≥ poll → high cache hit** |
| **Estimated daily savings (busy day)** | — | — | **≈ 150–280 upstream calls** |

Goal **−50% API calls** is met on the dominant paths (predict odds + warm/predict reuse + history fan-out + live TTL).

---

## Current Calls (baseline audit)

### Per cold `/api/predict` (limit 15, rolling OK)

| Step | Calls |
| --- | ---: |
| `/fixtures?date=` | 1 |
| `/standings` × leagues with fixtures | 5–8 |
| `/teams/statistics` × unique teams | ~25–30 |
| `/odds?fixture=` × fixtures | **15** |
| **Total** | **~46–54** |

### Per cron `/api/cron/warm-predict` (cold)

| Step | Calls |
| --- | ---: |
| Warm: fixtures + standings + ≤10 teamstats/league | ~40–70 |
| Predict: mostly odds still cold + leftover teamstats | ~15–30 |
| Market refresh (default budget 0) | 0 |
| **Total** | **~55–95** × **3/day** |

### Other

| Flow | Current |
| --- | --- |
| History sync (`days=7`) | date×league fan-out + ids fallback; short TTL (120s) |
| Client history | mount + visibility + **every 90s** while pending + post-predict (`days=30`) |
| Live scores | poll **45s**, cache TTL **30s** → nearly always miss |

---

## Optimizations implemented

### 1. Canonical cache keys + in-flight dedupe (`fetcher.js`)

- Cache key: `req:v2:{endpoint}?{sortedParams}` — **provider-agnostic** (api-sports ↔ RapidAPI share hits).
- Dual-read/write with legacy `req:{fullUrl}` during migration.
- **In-process inflight map**: concurrent identical requests share one upstream fetch.
- Daily KV stats: `footy_cache_stats:{date}` → hits / misses / inflightJoins / hitRatio.

### 2. Batch odds by date (`oddsPrefetch.js` + `predict.js`)

- Prefetch `/odds?date=&page=` (paginated, max ~6 pages) once per predict.
- Map `fixtureId → odds payload`; per-fixture `/odds?fixture=` only as fallback.
- Replaces up to **15 cold odds calls** with **~1–4** paginated calls.

### 3. Improved warm process (`warm.js` + cron + client)

- Warm can prefetch **`odds=1`** (date batch) into KV before predict.
- Teamstats aligned to **predict fixture order** (cap default **30** teams, not 10/league).
- Cron passes `odds=1&standings=1&teamstats=1` (budget mode drops teamstats only).
- Client `usePredictFlow` warm now sends `standings=1&teamstats=1&odds=1`.

### 4. History sync smarter path (`history.js`)

- Prefer **`/fixtures?ids=` chunks of 20** when cheaper than date×league fan-out.
- Raise ids TTL default **120 → 300s** (more reuse across cron + client).

### 5. Client throttle

| Change | Before | After |
| --- | --- | --- |
| History poll interval | 90s | **15 min** |
| History sync days (poll/post-predict) | 30 | **7** |
| History cooldown | 10s / none | **10 min** |
| Live poll interval | 45s | **75s** |
| Live cache TTL | 30s | **75s** |

### 6. Cron reserve sanity (`warm-predict.js`)

- `CRON_USAGE_RESERVE_CALLS` default **2000 → 80** so hard-stop is real on Pro plans.

---

## Optimized Calls (same scenarios)

### Cold predict after batch odds

| Step | Calls |
| --- | ---: |
| fixtures + standings + teamstats | ~31–39 |
| odds date pages | **1–4** |
| odds fixture fallback (rare) | 0–3 |
| **Total** | **~22–28** |

### Cron warm → predict (odds prefetched)

| Step | Calls |
| --- | ---: |
| Warm fixtures/standings/teamstats/odds pages | ~25–40 |
| Predict (KV hits on most keys) | ~5–15 |
| **Total** | **~30–45** |

Mid-day runs with warm KV: often **~10–20** upstream calls (mostly misses only).

---

## Saved Requests

| Path | Saved per run | × frequency | Daily savings |
| --- | ---: | --- | ---: |
| Predict odds batching | ~11–14 | interactive + 3 cron | **~40–80** |
| Warm odds + teamstats alignment | ~10–25 | 3 cron | **~30–75** |
| History ids-first + longer TTL | ~5–40 | 3 cron + fewer client | **~30–80** |
| Client history throttle | ~12–20 syncs avoided | per active user session | **~20–60** (multiplicative with users) |
| Live TTL alignment | ~40–70 upstream/hour in-play | match windows | **~20–50** |
| **Combined (busy day, 1–2 active users)** | | | **≈ 150–280** |

---

## Cache Efficiency

| Signal | Mechanism |
| --- | --- |
| Hit ratio (process) | `getLocalCacheStats()` / response header `X-Cache-Hit-Ratio` on predict |
| Hit ratio (daily) | KV `footy_cache_stats:{YYYY-MM-DD}` via `getDailyCacheStats()` |
| Odds prefetch telemetry | Headers `X-Odds-Prefetch-Mapped`, `X-Odds-Prefetch-Upstream` |
| Warm report | `oddsPrefetch`, `fixturesFromCache`, `teamStatsCached` |

**Expected hit ratios after warm cron:**

| Window | Hit ratio |
| --- | --- |
| Immediately after warm-predict | **70–90%** on predict |
| Mid-day repeated predict same date | **85–95%** |
| Cold morning (empty KV) | **0–20%** first run, then high |

---

## Estimated Daily Savings

Assumptions: Pro plan ~**750** requests/day limit; 3× warm-predict; 3× history sync; moderate interactive use.

| Bucket | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Cron warm-predict | 240 | 120 | **120** |
| Cron history | 90 | 40 | **50** |
| Interactive predict/warm | 80 | 40 | **40** |
| Live + client history | 60 | 20 | **40** |
| **Total** | **~470** | **~220** | **≈ 250 (≈ 53%)** |

On quieter days absolute savings are lower but the **percentage cut on odds + history + live** remains in the **45–55%** band.

---

## Files touched

| File | Change |
| --- | --- |
| `server-utils/fetcher.js` | Canonical keys, inflight dedupe, cache stats |
| `server-utils/oddsPrefetch.js` | **New** — date odds batching |
| `api/predict.js` | Prefetch odds map; headers |
| `api/warm.js` | Odds prefetch; fixture-aligned teamstats |
| `api/cron/warm-predict.js` | `odds=1`; reserve default 80 |
| `api/history.js` | Prefer ids batches; longer ids TTL |
| `api/fixtures.js` | Live TTL 75s |
| `src/hooks/usePredictFlow.ts` | Warm with standings/teamstats/odds |
| `src/hooks/useAppController.ts` | History 7d / 15m / 10m cooldown |
| `src/pages/UserDashboard.tsx` | Same history throttle |
| `src/hooks/useLiveFixtureScorePoll.ts` | Poll 75s |
| `src/utils/predictFlowUtils.ts` | Post-predict sync days=7 |

---

## Ops knobs

```bash
ODDS_PREFETCH_MAX_PAGES=6
TEAMSTATS_WARM_LIMIT=30
LIVE_SCORES_CACHE_TTL_SEC=75
HISTORY_SYNC_PREFER_IDS=1
HISTORY_SYNC_IDS_TTL_SEC=300
CRON_USAGE_RESERVE_CALLS=80
CRON_USAGE_BUDGET_THRESHOLD_PCT=70
CRON_USAGE_HARD_STOP_PCT=75
```

---

## Follow-ups (not required for −50%)

1. Persist odds + teamstats in Supabase from cron (survive KV cold starts).
2. Return per-request `callsUsed` / `fromCache` breakdown in predict JSON for admin UI.
3. Merge warm+predict into a single internal function (skip extra HTTP hop in cron).
