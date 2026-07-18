# ML Ready — Footy Predictor

Scaffolding for future Machine Learning. **No ML models are trained or served online by this work.**

Existing production path remains: Poisson / Dixon–Coles → isotonic calibration → multinomial LR stacker (`server-utils/mlStacker.js`) → value engine.

---

## Layout

| Path | Role |
|------|------|
| `server-utils/ml/featureCatalog.js` | Available / missing feature registry (`fs-v1`) |
| `server-utils/ml/features/FeatureExtractor.js` | Feature extraction from `predictions_history` / predict payloads |
| `server-utils/ml/engineering/FeatureEngineering.js` | Clipping, leakage strip, time splits, optional standardize |
| `server-utils/ml/dataset/TrainingDataset.js` | Training dataset schema + builders |
| `server-utils/ml/model/ModelInterface.js` | Model adapter contract + family stubs |
| `server-utils/ml/history/PredictionHistoryStore.js` | History read + `ml_training_examples` upsert helpers |
| `server-utils/ml/index.js` | Barrel exports |
| `supabase/migrations/022_ml_training_ready.sql` | `ml_training_examples` + `ml_model_registry` |

Apply migration when ready: `supabase db push` (or your usual migration path).

---

## Available Features

Schema version: **`fs-v1`**

### Stacker core (already used by multinomial LR)

| Feature | Group | Source |
|---------|-------|--------|
| `poisson_log_ratio_1X` | model | Raw / model Poisson 1X2 probs |
| `poisson_log_ratio_2X` | model | same |
| `market_log_ratio_1X` | market | Shin implied from odds |
| `market_log_ratio_2X` | market | same |
| `market_available` | market | Odds present flag |
| `elo_spread_norm` | elo | `modelMeta.eloSpread / 400` |
| `data_quality_centered` | quality | `modelMeta.dataQuality - 0.6` |
| `log_home_adv` | league | `leagueParams.homeAdv` |
| `rho` | league | Dixon–Coles ρ |

### Extended (extractable from history / `raw_payload`, not yet in stacker)

| Feature | Group | Source |
|---------|-------|--------|
| `p1`, `pX`, `p2` | model | Final / stored probs |
| `pO25`, `pGG` | model | Markets |
| `lambda_home`, `lambda_away` | model | Attack/defence lambdas |
| `odds_home`, `odds_draw`, `odds_away` | market | Consensus odds |
| `recommended_confidence` | model | Top pick confidence |
| `value_ev`, `value_kelly`, `value_detected` | value | Value engine |
| `confidence_engine_overall` | context | Confidence engine |
| `league_id` | meta | League |
| `kickoff_hour_utc`, `kickoff_dow` | meta | Kickoff time |
| `calibration_applied`, `stacker_applied` | pipeline | Flags |

Labels (targets, never as inputs): `label_1x2` ∈ {1,X,2}, `label_gg`, `label_over25` — derived from FT scores.

---

## Missing Features

Not reliably collected / persisted today. Collect before expecting tree/NN gains.

| Feature | Group | Gap |
|---------|-------|-----|
| `h2h_goals_avg`, `h2h_home_win_rate` | h2h | H2H not persisted |
| `injuries_home_count`, `injuries_away_count` | injuries | `/injuries` unused |
| `rest_days_home`, `rest_days_away` | schedule | Rest days rarely stored |
| `referee_avg_cards`, `referee_avg_goals` | referee | Sparse |
| `form_pts_home_5`, `form_pts_away_5` | form | Form string ≠ numeric pts |
| `xg_rolling_home`, `xg_rolling_away` | xg | Shot-based rolling incomplete |
| `corners_lambda_total` | markets | Not guaranteed |
| `lineup_confirmed` | lineups | Lineups API unused |
| `weather_temp_c` | context | No weather source |
| `closing_odds_home`, `odds_movement_home` | market | No closing / timeline store |
| `travel_km_away` | schedule | No geodata |
| `table_rank_home`, `table_rank_away` | standings | Not normalized as features |

---

## Training Strategy

1. **Source of truth:** `predictions_history` (settled `FT` / `AET` / `PEN`).
2. **Materialize:** `FeatureExtractor` → `FeatureEngineering` → rows in `ml_training_examples` (`PredictionHistoryStore.upsertTrainingExamples`).
3. **Tasks:** primary `1x2`; secondary `o25`, `gg`.
4. **Leakage:** never train on FT score, `validation`, or post-match fields (`LEAKAGE_COLUMNS`).
5. **Temporal order:** sort by `kickoff_at`; **no random shuffle** across time for the main split.
6. **League awareness:** fit global + per-league when `n ≥` thresholds (same spirit as `scripts/fitStacker.js`).
7. **Class balance:** monitor 1/X/2 rates; use class weights or stratified time folds if draw under-represented.
8. **Feature freeze:** bump `feature_schema_version` (`fs-v1` → `fs-v2`) on incompatible changes; keep old rows.
9. **Online gate:** new models stay `planned` / `candidate` in `ml_model_registry` until metrics beat stacker holdout; only then set `active`.

Suggested offline flow (future scripts, not shipped):

```text
fetchPredictionHistory({ settledOnly: true, days: 220 })
  → buildTrainingDataset(rows, { engineer: true, labeledOnly: true, timeCuts })
  → toMatrix(dataset, "1x2")
  → external trainer (Python/R) or future JS adapters
  → write metrics + artifact_uri to ml_model_registry
```

---

## Validation Strategy

| Layer | Method | Purpose |
|-------|--------|---------|
| **Time split** | train / valid / test by kickoff cut dates | Realistic forward performance |
| **Purged gap** | optional 1–3 day embargo between splits | Reduce same-round leakage |
| **League holdout** | leave-one-league-out (optional) | Generalization |
| **Calibration** | reliability diagrams, ECE; keep isotonic as post-process | Probability quality |
| **Discrimination** | log-loss, Brier (1X2), accuracy @ argmax | Ranking vs market |
| **Economic** | CLV / ROI on value bets only when EV>0 | Align with product |
| **Baseline** | multinomial stacker + market Shin | Must beat to promote |
| **Stability** | rolling monthly metrics in `model_performance_snapshots` | Drift |

Promotion rule (recommended): candidate beats stacker on **valid** log-loss **and** Brier, then confirm on **test**; no online `predict()` wiring until registry `status = active`.

---

## Future Models

Adapters live in `server-utils/ml/model/ModelInterface.js`. All `fit` / `predict` / `save` / `load` return “not implemented” until trainers land. Registry seeds are in migration `022`.

### XGBoost

- **Role:** Strong tabular baseline for `1x2` multiclass.
- **Inputs:** `fs-v1` dense floats; one-hot or target-encode `league_id` externally.
- **Notes:** Early stopping on time-valid log-loss; monotone constraints optional on `elo_spread_norm`.
- **Adapter:** `XGBoostModel` / `createModel("xgboost")`.

### CatBoost

- **Role:** Native categorical handling (`league_id`, `kickoff_dow`).
- **Inputs:** same features; pass categoricals without heavy encoding.
- **Notes:** Good default when league cardinality grows; ordered boosting + time split.
- **Adapter:** `CatBoostModel`.

### Random Forest

- **Role:** Interpretable baseline / feature importance sanity check.
- **Inputs:** clipped `fs-v1`; no standardization required.
- **Notes:** Weaker calibration — pair with isotonic; useful for auditing SHAP-like importances.
- **Adapter:** `RandomForestModel`.

### LightGBM

- **Role:** Fast boosting alternative to XGBoost; good for frequent retrain cron.
- **Inputs:** `fs-v1`; leaf-wise growth — watch overfitting on small leagues.
- **Notes:** Candidate for daily-ml style jobs once feature store is filled.
- **Adapter:** `LightGBMModel`.

### Neural Network

- **Role:** Small MLP (or entity embeddings for `league_id`) on standardized features.
- **Inputs:** `engineerFeatures(..., { standardizeStats })`.
- **Notes:** Needs more data than trees; consider as blend head later, not day-one replace.
- **Adapter:** `NeuralNetModel`.

---

## What is intentionally NOT done

- No XGBoost / CatBoost / RF / LightGBM / NN training code
- No change to `/api/predict` inference path
- No replacement of `mlStacker` / isotonic in production
- No automatic writes to `ml_training_examples` from live traffic (helpers only)

---

## Quick usage (offline)

```js
import {
  fetchPredictionHistory,
  buildTrainingDataset,
  createModel,
  FEATURE_SCHEMA_VERSION
} from "./server-utils/ml/index.js";

const { rows } = await fetchPredictionHistory({ days: 180, settledOnly: true });
const dataset = buildTrainingDataset(rows, {
  engineer: true,
  labeledOnly: true,
  timeCuts: { trainEnd: "2025-12-31", validEnd: "2026-03-31" }
});

const xgb = createModel("xgboost");
await xgb.fit(dataset); // → { ok: false, error: "…scaffolding only" }
console.log(FEATURE_SCHEMA_VERSION, dataset.summary);
```
