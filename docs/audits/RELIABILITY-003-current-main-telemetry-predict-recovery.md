# RELIABILITY-003 — Current-Main Telemetry-Only Patch + Predict Throw-Recovery

Date: 2026-09-11. **Prepared, not shipped:** no commit, push, merge or deploy. The work lives on local branch `fix/reliability-003-telemetry-predict-recovery` in a fresh worktree created from `origin/main` `ed20e9d1`.

---

## 1. Checkout

| Property | Value |
|---|---|
| Primary checkout | `main` @ `02544b62`, 299 behind / 0 ahead, 48 dirty entries. **Untouched.** |
| `origin/main` | `ed20e9d14a87f4be3cefe6fa6613a5f07f3a770d` (re-fetched; unchanged since RELIABILITY-002) |
| Work base | new worktree `scratchpad\wt-r003`, branch `fix/reliability-003-telemetry-predict-recovery` from `origin/main` |
| `wt-r002` | **not reused**. It is dirty with the P0-A auth hunks, which are out of scope here; it was kept as RELIABILITY-002 evidence and used only for the read-only auth check (§8). |
| Install | `npm ci`, 477 packages, lockfile unchanged, `@typescript-eslint/eslint-plugin/dist/index.js` present |

Nothing was copied whole from the stale checkout. The only file carried byte-for-byte is `rateLimitHeaders.js`, a new module that has no counterpart on origin/main (sha256 `04977072…`). Its test is identical (`fdf10c3c…`). Every other change was applied as hunks to origin/main's current files.

---

## 2. Baseline re-validation (clean `origin/main`, before any change)

| Check | Result | Matches RELIABILITY-002? |
|---|---|---|
| `npm run typecheck` / `tsc --noEmit` | PASS / PASS | yes |
| `eslint . --max-warnings 0` | PASS (0 warnings) | yes |
| `validate:pkg` | PASS, no orphans | yes |
| Node `--test` (28 chain scripts) | **2,619 / 0** | yes |
| Vitest `test:unit` | **1,865 / 1,866**. The one failure is `primitives.guard.test.ts`, the known Windows path-separator false positive (green on CI). | yes |
| `test:e2e-unit` / `test:golden` | 13/13 · 3/3 | yes |

---

## 3. Part A — API-Sports rate-limit telemetry

### `server-utils/fetcher.js` (+28 / −1; origin/main's observability layer untouched)

1. One import line added **beside** origin/main's existing `metricsStore` import. This is the RELIABILITY-002 conflict, resolved the only non-destructive way.
2. At the top of `recordUsageFromHeaders`: parse both quotas with `parseRateLimitHeaders`. If the minute window reports `remaining === 0`, emit `api.rate_limit_minute_exhausted {provider, minuteLimit, reset, retryAfter}`. This fires **before** the KV write, so it survives a KV failure.
3. `...rateLimitFields` is spread into the existing `usagePayload`. Only present values are added, so a daily figure can never be overwritten with `null`.

The daily `hLimit`/`hRemain`/`count`/`baselineRemaining` arithmetic is byte-identical to origin/main, including its `||` fallback. The function is still called only through origin/main's `recordUsageTelemetry` try/catch, so the parser can never veto a provider response, and the parser guards every header read itself as well.

**Not added:** throttling, queue, sleep, retry, concurrency limit, circuit breaker, or any cache key/TTL change. The integrated tests assert exactly one provider call per request, including on an exhausted minute window.

### Field mapping

| Header | Meaning | Field (KV `footy_api_usage:<YYYY-MM-DD>`) |
|---|---|---|
| `x-ratelimit-requests-limit` | daily ceiling | existing `limit` (unchanged) + `dailyLimit` |
| `x-ratelimit-requests-remaining` | daily remaining | existing `currentRemaining` (unchanged) + `dailyRemaining` |
| `x-ratelimit-limit` | **per-minute ceiling** | `minuteLimit` |
| `x-ratelimit-remaining` | **per-minute remaining** | `minuteRemaining` (0 kept, never dropped as falsy) |
| `x-ratelimit-reset` | window reset, if sent | `rateLimitReset` |
| `retry-after` | backoff hint, if sent | `retryAfter`, **recorded, never acted on** |
| — | observation time | `rateLimitObservedAt` (ISO-8601) |

### Test registration (`package.json`, +1 / −1)

`tests/rateLimitHeaders.test.js` is appended to the **existing** `test:fetcher` script, beside `fetcherUsageTelemetry.test.js`. No new script was created, the rewritten 31-script `test` chain is untouched, and nothing unrelated was registered. `validate:pkg` reports no orphans.

---

## 4. Part B — predict throw-recovery (`src/hooks/usePredictFlow.ts`)

### Where the gap was

origin/main wrapped the whole date loop **and** the completion call in one outer `try`. A non-OK or 429 response did `setStatus(...); return;`, and a throw escaped to the outer `catch`. Both skipped `onPredictCompleted`, the only path to the UI. RELIABILITY-001 fixed the non-OK/429 paths, but a throw still took the outer `catch`, so its "exception preserves completed dates" claim held only for the returned value.

### Structure now (not a bare `return` → `break`)

```
for date of dates:
   try { fetch → 429 | non-OK → record failure; break
                  json()      → rows + completedDates.push(date) }
   catch → record failure; break          ← throws are now a per-date failure
deduped = dedupe(rows of completed dates only)
if (no failure OR ≥1 completed date):     ← at most once
   try { await onPredictCompleted(deduped, token, completedDates) }
   catch → keep the date failure message if any, else show the callback error
if failure: setStatus(msg + " (n/N)" when partial)   ← AFTER the callback
return { outcome, completedDates, failedDates, rowCount }
```

### A RELIABILITY-001 regression fixed on the way

R001 guarded completion with `deduped.length > 0`. That also **suppressed completion on a fully successful run that returned 0 rows**: origin/main calls the callback there and shows "0 generated", whereas R001 would have left the "processing" status on screen. The condition is now "no failure, or ≥1 completed date", so origin/main's success path is unchanged, including empty results. A dedicated test pins it.

### Required semantics

| Case | Result |
|---|---|
| 1 · all 3 succeed | `success`; one completion with all rows and all 3 dates |
| 2 · d1 ok, d2 non-OK | d3 not requested; `partial_success`; completion with d1 only; `failedDates=[d2,d3]` |
| 3 · d1 ok, d2 **throws** | d3 not requested; `partial_success`; completion with d1 only; status `Eroare: … (1/3)` |
| 3b · d1 ok, d2 **JSON parse throws** | same as 3; d2 never counted completed |
| 4 · first date throws | `failure`; **no** completion; exception status (origin/main behaviour) |
| 5 · callback throws | called **once**, never retried. Whatever the consumer merged before throwing stays merged; the status shows the error, or the date failure if there is one. **Irreducible limitation:** consumer steps after the throw point don't run (e.g. `loadHistory`); the hook can't undo or complete a consumer's internal work. |

### Store safety (current origin/main consumers, unchanged)

- `mergePredictionRows` seeds from the **existing** rows, and `setUserPredictionMap` is a Set **union**, so a partial batch can only add rows.
- `syncHistoryAfterPredict` is a documented no-op (`return;`), so there is nothing to desync.
- `setPreds(deduped)` replaces the visible list, exactly as on every full run; the durable per-user store is merged.
- The third callback argument is the completed dates only, so `useWarm`'s `pentru ${dates.length} zi(le)` is truthful.
- `UserDashboard.tsx` and `useWarm.ts` were **not modified**; both `await runPredict(...)` and ignore the new additive `PredictRunResult`.

---

## 5. Tests

`src/hooks/usePredictFlow.partial.test.tsx` has 17 cases, auto-collected by `vitest run src`, and follows origin/main's `usePredictFlow.test.tsx` conventions (`renderHook`, stubbed `fetch`).

| # | Required | Covered by |
|---|---|---|
| 1 | all dates success | "all dates succeed…" + "…zero rows: completion still runs" |
| 2 | d1 ok + d2 non-OK | "date 1 succeeds, date 2 non-OK…" |
| 3 | d1 ok + d2 429 | "429 keeps its dedicated rate-limit message…" (status `… (1/2)`) |
| 4 | d1 ok + d2 throws | "…date 2 fetch THROWS…" |
| 5 | d1 ok + d2 JSON parse throws | "…date 2 JSON parse THROWS…" |
| 6 | first date throws | "first date THROWS…" |
| 7 | completed rows survive | "a partial completion adds its rows…" (real `mergePredictionRows`) |
| 8 | no store shrink | same, plus "a run where nothing completes leaves the per-user store untouched" |
| 9 | failed date not completed | JSON-parse and non-OK cases assert `completedDates`/`failedDates` |
| 10 | exact completed dates | asserted in the non-OK, throw and JSON-parse cases |
| + | callback throws (once only; message precedence) | two cases |
| + | retry only `failedDates` | asserts the retried request's `date` param and total fetch count |

Telemetry uses the parser tests (`tests/rateLimitHeaders.test.js`, 11) plus **4 new integrated cases** in origin/main's `tests/fetcherUsageTelemetry.test.js`, which drive the real `getWithCache`:

| # | Required | Covered by |
|---|---|---|
| 11 | daily headers | parser B; integrated "daily headers only → no invented minute fields" |
| 12 | minute headers | parser A/C; integrated "both quota pairs → daily unchanged, minute added" |
| 13 | reset / retry-after | parser E; integrated exhausted case asserts `retryAfter` in log and row |
| 14 | missing headers | parser D + existing "no rate-limit headers → no usage record" |
| 15 | minute exhausted | integrated: one warning, one provider call, `minuteRemaining: 0` recorded; plus the same with KV throwing (warning still fires, response still ok) |

No existing test was weakened. R001's weak exception case (no completion spy) was replaced by stronger ones.

---

## 6. Lint / typecheck / tests — baseline vs patch

| Check | origin/main | Patch | Result |
|---|---|---|---|
| Typecheck (`tsconfig.ci.json` / default) | PASS / PASS | PASS / PASS | = |
| ESLint `--max-warnings 0` (full repo) | PASS | PASS | = |
| ESLint targeted (changed files + `useWarm.ts`, `UserDashboard.tsx`) | — | PASS | — |
| `validate:pkg` | PASS | PASS (no orphans) | = |
| Node tests | 2,619 / 0 | **2,634 / 0** | +15 (11 parser + 4 integrated) |
| Vitest | 1,865 / 1 fail | **1,882 / 1 fail** | +17; same pre-existing `primitives.guard` failure |
| e2e-unit / golden | 13 · 3 | 13 · 3 | = |
| Targeted: predict-flow (vitest) | 2 | **19 / 19** | |
| Targeted: `test:fetcher` | 13 | **28 / 28** | |

**New failures: none.**

---

## 7. Diff audit

```
 package.json                        |  2 +-
 server-utils/fetcher.js             | 29 +++++++++++-
 src/hooks/usePredictFlow.ts         | 94 +++++++++++++++++++++++++++++++------
 tests/fetcherUsageTelemetry.test.js | 88 ++++++++++++++++++++++++++++++++++
 4 files changed, 197 insertions(+), 16 deletions(-)
?? server-utils/observability/rateLimitHeaders.js   (118 lines)
?? tests/rateLimitHeaders.test.js                   (168 lines)
?? src/hooks/usePredictFlow.partial.test.tsx        (344 lines)
?? docs/audits/RELIABILITY-003-current-main-telemetry-predict-recovery.md
```

This is the expected set plus **one justified addition**: `tests/fetcherUsageTelemetry.test.js`. It is origin/main's own fetcher test, already registered, and extended with the integrated telemetry cases RELIABILITY-002 §14 called for. Without them, nothing would test the wired path.

The intersection with frozen areas is **NONE**: `api/history.js`, `UserDashboard.tsx`, `useWarm.ts`, `server-utils/pipeline/*` (PredictorV3, Stage00–12, Stage08Decision), `PredictionEngine/*`, calibration/overlay/AutoCalibration, settlement, recommended, `marketOdds.js`, migrations, the auth helpers, venue and strength code. No pre-existing unrelated change is included.

---

## 8. Auth review (review only — nothing changed)

- R001's two auth hunks still `git apply --check` cleanly against origin/main `ed20e9d1`.
- `tests/authProviderSemantics.test.js` passes **25 / 25** on `wt-r002` (origin/main + exactly those hunks).
- `AuthRetryableFetchError` → 503; `AuthApiError`, `AuthSessionMissingError`, no token, and `!data.user` without a retryable error → 401.
- origin/main still has exactly **two** server `auth.getUser` call sites and two "Token invalid sau expirat." strings, both covered. **No missed helper.**

Auth P0 is **not** in this branch. It remains READY for a separate change.

---

## 9. Provider-behaviour isolation

In the patched `getWithCache`, the request URL, headers, fallback-provider retry, budget circuit, inflight dedup, cache read/write and TTL are all unchanged. The only new work per upstream response is a pure header read, plus at most one log line when the minute window is spent. The integrated tests assert one provider call per request in every telemetry case.

---

## 10. Independent review

A read-only ECC TypeScript review of the full diff found **no CRITICAL and no HIGH** issues. It confirmed success-path parity with origin/main, a single completion call site, completed dates always being a contiguous prefix (so `dates.slice(completedDates.length)` is sound), and that nothing in the fetcher change can escape `recordUsageTelemetry` or clobber daily fields.

- **MEDIUM (accepted, by design):** a callback error after an all-success run returns `outcome: "success"` while the status shows the error. This is documented in the type comment and tested; there are no dates to retry.
- **LOW (accepted):** the block comments are long. They match the comment density of the surrounding origin/main `fetcher.js`.

---

## 11. Risks / follow-ups

1. **Observation limits (unchanged from RELIABILITY-002 §15).** The usage row is last-write-wins per day and not exposed by `getApiUsage()`, so `minuteLimit` needs a direct KV read. The exhaustion log is kept about 1h. If production KV rejects writes, check `api.usage_telemetry_failed` first.
2. The partial status suffix `(n/N)` is composed in the hook, not i18n (as in R001).
3. There is still no retry UI; `failedDates` is exposed but not wired.
4. P0-A auth ships separately.

---

VERDICT:
READY FOR REVIEW / TELEMETRY + PREDICT-RECOVERY PATCH PREPARED

CHECKOUT:
CURRENT (origin/main ed20e9d1)

ESLINT:
PASS

TYPECHECK:
PASS

TESTS:
PASS (only the pre-existing primitives.guard failure; no new failures)

TELEMETRY P1:
READY

PREDICT RECOVERY P0 (incl. throw path):
READY

AUTH P0:
READY — not in this branch

V3 ISOLATION:
CONFIRMED

PRODUCTION CHANGE IN THIS TASK:
NONE (no commit, push, merge or deploy)

NEXT STEP:
Commit this branch and open a PR for review. After merge and deploy, read `minuteLimit` from `footy_api_usage:<date>` to start the RPM-budget measurement.
