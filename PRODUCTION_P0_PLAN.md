# PRODUCTION P0 PLAN
## Footy Predictor Pro — Certification Sprint (Plan Only)

| Field | Value |
|-------|-------|
| **Document** | `PRODUCTION_P0_PLAN.md` |
| **Date** | 2026-07-20 |
| **Source audit** | `FINAL_ENTERPRISE_AUDIT_2026.md` @ `main` / `0efe7acc` |
| **Current score** | 6.3 / 10 — Conditional Pass |
| **Target** | Production PASS — no remaining P0 blockers |
| **Status** | **IMPLEMENTED** — see `PRODUCTION_CERTIFICATION_REPORT.md` |
| **Constraint** | No redesign · no unrelated features · backward compatible · do not change prediction accuracy unless required by statistical validation |

---

# 0. Executive plan summary

This sprint closes the **remaining P0 blockers** from the enterprise certification:

| Task | Goal | Blocking? |
|------|------|-----------|
| T1 | Lock down public endpoints + strip ops leaks | **Yes** |
| T2 | History sync = CRON / ADMIN / SERVICE only (no client user path) | **Yes** |
| T3 | Host-header / SSRF hardening + tests | **Yes** |
| T4 | Walk-forward chronological validation | **Yes** (cert science) |
| T5 | Full CLV tracking + authenticated reports | **Yes** (cert science) |
| T6 | Security headers (CSP) + route audit hardening | **Yes** |
| T7 | Regression tests for all of the above | **Yes** |
| T8 | CI fails on build / types / security / API / WF / CLV | **Yes** |
| T9 | `PRODUCTION_CERTIFICATION_REPORT.md` after verify | Gate |

**Out of scope for this sprint:** prediction formula changes, new markets, UI redesign, new serverless routes (Hobby 12-function ceiling), model accuracy tuning unrelated to validation methodology.

---

# 1. Endpoint classification matrix (as-is → to-be)

Legend: **P** public · **A** authenticated JWT · **ADM** admin · **CRON** cron/internal · **SIG** Stripe signature

| Endpoint | As-is | To-be | Action |
|----------|-------|-------|--------|
| `GET /api/fixtures` (day leagues) | P + **leaks `usage`** | P (leagues only) | **Strip `usage` / cache / provider from public JSON**; admin-only via `usageOnly=1` (already ADM) |
| `GET /api/fixtures?view=live` | P | **A** (+ RL) | Require JWT; apply IP RL for defense-in-depth |
| `GET /api/fixtures?view=xg` | P + CORS `*` | **A** (+ RL) | Require JWT; tighten CORS to app origin(s) |
| `GET /api/fixtures?gdprExport / tierStatus / warmPredictUsage` | A | A | Keep |
| `GET /api/fixtures?usageOnly=1` | ADM | ADM | Keep |
| `GET/POST /api/predict` | A \| CRON | A \| CRON | Keep; wire optional RL only for non-cron if needed |
| `GET/POST /api/warm` | A \| CRON | A \| CRON | Keep |
| `GET /api/history` (aggregates, no bearer) | P | P | Keep aggregates only |
| `GET /api/history?mine=1` | A | A | Keep |
| `GET /api/history` admin full | ADM | ADM | Keep |
| `GET /api/history?performance=1` | A / ADM | A / ADM | Keep |
| `?sync=1` / `?closing=1` | CRON \| ADM | **CRON \| ADM** | Keep server gate; **remove client user calls** |
| `GET /api/backtest?view=public-track` | P | P | Keep sanitized aggregates; ensure no raw bets / ops |
| `?view=kpi\|analytics\|health\|metrics\|model-lab\|model-select` | CRON \| ADM | CRON \| ADM | Keep |
| `?view=snapshot` | CRON | CRON | Keep |
| `GET /api/alerts` | CRON \| ADM | CRON \| ADM | Keep |
| `GET /api/billing?view=config` | P | P | Keep (publishable key only) |
| billing checkout/portal/trial | A | A | Keep |
| billing webhook | SIG | SIG | Keep |
| `/api/admin*` | ADM | ADM | Keep + SSRF fix |
| `/api/cache/prewarm` | CRON | CRON | Keep |
| `/api/notifications/dispatch` | CRON | CRON | Keep |
| `/api/cron/*` | CRON | CRON | Keep |

**Hard rule:** No public response may include API usage, quota, provider state, cache metadata, internal timing, or system diagnostics.

---

# 2. TASK 1 — Lock down remaining public endpoints

## Required modifications

### 2.1 `api/fixtures.js`
| Change | Detail |
|--------|--------|
| `handleDay` | Remove `usage` (and any cache/provider fields) from the **default public** JSON. Keep fetching usage only when `usageOnly=1` (admin) or when JWT present **and** response field is explicitly requested by admin. |
| `handleLive` | Require Bearer JWT (`getRequester`); 401 if missing. Optionally allow CRON. Apply `checkAnonymousRateLimit` is wrong namespace once auth’d — use authenticated RL or per-user soft cap. Prefer: auth required + existing KV cache TTL. |
| `handleXg` | Same as live: JWT required. Replace `Access-Control-Allow-Origin: *` with allowlist from `APP_BASE_URL` / `PUBLIC_BASE_URL` / `VERCEL_URL` (or omit CORS if same-origin only). |
| Response masking helper | Add small local helper `publicFixturesPayload(data)` that whitelists safe fields. |

**Backward compatibility:** Authenticated UserDashboard / FocusCard already send JWT for most calls — verify `useLiveFixtureScorePoll` and `useMarketTotalsHydrate` attach `Authorization`. If they do not, update those hooks (required for to-be AUTH).

### 2.2 Client fetch sites (must send JWT after live/xg gate)
| File | Change |
|------|--------|
| `src/hooks/useLiveFixtureScorePoll.ts` | Pass Supabase session Bearer on `/api/fixtures?view=live` |
| `src/hooks/useMarketTotalsHydrate.ts` | Pass Bearer on `view=xg` |
| `src/components/MatchModal.tsx` | xG fetch already present — attach Bearer |
| Any other `view=live` / `view=xg` callers | Grep + fix |

### 2.3 Rate limiting
| File | Change |
|------|--------|
| `server-utils/anonymousRateLimit.js` | Keep for residual public routes (`fixtures` day, `history` aggregates, `public-track`, `billing config`) — **wire into those handlers**. |
| `api/fixtures.js` `handleDay` | Call `checkAnonymousRateLimit(req, "fixtures-day")` before upstream. |
| `api/history.js` `handleHistoryRead` (anon) | Call RL namespace `history-public`. |
| `api/backtest.js` `handlePublicTrack` | Call RL namespace `public-track`. |
| `api/billing.js` `handleConfig` | Optional light RL. |

### 2.4 Explicit non-changes
- Do **not** make league day listing require auth (product needs browse). Only strip ops fields + RL.
- Do **not** add new Vercel functions.

---

# 3. TASK 2 — Secure history sync

## Current truth
- Server gate **already correct**: `api/history.js` → `isAuthorizedHistorySync` = cron OR admin.
- Clients still POST with user JWT → **401 spam**, broken settlement UX (not a privilege bypass).

## Required modifications

### 3.1 Server (harden + prove)
| File | Change |
|------|--------|
| `api/history.js` | Keep `isAuthorizedHistorySync`. Add explicit 403 body code `history_sync_forbidden_for_user`. Ensure no alternate query param re-enters sync. |
| `api/admin.js` | Keep admin proxy `history-sync-now` (after SSRF fix in T3). |
| `api/cron/warm-predict.js` | Already skips inline sync — update comment to match. |
| `server-utils/cronRequestAuth.js` | Document that UA fallback must stay off in prod; optional assert/log if flag set without secret. |

### 3.2 Client (remove user sync paths)
| File | Change |
|------|--------|
| `src/hooks/useHistorySync.ts` | No-op / early return unless `isAdmin`; or delete sync calls and expose `refreshHistoryRead` only. |
| `src/utils/predictFlowUtils.ts` | `syncHistoryAfterPredict` → **remove network sync** for users; keep optional history **read** refresh (`?mine=1`). |
| `src/hooks/useWarm.ts` | Stop calling sync after predict. |
| `src/hooks/useAppController.ts` | Remove login/visibility/interval sync POSTs. |
| `src/pages/UserDashboard.tsx` | Same — rely on cron + `useMarketTotalsHydrate` for local settle UX. |
| `src/components/PerformanceCounterModal.tsx` | Remove sync-before-read; just GET performance. |
| `README.md` | Fix docs: sync = cron/admin only. |

### 3.3 Settlement UX (backward compatible)
| File | Change |
|------|--------|
| `src/hooks/useMarketTotalsHydrate.ts` | Keep local merge of `marketResults` for FocusCard WIN/LOSS (already exists). Do **not** invent a new user global sync. |
| Optional later (out of P0 if time) | Admin-only “force settle” already via admin proxy. |

**Forbidden:** Any endpoint that lets a normal authenticated user trigger global history sync.

---

# 4. TASK 3 — Host header / SSRF hardening

## Attack surface today
| File | Function | Risk |
|------|----------|------|
| `api/admin.js` | `resolvePublicBaseUrl(req)` | Uses `x-forwarded-host` / `host` → fetch with `CRON_SECRET` |
| `api/billing.js` | `appOrigin(req)` | Stripe redirect URLs from Host if env unset |
| `api/cron/warm-predict.js` | `resolvePublicBaseUrl()` | **Already env-first** — use as reference |

## Required modifications

### 4.1 New shared module
**Create** `server-utils/publicBaseUrl.js` (or `requestSecurity.js`):

| Export | Behavior |
|--------|----------|
| `resolveTrustedAppOrigin(req, { purpose })` | Prefer `PUBLIC_BASE_URL` → `APP_BASE_URL` → `CRON_WARM_PREDICT_BASE_URL` → `VERCEL_URL` (https). **In production, never fall back to request Host.** |
| `assertHostAllowlisted(hostname)` | Allowlist: hostname of trusted env URL(s) + optional `ALLOWED_APP_HOSTS` CSV. Reject unknown / malformed / IP literals unless explicitly allowlisted. |
| `buildInternalApiUrl(path, query)` | Only from trusted origin — never from headers. |

### 4.2 Call-site updates
| File | Change |
|------|--------|
| `api/admin.js` | Replace `resolvePublicBaseUrl(req)` with trusted helper; fail 503 if unset in prod. Prefer **in-process** invoke of history/daily-ml handlers if feasible without new routes (optional stretch). |
| `api/billing.js` | `appOrigin` uses trusted helper; production requires env. |
| `api/fixtures.js` | CORS origin from trusted helper allowlist. |
| `.env.example` | Document `PUBLIC_BASE_URL`, `APP_BASE_URL`, `ALLOWED_APP_HOSTS`. |

### 4.3 Tests
| File | Cases |
|------|-------|
| `tests/securityP0.test.js` (extend) | Forged `x-forwarded-host=evil.com` must not win when env set; prod without env fails closed; malformed host rejected. |

---

# 5. TASK 4 — Walk-forward validation

## Problem
`CalibrationSelector.js` uses `shuffleIndices` + random k-folds; `daily-ml.js` shuffles stacker samples; AutoModelSelection uses overlapping retrospective windows — **future can leak into train**.

## Design (no accuracy claim — methodology only)

```
sorted samples by kickoff
→ expanding or rolling train window
→ validate ONLY on strictly future matches (+ optional embargo)
→ advance
→ aggregate LogLoss / Brier / ROI / ECE / Accuracy + bootstrap CIs
```

## Required modifications

### 5.1 New module
**Create** `server-utils/validation/WalkForward.js` (or `.ts` compiled via existing JS pattern):

| Export | Role |
|--------|------|
| `sortByKickoff(samples)` | Stable chronological sort |
| `iterWalkForwardWindows({ mode: "expanding"\|"rolling", trainSize, testSize, step, embargo })` | Yield `{ train, test }` |
| `evaluateWalkForward(samples, fitFn, predictFn, metrics)` | Aggregate metrics + CIs |
| `leagueGroupedWalkForward(...)` | Optional per-league |

Reuse concepts from `server-utils/ml/engineering/FeatureEngineering.js` → `assignTimeSplits` (wire, don’t duplicate forever).

### 5.2 Wire into production selection
| File | Change |
|------|--------|
| `server-utils/calibration/CalibrationSelector.js` | Add `timeOrderedFolds` / deprecate shuffle path for production selection. Keep shuffle behind `CALIB_CV_MODE=random` for legacy tests only; **default = time**. |
| `api/cron/daily-ml.js` | Pass `kickoffAt` on samples; call walk-forward for method selection; remove `shuffleInPlace` for evaluation; raise promotion floors via env defaults. |
| `scripts/fitCalibration.js` | Use walk-forward holdout for method choice. |
| `server-utils/modelLab/AutoModelSelection.js` | Promote only if OOS future slice improves vs baseline; raise `MODEL_SELECT_MIN_SAMPLES` default (e.g. 100–200). |

### 5.3 Metrics (required outputs)
Per window + aggregate: Walk-forward LogLoss, Brier, ROI (if odds present), Calibration ECE, Accuracy, bootstrap CI (simple percentile).

### 5.4 Accuracy constraint
Do **not** change Poisson/DC formulas. Only change **how models/maps are selected and promoted**.

### 5.5 Tests
| File | Cases |
|------|--------|
| `tests/math.test.js` or `tests/walkForward.test.js` | No future kickoff in train; rolling/expanding smoke; metric aggregation shape. |

---

# 6. TASK 5 — Closing Line Value (CLV)

## Already present
- `server-utils/closingOddsCapture.js`
- Migration `030_closing_odds_clv.sql`
- `BacktestAnalytics.js` CLV helpers
- Crons with `closing=1`

## Gaps to close
Coverage KPI, authenticated report API, per league/market/model/month aggregates, no public raw tables.

## Required modifications

### 6.1 Analytics layer
| File | Change |
|------|--------|
| `server-utils/backtest/BacktestAnalytics.js` or new `server-utils/backtest/ClvReport.js` | `buildClvReport(rows)` → avg/median CLV, positive %, coverage, by league / market / modelVersion / month. |
| `server-utils/closingOddsCapture.js` | Ensure opening + closing + timestamps documented; store `capturedAt` lag vs kickoff in blob if missing. |

### 6.2 API (no new function file if possible)
| File | Change |
|------|--------|
| `api/backtest.js` | Add `view=clv` gated **CRON \| ADMIN** (same gate as kpi/metrics). Return report JSON only — never dump raw `predictions_history`. |
| Optional | Include CLV summary slice inside existing `view=kpi` / health dashboard for admin UI. |

### 6.3 Admin UI (minimal — not a redesign)
| File | Change |
|------|--------|
| `src/components/monitoring/HealthDashboard.tsx` or `AdminObservatory.tsx` | Show coverage %, avg CLV, beat rate (read from `view=clv` or kpi). |

### 6.4 Persistence
| Asset | Change |
|-------|--------|
| `backtest_snapshots` | Already has `avg_clv`, `clv_count`, `clv_beat_rate` — ensure snapshot job fills them (verify `handleSnapshot`). |
| New migration | **Only if** needed for report indexes — prefer no migration if JSON/select suffices. |

### 6.5 Tests
| File | Cases |
|------|--------|
| `tests/math.test.js` or `tests/clv.test.js` | Known opening/closing → expected CLV%; coverage; grouping. |

---

# 7. TASK 6 — Security hardening

| Item | File | Change |
|------|------|--------|
| CSP | `vercel.json` | Add Content-Security-Policy suitable for Vite SPA (default-src/script-src/style-src/img-src/connect-src to self + Supabase + Stripe + API). Start report-only if needed, then enforce. |
| Existing headers | `vercel.json` | Keep HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy — verify complete. |
| CORS | `api/fixtures.js` | Remove `*`; allowlist. |
| JWT | `authAdmin.js` | No change unless gaps found — re-audit `getRequester`. |
| Secrets | `.env.example` | Document all required prod vars including Stripe + PUBLIC_BASE_URL. |
| Cron UA fallback | `cronRequestAuth.js` | Fail closed if `ALLOW_VERCEL_CRON_UA_FALLBACK=1` in `VERCEL_ENV=production` without explicit second flag. |
| Input validation | fixtures live/xg | Strict parse of `ids` / `fixtureId` (ints only, max list length). |

---

# 8. TASK 7 — Regression tests

| New / extended file | Must prove |
|---------------------|------------|
| `tests/securityP0.test.js` | Host allowlist / SSRF; history sync rejects user JWT; admin/cron accept (unit of pure helpers) |
| `tests/apiAuth.fixtures.test.js` (new) | Pure helpers or handler unit tests: public day has no `usage`; live/xg require auth (mock req/res) |
| `tests/walkForward.test.js` (new) | Chronology invariants |
| `tests/clv.test.js` (new) | CLV math + report aggregates |
| Update `src/hooks/useHistorySync.test.tsx` | Expect no sync / admin-only |
| Update `src/utils/predictFlowUtils.test.ts` | No user sync POST |

**Note:** Full HTTP integration against Vercel is optional; prefer testing pure auth helpers + response maskers for CI stability.

---

# 9. TASK 8 — CI

## `package.json` scripts to add
```json
"typecheck": "tsc --noEmit",
"lint": "echo \"lint: deferred minimal\" || true",
"test:security": "node --test tests/securityP0.test.js tests/apiAuth.fixtures.test.js",
"test:validation": "node --test tests/walkForward.test.js tests/clv.test.js",
"test": "… existing … && npm run test:validation"
```

**Lint reality:** No ESLint config exists today. For P0:
- Option A (preferred): Add minimal `eslint` + `eslint-plugin-react-hooks` flat config and `lint` script that CI runs.
- Option B: `lint` script runs `tsc --noEmit` as stand-in until ESLint lands — **not ideal**; prefer A if time permits.

## `.github/workflows/tests.yml` steps (order)
1. `npm ci`
2. `npm run test` (includes security + walk-forward + CLV)
3. `npm run typecheck`
4. `npm run lint`
5. `npm run build`

Fail the job on any non-zero exit.

### Optional (same sprint if cheap)
- Include `tests/observability.test.js` in `npm test`.

---

# 10. TASK 9 — Final certification artifact

**After implementation + green CI locally**, generate:

`PRODUCTION_CERTIFICATION_REPORT.md`

Required sections (per user brief):
- Files modified
- Security issues resolved
- Endpoints protected
- History Sync validation
- Host validation
- Walk Forward summary
- CLV summary
- Regression tests
- CI improvements
- Remaining technical debt
- Risk assessment
- Expected Enterprise Audit score
- Confidence level

**Do not claim PASS without verifying each success criterion.**

---

# 11. Complete affected file list

## Create
| Path | Why |
|------|-----|
| `PRODUCTION_P0_PLAN.md` | This plan |
| `server-utils/publicBaseUrl.js` (name TBD) | Trusted origin / host allowlist |
| `server-utils/validation/WalkForward.js` | Chronological CV |
| `server-utils/backtest/ClvReport.js` (optional if not in BacktestAnalytics) | CLV aggregates |
| `tests/walkForward.test.js` | WF regression |
| `tests/clv.test.js` | CLV regression |
| `tests/apiAuth.fixtures.test.js` | Public leak / auth gates |
| `PRODUCTION_CERTIFICATION_REPORT.md` | Post-impl only |
| `eslint.config.js` (if lint Option A) | CI lint |

## Modify — API / server
| Path | Tasks |
|------|-------|
| `api/fixtures.js` | T1, T6 |
| `api/history.js` | T2 (messages), T1 RL on public read |
| `api/admin.js` | T3 |
| `api/billing.js` | T3 |
| `api/backtest.js` | T1 RL, T5 `view=clv` |
| `api/cron/warm-predict.js` | T2 comments |
| `api/cron/daily-ml.js` | T4 |
| `server-utils/anonymousRateLimit.js` | T1 wire-up (call sites) |
| `server-utils/cronRequestAuth.js` | T6 |
| `server-utils/calibration/CalibrationSelector.js` | T4 |
| `server-utils/modelLab/AutoModelSelection.js` | T4 |
| `server-utils/closingOddsCapture.js` | T5 polish |
| `server-utils/backtest/BacktestAnalytics.js` | T5 |
| `server-utils/ml/engineering/FeatureEngineering.js` | T4 reuse |
| `vercel.json` | T6 CSP (+ headers verify) |
| `.env.example` | T3, T6 |
| `scripts/fitCalibration.js` | T4 |

## Modify — client
| Path | Tasks |
|------|-------|
| `src/hooks/useLiveFixtureScorePoll.ts` | T1 auth header |
| `src/hooks/useMarketTotalsHydrate.ts` | T1 auth header |
| `src/components/MatchModal.tsx` | T1 auth header |
| `src/hooks/useHistorySync.ts` | T2 |
| `src/utils/predictFlowUtils.ts` | T2 |
| `src/hooks/useWarm.ts` | T2 |
| `src/hooks/useAppController.ts` | T2 |
| `src/pages/UserDashboard.tsx` | T2 |
| `src/components/PerformanceCounterModal.tsx` | T2 |
| `src/components/monitoring/HealthDashboard.tsx` and/or `AdminObservatory.tsx` | T5 minimal CLV tile |
| `README.md` | T2 docs |

## Modify — tests / CI
| Path | Tasks |
|------|-------|
| `tests/securityP0.test.js` | T3, T2 |
| `tests/math.test.js` | Adjust if CV defaults change; keep random mode for old tests |
| `src/hooks/useHistorySync.test.tsx` | T2 |
| `src/utils/predictFlowUtils.test.ts` | T2 |
| `package.json` | T7, T8 |
| `.github/workflows/tests.yml` | T8 |
| `tsconfig.json` | Only if typecheck needs exclude tweaks |

## Explicitly do NOT modify (unless bug blocks P0)
- `server-utils/math.js` Poisson/DC core
- `PredictionEngine/*` λ formulas
- Stripe pricing / product catalog
- New Vercel serverless files (stay at 12)
- Unrelated UX redesign

---

# 12. Implementation order (when approved)

```
Phase A — Security locks (T1, T2, T3, T6)
  → client auth headers for live/xg
  → strip usage
  → kill user sync
  → trusted base URL
  → CSP + cron fallback harden
  → security tests green

Phase B — Science gates (T4, T5)
  → WalkForward module + CalibrationSelector default time mode
  → daily-ml + AutoModelSelection OOS
  → ClvReport + backtest view=clv
  → tests green

Phase C — CI (T8)
  → typecheck + build + lint in workflow
  → full npm test

Phase D — Certification (T9)
  → PRODUCTION_CERTIFICATION_REPORT.md
  → re-score expected audit
```

---

# 13. Success criteria checklist (definition of done)

| Criterion | Verification |
|-----------|--------------|
| No public operational endpoints / leaks | Curl anon fixtures day → no `usage`; live/xg → 401 without JWT |
| No History Sync from client user | Network tab / unit tests: no `sync=1` from UserDashboard |
| Host header protected | Unit tests with forged Host |
| SSRF mitigated | Admin base URL from env only in prod |
| Walk Forward implemented | Module + daily-ml uses time folds by default |
| CLV operational | `view=clv` returns aggregates; snapshot fields populated when data exists |
| Regression tests green | `npm test` |
| CI green | GH Actions: test + typecheck + lint + build |
| No regression / backward compatible | Authenticated flows still predict/warm; public track still loads |
| Full PASS claim | Only after `PRODUCTION_CERTIFICATION_REPORT.md` with evidence |

---

# 14. Risk & effort

| Area | Effort | Risk if skipped |
|------|--------|-----------------|
| T1 fixtures lockdown | M | Critical quota burn |
| T2 client sync removal | S–M | UX pending + 401 noise (auth already OK) |
| T3 SSRF | S–M | Critical secret exfil |
| T4 walk-forward | L | Cert reject (science) |
| T5 CLV report | M | Cert reject (edge proof) |
| T6 CSP | M (tune) | XSS residual |
| T7–T8 tests/CI | M | Regressions return |
| T9 report | S | Process incomplete |

**Estimated calendar:** 2–4 focused engineering days for Phases A–C if no CSP breakage; Phase B is the longest (walk-forward wiring).

---

# 15. Approval gate

**Per workflow instruction: DO NOT START EDITING until this plan is accepted.**

Reply with one of:
- **`implement`** / **`go`** — begin Phase A → D in order
- **`revise <notes>`** — adjust plan before any code changes
- **`phase A only`** — security locks first, defer WF/CLV

---

*End of PRODUCTION_P0_PLAN.md — plan only, no implementation performed.*
