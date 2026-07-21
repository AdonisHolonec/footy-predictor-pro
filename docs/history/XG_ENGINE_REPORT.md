# Expected Goals (xG) Engine Report

**Date:** 2026-07-18
**Objective:** Replace the placeholder xG (λ reused as Expected Goals) with a **real rolling xG model** built from shots, shots on target, big-chance proxy, possession, and recent (provider) xG.

---

## 1. Current implementation (before)

Inspection found xG was **not real** — it reused the Poisson goal-expectation λ:

| Site | Old behavior | Evidence |
|------|--------------|----------|
| `PredictionEngine/ExpectedGoals.js` | Identity map: `xgHome = lambdaHome`, `source: "lambda_as_xg"` | module returned λ directly |
| `api/predict.js` `luckStats` | `hXG/aXG = roundDisplayRate(lambdaHome/Away)`, `intensityNote: "expected_rate_from_strength_model"` | λ shown to users as "xG" |
| Model Lab `xg` source | Read `luck_hxg/luck_axg` — i.e. λ | reconstructed from stored luck fields |

A genuine but **per-fixture** shot estimate existed (`calculateSyntheticXG` in `advancedMath.js`, used only by the `/api/fixtures?view=xg` endpoint) — but the prediction path did **not** use it and had **no rolling** xG.

---

## 2. New rolling xG model (after)

New module: `server-utils/xg/RollingXgModel.js`.

### Inputs (all requested signals)
Captured per fixture by an extended `extractFixtureMarketStats` (`teamMarketRolling.js`):

| Signal | API stat | Role |
|--------|----------|------|
| Shots on target | `Shots on Goal` | primary cheap xG proxy |
| Total shots | `Total Shots` | off-target volume |
| Shots inside box | `Shots insidebox` | chance quality (location) |
| Shots outside box | `Shots outsidebox` | low-value shots |
| Big chances (proxy) | min(SoT, inside-box) | high-quality on-target inside-box shots |
| Possession | `Ball Possession` | territory tilt (±10%) |
| Recent xG | `expected_goals` (when provided) | blended in directly |

### Per-match xG — `estimateMatchXg(stats)`
```
location model:  inBox·0.10 + outBox·0.03 + bigChance·0.06 + sotResidual·0.05
reduced model :  sot·0.27 + offTarget·0.025          (when shot locations absent)
× possession tilt (0.90–1.10)
blend with provider xG when present:  xg·0.6 + shotModel·0.4
clamp 0.05–6.0
```
Degrades gracefully: uses the richest signals available, falls back to SoT+shots.

### Rolling aggregation — `computeRollingXg(matches)`
Recency-weighted (EWMA, decay 0.85, most-recent first) rolling **xG for / against**, with home/away splits and a sample count. Emphasizes recent xG.

### λ derivation — `deriveXgLambdas({rollingHome, rollingAway, leagueBaseXg, homeAdv, awayAdv})`
Dixon–Coles multiplicative combine:
```
xgHome = (xgFor_home · xgAgainst_away / leagueBaseXg) · homeAdv
xgAway = (xgFor_away · xgAgainst_home / leagueBaseXg) · awayAdv
```

All weights env-configurable (`XG_W_*`, `XG_PROVIDER_BLEND`, `XG_RECENCY_DECAY`).

---

## 3. Wiring

| Site | New behavior |
|------|--------------|
| `api/predict.js` | After rolling stats resolve, `deriveXgLambdas(...)` computes real rolling xG and **overrides `luckStats.hXG/aXG`** (`xgSource`, `intensityNote: "rolling_xg_model"`). Exposed as `modelMeta.xgModel`. |
| `buildLiveRollingForTeam` (predict) | Now also computes `computeRollingXg(enriched)` from freshly fetched match statistics (full signal set) — in-memory, not persisted. |
| `PredictionEngine/ExpectedGoals.js` | Prefers `ctx.xgHome/xgAway` (rolling xG); falls back to λ with `source: "lambda_fallback"`. |
| Model Lab `xg` source | Automatically becomes real rolling xG (reads `luck_hxg/luck_axg`, now populated by the rolling model). |

### Data source strategy (migration-free, non-breaking)
- **Live rolling path** (fresh `/fixtures/statistics`) uses the **full** signal set (inside-box, possession, provider xG).
- **Persisted rolling** (`team_market_rolling`, currently stores SoT + total shots) → `rollingXgRates()` derives real xG from SoT+shots (`source: "sot_shots_derived"`).
- No schema change and the warm-predict persist path is untouched (no upsert breakage). Persisted enrichment with the richer signals is a future, optional step.

---

## 4. Behavior change

- xG is no longer numerically equal to λ. It reflects **actual shot volume, shot quality, and (where available) provider xG**, rolled over recent matches with recency weighting.
- The prediction pipeline's λ (goal model) is unchanged — xG is now an **independent** signal (used in `luckStats`, the ExpectedGoals module, and the Model Lab's xG model), which is what the Model Laboratory needs to make Models C/D meaningfully different from pure Poisson.

---

## 5. Verification

- `node --test tests/math.test.js` → **63 pass** (new test: location-aware estimate, provider-xG blend, reduced model, recency rolling, SoT/shots fallback, DC λ).
- `npm run build` → frontend compiles.
- `node --check` on `predict.js`, `RollingXgModel.js`, `teamMarketRolling.js` → OK.

## Files changed

| File | Change |
|------|--------|
| `server-utils/xg/RollingXgModel.js` | **New** rolling xG model |
| `server-utils/teamMarketRolling.js` | `extractFixtureMarketStats` captures inside/outside-box, possession, provider xG |
| `server-utils/PredictionEngine/ExpectedGoals.js` | Uses real rolling xG; λ only as fallback |
| `api/predict.js` | Compute rolling xG, override `luckStats`, expose `modelMeta.xgModel`; live path computes rolling xG |
| `tests/math.test.js` | Rolling xG test + updated extract test |

*The xG engine is descriptive/independent — it enriches signals and the Model Lab; the core goal model (λ) remains the pick driver unless a model is promoted.*
