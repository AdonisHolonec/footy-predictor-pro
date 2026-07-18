# Confidence Engine

The Confidence Engine is an **independent, additive** module that scores "how much reliable
context did we have for this match" — separately from the prediction pipeline that produces
λ_home/λ_away, the Poisson/Dixon-Coles probabilities, pick selection, and
`recommended.confidence`.

## Independence guarantee

- The Confidence Engine lives entirely under `server-utils/confidence/` and never imports from,
  or is imported by, `server-utils/prediction/*`.
- It is called in `api/predict.js` **after** the prediction object (λ, probs, pick, `recommended`)
  is fully built. It only reads already-computed context (team stats, form, standings, odds,
  data quality, etc.) — it never feeds back into λ, Poisson probabilities, or pick selection.
- `recommended.confidence` is untouched. It remains exactly what it always was: the model's pick
  probability (`maxConf` in `api/predict.js`), sourced from the Poisson/DC pipeline, calibration,
  and (optionally) the ML stacker.
- The engine is attached as a brand-new field, `confidenceEngine`, on each prediction row. Removing
  it entirely would not change any existing prediction, odds, or pick output.

## What it measures

`buildConfidenceEngine(ctx)` (in `server-utils/confidence/ConfidenceEngine.js`) returns:

```js
{
  overall: number,          // 0-100 rounded, weighted average of the 10 dimension scores
  scores: { attack, defense, form, standings, h2h, restDays, referee, injuries, oddsConsensus, teamStatistics },
  available: { /* same keys, boolean: did we have real data for this dimension? */ },
  weights: { /* effective (normalized) weights used for the overall average */ },
  explanation: string[]     // short human-readable line per dimension
}
```

Each dimension is scored 0-100, independently of which side the model favors:

| Dimension | Signal used | When unavailable |
| --- | --- | --- |
| Attack | Home GF-home + away GF-away vs league average | Neutral 50, `available:false` |
| Defense | Home GA-home + away GA-away vs league average (inverted — fewer conceded is better) | Neutral 50 |
| Form | `extractFormMultiplier`-style `[0.88, 1.12]` W/D/L momentum mapped to 0-100 | Neutral 50 |
| Standings | Points-per-game for both sides from the league table | Neutral 50 |
| H2H | Combined goal output across prior meetings vs league average | Neutral 50 (no fixtures on record) |
| Rest Days | Days since each side's last match; ~6-8 days is the sweet spot, `<3` or `>14` lowers the score | Neutral 50 (no last-match dates) |
| Referee | Real avg goals/cards stats when available; a **stable** (hash-based, not random) soft score from the name only when we don't have stats | Neutral 50 (no referee assigned) |
| Injuries | Reported absence counts — fewer injuries → higher score. Never triggers its own API call | Neutral 50 (no injury report) |
| Odds Consensus | Bookmaker count + Shin's `z` (lower `z` = less implied bias) | Neutral 50 (no market odds) |
| Team Statistics | Sample richness (matches played) + overall `modelMeta.dataQuality` | Neutral 50 (no `/teams/statistics` payload) |

When a dimension has no usable data, the engine **never invents fake precision** — it reports a
neutral ~50 and sets `available[dimension] = false` so the UI can visually dim it.

## Weights

Default weights live in `server-utils/confidence/confidenceWeights.js` (typed mirror:
`confidenceWeights.ts`) and are re-normalized to sum to 1.0 at runtime:

```js
{
  attack: 0.16, defense: 0.16, form: 0.12, standings: 0.12, h2h: 0.08,
  restDays: 0.06, referee: 0.05, injuries: 0.07, oddsConsensus: 0.10, teamStatistics: 0.08
}
```

Override any weight via environment variables (raw values; normalization happens automatically):

```
CONFIDENCE_WEIGHT_ATTACK
CONFIDENCE_WEIGHT_DEFENSE
CONFIDENCE_WEIGHT_FORM
CONFIDENCE_WEIGHT_STANDINGS
CONFIDENCE_WEIGHT_H2H
CONFIDENCE_WEIGHT_REST_DAYS
CONFIDENCE_WEIGHT_REFEREE
CONFIDENCE_WEIGHT_INJURIES
CONFIDENCE_WEIGHT_ODDS_CONSENSUS
CONFIDENCE_WEIGHT_TEAM_STATISTICS
```

## Wiring

`api/predict.js`:

1. Captures a read-only `confidenceCtx` snapshot (team stats, form, standings rows, league
   params, referee name, fixture date) at the same point the modular `PredictionEngine` context is
   built — into an outer `let confidenceCtx` so it survives the surrounding `if` blocks.
2. After the final probabilities/odds/data-quality are computed, calls
   `buildConfidenceEngine({ ...confidenceCtx, bookmakersUsed, shinZ, hasOdds, dataQuality, homePlayed, awayPlayed, modularScores })`.
3. Attaches the result as `confidenceEngine` on the prediction row — additive only, no existing
   field is renamed or removed.
4. `insufficientData` rows (missing team/standings data, or a per-fixture processing error) still
   get a `confidenceEngine` block, built from whatever minimal context exists (usually just the
   referee name) — every dimension reports `available:false` in that case.

`maskPredictionForTier` (`server-utils/accessTier.js`) is **not** modified: it only deletes
specific paid-analytics fields for Free/Premium tiers. `confidenceEngine` is meta/context
information (not a paid pick probability), so it passes through untouched for every tier.

## UI

- `src/components/ConfidenceEnginePanel.tsx` renders the "Overall Confidence" big number, a
  10-cell grid of dimension scores (dimmed + "n/a" when `available` is `false`), and a collapsible
  "De ce acest scor?" list of the `explanation` lines. Uses the existing `signal-*` design tokens
  and `font-mono` — no new color palette.
- `src/components/MatchModal.tsx` renders the panel in its own section (labelled "03 — Confidence
  Engine") whenever `match.confidenceEngine` exists.
- `src/components/MatchCard.tsx` shows a small `CTX NN%` chip next to the model-tier badge as a
  compact preview, when `row.confidenceEngine` exists.
