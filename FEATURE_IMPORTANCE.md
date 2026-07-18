# Feature Importance & Prediction Contributions

**Date:** 2026-07-18
**Scope:** Per-prediction attribution of every module's contribution.

The project now ships **two complementary attribution layers**:

1. **Prediction Contributions Engine** (new) — **signed** percentage-point impact of each module *toward the recommended pick* (Poisson +24%, Weather −2%, …), plus the overall **Confidence**. This matches the "why did the model pick this?" question directly.
2. **Feature Importance Engine** (existing) — **positive, normalized-to-100%** share of each feature, used for compact bars and ML feature storage.

Both are read-only: they **never** change λ, probabilities, or pick selection.

---

## 1. Prediction Contributions Engine (signed)

**Files:**
- `server-utils/importance/PredictionContributions.js` — engine
- `api/predict.js` — builds `predictionContributions` per prediction and returns it in the API
- `src/components/PredictionContributionsChart.tsx` — diverging-bar UI
- `src/components/MatchModal.tsx` — renders it in the match detail modal

### What it produces

For each prediction, a signed contribution (in **percentage points** on the pick probability) for every module actually in the pipeline:

| Module | Key | Source |
|--------|-----|--------|
| Poisson (attack + defense goal model) | `poisson` | `strengthMeta` atk/def vs league average |
| Home Advantage | `homeAdvantage` | `strengthMeta.homeAdv / awayAdv` |
| Form | `form` | Form module home/away factors |
| Elo | `elo` | `eloInfo.eloSpread` (Elo log-odds) |
| Odds | `odds` | OddsEngine (Shin-mapped) factor |
| Injuries | `injuries` | InjuriesEngine factor |
| Referee | `referee` | RefereeEngine factor |
| Weather | `weather` | WeatherEngine factor |
| Rest Days | `restDays` | RestDaysEngine factor |
| H2H | `h2h` | H2HEngine factor |
| Motivation | `motivation` | MotivationEngine factor |
| Lineups | `lineup` | LineupEngine factor |
| Standings | `standings` | StandingsEngine factor |
| Recent Form | `recentMatches` | RecentMatches factor |
| Away Strength | `awayStrength` | AwayStrength factor |
| Calibration | `calibration` | Calibrated − raw probability of the pick |
| **Confidence** | *(separate field)* | Independent Confidence Engine overall (0–100) |

### Example output (shape)

```json
{
  "schemaVersion": "contrib-v1",
  "pick": "1",
  "outcome": "1",
  "confidence": 85,
  "pickProbability": 63,
  "net": 6.4,
  "items": [
    { "key": "poisson",       "label": "Poisson",        "contribution": 24.0, "direction": "positive", "share": 100 },
    { "key": "elo",           "label": "Elo",            "contribution": 12.0, "direction": "positive", "share": 50 },
    { "key": "form",          "label": "Form",           "contribution": 9.0,  "direction": "positive", "share": 37 },
    { "key": "homeAdvantage", "label": "Home Advantage", "contribution": 7.0,  "direction": "positive", "share": 29 },
    { "key": "odds",          "label": "Odds",           "contribution": 6.0,  "direction": "positive", "share": 25 },
    { "key": "injuries",      "label": "Injuries",       "contribution": -5.0, "direction": "negative", "share": 21 },
    { "key": "calibration",   "label": "Calibration",    "contribution": 4.0,  "direction": "positive", "share": 17 },
    { "key": "referee",       "label": "Referee",        "contribution": 3.0,  "direction": "positive", "share": 12 },
    { "key": "weather",       "label": "Weather",        "contribution": -2.0, "direction": "negative", "share": 8 }
  ],
  "topDrivers": ["poisson:24", "elo:12", "form:9", "homeAdvantage:7", "odds:6"]
}
```

### How it is computed (grounded — no invented numbers)

Each module is first expressed as a **home-supremacy log term** (positive → favors home):

```
poisson       = wA·[ln(atkH/lg) − ln(atkA/lg)] + wD·[ln(defA/lg) − ln(defH/lg)]
homeAdvantage = wHA·[ln(homeAdv) − ln(awayAdv)]
form          = wF·[ln(formHome) − ln(formAway)]
optional_i    = modularBlend · w_i · [(f_i_home − 1) − (f_i_away − 1)]   // exact combine.js marginal
elo           = eloWeight · ln(10) · eloSpread / 400                      // Elo log-odds
```

Then each term is **oriented to the recommended outcome** (flip sign for away picks; for draws, terms that increase imbalance count negatively) and mapped to **probability points** via the logistic derivative `p·(1−p)`, where `p` is the pick's final probability.

**Calibration** is measured directly as the shift the isotonic/stacker/blend layer applied to the pick outcome: `calibrated% − raw%`.

**Confidence** is the independent Confidence Engine overall score, surfaced as its own number (not a signed contribution).

### Weights & configuration (nothing hardcoded)

- Module weights come from the resolved prediction weights (`PREDICT_WEIGHT_*`, then auto-calibration overlay) — the **same weights that drive λ**, so attribution reflects the live model.
- `modularBlend` gates the optional modules (see `ACTIVATION_REPORT.md`).
- Elo attribution weight: `PREDICT_CONTRIB_ELO_WEIGHT` (default `1.0`).

### API

Returned on every sufficient-data prediction as `predictionContributions` (alongside `featureImportance`, `explanation`, `confidenceEngine`). No new endpoint — it rides on `/api/predict`.

### UI

`PredictionContributionsChart.tsx` renders **diverging bars**: positive contributions grow right (mint), negative grow left (rose), with a centered axis, a Confidence badge, and a net-lean footer. Rendered in `MatchModal` under the Feature Importance chart.

---

## 2. Feature Importance Engine (existing, normalized)

**Files:** `server-utils/importance/FeatureImportanceEngine.js`, `featureImportanceWeights.js`, `src/components/FeatureImportanceChart.tsx`.

- 10 features: attack, defense, form, standings, h2h, referee, odds, restDays, weather, injuries.
- Method: `prior × (0.08 + activation)` normalized to **100%** (positive shares).
- Persisted to `prediction_feature_importance` and flattened to `fi_*` for ML.

Use this for the compact "share of importance" view; use **Prediction Contributions** for the signed "which way did each module push" view.

---

## Difference at a glance

| | Prediction Contributions | Feature Importance |
|--|--------------------------|--------------------|
| Sign | **Signed** (+/−) | Positive only |
| Units | Percentage points on the pick | % share of 100 |
| Includes | Poisson, Elo, Home Advantage, Calibration, Confidence | attack…injuries (10) |
| Question answered | "Which way did each module push this pick?" | "How much did each feature matter?" |
| Storage | API + UI | API + UI + DB + ML vector |

---

## Verification

- `node --test tests/math.test.js` → **58 pass** (includes `PredictionContributions` orientation + calibration test)
- `npm run build` → frontend compiles with the new chart
- `node --check` on changed server files → OK

## Files changed

| File | Change |
|------|--------|
| `server-utils/importance/PredictionContributions.js` | **New** signed attribution engine |
| `api/predict.js` | Build + return `predictionContributions` per prediction |
| `src/types.ts` | `PredictionContributions` / `PredictionContributionItem` types + field |
| `src/components/PredictionContributionsChart.tsx` | **New** diverging-bar UI |
| `src/components/MatchModal.tsx` | Render contributions chart |
| `tests/math.test.js` | Engine unit test |

*Attribution is explanatory only — it does not alter any prediction.*
