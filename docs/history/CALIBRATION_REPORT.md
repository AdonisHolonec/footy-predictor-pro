# Probability Calibration Report

**Date:** 2026-07-18  
**Objective:** Improve 1X2 probability calibration by keeping Isotonic (PAV) and evaluating Platt Scaling, Temperature Scaling, and Beta Calibration — then auto-selecting the best method per outcome / league.

---

## 1. Verdict

**Per-dataset bake-off (CV log-loss), not a single fixed method.**

| Miscalibration pattern | Best method | Why |
|------------------------|-------------|-----|
| Overconfident (probs pushed to extremes) | **Isotonic** | Non-parametric PAV corrects arbitrary monotone distortions |
| Underconfident (probs shrunk toward 0.5) | **Platt** | Logistic recalibration stretches logits efficiently |
| Systematic sigmoid bias | **Platt** (Beta close 2nd) | Affine-in-logit / Beta both match logistic bias |
| Already well calibrated | **none** (identity) | Avoids overfitting a remap that hurts CV log-loss |

**Production policy:** `selectBestCalibration()` runs 4-fold CV on settled history, ranks  
`isotonic | platt | temperature | beta` by **log-loss → ECE → Brier**, and only ships a map if it beats the uncalibrated baseline on the same folds. Otherwise it stores an identity curve (`method = none`).

Runtime still applies maps via the existing piecewise-linear path (`applyIsotonicMap` / `applyCalibratedTriple`) — parametric winners are materialized to `(x_points, y_points)`.

---

## 2. Methods

| Method | Form | Params | Strengths | Weaknesses |
|--------|------|--------|-----------|------------|
| **Isotonic (PAV)** | Monotone step / PWL | Blocks | Flexible, keeps old path | Overfits small N; can hurt when already calibrated |
| **Platt** | `σ(a·logit(x) + b)` | a, b | Strong on logistic bias / underconfidence | Assumes sigmoid shape |
| **Temperature** | `σ(logit(x) / T)` | T > 0 | 1-param, great for pure over/under confidence | Cannot fix location bias |
| **Beta** (Kull et al.) | `σ(a·ln x − b·ln(1−x) + c)` | a, b, c | More flexible than Platt | Needs more samples; L2 + a,b≥0 for stability |

Implementations: `server-utils/calibration/methods.js`  
Selector: `server-utils/calibration/CalibrationSelector.js`

---

## 3. Evaluation protocol

1. Build per-outcome samples `{x: raw_prob, y ∈ {0,1}}` from settled `predictions_history`.
2. Shuffle indices (deterministic seed) → **k-fold CV** (default k=4).
3. Score each method on held-out folds: **log-loss**, **ECE** (10 bins), **Brier**.
4. Score **uncalibrated baseline** on the *same* validation indices (fair compare).
5. Choose best method with `logLoss ≤ baseline.logLoss`; else `none`.
6. Refit winner on **all** samples → store curve + method metadata.

Triggered by `api/cron/daily-ml.js` → `runCalibration()` → `fitBestCalibration()`.

---

## 4. Synthetic bake-off results (n=400 each)

Reproducible via `CalibrationSelector` (seeded CV). Metrics = CV averages.

### 4.1 Overconfident

| Method | Log-loss ↓ | ECE ↓ | Brier ↓ |
|--------|------------|-------|---------|
| **isotonic** ★ | **0.61919** | **0.05148** | **0.21369** |
| temperature | 0.62656 | 0.07966 | 0.21669 |
| beta | 0.62718 | 0.06734 | 0.21684 |
| platt | 0.62755 | 0.09970 | 0.21720 |
| baseline | 0.77148 | 0.12908 | 0.23111 |

**Selected: isotonic** (Δ log-loss −0.152 vs baseline)

### 4.2 Underconfident

| Method | Log-loss ↓ | ECE ↓ | Brier ↓ |
|--------|------------|-------|---------|
| **platt** ★ | **0.63177** | **0.03632** | **0.22052** |
| temperature | 0.63359 | 0.05069 | 0.22140 |
| beta | 0.64248 | 0.05420 | 0.22529 |
| isotonic | 0.69243 | 0.04557 | 0.22319 |
| baseline | 0.64648 | 0.06601 | 0.22709 |

**Selected: platt** (isotonic *worse* than baseline here — parametric wins)

### 4.3 Sigmoid bias

| Method | Log-loss ↓ | ECE ↓ | Brier ↓ |
|--------|------------|-------|---------|
| **platt** ★ | **0.62120** | **0.02693** | **0.21559** |
| beta | 0.62227 | 0.03862 | 0.21613 |
| temperature | 0.63298 | 0.09146 | 0.22130 |
| isotonic | 0.64019 | 0.05852 | 0.22055 |
| baseline | 0.63143 | 0.09680 | 0.22066 |

**Selected: platt**

### 4.4 Already well calibrated

| Method | Log-loss ↓ |
|--------|------------|
| baseline ★ | **0.56856** |
| temperature | 0.57050 |
| beta | 0.57185 |
| platt | 0.57202 |
| isotonic | 0.61590 |

**Selected: none** (`reason: no_method_beats_baseline`) — identity map stored so we do not degrade sharpness.

---

## 5. Production wiring

```
daily-ml runCalibration
  → buildCalibrationGroups (1 / X / 2)
  → selectBestCalibration (CV bake-off)
  → upsert calibration_maps (x_points, y_points, method, metrics_json)
  → league maps + global league_id = -1

predict
  → loadCalibrationMaps(modelVersion)
  → pickCalibrationMapForLeague(maps, leagueId)
       // league hit, else global "-1", else legacy "*"
  → applyCalibratedTriple(rawProbs, maps)
```

### Fixes in this pass

1. **Global fallback bug:** maps were written as `league_id = -1` but lookup only fell back to `"*"`. `pickCalibrationMapForLeague` now checks `"-1"` then `"*"`.
2. **Fair baseline:** uncalibrated metrics use the same CV folds as fitted methods.
3. **Identity guard:** if every method hurts CV log-loss → store `method=none`.
4. **Audit columns:** migration `025_calibration_method.sql` adds `method` + `metrics_json` (upsert falls back if migration not applied yet).

---

## 6. How to choose “the best” in practice

There is **no universal winner**. The best method depends on the error shape of the raw model for that league/outcome window:

- Keep **Isotonic** as the flexible default when distortions are irregular / overconfident.
- Prefer **Platt** (or **Beta**) when CV shows logistic / underconfidence structure.
- Use **Temperature** when a single sharpness scalar is enough.
- Use **none** when the model is already calibrated.

The daily selector encodes this automatically; inspect `calibration_maps.method` / `metrics_json.ranking` (after migration 025) or the cron `methodSelection` summary.

---

## 7. Tests

`tests/math.test.js` covers:

- Platt / Temperature / Beta fit → finite params + monotone `curveToPoints`
- CV ranking on overconfident data beats baseline
- Selector picks a parametric method on underconfident data
- Selector returns `none` when already calibrated
- Global map fallback `league_id = -1`

Run: `npm run test:math`

---

## 8. Apply migration

```bash
# when ready against the project Supabase instance
supabase db push
# or apply supabase/migrations/025_calibration_method.sql manually
```

Until applied, daily-ml still writes curves; method metadata upsert soft-falls back to the previous schema.
