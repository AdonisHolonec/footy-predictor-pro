# FINAL ENTERPRISE AUDIT 2026
## Footy Predictor Pro — Production Certification Panel

| Field | Value |
|-------|-------|
| **Document** | `FINAL_ENTERPRISE_AUDIT_2026.md` |
| **Inspection date** | 2026-07-20 |
| **Repository** | `footy-predictor-starter` → remote `AdonisHolonec/footy-predictor-pro` |
| **Branch / tip** | `main` @ `0efe7acc` (post Special Bet UI; shots-odds fuzzy match; UEFA domestic stats fallback) |
| **Production URL** | https://footy-predictor-pro.vercel.app |
| **Panel** | CTO · Principal AI Engineer · Quant Researcher · Senior Data Scientist · DevOps Architect · Security Engineer · Product Director · SaaS Consultant |
| **Mandate** | Certify whether this repository deserves production deployment. Assume competitor ownership. Reject theater. Evidence over narrative. |
| **Supersedes** | Prior `FINAL_ENTERPRISE_AUDIT_2026.md` dated 2026-07-18 (many P0s therein are **closed**; this document re-scores current code) |

> **This is not a celebration document.** Engineering ambition is real. Certification asks only: *would a competent enterprise CTO ship this to paying strangers tomorrow without material brand, legal, or capital risk?*

---

# 27. CTO FINAL VERDICT (PREVIEW)

| Decision | Result |
|----------|--------|
| **Public paid production SaaS (unrestricted marketing)** | **REJECT** |
| **Open anonymous heavy traffic** | **REJECT** |
| **Closed paid / trial beta (known cohorts)** | **CONDITIONAL PASS** — after P0 security + settlement reliability |
| **Internal research / paper-trading lab** | **ACCEPT** |

| Metric | Value |
|--------|-------|
| **Weighted overall score** | **6.3 / 10** |
| **Letter grade** | **C+** |
| **Enterprise SaaS readiness** | **~58%** |
| **Paid niche beta readiness (post-P0)** | **~78%** |
| **Research / demo readiness** | **~88%** |

### Why not green
The product now has a **credible commercial skeleton** (Stripe, tier masks, JWT-gated predict/warm, RLS crown jewels, cron ML/history). It still fails enterprise certification because:

1. **Unauthenticated upstream burn** on `/api/fixtures` (day / live / xg) + API usage disclosure.
2. **Settlement reliability gap** — corners/shots validation depends on sparse crons; client history sync is auth-mismatched (user JWT → 401).
3. **Edge not scientifically certified** — no walk-forward promotion gate; CLV plumbing exists but coverage/reporting is not a release criterion.
4. **Ops fragility** — Hobby 12-function ceiling, predict/history without elevated `maxDuration`, KV module-load hard dependency, thin CI (tests only).

### What changed since 2026-07-18 audit (credit where due)
| Prior P0 claim | Status now |
|----------------|------------|
| Anonymous predict/warm | **Closed** — JWT or cron (`Stage00Ingress`, `api/warm.js`) |
| Missing Stripe | **Closed** — `api/billing.js`, `stripeBilling.js`, portal/checkout/webhook |
| Missing RLS on crown jewels | **Closed** — `026_rls_crown_jewels.sql` (+ privilege/Stripe guards 027/029) |
| Train/serve skew on final probs | **Mostly closed** — `extractRawTriple` prefers `rawPoissonProbs1x2Pct` |
| Closing odds absent | **Plumbing shipped** — `closingOddsCapture.js`, migration 030; adoption still incomplete |
| Premium limit &lt; Free | **Addressed in product logic** — verify env caps in deploy; code path uses `accessTier.js` |

---

# 1. Executive Summary

### What this system is
A Vite/React SPA + **12** Vercel serverless handlers under `api/` + Supabase Auth/Postgres (30 migrations) + `@vercel/kv` cache + API-Football upstream, with Predictor V3 staged pipeline (`Stage00`–`Stage12`) and a deep modeling stack under `server-utils/` (~172 files) and consumer UI under `src/` (~136 files).

### Inventory (inspected surface)
| Surface | Count / notes |
|---------|----------------|
| Tracked-ish source files (excl. `node_modules`/`dist`/`backups`) | ~451 |
| API entrypoints | 12 (Hobby function ceiling) |
| Supabase migrations | 30 |
| Test files under `tests/` | 8 (+ Vitest under `src/`) |
| CI | `.github/workflows/tests.yml` → `npm test` only |
| Crons in `vercel.json` | 12 schedules |
| Live tests (this inspection) | 84 node + 14 vitest = **98 passing** |

### Genuinely strong
1. **Real goals model** — modular λ → bivariate Poisson + Dixon–Coles (`server-utils/math.js`, `PredictionEngine/`).
2. **Productized enrichment** — rolling xG, corners/SOT Poisson blocks, Shin de-vig, Value/Kelly, adaptive Monte Carlo, isotonic + parametric calibration, multinomial stacker, Elo parallel signal.
3. **Commercial path** — Stripe webhook-signed billing, tier masking (`Stage11Masking`), warm/predict quotas, GDPR export hooks.
4. **Ops intent** — warm-predict cron chain, daily-ml, history sync + closing capture, health bundle / metrics store.
5. **Security progress** — admin emails server-only, RLS deny-by-default on history/snapshots, profile privilege triggers.

### Certification killers (remain)
1. Public fixtures/live/xg burn + `usage` leak (`api/fixtures.js`).
2. History sync policy vs client (`isAuthorizedHistorySync` cron/admin only; `useHistorySync` still user JWT).
3. Admin internal fetch Host-header SSRF risk (`api/admin.js` `resolvePublicBaseUrl`).
4. No temporal OOS gate for calib/stacker/Model Lab promotion.
5. CI is not a release gate (no build/tsc/E2E/security audit).

### Scorecard (all sections)

| # | Section | Score | Grade | Risk | Priority | Business impact | Technical impact | Effort |
|---|---| ---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 2 | Architecture | 7.0 | B− | Med | P1 | Med | High | L |
| 3 | AI & Prediction Engine | 7.0 | B− | High | P0 | High | High | L |
| 4 | Quantitative Validation | 4.0 | D+ | High | P0 | High | High | XL |
| 5 | Statistical Validation | 3.5 | D+ | High | P0 | High | High | XL |
| 6 | Explainability | 6.0 | C+ | Med | P2 | Med | Low | M |
| 7 | Feature Importance | 4.5 | D+ | Med | P2 | Low | Med | M |
| 8 | Monte Carlo | 7.0 | B− | Low | P2 | Low | Med | S |
| 9 | Calibration | 5.5 | C | High | P0 | High | High | L |
| 10 | Ensemble | 5.5 | C | High | P1 | Med | High | L |
| 11 | API | 5.5 | C | Critical | P0 | High | High | M |
| 12 | Database | 7.0 | B− | Med | P1 | High | High | M |
| 13 | Security | 5.5 | C | Critical | P0 | Critical | High | M |
| 14 | Performance | 6.0 | C+ | Med | P1 | Med | Med | M |
| 15 | Cache | 6.5 | B− | High | P0 | High | Med | S |
| 16 | Frontend | 6.0 | C+ | Med | P1 | High | Med | L |
| 17 | UX | 6.0 | C+ | Med | P1 | High | Low | M |
| 18 | DevOps | 5.0 | C | High | P0 | High | High | M |
| 19 | Monitoring | 5.5 | C | Med | P1 | Med | Med | M |
| 20 | CI/CD | 3.5 | D+ | High | P0 | High | High | M |
| 21 | Test Coverage | 5.0 | C | High | P0 | Med | High | L |
| 22 | Competitive Benchmark | 6.0 | C+ | Med | P2 | High | Low | — |
| 23 | Technical Debt | 4.5 | D+ | Med | P1 | Med | High | L |
| 24 | Production Risks | — | — | Critical | P0 | Critical | High | — |
| **Overall (weighted)** | | **6.3** | **C+** | | | | | |

Weighting emphasis: Security ×1.4, Quant/Stats ×1.3, API/DevOps ×1.2, AI engine ×1.1, UX/FE ×0.9, Explainability/MC ×0.7.

---

# 2. Architecture Review

**Score: 7.0 · Grade: B− · Risk: Medium · Priority: P1 · Business: Med · Tech: High · Effort: L**

### Topology
```
Client (Vite/React)
  → api/*.js (Vercel serverless, 12 functions)
    → server-utils (PredictorV3 Stage00–12, fetcher, billing, ML)
      → @vercel/kv (Upstash)
      → supabaseAdmin (service_role)
      → API-Football / RapidAPI
Cron (vercel.json) → same API surface
```

### Strengths
- Clear orchestrator: `api/predict.js` → `PredictorV3.handle` → `Stage00Ingress`…`Stage12Response`.
- Fixture loop isolation: `runFixtureStageLoop.js` + per-fixture abort on insufficient data.
- Separation of warm (cache fill) vs predict (compute) vs history sync (settle).
- League profiles JSON-driven (`leagueProfiles.config.json`) — not hard-coded magic only.

### Weaknesses
- **Dual prediction trees**: `server-utils/prediction/` + `server-utils/PredictionEngine/` (+ frozen `backups/`). Cognitive load and drift risk.
- **Hobby 12-function hard ceiling** — any new route requires consolidation.
- Broken `npm run api` (`server/` directory missing).
- Untracked one-shot slice scripts and `App.tsx.backup-pre-refactor` pollute workspace hygiene.

### Evidence
- `server-utils/pipeline/PredictorV3.js`, `STAGE_ORDER`, `PREDICTOR_V3_VERSION`
- `vercel.json` rewrites + crons + headers
- `package.json` scripts

---

# 3. AI & Prediction Engine Review

**Score: 7.0 · Grade: B− · Risk: High · Priority: P0 · Business: High · Tech: High · Effort: L**

### Core path (live)
`Stage02` features → `Stage03` `PredictionEngine.build` / `strengthRatingsLambdas` → `Stage04` `computeMatchProbs` → `Stage05` MC + side markets → `Stage06` calibration → `Stage07` Elo/Shin/stacker/ModelLab → `Stage08` Value/Kelly → `Stage09` explain.

### Modules
`AttackStrength`, `DefenseStrength`, `FormEngine`, `HomeAdvantage`, `AwayStrength`, `RecentMatches`, `StandingsEngine`, `H2HEngine`, `RefereeEngine`, `InjuriesEngine`, `LineupEngine`, `OddsEngine`, `RestDaysEngine`, `MotivationEngine`, `WeatherEngine`, `PoissonEngine`, `ExpectedGoals`, `ConfidenceEngine`, `RecommendationEngine` — wired via `MODULES` + `combineLambdas` (`PredictionEngine/index.js`, `combine.js`).

### Strengths
- Bivariate Poisson + Dixon–Coles τ is a legitimate football scoring model.
- Bayesian shrinkage on strengths; λ clamps; league ρ from draw frequency.
- UEFA / empty-cup stats fallback (domestic league + recent FT fixtures) — `predictHelpers.fetchTeamStatisticsWithSeasonFallback` — reduces “Date limitate” false negatives.
- Fuzzy + nearest-line shots odds matching — `marketOdds.consensusOverUnderOddsAtLine`.

### Weaknesses
- Optional modules (motivation/weather/lineup) often near-neutral → marketing “AI modules” overstates signal.
- Odds influence both λ (`weights.odds`) and post-hoc market blend → double-count risk.
- Side markets (corners/shots) use independent Poisson — no bivariate structure; independence untested.
- Insufficient-data abort is correct but still visible to users on thin competitions when all fallbacks fail.

### Verdict
**Research-grade core, product-grade packaging.** Not yet a certified edge engine.

---

# 4. Quantitative Validation

**Score: 4.0 · Grade: D+ · Risk: High · Priority: P0 · Business: High · Tech: High · Effort: XL**

### Present
- Backtest analytics: ROI, log-loss, Brier, Kelly growth, Sharpe, drawdown (`BacktestAnalytics.js`).
- Public track endpoint (sanitized aggregates).
- Closing-odds capture window (`closingOddsCapture.js`) + columns (migration 030).
- Model Lab metrics across registry A–E.

### Missing for certification
| Requirement | Status |
|-------------|--------|
| Systematic **CLV** report as ship gate | Plumbing only; coverage not proven |
| Walk-forward / purged CV for calib & stacker | Random folds in `CalibrationSelector` |
| Execution model (limits, latency, vig) | Absent |
| Side-market calibration | Absent |
| Bankroll simulation under stress | Partial (Kelly curve) only |

### Quant Researcher verdict
**Do not market as “+EV verified.”** Arithmetic is correct; edge is unproven.

---

# 5. Statistical Validation

**Score: 3.5 · Grade: D+ · Risk: High · Priority: P0 · Business: High · Tech: High · Effort: XL**

### Gaps
1. **Time leakage risk in selection** — `shuffleIndices` + k-fold for calibration method choice.
2. **Auto Model Selection** min samples ~20 — too low for promotion.
3. **In-sample stacker metrics** historically accepted as fitness.
4. **League heterogeneity** — global `league_id=-1` maps hide thin-league bias.
5. **No formal multiple-testing control** across markets (1X2 + O/U + corners + SOT + special bet).

### Present positives
- `assignTimeSplits` / `stripLeakage` in ML scaffolding (`FeatureEngineering.js`).
- Train/serve preference for raw Poisson triples (`ml/extractRawTriple.js`).
- Unit tests for core math identities (98 automated tests green at inspection).

### Data Scientist verdict
**Hypothesis engine, not validated estimator.** Ship only with explicit “model probabilities, not guarantees” legal copy (already partially present in UX).

---

# 6. Explainability Review

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P2 · Business: Med · Tech: Low · Effort: M**

### Present
- `PredictionExplanation.js` narrative reasons.
- `FeatureImportanceEngine.js` activation × prior bars.
- `PredictionContributions.js` signed module impact toward pick.
- UI: `ExplanationCard`, `FeatureImportanceChart`, `PredictionContributionsChart`, Prediction Laboratory radar.

### Limits
- FI is **not** SHAP/causal; keys omit stacker/MC/xG as first-class drivers.
- Dual confidence languages (engine vs card %) confuse power users.
- Laboratory scores are diagnostic UX, not Model Lab OOS metrics.

---

# 7. Feature Importance Validation

**Score: 4.5 · Grade: D+ · Risk: Medium · Priority: P2 · Business: Low · Tech: Med · Effort: M**

Priors in `featureImportanceWeights.js` are hand-set / env-overridable. Auto overlays adjust weights from history reliability (`AutoCalibrationEngine`) but attribution UI remains heuristic. **Do not claim scientific feature discovery.**

---

# 8. Monte Carlo Validation

**Score: 7.0 · Grade: B− · Risk: Low · Priority: P2 · Business: Low · Tech: Med · Effort: S**

### Strengths
- Samples the **same** bivariate+DC PMF as analytic markets (`MonteCarloEngine.js`).
- Adaptive sim tiers from uncertainty (`selectAdaptiveSimulations`).
- Seeded PRNG for reproducibility per fixture.
- Explicitly does **not** override the pick — correct product stance.

### Risks
- Marketing can oversell MC as “AI search for the true score.”
- Adaptive 1k sims on uncertain matches increases CI noise in UI.

---

# 9. Calibration Validation

**Score: 5.5 · Grade: C · Risk: High · Priority: P0 · Business: High · Tech: High · Effort: L**

### Stack
| Layer | Path |
|-------|------|
| Isotonic PAV | `isotonicCalibration.js` |
| Platt / Temp / Beta | `calibration/methods.js` |
| Method selector | `CalibrationSelector.js` |
| Apply live | `Stage06Calibration.js` on `pRaw` |
| Auto weight overlays | `AutoCalibrationEngine.js` |
| Cron | `api/cron/daily-ml.js` |

### Issues
- Random CV ≠ temporal validation.
- Side markets uncalibrated.
- Overlay + stacker + Shin can **over-correct** on small samples.
- Maps stored in Supabase; cold-start leagues fall back to global.

---

# 10. Ensemble Validation

**Score: 5.5 · Grade: C · Risk: High · Priority: P1 · Business: Med · Tech: High · Effort: L**

### Components
- Multinomial stacker (`mlStacker.js`) — feature-rich, softmax 3-way.
- Model Lab A–E + AutoModelSelection (KV `footy_active_model`).
- Elo as parallel probability source (`teamElo.js`).
- Market blend / Shin consensus.

### Issues
- Promotion threshold too weak (~20 settled).
- Equal-weight source averaging when all present is naive.
- External trainers (`ModelInterface`) largely stubbed (`ML_READY.md`).
- Odds double-count with modular odds weight.

---

# 11. API Review

**Score: 5.5 · Grade: C · Risk: Critical · Priority: P0 · Business: High · Tech: High · Effort: M**

### Endpoint matrix (condensed)

| Route | Auth | Notes |
|-------|------|-------|
| `/api/predict` | JWT or cron | Quotas; free → DB-only path |
| `/api/warm` | JWT or cron | Budget soft/hard skips |
| `/api/fixtures` day | **Public** | Returns `usage` (quota intel) |
| `/api/fixtures?view=live` | **Public** | Upstream burn |
| `/api/fixtures?view=xg` | **Public** + CORS `*` | Stats burn |
| `/api/history` read | Anon aggregates / JWT mine / admin full | OK design |
| `/api/history?sync=1` | Cron or **admin only** | Client mismatch |
| `/api/billing` | Stripe sig / JWT | Solid |
| `/api/admin` | `assertAdmin` | Host SSRF risk on internal fetch |
| `/api/backtest?view=public-track` | Public | Sanitized; fallback scan cost |
| Crons warm-predict / daily-ml | Cron secret | `maxDuration` 300 |

### Critical API defects
1. No live use of `checkAnonymousRateLimit` on public fixtures.
2. Predict/history lack elevated `maxDuration` (timeout mid-job).
3. Persist soft-fail can return 200 with `X-Persist-Warning` → UI/DB drift.

---

# 12. Database Review

**Score: 7.0 · Grade: B− · Risk: Medium · Priority: P1 · Business: High · Tech: High · Effort: M**

### Strengths
- 30 migrations; RLS deny-all on `predictions_history`, `backtest_snapshots`, notification logs.
- Privilege / Stripe column guards on `profiles`.
- Service-role server path is intentional and consistent.
- Card market validations + closing odds columns for settlement/CLV.

### Weaknesses
- `cleanup_operational_logs` not cron-wired → log growth.
- Open-ended paid tiers when `subscription_expires_at` is null (admin-grant footgun — partially mitigated in product flows).
- Heavy history sync scans without progressive backpressure guarantees under Hobby limits.

---

# 13. Security Review

**Score: 5.5 · Grade: C · Risk: Critical · Priority: P0 · Business: Critical · Tech: High · Effort: M**

### Closed since prior audit
- Predict/warm anonymous abuse path.
- Client-writable privilege escalation on profiles (triggers).
- Admin via `VITE_ADMIN_EMAILS` (server `ADMIN_EMAILS` only; tested in `securityP0.test.js`).
- Stripe webhook signature verification.

### Open P0 / High
| Sev | Finding | Path |
|-----|---------|------|
| Critical | Public fixtures/live/xg + usage leak | `api/fixtures.js` |
| High | Admin internal URL from `x-forwarded-host` + cron Bearer | `api/admin.js` |
| High | Client sync JWT vs server cron/admin | `useHistorySync.ts`, `api/history.js` |
| Medium | `UPSTREAM_BASE_URL` unconstrained | `fetcher.js` |
| Medium | Optional cron UA fallback | `cronRequestAuth.js` |
| Medium | No CSP header | `vercel.json` |
| Low | Dead anon rate limiter | `anonymousRateLimit.js` |

### Security Engineer verdict
**Improved to “serious indie SaaS,” not “enterprise hardened.”** Do not open marketing floodgates until public upstream endpoints are gated.

---

# 14. Performance Review

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P1 · Business: Med · Tech: Med · Effort: M**

### Strengths
- KV cache with sorted param keys (`req:v2:…`).
- Inflight dedupe; budget circuit breaker.
- League-level Elo/rolling load once per loop.
- Predict fixture cap (`limit` ≤ 15 in ingress).

### Weaknesses
- Per-fixture module input collection + odds + MC can blow serverless budgets on dense days.
- History sync 45d × stats fetch capped (`HISTORY_SYNC_CARD_STATS_MAX`) → backlog.
- Client hydrate for market totals max 8 fixtures and does not persist.
- Dual UI stacks (FocusCard + MatchCard + MatchModal) increase FE bundle cognitive cost (not necessarily bytes).

---

# 15. Cache Review

**Score: 6.5 · Grade: B− · Risk: High · Priority: P0 · Business: High · Tech: Med · Effort: S**

### Design
- Canonical + legacy keys for mixed deploys.
- TTLs: live ~75s, xG 900s, fixtures 6h, standings/teamstats up to 24h–30d.
- Fail-open on KV read errors (continues to network); fail-closed on quota counters for non-exempt users.

### Risks
- Module-level `createClient` in `fetcher.js` / `accessTier.js` / `metricsStore.js` can break cold start if KV env missing.
- Dual-write legacy keys doubles Redis ops.
- Prewarm endpoint not scheduled in `vercel.json` (Bucharest `00:01` gate unused unless manually hit).

---

# 16. Frontend Review

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P1 · Business: High · Tech: Med · Effort: L**

### Architecture
- Routes: `/`, `/track-record`, `/privacy`, `/login`, `/workspace` (`RootRouter.tsx`).
- Consumer: `UserDashboard.tsx` + `PredictionFocusCard` + `ConsumerShell`.
- Admin: `AdminDashboard` → `App` observatory.
- i18n RO/EN.

### Strengths
- Tier-aware locks; FocusCard market WIN/LOSS coloring; live score/referee poll; special bet; FH goals in modal card 04.
- Design tokens via CSS variables.

### Weaknesses
- God components: `UserDashboard` ~72KB, `MatchModal` ~94KB, `MatchCard` ~34KB.
- Dual presentation paths (FocusCard vs MatchCard) increase inconsistency risk.
- Heavy localStorage prediction caches — rehydrate edge cases.

---

# 17. UX Review

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P1 · Business: High · Tech: Low · Effort: M**

### Strengths
- Clear monetization story (free / premium / ultra).
- Mobile shell + command palette patterns.
- Public track record page for trust.
- Recent UX fixes: Special Bet readability + toggle highlight; settled market colors; FH goals replace correct score.

### Weaknesses
- “Date limitate” still possible on exotic cups despite fallbacks.
- Corners/shots pending for hours undermines trust in WIN/LOSS counters.
- Labs / Monte Carlo / FI can overwhelm free-tier users.
- Sync failures are silent from user POV (401).

### Product Director verdict
**Good niche SaaS UX trajectory.** Trust depends on settlement reliability more than more charts.

---

# 18. DevOps Review

**Score: 5.0 · Grade: C · Risk: High · Priority: P0 · Business: High · Tech: High · Effort: M**

### Present
- Vercel deploy from `main`.
- 12 crons covering sync, warm-predict, daily-ml, backtest snapshot.
- Security headers (nosniff, DENY frame, HSTS, Referrer-Policy) — **no CSP**.
- `.env.example` for core keys (Stripe vars still under-documented relative to code).

### Gaps
- No staging project discipline documented in-repo.
- `maxDuration` only on two cron handlers.
- Prewarm not cron’d.
- Retention SQL not scheduled.
- Hobby function count = hard product constraint.

---

# 19. Monitoring Review

**Score: 5.5 · Grade: C · Risk: Medium · Priority: P1 · Business: Med · Tech: Med · Effort: M**

### Present
- `observability/logger.js`, `requestMonitor.js`, `metricsStore.js`, `healthBundle.js`.
- Health via `/api/backtest?view=health` + `HealthDashboard.tsx`.
- API budget circuit; history sync status tables.

### Missing
- No Sentry / OTel / Datadog.
- No client error telemetry.
- `tests/observability.test.js` not in `npm test`.
- No paging / on-call runbooks in-repo.

---

# 20. CI/CD Review

**Score: 3.5 · Grade: D+ · Risk: High · Priority: P0 · Business: High · Tech: High · Effort: M**

### Current gate
`.github/workflows/tests.yml`: checkout → Node 22 → `npm ci` → `npm test`.

### Missing for production certification
- `vite build`
- Typecheck (`tsc --noEmit`)
- Lint
- `npm audit` / secret scan
- E2E (Playwright/Cypress)
- Migration dry-run
- Preview deploy smoke

**DevOps Architect verdict:** CI proves math unit tests, not shippability.

---

# 21. Test Coverage Review

**Score: 5.0 · Grade: C · Risk: High · Priority: P0 · Business: Med · Tech: High · Effort: L**

| Suite | In CI | Role |
|-------|-------|------|
| `tests/math.test.js` (~74) | Yes | Core math / calib / value / MC |
| `tests/securityP0.test.js` (~10) | Yes | Admin emails, trial vs paid |
| `tests/pipeline/goldenFixture.test.js` | Yes | Pipeline golden |
| `src/**/*.test.tsx` | Yes | Hooks / utils |
| Observability tests | **No** | Orphaned |

### Coverage holes
- No E2E for predict → mask → settle.
- No API integration tests against mocked upstream.
- No RLS policy smoke tests.
- No Stripe webhook fixture tests.
- MatchModal / UserDashboard untested.
- Sync unit expectations may still assume user JWT sync success (stale).

**Inspection run:** 84 node + 14 vitest tests passed (2026-07-20).

---

# 22. Competitive Benchmark

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P2 · Business: High · Tech: Low · Effort: —**

| Competitor class | Footy Predictor Pro vs |
|------------------|------------------------|
| Tipster Telegram channels | **Superior** transparency / model narrative |
| Odds-screen scrapers | Weaker on CLV / line shopping |
| Established model SaaS (e.g. niche Poisson apps) | Comparable core math; weaker certification & settlement UX |
| Full sportsbooks / trading desks | Not competitive (no execution, no inventory) |

**Positioning that survives diligence:** “Model-assisted football insights with transparent probabilities,” **not** “guaranteed edge AI.”

---

# 23. Technical Debt

**Score: 4.5 · Grade: D+ · Risk: Medium · Priority: P1 · Business: Med · Tech: High · Effort: L**

1. Dual PredictionEngine trees + `backups/` snapshot.
2. God components (Dashboard / MatchModal / AdminObservatory).
3. Untracked slice scripts (`scripts/build-predictor-v3.mjs`, etc.).
4. Dead `anonymousRateLimit` on live path; unused `redis` / `@upstash/redis` deps.
5. Stale README claims (history sync “any JWT”).
6. Prior audit docs contradict current migrations — this file supersedes.
7. `npm run api` broken.
8. FocusCard vs MatchCard feature parity drift.

---

# 24. Production Risks

| ID | Risk | Sev | Likelihood | Mitigation |
|----|------|-----|------------|------------|
| R1 | API-Football quota exhaustion via public fixtures/xg | Critical | High | Auth + rate limit + remove usage from public JSON |
| R2 | Corners/shots counters stuck pending | High | High | Persist hydrate; denser sync; user-safe settle endpoint |
| R3 | CRON_SECRET misconfig → silent ops death | Critical | Med | Deploy checklist + alerts on sync staleness |
| R4 | KV cold-start crash | High | Med | Lazy client; fail-soft |
| R5 | Serverless timeout mid predict/sync | High | Med | Raise `maxDuration`; chunk sync |
| R6 | Overconfident Kelly stakes | High | Med | Cap + calibrate side markets; legal copy |
| R7 | Admin Host SSRF | High | Low–Med | Env-only base URL |
| R8 | Billing open-ended ultra grant | Med | Med | Always set expiry |
| R9 | Model Lab promotes overfit model | Med | Med | Walk-forward gate |
| R10 | GDPR/export gaps under load | Med | Low | Load-test export path |
| R11 | Function limit blocks features | Med | High | Consolidate handlers |
| R12 | Reputation hit from “AI sure bets” perception | High | Med | Tone down marketing; track-record honesty |

---

# 25. Top 100 Remaining Improvements

### P0 — Security & trust (1–20)
1. Auth-gate `/api/fixtures` day listing for non-public fields.
2. Auth-gate `view=live` and `view=xg` (or signed short-TTL tokens).
3. Remove `usage` from anonymous fixtures responses.
4. Wire `checkAnonymousRateLimit` (or edge middleware) on remaining public GETs.
5. Fix admin internal fetch to `PUBLIC_BASE_URL` / `VERCEL_URL` only.
6. Align `useHistorySync` with server policy (cron-only **or** scoped user settle).
7. Persist market totals from client hydrate into history (authorized).
8. Elevate `maxDuration` for `api/predict.js` and `api/history.js`.
9. Add CSP header in `vercel.json`.
10. Document + verify `CRON_SECRET` in every environment.
11. Alert when `history_sync_status` stale &gt; N hours.
12. Fail deploy if KV/Supabase env missing (build-time check).
13. Lock open-ended paid grants (require expiry).
14. Rate-limit `/api/backtest?view=public-track` fallback scans.
15. Disallow `ALLOW_VERCEL_CRON_UA_FALLBACK` in prod by default (assert).
16. Allowlist `UPSTREAM_BASE_URL` hosts.
17. Rotate keys runbook.
18. Dependency audit in CI.
19. Secret scanning (gitleaks) in CI.
20. Remove CORS `*` on xG or restrict origins.

### P0 — Settlement & quant honesty (21–35)
21. Increase history sync frequency for FT windows (or event-driven).
22. Prioritize pending corners/shots in sync budget.
23. Raise / dynamic `HISTORY_SYNC_CARD_STATS_MAX`.
24. CLV coverage dashboard as ship gate.
25. Walk-forward calibration fit.
26. Purged CV for stacker.
27. Raise AutoModelSelection sample floor (e.g. 200+).
28. Side-market calibration maps.
29. Publish ECE/Brier by league weekly.
30. Ban Model Lab promotion without OOS improvement.
31. Separate odds-in-λ vs market blend (ablation).
32. Stress-test Kelly under miscalibration.
33. Legal/compliance review of EV language.
34. Golden tests for card market settlement.
35. UEFA fallback telemetry (source: domestic vs recent_fixtures).

### P1 — Platform (36–60)
36. Consolidate API functions under Hobby limit (router pattern).
37. Lazy KV clients everywhere.
38. Cron `cleanup_operational_logs`.
39. Schedule `/api/cache/prewarm` or delete it.
40. Stripe vars in `.env.example`.
41. Staging Vercel project + migrate workflow.
42. `vite build` + `tsc` in CI.
43. E2E smoke: login → predict → card settle.
44. Observability tests into `npm test`.
45. Sentry (server + client).
46. Structured log sampling.
47. Split `UserDashboard.tsx`.
48. Split `MatchModal.tsx`.
49. Unify FocusCard / MatchCard market row component.
50. Delete or quarantine `backups/` from deploy context.
51. Remove unused redis packages.
52. Fix or remove `npm run api`.
53. Update README sync auth docs.
54. Single PredictionEngine tree (delete façade duplication).
55. Bundle analysis budget.
56. Image/logo CDN caching policy.
57. Prefetch odds coverage report by market.
58. Nearest-line odds already shipped — add bookmaker diversity metric.
59. Weather/injury module quality gates (disable if null).
60. Referee engine coverage report.

### P2 — Model science (61–80)
61. Joint goals model with corners (copula / bivariate).
62. Fit xG weights by MLE on history.
63. Elo–goals joint calibration.
64. Hierarchical league partial pooling.
65. In-play model (separate from pre-match).
66. Player-level lineup model (real data).
67. Weather as continuous feature with verified source.
68. Motivation proxy from table/math only (document).
69. Market efficiency tests by league tier.
70. Dixon–Coles ρ league-year specific.
71. Scoreline sharpness metrics.
72. Probability reliability diagrams in admin.
73. Conformal prediction intervals.
74. Bayesian model averaging vs stacker.
75. Adversarial bookmaker latency simulation.
76. Closing line value by market family.
77. Segregate cup vs league models.
78. Domestic-league stats blending weight for UEFA.
79. Backtest transaction costs.
80. Paper-trading ledger per user (optional).

### P3 — Product / growth (81–100)
81. Onboarding checklist for first Predict.
82. Explain “pending corners” in UI with ETA.
83. Reduce laboratory noise for free tier.
84. Accessibility audit (a11y).
85. Performance budgets for LCP.
86. Offline/empty states polish.
87. Referral / affiliate (compliance-aware).
88. Club follow notifications reliability.
89. Multi-language beyond RO/EN.
90. Native PWA install path.
91. Admin “force settle fixture” tool.
92. User-visible model version changelog.
93. Export picks CSV.
94. Dark/light contrast QA (corners/shots already touched).
95. Special Bet stake calculator.
96. Educative tooltips for FH O/U.
97. Track-record methodology page.
98. Status page (external).
99. SOC2-oriented access logs (long-term).
100. Independent third-party model audit before Series A narrative.

---

# 26. Roadmap v3.0

### Theme: **Trust before theater**

| Phase | Window | Outcomes | Exit criteria |
|-------|--------|----------|---------------|
| **3.0.0 — Harden** | 1–2 weeks | Gate fixtures/live/xg; fix admin base URL; sync auth alignment; CSP; maxDuration; KV lazy init | No unauthenticated upstream burn; sync settles corners/shots &lt; 60 min p95 |
| **3.0.1 — Prove** | 2–4 weeks | Walk-forward calib; CLV weekly report; raise promotion floors; side-market ECE | CLV report published internally for 4 weeks |
| **3.0.2 — Scale ops** | 2–3 weeks | API consolidation; staging; Sentry; CI build+E2E; log retention cron | CI blocks broken builds; on-call alert for sync lag |
| **3.1 — Model** | 4–8 weeks | Ablate odds double-count; cup-specific models; joint corners; xG fit | OOS log-loss improvement vs frozen baseline |
| **3.2 — Product** | parallel | Dashboard split; unified market row; settlement UX ETA; methodology page | Support tickets on “pending” ↓ 50% |

### Non-goals for v3.0
- Claiming guaranteed ROI.
- Player-prop marketplace.
- Live trading bot.

---

# 27. CTO Final Verdict

### Decision
**REJECT** for unrestricted public production marketing.  
**CONDITIONAL PASS** for closed paid/trial beta **after** section-25 items 1–8 and 21–23.  
**ACCEPT** for internal research use as-is (with legal copy).

### One-paragraph diligence statement
Footy Predictor Pro is a **serious, unusually deep indie sports-modeling SaaS**: the core Dixon–Coles / bivariate Poisson engine, calibration/stacker plumbing, Stripe monetization, and RLS posture are real. It is **not** yet enterprise-certifiable because public API surfaces can still burn upstream quota, settlement of corners/shots is operationally fragile, statistical promotion gates are not temporal, and CI/CD does not protect releases. A competitor CTO would **buy time**, not the narrative — fund the harden/prove phases, then reconsider a public launch.

### Signature block

| Role | Vote | Note |
|------|------|------|
| CTO | **REJECT / Conditional beta** | Ship only behind cohort controls |
| Principal AI Engineer | **Conditional** | Core sound; promotion science weak |
| Quant Researcher | **Reject edge claims** | CLV/walk-forward required |
| Senior Data Scientist | **Reject certification** | Random CV disqualifies |
| DevOps Architect | **Conditional** | Hobby limits + thin CI |
| Security Engineer | **Reject open prod** | Public fixtures/xg first |
| Product Director | **Conditional beta** | UX improving; trust = settlement |
| SaaS Consultant | **Niche GTM OK** | Position as insights, not oracle |

---

### Appendix A — Key evidence paths

| Area | Paths |
|------|-------|
| Predict orchestration | `api/predict.js`, `server-utils/pipeline/PredictorV3.js`, `runFixtureStageLoop.js` |
| Math core | `server-utils/math.js`, `PredictionEngine/*` |
| Calibration / stacker | `isotonicCalibration.js`, `calibration/*`, `mlStacker.js`, `api/cron/daily-ml.js` |
| Value / Kelly | `value/ValueEngine.js`, `Stage08Decision.js` |
| Monte Carlo | `monteCarlo/MonteCarloEngine.js`, `Stage05Simulation.js` |
| Odds / shots | `marketOdds.js`, `Stage07ModelFusion.js` |
| Auth / tiers | `authAdmin.js`, `accessTier.js`, `Stage00Ingress.js`, `Stage11Masking.js` |
| Billing | `api/billing.js`, `stripeBilling.js` |
| History / settle | `api/history.js`, `cardMarketSettlement.js`, `closingOddsCapture.js` |
| Fixtures public | `api/fixtures.js` |
| Cache | `fetcher.js` |
| RLS | `supabase/migrations/026_*.sql`, `027_*.sql`, `029_*.sql` |
| CI | `.github/workflows/tests.yml` |
| Deploy | `vercel.json` |

### Appendix B — Inspection method
- Parallel expert agents on Architecture/API/DB/Cache, AI stack, Security/DevOps/FE/Tests.
- Direct inventory of `api/`, `server-utils/`, `src/`, `supabase/migrations/`, `tests/`, `vercel.json`.
- Live test execution: **98 passing** (2026-07-20).
- Adversarial stance: treat as competitor due diligence, not founder self-review.

---

*End of FINAL_ENTERPRISE_AUDIT_2026.md — Certification panel, 2026-07-20.*
