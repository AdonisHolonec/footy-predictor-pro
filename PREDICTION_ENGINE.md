# Modular Prediction Engine

This document describes the modular football prediction engine under `server-utils/prediction/`. The engine is an **additive layer** on top of the existing `server-utils/math.js` primitives. `api/predict.js` tries the modular engine first and falls back to `strengthRatingsLambdas` if it fails.

## Architecture

```
PredictionContext
       │
       ▼
┌──────────────────────────────────────────────────┐
│  Core modules (always run when team stats exist)   │
│  AttackStrength · DefenseStrength · FormEngine     │
│  HomeAdvantage                                     │
└──────────────────────────────────────────────────┘
       │
       ▼
  base λ_home, λ_away   (Dixon-Coles multiplicative, same as strength-ratings)
       │
       ▼
┌──────────────────────────────────────────────────┐
│  Optional modules (neutral 1.0 when data missing)│
│  Standings · H2H · Referee · RestDays · Recent   │
└──────────────────────────────────────────────────┘
       │
       ▼
  blended λ adjustment (modularBlend × weighted deltas)
       │
       ▼
┌──────────────────────────────────────────────────┐
│  Poisson module → 1X2, O/U, GG, correct score    │
│  (wraps math.computeMatchProbs)                  │
└──────────────────────────────────────────────────┘
```

### Runtime vs TypeScript source

| Role | Path |
|------|------|
| Typed source of truth | `*.ts` |
| Vercel / Node runtime imports | matching `*.js` (used by `api/predict.js`) |

## Module reference

Each module returns `{ score: number, detail?: object }`. Scores are typically centered around **1.0** for multiplicative use. Side-specific factors live in `detail.home` / `detail.away` where applicable.

### 1. AttackStrength

**Inputs:** `hStats.gfHome`, `aStats.gfAway`, league averages, shrinkage `k`.

**Formula:**

1. Raw attack rates: `gfHome` (home team at home), `gfAway` (away team away).
2. Bayesian shrinkage toward league split average (`math.applyBayesianShrinkage`):
   ```
   atk = (n × observed + k × prior) / (n + k)
   ```
3. Clamp each factor to `[0.25, 3.2]`.
4. Relative factors: `homeFactor = atkH / leagueAvg`, `awayFactor = atkA / leagueAvg`.

**Output detail:** `{ atkH, atkA, leagueAvg, homeFactor, awayFactor }`

### 2. DefenseStrength

**Inputs:** `hStats.gaHome`, `aStats.gaAway` (goals conceded in relevant split).

Same shrinkage and clamping as attack. Lower conceded → lower factor → lower opponent λ when used as `def_opp / leagueAvg`.

**Output detail:** `{ defH, defA, leagueAvg, homeFactor, awayFactor }`

### 3. FormEngine

**Inputs:** W/D/L form string or precomputed multipliers.

Delegates to `math.extractFormMultiplier`:

- Last 6 results, exponential decay (half-life ≈ 4 matches).
- Weighted points ratio mapped to `[0.88, 1.12]`.
- Empty/missing form → `1.0`.

**Output detail:** `{ home, away }`

### 4. HomeAdvantage

**Inputs:** `leagueParams.homeAdv` (default 1.06), `leagueParams.awayAdv` (default 0.96).

**Output detail:** `{ homeAdv, awayAdv }`

### 5. StandingsEngine

**Inputs:** `homeStandingsRow`, `awayStandingsRow` from API standings.

When **missing:** `{ home: 1.0, away: 1.0, available: false }`.

When present:

```
ptsRate = points / played
gdRate  = (GF - GA) / played
factor  = 1 + 0.05 × (ptsRate - 1.5) / 1.5 + 0.03 × (gdRate / leagueAvg)
```

Clamped to `[0.85, 1.15]` per side.

### 6. H2HEngine

**Inputs:** `h2hFixtures[]`, `homeTeamId`.

When **missing:** neutral 1.0.

When present: average goals per side (oriented to current home team), divided by `leagueAvg`, clamped `[0.85, 1.15]`.

### 7. RefereeEngine

**Inputs:** `refereeStats.avgGoals` (optional), `refereeName`.

When **missing:** neutral 1.0.

When present:

```
boost = avgGoals / (leagueAvg × 2)   // total goals per match
```

Clamped `[0.92, 1.08]`, applied equally to both sides (higher-scoring referee → higher λ).

### 8. RestDays

**Inputs:** `fixtureDate`, `homeLastMatchDate`, `awayLastMatchDate`.

When **missing:** neutral 1.0.

| Days since last match | Factor |
|----------------------|--------|
| < 3 (congested) | 0.94 |
| 3–7 | linear around 4 days ideal |
| > 7 (well rested) | 1.03 |

### 9. RecentMatches

**Inputs:** `homeRecentMatches[]`, `awayRecentMatches[]` (last 5, `{ goalsFor }`).

When **missing:** neutral 1.0.

```
atkTrend = avg(goalsFor) / leagueAvg
factor   = clamp(0.7 × atkTrend + 0.3, 0.88, 1.12)
```

### 10. Poisson

Wraps `math.computeMatchProbs(lambdaHome, lambdaAway, fixtureId, options)`.

Uses `poissonCorrelation` weight (default 0.12) and league `rho` for Dixon-Coles low-score correction.

**Returns:** full `probs`, `bestScore`, `bestScoreProb`, plus `detail` from Poisson model meta.

## Combining scores (PredictionEngine.build)

### Base λ (core modules)

Mirrors `strengthRatingsLambdas` with editable exponents:

```
λ_home = leagueAvgHome
       × (atkH / leagueAvg) ^ w_attack
       × (defA / leagueAvg) ^ w_defense
       × homeAdv ^ w_homeAdvantage
       × formHome ^ w_form

λ_away = leagueAvgAway
       × (atkA / leagueAvg) ^ w_attack
       × (defH / leagueAvg) ^ w_defense
       × awayAdv ^ w_homeAdvantage
       × formAway ^ w_form
```

Form is clamped to `[0.9, 1.1]` after optional `timeDecay` (same as math.js).

Final λ uses `math.clampLambda` → `[0.2, 4.5]`.

### Optional module blend

For each side:

```
adj = 1 + modularBlend × Σ (w_i × (factor_i - 1))
```

Only optional modules contribute: standings, h2h, referee, restDays, recentMatches.

```
λ_final = clampLambda(λ_base × adj)
```

With default weights and **all optional modules neutral (1.0)**, `adj = 1` and output matches `strengthRatingsLambdas` (when core weights are 1.0).

## Weight configuration

All weights live in `predictionWeights.ts` / `predictionWeights.js`. Defaults:

| Key | Default | Env override |
|-----|---------|--------------|
| `attack` | 1.0 | `PREDICT_WEIGHT_ATTACK` |
| `defense` | 1.0 | `PREDICT_WEIGHT_DEFENSE` |
| `form` | 1.0 | `PREDICT_WEIGHT_FORM` |
| `homeAdvantage` | 1.0 | `PREDICT_WEIGHT_HOME_ADVANTAGE` |
| `standings` | 0.15 | `PREDICT_WEIGHT_STANDINGS` |
| `h2h` | 0.10 | `PREDICT_WEIGHT_H2H` |
| `referee` | 0.05 | `PREDICT_WEIGHT_REFEREE` |
| `restDays` | 0.08 | `PREDICT_WEIGHT_REST_DAYS` |
| `recentMatches` | 0.12 | `PREDICT_WEIGHT_RECENT_MATCHES` |
| `poissonCorrelation` | 0.12 | `PREDICT_WEIGHT_POISSON_CORRELATION` |
| `modularBlend` | 0 (parity mode) | `PREDICT_WEIGHT_MODULAR_BLEND` |

Load at runtime via `getPredictionWeights()`.

## Integration in api/predict.js

Around the former `strengthRatingsLambdas` call (~line 767):

1. Build `PredictionContext` from team stats, form, league params, standings rows, referee name, fixture metadata.
2. Call `PredictionEngine.build(ctx)`.
3. On success → `method: "modular-engine"`, populate `strengthMeta`, expose `modelMeta.modularScores`.
4. On failure → fallback to `strengthRatingsLambdas` unchanged (`method: "standings-ratings"` path preserved separately).

**Response compatibility:**

- Existing fields (`probs`, `lambdaHome`/`lambdaAway` via Poisson path, `strengthMeta`, `method`) unchanged for UI.
- New optional field: `modelMeta.modularScores` — compact per-module `{ score, detail }` map for transparency.

## Compatibility notes

- **math.js is untouched** — `computeMatchProbs`, `strengthRatingsLambdas`, `extractFormMultiplier`, `applyBayesianShrinkage` remain the canonical implementations; tests in `tests/math.test.js` must keep passing.
- **No endpoints removed** — predict API shape is backward compatible.
- **Neutral optional modules** — when H2H, referee stats, rest days, or recent matches are not passed, factors are 1.0 so defaults do not shock predictions.
- **Standings in optional layer** — table position nudges λ only via `modularBlend × w_standings`. Default `modularBlend=0` keeps numeric parity with legacy `strength-ratings`; raise the env weight when you want optional modules live. The legacy standalone `standings` λ path in predict.js remains as fallback when team stats are unavailable.

## File index

```
server-utils/prediction/
├── types.ts
├── predictionWeights.ts / .js
├── AttackStrength.ts / .js
├── DefenseStrength.ts / .js
├── FormEngine.ts / .js
├── HomeAdvantage.ts / .js
├── Poisson.ts / .js
├── StandingsEngine.ts / .js
├── H2HEngine.ts / .js
├── RefereeEngine.ts / .js
├── RestDays.ts / .js
├── RecentMatches.ts / .js
├── PredictionEngine.ts / .js
└── _helpers.js
```

## Related: Confidence Engine (independent, additive)

`server-utils/confidence/` hosts a separate **Confidence Engine** that is fully independent from
everything described above — it never reads or writes λ, Poisson probabilities, pick selection, or
`recommended.confidence`. It only scores "how much reliable context did we have" per dimension
(attack, defense, form, standings, H2H, rest days, referee, injuries, odds consensus, team
statistics) and attaches the result as a new additive field, `confidenceEngine`, on each
prediction row. See [`CONFIDENCE_ENGINE.md`](./CONFIDENCE_ENGINE.md) for the full breakdown.
