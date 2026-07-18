# Confidence Engine (Independent)

Scores **how reliable the supporting context is** for a match recommendation.  
**Never** changes λ, Poisson probabilities, pick selection, or `recommended.confidence`.

## Contract

```js
buildConfidenceEngine(ctx) → {
  confidence,          // 0–100 (alias of overall)
  overall,             // 0–100 weighted average
  category,            // Very High | High | Medium | Low | Very Low
  scores: { …12 dims },
  available: { … },
  weights: { … },
  explanation: string[],   // per-dimension notes
  why?: string,
  recommendationWhy?: string[]  // WHY this pick got that category
}
```

`attachRecommendationExplanation(engine, { pick, pickProb })` adds recommendation WHY lines **without mutating scores**.

## Dimensions (each 0–100)

| Dimension | Signal |
|-----------|--------|
| Attack | GF vs league avg |
| Defense | GA vs league avg (inverted) |
| Form | W/D/L multipliers |
| Recent Matches | Last matches intensity or sample-size proxy |
| Standings | Points per game |
| Referee | Avg goals stats / name soft score |
| Injuries | Absence counts (neutral if missing) |
| Lineups | Confirmed XI / key absences (neutral if missing) |
| Rest Days | Days since last match |
| Home Advantage | League `homeAdv` / `awayAdv` calibration |
| Odds Consensus | Bookmaker count + Shin z |
| H2H | Prior meetings goal output |

Missing data → **neutral ~50** + `available: false` (UI dims the cell). No invented precision.

## Categories

| Score | Category |
|------:|----------|
| ≥ 80 | Very High |
| ≥ 65 | High |
| ≥ 50 | Medium |
| ≥ 35 | Low |
| &lt; 35 | Very Low |

## Weights

Defaults in `server-utils/confidence/confidenceWeights.js` (sum → renormalized to 1).  
Env: `CONFIDENCE_WEIGHT_ATTACK`, `…_DEFENSE`, `…_FORM`, `…_RECENT_MATCHES`, `…_STANDINGS`, `…_REFEREE`, `…_INJURIES`, `…_LINEUPS`, `…_REST_DAYS`, `…_HOME_ADVANTAGE`, `…_ODDS_CONSENSUS`, `…_H2H`.

## Wiring

1. `api/predict.js` builds `confidenceEngine` **after** probs exist, from read-only context.  
2. After `topPick` / `maxConf` are known → `attachRecommendationExplanation(...)`.  
3. Attached as additive field `confidenceEngine` on the prediction row.  
4. `recommended.confidence` remains the model pick probability.

## UI

- `ConfidenceEnginePanel` — category badge, overall %, 12-dimension grid with bars, **Why this recommendation got X**, full dimension notes.  
- `MatchCard` — compact chip with category + %.  
- `MatchModal` — full panel with recommended pick label.

## Independence guarantee

- Lives only under `server-utils/confidence/`.  
- Does **not** import `server-utils/prediction/*` or `PredictionEngine/*` for scoring.  
- Removing `confidenceEngine` would not change any prediction output.
