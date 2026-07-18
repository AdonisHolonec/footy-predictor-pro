# Feature Importance Engine

Per-prediction **contribution %** for Attack, Defense, Form, Standings, H2H, Referee, Odds, Rest Days, Weather, Injuries.

Does **not** change λ, Poisson probabilities, or pick selection.

## Output

```js
featureImportance: {
  schemaVersion: "fi-v1",
  contributions: { attack: 23.1, defense: 18.0, … },  // sums to 100
  items: [{ key, label, contribution, activation, prior }, …],
  topFeatures: ["attack:23.1", …],
  total: 100,
  method: "prior_x_activation_normalized"
}
```

## Method

1. **Activation** from real signals (strengthMeta factors, modular scores, confidence dimensions, odds edge).  
2. Multiply by **priors** (`featureImportanceWeights.js`, overridable via `FI_PRIOR_*`).  
3. Renormalize to **100%**.

## Storage (ML)

| Store | Path |
|-------|------|
| Prediction row / history | `raw_payload.featureImportance` |
| Column | `predictions_history.top_features` ← top contribution keys |
| Dedicated table | `prediction_feature_importance` (migration `023`) |
| ML features | `fi_attack` … `fi_injuries` in `featureCatalog` / `FeatureExtractor` |

## UI

`FeatureImportanceChart` — full chart in Match Modal, compact bars on Match Card.
