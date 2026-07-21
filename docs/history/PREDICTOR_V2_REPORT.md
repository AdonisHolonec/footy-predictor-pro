# Predictor V2 — Integration Report

**Date:** 2026-07-18  
**Version:** `predictor-v2.1`  
**Objective:** Integrate the full prediction stack into one audited pipeline and document architecture, performance, accuracy, capabilities, migration, and retired debt.

---

## 1. Final pipeline

```text
Fetch
  ↓
Cache
  ↓
Features
  ↓
Prediction Engine          ← attack · defense · form · homeAdv
  ↓                           + Injuries · Weather · Referee · Lineups
Poisson                       · Rest Days · Motivation · Odds · H2H · …
  ↓
Elo                        ← parallel rating signal (stacker / Model Lab)
  ↓
xG                         ← rolling shot-based λ blend (weight `expectedGoals`)
  ↓
Injuries / Weather / …     ← also applied inside engine before Poisson (λ path)
  ↓
Calibration                ← isotonic / Platt / temperature / beta maps
  ↓
Confidence                 ← independent ConfidenceEngine (+ module inputs)
  ↓
Recommendation             ← ValueEngine + professional multi-market picks
  ↓
Feature Importance         ← FI engine + signed PredictionContributions
  ↓
Prediction                 ← row + history + Monte Carlo + laboratory
```

**Physical note:** Injuries → Motivation are folded into `PredictionEngine.build` *before* Poisson so they can move λ. Elo, Calibration, Confidence, Recommendation, and Feature Importance run after. Rolling xG is resolved early from market-rolling cache (and re-blended if live rolling arrives late). Every fixture emits `modelMeta.pipeline` with per-stage status.

Contract module: `server-utils/pipeline/PredictorV2.js`  
Handler: `api/predict.js`

---

## 2. Architecture

### 2.1 Layers

| Layer | Responsibility | Key modules |
|-------|----------------|-------------|
| **Ingress** | Auth, tiers, rate limits, usage budget | `api/predict.js`, `accessTier.js` |
| **Data** | API-Football fetch + KV cache | `fetcher.js`, `oddsPrefetch.js` |
| **Features** | Team stats, standings, module collector | `math.js`, `moduleInputs.js`, `teamMarketRolling.js` |
| **Engine** | Modular λ construction | `PredictionEngine/*`, `combine.js`, `weights.js` |
| **Probabilities** | Bivariate Poisson + Dixon–Coles | `math.js` `computeMatchProbs` |
| **Simulation** | Adaptive Monte Carlo (1k–25k) | `monteCarlo/MonteCarloEngine.js` |
| **Post-λ** | Elo, xG blend, calibration, stacker, Model Lab | `teamElo.js`, `RollingXgModel.js`, `isotonicCalibration.js`, `mlStacker.js`, `modelLab/*` |
| **Decision** | Confidence, value, top pick | `ConfidenceEngine.js`, `ValueEngine.js` |
| **Explain** | Feature importance + contributions | `FeatureImportanceEngine.js`, `PredictionContributions.js` |
| **Offline ML** | Calibration bake-off, stacker, auto model promote | `api/cron/daily-ml.js` |

### 2.2 Engine modules (all live when `modularBlend=1`)

Attack · Defense · Form · HomeAdvantage · AwayStrength · Standings · RecentMatches · H2H · Referee · Injuries · Lineups · Odds · RestDays · Motivation · Weather · Poisson · ExpectedGoals · (audit) Confidence · Recommendation

Enrichment bus: `collectModuleInputs()` — odds, H2H, injuries, lineups, recent matches, rest dates, weather.

### 2.3 Pipeline audit payload

```json
"modelMeta": {
  "predictorVersion": "predictor-v2.1",
  "pipeline": {
    "version": "predictor-v2.1",
    "summary": "fetch:ok → … → prediction:ok",
    "stages": { "xg": { "status": "ok", "detail": "blended:rolling_xg" }, "...": "..." }
  }
}
```

---

## 3. Performance

| Lever | Effect |
|-------|--------|
| **KV + `getWithCache`** | Deduped HTTP; TTL caching on fixtures/stats/odds |
| **Date-batched odds prefetch** | One odds pull per calendar day instead of N fixture calls |
| **Adaptive Monte Carlo** | 1 000–25 000 sims by uncertainty (blowouts cheap, toss-ups rich) |
| **Live rolling cap** | Bounded uncached stats hydration (`LIVE_ROLLING_MAX_UNCACHED_STATS_CALLS`) |
| **Usage hard-stop** | Under quota → DB-only / degraded path instead of melt-down |
| **xG early from rolling map** | Avoids waiting on live hydration for most leagues |
| **Serverless function budget** | Hobby limit respected — new APIs folded into existing routes (`backtest?view=…`, `daily-ml`) |

Expected CPU shape vs fixed-10k MC: fewer sims on heavy favourites, more on balanced cards — net similar or lower average cost with better CI where it matters.

---

## 4. Accuracy improvements

| Change | Impact |
|--------|--------|
| **`modularBlend: 1`** | Optional modules actually move λ (standings, form-adjacent, injuries, rest, odds, …) |
| **Rolling xG → λ** | `expectedGoals` weight default **0.2**; strength λ blended toward shot-based xG |
| **Multi-method calibration** | Cron CV bake-off: isotonic / Platt / temperature / beta; identity if none beat baseline |
| **Global calib fallback fix** | `league_id = -1` maps now apply when league-specific map missing |
| **Multinomial stacker** | Learns Poisson vs market features on settled history |
| **League market priors** | Draw / BTTS / over rates from league profiles |
| **Shin de-vig** | Market blend uses Shin-implied probs |
| **Auto Model Selection** | Promotes A–E from rolling accuracy/ROI windows; default E = full stack |
| **Adaptive MC** | Tighter market CIs on uncertain matches |
| **Live Model Lab xG source** | Uses Poisson-from-xG λ, not a copy of raw Poisson |

Residual honesty: weather often neutral (provider rarely sends weather); referee tendency needs stats endpoint; motivation is standings-rank heuristic; lineup “missing key players” still weak pre-kickoff.

---

## 5. New capabilities

1. **Activated modular Prediction Engine** — all optional factors wired via `moduleInputs`
2. **Rolling Expected Goals** — shots / SoT / location / possession / provider xG → λ blend
3. **Calibration selector** — Platt, Temperature, Beta vs Isotonic (daily-ml)
4. **Adaptive Monte Carlo** — uncertainty tiers 1k / 3k / 5k / 10k / 25k
5. **Model Lab + auto promotion** — compete models; apply via KV `footy_active_model`
6. **Professional Value Engine** — multi-market EV / Kelly / best pick
7. **Signed feature contributions** — per-module impact toward the pick
8. **Independent Confidence Engine** — now receives module inputs (injuries/H2H/lineups/weather/…)
9. **Enterprise surfaces** — health / analytics / Model Lab panels (via existing routes)
10. **Pipeline trace** — `modelMeta.pipeline` for every prediction

Supporting reports: `ACTIVATION_REPORT.md`, `XG_ENGINE_REPORT.md`, `CALIBRATION_REPORT.md`, `MONTECARLO_REPORT.md`, `MODEL_SELECTION.md`, `ENTERPRISE_REPORT.md`.

---

## 6. Migration guide

### 6.1 From “parity / V1” (modularBlend=0, λ-as-xG)

| Step | Action |
|------|--------|
| 1 | Deploy code with `predictor-v2.1` (weights defaults already activated) |
| 2 | Apply Supabase migration `025_calibration_method.sql` (method + metrics_json) |
| 3 | Run `daily-ml` cron (calibration bake-off + stacker + model promote) |
| 4 | Confirm `calibration_maps` rows exist (league + `league_id=-1`) |
| 5 | Warm predict once; inspect `modelMeta.pipeline` and `xgModel.blendedIntoLambda` |
| 6 | Optional env overrides — see §6.3 |

### 6.2 Behaviour changes to expect

- λ and 1X2 probs **will shift** vs parity mode (modules + xG blend on).
- Monte Carlo `simulations` varies by match; UI shows `adaptive (u=…)`.
- Calibration method may be `platt` / `temperature` / `beta` / `none`, not only isotonic.
- Active model may leave `E` if auto-selection promotes another id.

### 6.3 Key environment knobs

| Env | Default | Role |
|-----|---------|------|
| `PREDICT_WEIGHT_MODULAR_BLEND` | `1` | Master gate for optional modules |
| `PREDICT_WEIGHT_EXPECTED_GOALS` | `0.2` | Strength ↔ xG blend |
| `PREDICT_WEIGHT_*` | see `weights.js` | Per-module λ influence |
| `MONTE_CARLO_ADAPTIVE` | on | Set `0` to force fixed sims |
| `MONTE_CARLO_SIMS` | `10000` | Fixed budget when adaptive off |
| `ACTIVE_MODEL_ID` | — | Override auto-selected model |
| `CALIBRATION_MIN_SAMPLES` | `150` | Min samples to fit maps |

### 6.4 Rollback

```bash
# Soft rollback — parity-like λ without optional modules / xG blend
PREDICT_WEIGHT_MODULAR_BLEND=0
PREDICT_WEIGHT_EXPECTED_GOALS=0
MONTE_CARLO_ADAPTIVE=0
MONTE_CARLO_SIMS=10000
```

Code rollback: revert to pre-V2 commit; calibration maps remain compatible (x/y points only).

---

## 7. Technical debt removed

| Removed / retired | How |
|-------------------|-----|
| **`modularBlend=0` nullifying all optional modules** | Default `1`; modules wired |
| **λ reused as “xG” in luckStats** | Rolling shot-based xG; blend into λ |
| **`expectedGoals` weight stuck at 0** | Default `0.2` + combine blend |
| **Hardcoded Poisson correlation / shrinkage in predict** | `weights.poissonCorrelation`, `PREDICT_SHRINKAGE_K` |
| **Global calibration maps never applied** | Fallback `league_id=-1` in picker |
| **Fixed 10k Monte Carlo for every match** | Adaptive tiers |
| **Model Lab live `xg` = copy of Poisson** | `buildXgSourceProbs` from xG λ |
| **Confidence engine blind to enrichments** | Spreads `moduleInputs` into `confidenceCtx` |
| **Undocumented stage order** | `PredictorV2` contract + `modelMeta.pipeline` |

### Still open (honest backlog)

- Fat `api/predict.js` (~2k LOC) — pipeline contract extracted; full split still TODO  
- Duplicate `server-utils/prediction/*` facade vs `PredictionEngine/*` (facade is thin re-export)  
- Weather external provider; referee tendency stats table  
- Stacker can still bypass calibrated blend when weights exist  
- Enterprise P0 security items from `ENTERPRISE_REPORT.md` (RLS / open routes) unchanged by this integration  
- `ENGINE_EXECUTION_REPORT.md` claims of `modularBlend=0` are **stale** — trust this report + `ACTIVATION_REPORT.md`

---

## 8. Verification

```bash
npm run test:math
```

Includes: Predictor V2 contract, xG λ blend, adaptive MC, calibration selector, rolling xG, Model Lab, contributions.

Smoke (production):

1. Hit `/api/predict` for a matchday  
2. Assert `modelMeta.predictorVersion === "predictor-v2.1"`  
3. Assert `modelMeta.pipeline.stages` all present  
4. Assert `monteCarlo.adaptive` when adaptive enabled  
5. Assert `xgModel.applied` on leagues with rolling shot data  

---

## 9. File map (this integration)

| File | Role |
|------|------|
| `server-utils/pipeline/PredictorV2.js` | Stage contract, xG blend helpers, pipeline trace |
| `server-utils/PredictionEngine/combine.js` | λ ← strength × modules × xG blend |
| `server-utils/PredictionEngine/weights.js` | `expectedGoals: 0.2` |
| `api/predict.js` | Early xG into engine, late reblend, Model Lab xG source, pipeline meta, confidence inputs |
| `PREDICTOR_V2_REPORT.md` | This document |
| Prior: `MonteCarloEngine.js`, `CalibrationSelector.js`, `RollingXgModel.js`, `moduleInputs.js` | Stage implementations |

---

## 10. Verdict

**Predictor V2 is the integrated production path:** fetch/cache → modular engine (with injuries/weather/referee/lineups/rest/motivation) → Poisson → Elo → rolling xG blend → calibration → confidence → recommendation → feature importance → prediction — with adaptive Monte Carlo, multi-method calibration, and an auditable `modelMeta.pipeline` on every row.
