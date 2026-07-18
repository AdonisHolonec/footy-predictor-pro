# Value Betting Engine

The Value Betting Engine turns **predicted probability** and **bookmaker decimal odds** into a
clear EV decision: Expected Value, Kelly stake %, Value Score, and Positive / Negative EV flags.

**Hard rule:** bets with negative EV are **never** recommended (`recommendable` is always `false`
when `negativeEV` is true or `expectedValue <= 0`).

## Location

| File | Role |
| --- | --- |
| `server-utils/value/ValueEngine.js` | Runtime engine (imported by `api/predict.js`) |
| `server-utils/value/ValueEngine.ts` | Typed mirror (kept in sync manually) |
| `server-utils/value/valueWeights.js` | Tunable thresholds / score weights |
| `src/components/ValueCard.tsx` | UI card (green / yellow / red) |

## Inputs

```js
evaluateValue(probability, odds, { confidencePct?, type? })
```

- `probability` — model probability as `0–1` or `0–100`
- `odds` — bookmaker decimal odds (e.g. `2.10`)
- `confidencePct` — optional; selects quarter-Kelly vs softer Kelly fraction

## Outputs

```js
{
  expectedValue,   // EV% = (p × odds − 1) × 100
  kellyPct,        // fractional Kelly % of bankroll (capped)
  valueScore,      // 0–100 composite score
  positiveEV,      // expectedValue > 0
  negativeEV,      // expectedValue < 0
  signal,          // "positive" | "neutral" | "negative"
  recommendable,   // true only for Positive EV above thresholds
  edge,            // p × odds
  fairOdds,        // 1 / p
  impliedProb,     // 1 / odds
  explanation      // short human-readable lines
}
```

`buildValueEngine(candidates)` evaluates 1X2 (or any) markets and returns the same fields plus:

- `detected` — a recommendable value bet was selected
- `markets` — per-selection evaluations
- `rejectedNegativeCount` — how many markets failed the negative-EV hard filter
- `rule: "never_recommend_negative_ev"`

## Signal → Value Card colors

| Signal | Condition | Card |
| --- | --- | --- |
| **positive** | `EV ≥ positiveEvPct` (default **1.25%**) | Green — Positive EV |
| **neutral** | `0 ≤ EV < positiveEvPct` | Yellow — Neutral |
| **negative** | `EV < 0` | Red — Negative EV |

Recommendation requires **Positive EV** plus edge / odds / Kelly guards. Neutral and Negative
selections are shown on the card for transparency but are never flagged as recommendable.

## Formulas

**Expected Value (%)**

\[
EV = (p \cdot odds - 1) \times 100
\]

**Kelly (fractional)**

\[
f^* = \frac{b \cdot p - q}{b},\quad b = odds - 1,\quad q = 1 - p
\]

Stake % = `f* × kellyFraction × 100`, capped at `kellyCapPct` (default 3%).

**Value Score (0–100)** — weighted blend of normalized EV, edge, Kelly, and confidence
(weights in `valueWeights.js`). Negative EV is clamped so the score stays in the red band.

## Integration (`api/predict.js`)

1. Build 1X2 candidates from blended model + market probabilities and consensus odds.
2. Run `buildValueEngine(candidates)` → attach `valueEngine` on each prediction row.
3. Legacy staking (`calculateEnsembleStake`, `evaluateNoBetZone`) still computes stake plan.
4. Final gate: a value bet is `detected` only if Value Engine `recommendable` **and** `EV > 0`
   **and** legacy no-bet zone allows it. Negative EV can never pass.

Backward-compatible `valueBet` remains on the row for stake plan / ensemble details.

## UI

- **MatchModal** — full `ValueCard` under odds (EV, Kelly %, Value Score, Positive/Neutral/Negative flags).
- **MatchCard** — compact EV chip colored by signal.

Negative EV cards always show: *“Negative EV — never recommend this bet.”*

## Tuning

Edit `server-utils/value/valueWeights.js`:

```js
{
  positiveEvPct: 1.25,
  minOdds: 1.3,
  minProbability: 0.2,
  minEdge: 1.1,
  kellyFraction: 0.25,
  kellyCapPct: 3,
  scoreWeights: { ev: 0.45, edge: 0.25, kelly: 0.2, confidence: 0.1 }
}
```

## Independence notes

- Does **not** change λ / Poisson probabilities or the model’s 1X2 pick.
- Does **not** override `recommended.confidence`.
- Only decides whether a market has Positive EV vs the book and whether it may be recommended.
