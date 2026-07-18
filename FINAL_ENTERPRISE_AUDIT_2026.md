# FINAL ENTERPRISE AUDIT 2026  
## Footy Predictor Pro — Production Certification Panel

| Field | Value |
|-------|-------|
| **Document** | `FINAL_ENTERPRISE_AUDIT_2026.md` |
| **Date** | 2026-07-18 |
| **Repository** | `footy-predictor-starter` |
| **Branch inspected** | `refactor/frontend-app-architecture` @ `c307434` |
| **Production URL** | https://footy-predictor-pro.vercel.app |
| **Panel** | CTO · Principal AI Engineer · Quant Researcher · Senior Data Scientist · DevOps Architect · Security Engineer · Product Director · SaaS Consultant |
| **Mandate** | Determine whether this repository deserves production deployment. Assume competitor ownership. Reject theater. |

> **This is not a celebration document.** Prior reports (`ENTERPRISE_REPORT.md`, activation/xG/calibration notes) describe engineering ambition. This certification asks only: *would a competent enterprise CTO ship this to paying strangers tomorrow?*

---

# CTO FINAL VERDICT (PREVIEW)

| Decision | Result |
|----------|--------|
| **Public paid production SaaS** | **REJECT** |
| **Open anonymous traffic** | **REJECT** |
| **Closed private beta (known users)** | **CONDITIONAL** — only after P0 security + monetization locks |
| **Internal research / paper-trading lab** | **ACCEPT** |

**Weighted overall score: 5.4 / 10 (Grade: D+ / C−)**

**Readiness:**
- Enterprise SaaS: **~42%**
- Paid niche beta after P0 fixes: **~65%**
- Research demo: **~80%**

The product has a **real probabilistic brain** (Dixon–Coles / bivariate Poisson, Shin, EV/Kelly arithmetic, adaptive Monte Carlo sampling, multi-method calibration *code*). It does **not** have production-grade security, commercial armor, or statistically trustworthy offline→online ML. Shipping as “Enterprise” today would be a due-diligence failure.

---

# 1. Executive Summary

### What this is
A Vite/React SPA + Vercel serverless API (`api/*`) + Supabase Auth/Postgres + KV/Redis cache + API-Football upstream, with a deep prediction stack under `server-utils/` (~269 source files in `api/`, `server-utils/`, `src/`, `supabase/migrations/`, `tests/`).

### What is genuinely strong
1. Core match model: attack/defense/form/home-advantage λ → bivariate Poisson + Dixon–Coles (`server-utils/math.js`, `PredictionEngine/combine.js`).
2. Market plumbing: Shin de-vig, professional multi-market ValueEngine, quarter-Kelly (`advancedMath.js`, `value/ValueEngine.js`).
3. Offline ML scaffolding: isotonic PAV + Platt/Temperature/Beta selector (`calibration/*`), multinomial stacker (`mlStacker.js`), daily cron (`api/cron/daily-ml.js`).
4. Adaptive Monte Carlo from analytical uncertainty (`monteCarlo/MonteCarloEngine.js`).
5. Predictor V2 contract + pipeline audit trail (`pipeline/PredictorV2.js`, `modelMeta.pipeline` in `api/predict.js`).
6. Modular engine activation: `modularBlend: 1`, `expectedGoals: 0.2` (`PredictionEngine/weights.js`) — **updates prior audits that claimed blend=0**.

### What kills production certification
1. **Security P0s still open:** anonymous predict/warm, unauthenticated analytics/alerts/health, missing RLS on crown-jewel tables, profiles tier self-escalation, fail-open rate limits.
2. **Train/serve skew:** calibration/stacker fit prefers `evaluation.modelProbs1x2Pct` (final probs); live apply uses raw Poisson (`daily-ml.js` `extractRawTriple` vs `predict.js`).
3. **No walk-forward / CLV proof:** random CV; stacker metrics in-sample; closing odds not captured.
4. **Monetization theater:** no Stripe; Premium daily limit &lt; Free; `incrementPredictCount*` unused; tier mask does not strip Monte Carlo / laboratory / FI.
5. **CI is not a release gate:** `.github/workflows/tests.yml` runs `npm test` only — no build, typecheck, lint, E2E, security audit.

### Scorecard (all dimensions)

| # | Section | Score | Grade | Risk | Priority | Business impact | Technical impact | Effort |
|---|---------||:-----:|:----:|:--------:|:--------:|:---------------:|:----------------:|:------:|
| 2 | Architecture | 6.0 | C+ | Med | P1 | Med | High | L |
| 3 | AI & Prediction Engine | 6.5 | B− | High | P0 | High | High | L |
| 4 | Quantitative Validation | 3.5 | D+ | High | P0 | High | High | XL |
| 5 | Statistical Validation | 3.0 | D | High | P0 | High | High | XL |
| 6 | Explainability | 5.5 | C | Med | P2 | Med | Low | M |
| 7 | Feature Importance | 4.0 | D | Med | P2 | Low | Med | M |
| 8 | Monte Carlo | 6.5 | B− | Low | P2 | Low | Med | S |
| 9 | Calibration | 5.0 | C | High | P0 | High | High | L |
| 10 | Ensemble | 4.5 | D+ | High | P1 | Med | High | L |
| 11 | API | 4.5 | D+ | Critical | P0 | High | High | M |
| 12 | Database | 4.0 | D | Critical | P0 | High | High | M |
| 13 | Security | **3.0** | **D** | **Critical** | **P0** | **Critical** | **High** | **M** |
| 14 | Performance | 6.0 | C+ | Med | P1 | Med | Med | M |
| 15 | Cache | 6.5 | B− | High | P0 | High | Med | S |
| 16 | Frontend | 5.0 | C | Med | P1 | High | Med | L |
| 17 | UX | 4.5 | D+ | Med | P1 | High | Low | L |
| 18 | DevOps | 3.5 | D+ | High | P0 | High | High | M |
| 19 | Monitoring | 5.0 | C | Med | P1 | Med | Med | M |
| 20 | CI/CD | 2.5 | F | High | P0 | High | High | M |
| 21 | Test Coverage | 4.0 | D | High | P0 | Med | High | L |
| 22 | Competitive Benchmark | 3.5 | D+ | High | P0 | Critical | Med | XL |
| 23 | Technical Debt | 4.5 | D+ | High | P1 | Med | High | XL |
| 24 | Production Risks | — | — | Critical | P0 | Critical | High | — |

**Weighted overall: 5.4 / 10.**

---

# 2. Architecture Review

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P1**  
**Business impact: Medium · Technical impact: High · Effort: L**

### Findings
- **Sound topology:** SPA → Vercel serverless → Supabase + KV + API-Football. Appropriate for early SaaS.
- **Hobby constraint shapes design:** ~12 serverless entrypoints; health/model-lab folded into `api/backtest.js` (`vercel.json` + comments in handlers). Pragmatic, but overloads files.
- **God-handler:** `api/predict.js` still owns fetch → enrich → engine → Poisson → MC → xG → calib → Elo → stacker → Model Lab → confidence → value → FI → persist (~2.3k+ LOC). `PredictorV2.js` is a **contract + helpers**, not a real orchestrator.
- **Dual trees:** canonical `PredictionEngine/` vs thin `prediction/` facade; engine-internal Confidence/Recommendation vs live `confidence/` + `ValueEngine` — dual stacks confuse audits.
- **Pipeline narrative vs physics:** documented order (Elo/xG after Poisson; injuries after Poisson) does not match λ construction (modules + early xG *before* Poisson).

### Evidence
- `server-utils/pipeline/PredictorV2.js` — stage list + blend helpers  
- `api/predict.js` — physical order  
- `vercel.json` — crons + `maxDuration: 300`

### Verdict
Architecturally coherent for a research product; not modular enough for enterprise ownership or safe iteration.

---

# 3. AI & Prediction Engine Review

**Score: 6.5 · Grade: B− · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: L**

### What’s real
| Component | Assessment | Evidence |
|-----------|------------|----------|
| Core λ (atk/def/form/HA) | Real Dixon–Coles-style multiplicative | `PredictionEngine/combine.js` |
| Optional modules | **Live** (`modularBlend: 1`) | `weights.js`, `moduleInputs.js` |
| Poisson + DC | Real | `math.js` `computeMatchProbs` |
| Rolling xG → λ blend | Semi-real (hand weights; `expectedGoals: 0.2`) | `xg/RollingXgModel.js`, `combine.js` |
| Elo | Parallel signal, not in λ | `teamElo.js` |
| Shin + ValueEngine | Real arithmetic | `advancedMath.js`, `value/ValueEngine.js` |
| ConfidenceEngine | Heuristic dashboard, not calibrated P(correct) | `confidence/ConfidenceEngine.js` |

### Theater / weak signal
- **Motivation:** standings rank-gap heuristic; can scale both sides similarly.  
- **Weather:** rarely present on API-Football fixtures → usually neutral.  
- **Referee:** name present; tendency stats not populated → near-neutral.  
- **Lineups:** `missingKeyPlayers` hard-wired `0` in collector.  
- **Injuries:** headcount proxy, not player quality.  
- **Odds in λ + market blend:** double-counting risk when `odds` weight &gt; 0 and post-λ market blend also runs.

### Critical accuracy defect
**Train/serve skew** (see §5 / §9): offline fit uses final `modelProbs`; online calib/stacker apply on raw Poisson.

### Verdict
Competent sports-modeling core with productized enrichment glue. Not “AI excellence” until fit targets, walk-forward, and CLV exist.

---

# 4. Quantitative Validation

**Score: 3.5 · Grade: D+ · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: XL**

### Findings
- Backtest analytics compute ROI, yield, log-loss, Brier, Kelly growth, Sharpe, drawdown (`BacktestAnalytics.js`) — **arithmetic is real**.
- **CLV is mostly empty:** closing odds not systematically captured at kickoff (`BACKTEST_ENGINE.md` admits this). Without CLV, ROI claims are not edge claims.
- Model Lab / Auto Selection compete on stored history with overlapping windows; promotion floor can be as low as ~20 samples (`AutoModelSelection.js`).
- No published public track record; no independent holdout season.

### Missing for quant certification
1. Kickoff closing line store + CLV report  
2. Walk-forward backtest (train ≤ t, test t+1)  
3. Bankroll simulation with costs/limits  
4. League-stratified OOS tables  
5. Ablation of modular λ factors (not only source remix)

### Verdict
You can compute scores. You cannot yet prove edge.

---

# 5. Statistical Validation

**Score: 3.0 · Grade: D · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: XL**

| Concern | Status | Evidence |
|---------|--------|----------|
| Random k-fold on time series | Leakage risk | `CalibrationSelector.js` shuffle folds |
| Stacker metrics in-sample | Optimistic bias | `daily-ml.js` `trainSoftmax` → `computeStackerMetrics` same data |
| Fit on final probs / apply on raw | Train/serve skew | `extractRawTriple` prefers `evaluation.modelProbs1x2Pct` |
| Per-outcome calib + renorm | Implemented but multinomial-weak | `applyCalibratedTriple` |
| Auto-calibration overlays | No OOS gate | `AutoCalibrationEngine.js` |
| Unit tests as “validation” | Synthetic only | `tests/math.test.js` |

### Verdict
Statistical process is **not** production-grade. Any investor deck citing “calibrated ML accuracy” from current dashboards would be misleading.

---

# 6. Explainability Review

**Score: 5.5 · Grade: C · Risk: Medium · Priority: P2**  
**Business impact: Medium · Technical impact: Low · Effort: M**

### Findings
- `PredictionExplanation.js` produces human-readable WHY text.  
- `modelMeta.pipeline` / `predictorVersion` improve auditability (Predictor V2).  
- Confidence engine is explicitly independent of pick — good for honesty, bad if UI implies it is P(win).  
- Dual recommendation stacks (engine Recommendation vs ValueEngine) can disagree with explanations.

### Verdict
Adequate for power users; not regulatory-grade model cards.

---

# 7. Feature Importance Validation

**Score: 4.0 · Grade: D · Risk: Medium · Priority: P2**  
**Business impact: Low · Technical impact: Medium · Effort: M**

### Findings
- `FeatureImportanceEngine.js`: prior × activation → renormalize to 100%. **Not SHAP, not permutation importance, not ablation.**  
- `PredictionContributions.js`: signed linearization around modular factors — useful UI, **not causal**.  
- Persisted importance rows exist (`023_prediction_feature_importance.sql`) but do not validate module value.

### Verdict
Explainability charts. Do not market as “AI feature importance science.”

---

# 8. Monte Carlo Validation

**Score: 6.5 · Grade: B− · Risk: Low · Priority: P2**  
**Business impact: Low · Technical impact: Medium · Effort: S**

### Findings
- Samples correct bivariate Poisson + DC PMF; seeded `mulberry32`; Wilson + percentile CIs.  
- Adaptive tiers 1k/3k/5k/10k/25k from entropy/competitiveness/goal-var/O-U closeness (`MonteCarloEngine.js`, `MONTECARLO_REPORT.md`).  
- **Does not feed pick, EV, λ, or calibration.** Display/CI quality only.  
- UI shows adaptive uncertainty (`MonteCarloPanel.tsx`).

### Verdict
Solid engineering for distribution visualization. Not an accuracy upgrade.

---

# 9. Calibration Validation

**Score: 5.0 · Grade: C · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: L**

### What’s good
- Methods: Isotonic PAV, Platt, Temperature, Beta (`calibration/methods.js`).  
- CV selector with baseline guard + identity fallback (`CalibrationSelector.js`).  
- Global map fallback `league_id=-1` fixed (`isotonicCalibration.js`).  
- Apply path renormalizes 1X2 (`applyCalibratedTriple`).  
- Migration `025_calibration_method.sql` for method audit (must be applied).

### What’s broken for production trust
1. **Fit target skew** — `extractRawTriple` prefers final `modelProbs1x2Pct`.  
2. **Stacker bypasses calibration** when weights exist (`predict.js`).  
3. **Random CV** on serial football data.  
4. Upsert Brier is post-refit in-sample.  
5. Side markets (O/U, BTTS) used in `selectTopPick` remain on uncalibrated Poisson `p`.

### Verdict
Machinery is real; deployment contract is not trustworthy until fit≡apply and walk-forward gates exist.

---

# 10. Ensemble Validation

**Score: 4.5 · Grade: D+ · Risk: High · Priority: P1**  
**Business impact: Medium · Technical impact: High · Effort: L**

### Findings
- Stacker: multinomial softmax SGD — real code, in-sample metrics.  
- Model Lab A–E: source blends on reconstructed history; live A–D override can **discard** calibration+stacker path; E = no-op.  
- Auto promotion via KV (`AutoModelSelection.js`, cron `mode=model-selection`).  
- Equal-weight source average is not a fitted ensemble.

### Verdict
Ensemble story is productized; statistical ensemble discipline is not.

---

# 11. API Review

**Score: 4.5 · Grade: D+ · Risk: Critical · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: M**

### Endpoint auth scorecard

| Route | Auth | Severity |
|-------|------|----------|
| `/api/predict`, `/api/warm` | Anonymous OK; fail-open RL | **P0** |
| `/api/backtest?view=kpi\|analytics\|health\|model-lab` | Open | **P0** |
| `/api/backtest?view=model-select` (read) | Open | **P0** |
| `/api/alerts` | **None** (service-role reads) | **P0** |
| `/api/fixtures?usageOnly=1` | Open ops leak | **P0** |
| `/api/history?sync=1` | Cron **or any JWT** | **P0** |
| `/api/admin` | Admin JWT | OK |
| `/api/cron/*`, prewarm, notify | `CRON_SECRET` (also `?secret=`) | P1 query leak |
| `/api/activate-trial` | JWT | OK endpoint; RLS undermines |

### Other API defects
- No schema validation (zod/joi) — clamps only.  
- Anonymous predict returns **unmasked** Ultra-grade payload (`maskPredictionForTier` only when tier context applies).  
- Tier quota counters exist but are **not incremented** from predict path.

### Verdict
API surface is a competitive-intelligence and cost-abuse risk.

---

# 12. Database Review

**Score: 4.0 · Grade: D · Risk: Critical · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: M**

### Missing RLS (migrations never enable)
| Table | Migration |
|-------|-----------|
| `predictions_history` | `001_predictions_history.sql` |
| `backtest_snapshots` | `002_backtest_snapshots.sql` |
| `notification_dispatch_log` | `007_notifications_log.sql` |

If PostgREST grants default `anon`/`authenticated` SELECT, crown jewels are dumpable via `VITE_SUPABASE_ANON_KEY`.

### Profiles privilege escalation
`008_profiles_rls_no_recursion.sql` `users_update_own_profile` forces `role='user'` but does **not** column-restrict `tier` / `subscription_expires_at` / trial fields (`016_user_tiers_and_trials.sql`). Client can self-upgrade paid tier.

### Positive
Many ML tables use deny-all `using (false)` (`014`, `015`, `022`, `023`, …). Sensitive RPCs revoked from `public`.

### Verdict
Database security is incomplete. Do not expose anon key to hostile internet until RLS is closed.

---

# 13. Security Review

**Score: 3.0 · Grade: D · Risk: Critical · Priority: P0**  
**Business impact: Critical · Technical impact: High · Effort: M**

### P0 blockers (must fix before any public traffic)
1. Close or DB-only anonymous `/api/predict` + `/api/warm`; fail-**closed** rate limit; shared KV env.  
2. Column-allowlist profiles UPDATE (block tier/subscription/trials/role).  
3. Enable RLS + deny-all on `predictions_history`, `backtest_snapshots`, `notification_dispatch_log`.  
4. Auth-gate backtest kpi/analytics/health/model-lab/model-select-read, `/api/alerts`, fixtures `usageOnly`.  
5. History sync = cron/admin only.  
6. Never return unmasked predictions to anonymous.  
7. Wire or delete tier quota counters; fix Premium &lt; Free limits.  
8. Remove cron `?secret=` query auth; header-only.  
9. Security headers (CSP, HSTS, X-Frame-Options) absent from `vercel.json`.  
10. Patch high npm advisories (`react-router`, `ws` at time of audit).

### P1
- `VITE_ADMIN_EMAILS` client exposure  
- CORS `*` on some fixtures views  
- Three Redis client libraries (`@vercel/kv` deprecated)  
- No secret scanning / dependency gate in CI  

### Verdict
**Hard reject** for production. Security posture is the primary certification failure.

---

# 14. Performance Review

**Score: 6.0 · Grade: C+ · Risk: Medium · Priority: P1**  
**Business impact: Medium · Technical impact: Medium · Effort: M**

### Findings
- Odds date prefetch, warm crons, in-flight dedupe, adaptive MC reduce waste.  
- Predict fixture cap ≤15/request.  
- Budget guard can force DB-only for authenticated users (`PREDICT_USAGE_RESERVE_CALLS` default 2000 is economically inverted vs typical API-Football daily limits) while **anonymous bypasses** it.  
- Main JS bundle &gt;1 MB gzipped ~310 KB after recent builds — admin Recharts stack is heavy; lazy panels help but not enough.  
- Hobby cron ±59 min precision can desync gates.

### Verdict
Acceptable for beta volumes; not tuned for Saturday traffic + scrape resistance.

---

# 15. Cache Review

**Score: 6.5 · Grade: B− · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: Medium · Effort: S**

### Findings
- `getWithCache` (`fetcher.js`): provider-agnostic keys, in-flight Map, TTL.  
- **Fail-open** on KV read/write errors → availability over cost control.  
- Anon rate limit uses different env aliases than cache (`STORAGEE_KV_*` vs `KV_REST_API_*`) → silent skip (`anonymousRateLimit.js`).  
- Warm path can amplify upstream spend when open.

### Verdict
Cache design is good; fail-open + open anon = bill runaway under attack.

---

# 16. Frontend Review

**Score: 5.0 · Grade: C · Risk: Medium · Priority: P1**  
**Business impact: High · Technical impact: Medium · Effort: L**

### Findings
- Thin route table (`RootRouter.tsx`: `/`, `/privacy`, `/login`, `/workspace`).  
- Admin observatory stacks Enterprise / Health / Model Lab / Backtest in one scroll (`PerformancePanel`).  
- User workspace is a separate monolith (`UserDashboard.tsx`) without enterprise labs.  
- No ErrorBoundary; no eslint at root; RO/EN copy mix.  
- Tier mask incomplete (Monte Carlo, laboratory, FI survive).

### Verdict
Research console UI. Not a productized consumer SaaS frontend.

---

# 17. UX Review

**Score: 4.5 · Grade: D+ · Risk: Medium · Priority: P1**  
**Business impact: High · Technical impact: Low · Effort: L**

### Findings
- Landing can look premium; workspace feels like an internal tool.  
- Pricing psychology broken (Premium daily matches &lt; Free).  
- No billing UX, no onboarding journey, no mobile match-center parity with tip apps.  
- “Enterprise” labels on dashboards that sit on open APIs undermine trust when discovered.

### Verdict
UX does not support a paid public launch narrative.

---

# 18. DevOps Review

**Score: 3.5 · Grade: D+ · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: M**

### Findings
- Deploy: `vercel --prod` / git push; works.  
- Crons defined in `vercel.json` (history ×3, warm ×3, daily-ml, snapshot, ops-report, model-selection).  
- README cron schedule **stale** vs `vercel.json`.  
- `dist/` committed historically — release hygiene smell.  
- No staging promotion policy, no rollback runbook in-repo, no pinned Node beyond CI’s 20.  
- `engines: ">=18"` too loose.

### Verdict
Can deploy. Cannot operate as enterprise DevOps.

---

# 19. Monitoring Review

**Score: 5.0 · Grade: C · Risk: Medium · Priority: P1**  
**Business impact: Medium · Technical impact: Medium · Effort: M**

### Findings
- DIY: structured logger, request monitor, metrics store, health bundle, ops alerts.  
- Health UI via `/api/backtest?view=health` — **unauthenticated**.  
- `/api/alerts` unauthenticated.  
- No Sentry/Datadog/OTel; serverless amnesia for process-local counters.  
- `tests/observability.test.js` **not** in `npm test`.

### Verdict
Observability *ideas* shipped; production ops not closed.

---

# 20. CI/CD Review

**Score: 2.5 · Grade: F · Risk: High · Priority: P0**  
**Business impact: High · Technical impact: High · Effort: M**

### Evidence
`.github/workflows/tests.yml`:
```yaml
- run: npm test   # only
```
Missing: `vite build`, `tsc --noEmit`, lint, `npm audit`, E2E, preview deploy gate, migration checks.

### Verdict
Green CI ≠ shippable artifact.

---

# 21. Test Coverage Review

**Score: 4.0 · Grade: D · Risk: High · Priority: P0**  
**Business impact: Medium · Technical impact: High · Effort: L**

| Suite | Present | In CI |
|-------|---------|-------|
| Math / calib / MC / value / Model Lab | ~70 tests (`tests/math.test.js`) | Yes |
| Vitest hooks/utils | Few under `src/` | Yes |
| Observability | 4 tests | **No** |
| API auth / RLS / mask | **0** | No |
| E2E | **0** | No |
| Security regression | **0** | No |

### Verdict
Strong unit math. Zero production-contract tests.

---

# 22. Competitive Benchmark

**Score: 3.5 · Grade: D+ · Risk: High · Priority: P0**  
**Business impact: Critical · Technical impact: Medium · Effort: XL**

| Capability | Typical tip SaaS / data API | Footy Predictor Pro |
|------------|----------------------------|---------------------|
| Stripe / App Store billing | Yes | **No** |
| Public verified track record | Yes | Private only |
| Mobile live center | Yes | Weak |
| Odds comparison UX | Yes | Thin |
| Closing-line proof | Serious desks | Missing |
| Auth’d analytics | Behind paywall | **Often open** |
| Support / status / SLA | Yes | DIY health |
| Gambling compliance (geo/age) | Required for ads | Privacy page only |
| Deep Poisson + calib + value | Rare | **Your moat** |

**Moat is technical depth. Market loses on distribution, trust, and security.** Depth is scrapable via open backtest/predict today.

---

# 23. Technical Debt

**Score: 4.5 · Grade: D+ · Risk: High · Priority: P1**  
**Business impact: Medium · Technical impact: High · Effort: XL**

### Removed / improved since mid-audit cycle
- `modularBlend` default 0 → **1**  
- λ-as-xG → rolling xG + blend  
- Fixed 10k MC → adaptive  
- Global calib `-1` fallback  
- Predictor V2 pipeline meta  

### Still open
1. `api/predict.js` god-handler  
2. Dual confidence/recommendation stacks  
3. Train/serve skew  
4. Dead `incrementPredictCount*`  
5. Incomplete tier mask  
6. Doc sprawl / stale README  
7. Triple Redis clients + deprecated `@vercel/kv`  
8. `ENGINE_EXECUTION_REPORT.md` / parts of `ENTERPRISE_REPORT.md` **stale** on blend=0 / λ-as-xG  

---

# 24. Production Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | API-Football bill runaway via anon warm/predict | High | Critical | Close anon; fail-closed RL |
| R2 | IP theft via open analytics/model-lab | High | Critical | Auth-gate |
| R3 | Tier theft via profiles RLS | High | Critical | Column allowlist |
| R4 | History dump via missing RLS | Med–High | Critical | Enable RLS deny-all |
| R5 | Misleading accuracy / ROI claims | High | High (legal/trust) | Walk-forward + CLV |
| R6 | Auto model promote degrades prod | Med | High | Freeze A–D; score E honestly |
| R7 | Cron secret leakage via query string | Med | High | Header-only |
| R8 | Hobby cron drift breaks warm/sync | Med | Med | Pro plan or soften gates |
| R9 | Stacker+calib skew silently hurts picks | High | High | Fix extractRawTriple |
| R10 | No billing → fake SaaS economics | Certain | Critical | Stripe or stop selling tiers |

---

# 25. Top 100 Remaining Improvements

### P0 — Security & money (1–20)
1. Disable anonymous live predict (DB-only or auth-required).  
2. Disable anonymous warm.  
3. Fail-closed anon rate limit.  
4. Unify KV env vars for RL + cache.  
5. Auth-gate `/api/alerts`.  
6. Auth-gate backtest kpi/analytics/health/model-lab.  
7. Auth-gate model-select read.  
8. Auth-gate fixtures `usageOnly`.  
9. History sync cron/admin only.  
10. RLS on `predictions_history`.  
11. RLS on `backtest_snapshots`.  
12. RLS on `notification_dispatch_log`.  
13. Profiles UPDATE column allowlist.  
14. Mask Monte Carlo for Free/Premium.  
15. Mask laboratory / FI / contributions by tier.  
16. Never unmask anonymous responses.  
17. Wire `incrementPredictCount*` or remove quotas.  
18. Fix Premium daily limit ≥ Free.  
19. Remove `?secret=` cron auth.  
20. Add security headers in `vercel.json`.

### P0 — Model integrity (21–35)
21. Fit calibration on `rawPoissonProbs1x2Pct`.  
22. Fit stacker on raw Poisson features consistently.  
23. Walk-forward calibration.  
24. Holdout stacker metrics before activate.  
25. Embargo/purge around kickoff in CV.  
26. Capture closing odds at kickoff.  
27. Publish CLV dashboard.  
28. As-of Elo at prediction time.  
29. Single probability object for pick+EV+persist.  
30. Stop using uncalibrated O/U for top pick when 1X2 calibrated.  
31. Freeze AutoSelect A–D until live≡lab.  
32. Score production E as true baseline in selection.  
33. Apply migration 025 in prod Supabase.  
34. Document train/serve contract in one model card.  
35. Kill early ValueEngine or align with final probs.

### P1 — Product & ops (36–60)
36. Stripe Checkout + webhooks → `profiles.tier`.  
37. Entitlement matrix module (single source).  
38. CI: `npm run build`.  
39. CI: `tsc --noEmit`.  
40. CI: include observability tests.  
41. CI: `npm audit --omit=dev` gate.  
42. Playwright smoke: login → predict → mask.  
43. API integration tests for cron/admin/anon.  
44. Sentry (or equivalent) on API + SPA.  
45. Uptime check on authenticated health.  
46. Pager/Slack on high ops alerts.  
47. Pin Node 20 in `engines`.  
48. Stop committing `dist/` (or automate only).  
49. Sync README crons to `vercel.json`.  
50. Staging project + promote policy.  
51. ErrorBoundary in React tree.  
52. Route-split dashboards (`/admin/health`, etc.).  
53. Mobile match center pass.  
54. Onboarding checklist.  
55. Public track-record page (post-auth-fix).  
56. GDPR export/delete runbook.  
57. Age/geo gambling disclaimer flow.  
58. Rate-limit authenticated predict too.  
59. Idempotency keys on sync/cron.  
60. Secret rotation runbook.

### P1 — Engine (61–80)
61. Fit shot-xG coefficients on data (not hand constants).  
62. Referee stats table + backfill.  
63. External weather provider or drop weight.  
64. Real missing-key-player lineup model.  
65. Injuries with player strength weights.  
66. Remove odds from λ *or* from post-blend (one path).  
67. Motivation from schedule/title race features.  
68. Multinomial calibration (not 3 binaries).  
69. Module ablation study with sequential testing.  
70. Split `predict.js` into pipeline stages.  
71. Delete or merge dead `prediction/` duplicates.  
72. Unify Confidence engines.  
73. Monte Carlo optional feed into uncertainty→stake cap.  
74. League-specific stacker activation thresholds.  
75. Feature store from `ml_training_examples` actually trained.  
76. Model registry promotion with human approval.  
77. Shadow mode for new weights.  
78. Canary predict cohort.  
79. Drift monitors on 1X2 vs market.  
80. Reliability diagrams in Health UI (auth’d).

### P2 — Polish (81–100)
81. ESLint + Prettier.  
82. Bundle `manualChunks` for Recharts.  
83. Replace deprecated `@vercel/kv` path.  
84. One Redis client only.  
85. i18n framework (RO/EN).  
86. Accessibility pass on dashboards.  
87. Empty states for no fixtures.  
88. Preferential SEO tip pages (if go-to-market).  
89. Public API product tier.  
90. Webhooks for settled tips.  
91. CSV export auth’d.  
92. Dark-label white-label config.  
93. Per-league kill switches.  
94. Chaos test: KV down.  
95. Chaos test: Supabase down.  
96. Load test Saturday 12:00 UTC.  
97. Cost dashboard ($/1k predicts).  
98. Investor-facing model card PDF from CI.  
99. Retire stale reports or mark superseded.  
100. Rename “Enterprise” UI until security passes.

---

# 26. Roadmap v3.0

### Phase 0 — Stop the bleeding (1–2 weeks) — **gate to any public traffic**
- All Security P0s (auth, RLS, anon, profiles, headers).  
- Fix `extractRawTriple` train/serve.  
- CI build + typecheck.  
- Apply migration 025.

**Exit criterion:** External pen-tester cannot dump history or self-upgrade tier; anonymous cannot burn quota for full model JSON.

### Phase 1 — Honest quant (3–6 weeks)
- Closing odds + CLV.  
- Walk-forward calib/stacker.  
- Freeze unsafe AutoSelect.  
- Single prob pipeline for pick/EV.  
- Public (or private shared) track record.

**Exit criterion:** OOS log-loss/Brier/CLV report signed by quant owner.

### Phase 2 — Commercial SaaS (4–8 weeks)
- Stripe + entitlement matrix.  
- Fix tier UX.  
- Masking completeness.  
- Mobile-ready match UX.  
- Support/status basics.

**Exit criterion:** Money changes hands without admin SQL; Free≠Ultra payload.

### Phase 3 — Predictor v3 platform (ongoing)
- Split predict orchestrator.  
- Fitted xG / referee / weather.  
- Multinomial calibration.  
- Shadow/canary promotions.  
- Optional B2B API.

**Exit criterion:** Modular releases without god-handler edits; model registry with approval.

---

# 27. CTO Final Verdict

### Certification decision

| Use case | Decision | Conditions |
|----------|----------|------------|
| **Public production SaaS (paid strangers)** | **REJECT** | Fail security + commercial + statistical integrity |
| **Open anonymous marketing demo with live model** | **REJECT** | Cost + IP leakage |
| **Closed beta (≤N known users, auth required)** | **CONDITIONAL PASS** | Complete Phase 0 security P0s first |
| **Internal quant lab / paper trading** | **PASS** | Do not market as “enterprise calibrated AI” |

### Why reject production
A competitor diligence team would conclude:

1. **You cannot protect the product** (open analytics, anon predict, missing RLS, tier escalation).  
2. **You cannot charge for the product** (no Stripe; tiers inverted; mask incomplete; quotas unwired).  
3. **You cannot defend the accuracy story** (train/serve skew; in-sample stacker; no CLV; random CV).  
4. **You cannot operate the product** (CI without build; unauth health; no APM; stale runbooks).

### What would change the verdict to PASS
Minimum bar for **paid production**:
- [ ] All §13 P0 security items closed and regression-tested  
- [ ] Train/serve skew fixed + walk-forward report  
- [ ] Closing-odds CLV ≥ one full season window (or honest “no edge proven” disclaimer)  
- [ ] Stripe live + entitlement tests green  
- [ ] CI: test + build + typecheck + audit gate  
- [ ] Anonymous cannot obtain Ultra payloads or burn upstream  

Until then, the honest label is:

> **Advanced football probability research application with production *hosting*, not production *certification*.**

### Panel signatures (role positions)

| Role | Position |
|------|----------|
| **CTO** | Reject public prod; conditional private beta after P0 |
| **Principal AI Engineer** | Core math ships; ML ops contract fails |
| **Quant Researcher** | No CLV / walk-forward → no edge claim |
| **Senior Data Scientist** | Calibration selector real; fit target wrong |
| **DevOps Architect** | Deploy works; release engineering does not |
| **Security Engineer** | Hard fail — multiple critical findings |
| **Product Director** | Kitchen-sink admin UI ≠ SaaS product |
| **SaaS Consultant** | Do not sell “Enterprise” until money + trust + security align |

---

## Appendix A — Evidence index

| Area | Paths |
|------|-------|
| Predict path | `api/predict.js` |
| Cron ML | `api/cron/daily-ml.js` |
| Open analytics | `api/backtest.js`, `api/alerts.js` |
| Weights | `server-utils/PredictionEngine/weights.js` |
| Combine / xG blend | `server-utils/PredictionEngine/combine.js` |
| Calibration | `server-utils/calibration/*`, `isotonicCalibration.js` |
| Monte Carlo | `server-utils/monteCarlo/MonteCarloEngine.js` |
| Pipeline contract | `server-utils/pipeline/PredictorV2.js` |
| Tier mask | `server-utils/accessTier.js` |
| Anon RL fail-open | `server-utils/anonymousRateLimit.js` |
| Profiles RLS | `supabase/migrations/008_profiles_rls_no_recursion.sql`, `016_user_tiers_and_trials.sql` |
| Missing RLS | `001_predictions_history.sql`, `002_backtest_snapshots.sql`, `007_notifications_log.sql` |
| CI | `.github/workflows/tests.yml` |
| Crons | `vercel.json` |
| Prior (partially stale) | `ENTERPRISE_REPORT.md` (blend=0 / λ-as-xG claims outdated) |

## Appendix B — Supersession

This document **supersedes** `ENTERPRISE_REPORT.md` and `ENTERPRISE_AUDIT.md` for certification decisions as of 2026-07-18. Engineering capability reports (`PREDICTOR_V2_REPORT.md`, `CALIBRATION_REPORT.md`, `MONTECARLO_REPORT.md`, `XG_ENGINE_REPORT.md`) remain useful for *what was built*; they are **not** production certificates.

---

**END OF CERTIFICATION AUDIT**  
**Overall: 5.4 / 10 — REJECT public production deployment.**
