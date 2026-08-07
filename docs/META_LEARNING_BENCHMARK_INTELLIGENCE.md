# Meta Learning & Benchmark Intelligence — Technical Design (Phase X)

Status: **design only**. No implementation, no code changes. Nothing in this document
modifies PredictorV3, `server-utils/PredictionEngine/`, Stage00–Stage12, the
Recommendation Engine, ValueEngine, or the existing benchmark
(`server-utils/predictionBenchmark/*`, `server-utils/backtest/benchmark*.js`,
`prediction_benchmarks`, `api/backtest.js?view=benchmark-*`,
`src/components/admin/BenchmarkPanel.tsx`, the `mode=prediction-benchmark-sweep` cron).

Everything described here is a **separate, additive, read-only layer** that consumes
already-persisted rows. It never writes to `predictions_history`, never writes to
`prediction_benchmarks`, and is never read by the prediction path.

## Contents

- [§0 Executive summary — and the constraint that decides everything](#0-executive-summary--and-the-one-thing-that-decides-whether-this-is-worth-building)
- [Phase 1 — What already exists](#phase-1--what-already-exists)
- [Phase 2 — What is missing](#phase-2--what-is-missing) (gaps G1–G7)
- [Phase 3 — New data model](#phase-3--new-data-model)
- [Phase 4 — Meta Learning Engine architecture](#phase-4--meta-learning-engine-architecture)
- [Phase 5 — Scoring Engine](#phase-5--scoring-engine-automatic-discovery-of-p-is-better-in-context-x)
- [Phase 6 — Confidence calibration without touching the engine](#phase-6--confidence-calibration-without-touching-the-engine)
- [Phase 7 — Meta Recommendation Layer (dormant)](#phase-7--meta-recommendation-layer-design-only-dormant)
- [Phase 8 — Internal admin dashboard](#phase-8--internal-admin-dashboard)
- [Phase 9 — Roadmap (Sprints 1–5) + risk register](#phase-9--roadmap)
- [Appendix A — Architectural decisions and rationale](#appendix-a--architectural-decisions-and-rationale)
- [Appendix B — Constraint compliance checklist](#appendix-b--constraint-compliance-checklist)
- [Appendix C — Open questions for the product owner](#appendix-c--open-questions-for-the-product-owner)

---

## 0. Executive summary — and the one thing that decides whether this is worth building

The question this layer must answer is *"under which conditions is PredictorV3 better
than an external provider, and vice versa?"* That is a **paired statistical inference
problem over segments**, not a machine-learning problem. The architecture below is
deliberately statistics-only: contingency tables, McNemar's test, Wilson intervals,
empirical-Bayes shrinkage, isotonic calibration, Benjamini–Hochberg FDR control, and
CUSUM drift detection. No model training, no LLM, no black box — every verdict must be
explainable to a human as "n=…, edge=…, q=…".

**The binding constraint is not architecture, it is statistical power.** Three
structural facts, verified in this codebase, cap what any design can deliver:

1. **Comparability ceiling.** API-Football's `/predictions` only yields a comparable
   selection for `1x2`, goals `ou`, and (weakly, via free-text `advice`) `btts` / `dc`
   — see `classifyApiPredictionByFamily()` in
   `server-utils/predictionBenchmark/BenchmarkConsensus.js`. PredictorV3's authoritative
   family taxonomy (`DECLARED_FAMILY_ALIASES`, same file) covers eight declared families —
   `1x2`, `dc`, `btts`, `ou` (goals), `corners`, `cards`, `shots`, `correct_score` — plus
   the derived `ou_other` bucket for non-goals O/U lines. For the uncovered families
   **no external counterpart exists at all**,
   so "who is better at corners" is permanently unanswerable against this provider. Prior
   sweep measurement put the share of our predictions with a usable comparable API pick
   at roughly one in ten.
2. **Accrual rate.** The sweep is budgeted at `PREDICTION_BENCHMARK_SWEEP_BUDGET`
   (raised in Sprint 1 from 30 to **120 fetches/run**, one run/day at 11:45 UTC, over a
   window widened from 3 to **7 days**), and only *settled* pairs count for inference.
   Sprint 1 also fixed the budget itself: `.limit()` was applied to the candidate query
   *before* the already-benchmarked filter, so the budget capped rows **scanned** rather
   than fetches, and a window whose newest rows were already benchmarked produced zero
   fetches while older unbenchmarked rows stayed permanently unreachable. Raising the
   number without that fix would have changed nothing. A segment-level McNemar test needs
   roughly
   **≥25 discordant pairs** (`onlyOurCorrect + onlyApiCorrect`) before it says anything;
   discordance is typically 25–40% of pairs. Realistically that is **months of accrual
   per segment**, and the full cross-product of the requested dimensions
   (league × odds band × favouritism × confidence × family × season phase) is
   thousands of cells. Most will never fill.
3. **No live predictions exist.** `isPreKickoff()` in
   `server-utils/predictionsHistory.js` deliberately refuses to persist or overwrite a
   fixture at or after kickoff, to protect `raw_payload` from time-leakage. There is
   therefore **zero live-prediction data**, and "live vs pre-match" cannot be analysed
   until a separate live capture path exists. It is scoped out below rather than faked.

The design consequence is explicit and load-bearing: **the layer must be built to say
"insufficient data" loudly and by default.** A meta-learning layer that reports
"Ligue 2: PredictorV3 100% (n=3)" is worse than no layer, because it will drive real
staking decisions on noise. Multiplicity control, shrinkage, and minimum-support gating
are not polish — they are the feature.

---

## Phase 1 — What already exists

### 1.1 `predictions_history` (migrations 001, 003, 013, 030, 036)

One row per fixture, primary key `fixture_id`. Written by Stage10 persistence via
`mapPredictionToDbRow()`.

| Column | Meta-learning use |
|---|---|
| `fixture_id` (PK) | join key to every other table |
| `league_id`, `league_name` | **League dimension** |
| `home_team`, `away_team` | display; team-level segments (future) |
| `kickoff_at` | **Season-phase dimension**, time-window filtering, walk-forward folds |
| `recommended_pick`, `recommended_confidence` | our selection + **confidence bucket dimension** |
| `odds_home`, `odds_draw`, `odds_away`, `bookmaker` | **Odds-band, favouritism, home/away-favourite dimensions**; counterfactual pricing |
| `closing_odds_home/draw/away`, `closing_odds_captured_at` | **Odds-movement / CLV dimension — 1X2 only** |
| `match_status`, `score_home`, `score_away` | settlement |
| `validation` (`pending|win|loss`) | our realised outcome for the published pick |
| `value_bet_validation` | ValueEngine track outcome |
| `model_version` | **mandatory stratification key** (see §4.6) |
| `reason_codes`, `top_features` | explanatory context for *why* a segment behaves as it does |
| `luck_hg/hxg/ag/axg` | xG-luck context (secondary segment candidate) |
| `referee_name` | referee context (secondary) |
| `raw_payload` (jsonb) | the entire prediction object: `recommended.{pick,family,confidence,odd}`, `valueBet`, `valueEngine.{bestMarket,kellyPct,expectedValue}`, `evaluation.{modelProbs1x2Pct,calibratedProbs1x2Pct}`, `marketResults`, `auditLog`, `featureImportance`, card/corner/shot market blocks |

`raw_payload.recommended.family` is the **server-authoritative market family** and must
not be re-derived from the pick string — `BenchmarkConsensus.resolveOurFamily()`
already documents and relies on this.

### 1.2 `prediction_benchmarks` (migration 039)

One row per `(fixture_id, model_version, schema_version)`. Written only by
`runBenchmarkSweep()`. RLS `using (false)` → service-role only.

Carries: `our_pick`, `our_family`, `our_confidence`, `our_odd`, `api_prediction` (the
normalized `afb-v1` payload), `api_raw` (untouched upstream response), `consensus`
(the full `BenchmarkConsensusResult`), `agree`, `confidence_delta`, `score_home/away`,
`our_result`, `api_result`, `kickoff_at`, `league_id`, `fetched_at`, `settled_at`.

Inside `consensus` (per `BenchmarkConsensus.js`): `ourPick.{pick,family,confidence}`,
`apiPick.{inferredPick,family,confidencePct,source}`, `familyComparable`, `agree`,
`confidenceDelta`, `recommendationDelta.{sameSide,ourSide,apiSide}`,
`perFamilyBreakdown.{1x2,ou,btts,dc}` each with `{agree, ourSide, apiSide, lineMismatch}`.
`apiPick.source` ∈ `winner | percent | under_over | advice` — a **provenance/quality
flag** the meta layer must use, because `advice`-derived signals are explicitly
documented as low-confidence and grammar-unstable.

Inside `api_prediction`: `winPercent.{home,draw,away}` (the only thing resembling a
provider confidence), `winner`, `winOrDraw`, `advice`, `goalsPrediction`, `underOver`,
`comparison.{form,att,def,poisson_distribution,h2h,goals,total}` (each home/away),
`teamsForm.{home,away}.{form,att,def,goals}`, `h2h[]`.

### 1.3 Reusable computation already in the repo — do not reimplement

| Module | What it already gives the meta layer |
|---|---|
| `server-utils/backtest/BacktestAnalytics.js` | `computeBacktestMetrics()`: hit rate, ROI, **yield**, profit/loss, avg odds/confidence, **expected value**, **maxDrawdown**, streaks, equity curve, `byMarket/byLeague/bySide`. `computeQuantMetrics()`: **LogLoss, Brier, Kelly growth %, Kelly final bankroll, Kelly max drawdown, geometric-mean growth, Sharpe (raw + annualized), CLV, CLV beat rate**, returns histogram. Also `confidenceDistribution()`, `leagueMarketHeatmap()`, `parseFilters()`, `filterBetEvents()`, `seasonStartIso()`. **Every ROI/Yield/EV/Kelly/Drawdown metric requested in the prompt already exists here.** |
| `server-utils/backtest/benchmarkMetrics.js` | `computeAgreementRate()` (incl. by market family), `computeHeadToHead()` (the **2×2 contingency table** — `bothCorrect`, `bothWrong`, `onlyOurCorrect`, `onlyApiCorrect`), `computeOurPerformance()` |
| `server-utils/backtest/benchmarkEvents.js` | `extractBenchmarkEvent()` row→event flattening, `toOurBetEvent()` bridge to the metrics engine |
| `server-utils/isotonicCalibration.js` + `calibration_maps` (mig. 014) | **isotonic PAV fit + piecewise-linear inference** — exactly the machinery Phase 6 needs, already written and already stored per `(league_id, model_version, outcome)` with `brier_raw`/`brier_calibrated` |
| `auto_calibration_overlays` + `calibration_runs` (mig. 024), `server-utils/calibration/overlayRuntime.js`, `overlayStore.js`, `manualLocks.js` | the **precedent pattern** for "fit an overlay, store it, apply it at runtime only for non-locked keys" — Phase 6 mirrors this shape but leaves the runtime application dormant |
| `league_profile_overlays` (mig. 035) + `computeLeagueProfileRecalibration.js` | precedent for per-league fitted overlays clamped against a static config |
| `model_performance_snapshots` (mig. 014) | daily Brier / LogLoss / **ECE** / hit rate per `(model_version, league_id, window_days)` — the drift-detection substrate |
| `server-utils/leagueProfiles/leagueProfiles.config.json` | per-league priors keyed by league id (`39` Premier League, `140` La Liga, `135` Serie A, `78` Bundesliga, `61` Ligue 1, `283` Romania SuperLiga, …) with `blendWeight`, `confidenceMultiplier`, `stakeCap` — a usable, if implicit, **league-quality signal** |
| `server-utils/predictionsHistory.js` | `evaluateTopPick()`, `isFinalStatus()`, `isGradeablePick()` — the single settlement authority. The meta layer must **never** re-implement grading. |
| `api/backtest.js` `view=` dispatch, `api/cron/daily-ml.js` `mode=` dispatch | the two extension seams (see §3.6 — Vercel Hobby function-count limit makes new API files a non-starter) |

### 1.4 Already answerable today, with zero new data

League · odds band · favourite/outsider · home-vs-away favourite · confidence bucket ·
market family · season phase · agreement-vs-disagreement hit rate · confidence
disagreement · our ROI/Yield/EV/Kelly/Drawdown.

All of it is derivable from `predictions_history` ⋈ `prediction_benchmarks` on
`fixture_id`. **No new upstream API calls are required for any of it.**

---

## Phase 2 — What is missing

### 2.1 Hard gaps (block a requested analysis outright)

| # | Gap | Why it blocks | Resolution |
|---|---|---|---|
| G1 | **No provider odds** — API-Football `/predictions` publishes no price (documented in `benchmarkEvents.js` and the research doc) | ROI / Yield / Kelly / EV cannot be computed for the provider side; head-to-head is win-rate-only | **Counterfactual pricing** (§4.4): price the provider's selection at *our own recorded* market odds for the same fixture. Legitimate, not fabricated, and must be labelled with `priced_from`. |
| G2 | **No live predictions** (`isPreKickoff` guard) | "Live vs pre-match" is unanswerable | **Scoped out.** Requires a separate live capture path; do not fake it. Documented as a future dependency. |
| G3 | **Closing odds are 1X2-only** (mig. 030) | "Does PredictorV3 win more when the market moves?" is restricted to 1X2 selections | Accept the restriction; label the dimension `odds_movement_scope = 1x2_only` and report coverage %. |
| G4 | **No provider counterpart for corners / cards / shots / correct_score / non-goals O/U** | those families are structurally uncomparable against API-Football | Report them in a `no_external_counterpart` bucket. This is the strongest argument for the multi-provider schema in Phase 3. |
| G5 | **No league-quality tier taxonomy** | "Top 5 / Top 10 / rest" has no data source | New **additive** config `leagueTiers.config.json` (§3.5). `leagueProfiles.config.json` must not be touched. |
| G6 | **Season phase is calendar-naive.** `seasonStartIso()` hardcodes Aug 1 | wrong for Brazil / MLS / Nordic calendar-year seasons — exactly the leagues the prompt names as suspected API-Football strongholds | put `seasonStartMonth` per league in the same new tier config; fall back to Aug 1 |
| G7 | **No team ids on either table** | `resolveFixtureTeams()` re-fetches `/fixtures` on every sweep just to get them | Persist `home_team_id`/`away_team_id` in the **new** meta context table during ETL (from `api_raw`, which already contains them) — no new upstream call, and no change to existing tables |

### 2.2 Soft gaps (data exists but is unusable as-is)

- **`agree` is null far more often than it is false.** `familyComparable` is false whenever
  our family has no API counterpart *or* the O/U line differs (`lineMismatch`). Every
  aggregate must therefore distinguish three states — `agree=true`, `agree=false`,
  `not comparable` — and never let "not comparable" silently inflate a denominator.
  `computeAgreementRate()` already filters correctly; the meta layer must preserve that
  discipline and additionally *report* the non-comparable share as a first-class number.
- **Provider confidence is only available for 1X2.** `apiPick.confidencePct` is populated
  from `winPercent` for `source ∈ {winner, percent}` and is `null` for `under_over` and
  `advice`. So `confidence_delta` and any provider calibration curve are **1X2-only**.
- **`winPercent` is not a calibrated probability.** It is an undocumented internal score
  that sums to ~100. Treating it as a probability for Brier/LogLoss is defensible *only*
  after fitting a provider-specific calibration map (Phase 6) — before that it is an
  ordinal score, and must be labelled as such.
- **`33/33/33` is a "no data" sentinel**, not a lean — already handled in `classify1x2()`.
  The meta layer must count these as *provider abstentions* and report abstention rate as
  a provider quality metric in its own right.
- **`source = advice` signals are second-class.** They must carry a quality weight and be
  excludable from verdicts with one filter.
- **No stored `model_version` on the context**: `prediction_benchmarks.model_version`
  exists, but pooling across PredictorV3 versions silently compares different models.
  Stratification is mandatory (§4.6).
- **Settlement asymmetry.** `runBenchmarkSweep()` copies `our_result` from
  `predictions_history.validation` (which routes through `resolveRecommendedValidation()`
  and therefore handles card/corner markets) but grades `api_result` with
  `evaluateTopPick()` directly. For the comparable families (1x2/dc/btts/goals-ou) the two
  agree; the meta layer must assert that rather than assume it, and drop any pair where the
  two settlement paths disagree.

### 2.3 Not missing — already available, contrary to expectation

Favourite/outsider, odds bands, home/away favourite, confidence buckets, season phase
(modulo G6), agreement analysis, confidence disagreement, and the entire ROI/Yield/EV/
Kelly/Drawdown suite. **No new capture is needed for the majority of the prompt.**

---

## Phase 3 — New data model

### 3.1 Design principle: change the grain, not the existing tables

`prediction_benchmarks` is **pairwise and fixture-grained**: one row = one fixture =
"our pick vs *the* API pick". That shape cannot express three providers, and it cannot
express "provider P had an opinion on BTTS while our published pick was a corners bet"
— information that already sits unused in `consensus.perFamilyBreakdown`.

The meta layer therefore introduces a **selection-grained star schema**:

> one row per **(provider, fixture, market family, selection)**

PredictorV3 is registered as *just another provider*. Head-to-head then becomes a
self-join over providers instead of a hardcoded "us vs them", and adding Forebet /
BetMines / Opta is an INSERT into a registry plus one normalizer — **no schema change,
no rewrite of the scoring engine, no change to the dashboard**.

`prediction_benchmarks` keeps working untouched. The new layer *reads* it (and
`predictions_history`) and projects both into the new grain. All new tables are
service-role only (`enable row level security` + `using (false)`), matching migrations
024/035/037/039.

### 3.2 Tables

**`meta_providers`** — provider registry (dimension)
```
id serial pk
key text unique                 -- 'predictor_v3' | 'api_football' | 'forebet' | 'opta'
display_name text
kind text                       -- 'internal' | 'external'
supports_odds boolean           -- false for api_football (G1)
supports_confidence boolean
covered_families text[]         -- ['1x2','ou','btts','dc'] for api_football
schema_version text             -- 'afb-v1' etc.
active boolean, created_at
```
Seeded with `predictor_v3` and `api_football`. Adding a provider is a row, not a migration.

**`meta_fixture_context`** — the materialized context vector (dimension, one row per fixture × model_version)
```
fixture_id bigint, model_version text, context_version text default 'ctx-v1'   -- unique together
league_id int, league_name text, league_tier smallint, league_quality text
home_team_id int, away_team_id int                                             -- closes G7
kickoff_at timestamptz, season_phase text, days_since_season_start int
odds_home/draw/away numeric, closing_odds_home/draw/away numeric
favourite_side text            -- 'home'|'away'|'none'
favourite_implied_prob numeric
favouritism_class text         -- 'clear_favourite'|'moderate_favourite'|'balanced'|'outsider_led'
odds_band text                 -- '<1.25'|'1.25-1.50'|'1.50-1.80'|'1.80-2.20'|'2.20+'
market_move_pct numeric, market_move_class text   -- 'toward'|'against'|'flat'|'unknown' (1x2 only, G3)
match_status text, score_home int, score_away int, settled boolean
computed_at timestamptz
```
Pure projection of existing columns — **no upstream calls**. Recomputable from scratch at
any time; `context_version` lets bucket definitions evolve without destroying history.

**`meta_provider_selections`** — the fact table (one row per provider opinion)
```
id bigserial pk
fixture_id bigint, provider_id int, model_version text
market_family text              -- '1x2'|'dc'|'btts'|'ou'|'ou_other'|'corners'|'cards'|'shots'|'correct_score'
selection text                  -- '1'|'X'|'2'|'1X'|'GG'|'Over 2.5'|...
line numeric                    -- null outside O/U-style markets
is_primary boolean              -- the provider's headline pick vs a secondary family opinion
stated_confidence numeric       -- our confidence % | winPercent | null
signal_source text              -- 'stage08'|'winner'|'percent'|'under_over'|'advice'
signal_quality smallint         -- 1=structural, 2=derived, 3=free-text(advice)
priced_odd numeric              -- see §4.4
priced_from text                -- 'own_quote'|'our_recorded_1x2'|'our_value_quote'|'unpriced'
closing_odd numeric, clv_pct numeric
result text                     -- 'pending'|'win'|'loss'|'ungradeable'
pnl_units numeric
settled_at timestamptz, source_row jsonb, created_at
unique (fixture_id, provider_id, model_version, market_family, selection, line)
```
This is the table that makes multi-provider scale. `is_primary=false` rows unlock the
`perFamilyBreakdown` data that is currently written but never analysed.

**`meta_segment_performance`** — aggregate rollup (materialized, refreshed nightly)
```
id bigserial pk
provider_id int, model_version text
segment_kind text               -- 'league'|'odds_band'|'favouritism'|'confidence_bucket'
                                -- |'market_family'|'league_tier'|'season_phase'|'market_move'
                                -- |'agreement'|'composite'
segment_key text                -- '39' | '1.80-2.20' | 'clear_favourite' | 'tier1&1.50-1.80'
market_family text, window_days int, window_end date
n int, wins int, losses int
hit_rate numeric, hit_rate_shrunk numeric, wilson_low numeric, wilson_high numeric
roi numeric, yield_pct numeric, expected_value numeric
kelly_growth_pct numeric, max_drawdown numeric, sharpe numeric
brier numeric, log_loss numeric, ece numeric
priced_coverage_pct numeric     -- honesty: what share of n had a usable price
metrics_json jsonb, computed_at
unique (provider_id, model_version, segment_kind, segment_key, market_family, window_days, window_end)
```

**`meta_pairwise_verdicts`** — the scoring engine's output (Phase 5)
```
id bigserial pk
provider_a_id int, provider_b_id int, model_version text
segment_kind text, segment_key text, market_family text, window_days int, window_end date
n_paired int, both_correct int, both_wrong int, only_a_correct int, only_b_correct int
discordant_n int                            -- only_a + only_b: the real sample size
hit_rate_delta numeric, roi_delta numeric
mcnemar_statistic numeric, p_value numeric, q_value numeric   -- q = BH-adjusted
effect_size numeric                          -- shrunk, signed
dominance_score numeric                      -- §5.2
verdict text  -- 'a_dominant'|'a_leaning'|'inconclusive'|'b_leaning'|'b_dominant'|'insufficient_data'
fold_scheme text                             -- 'walk_forward_oos' | 'in_sample'
evidence_json jsonb, computed_at
```

**`meta_calibration_bins`** — reliability data (Phase 6)
```
id bigserial pk
provider_id int, model_version text, market_family text, league_tier smallint
bin_low numeric, bin_high numeric
n int, stated_mean numeric, realised_rate numeric
wilson_low numeric, wilson_high numeric
window_days int, window_end date, computed_at
```

**`meta_confidence_calibration`** — the fitted (and **dormant**) overlay (Phase 6)
```
id bigserial pk
provider_id int, model_version text, market_family text, scope text default 'global'
method text                     -- 'isotonic_pav'|'platt'|'linear_shift'
x_points numeric[], y_points numeric[]        -- same shape as calibration_maps (mig. 014)
overconfidence_slope numeric, overconfidence_intercept numeric
ece_before numeric, ece_after numeric, brier_before numeric, brier_after numeric
sample_size int
active boolean default true
applied_at_runtime boolean not null default false   -- HARD OFF. Never true in Phase X.
fitted_at, created_at
unique (provider_id, model_version, market_family, scope) where active
```

**`meta_drift_events`** — drift detection log (Phase 8)
```
id bigserial pk
provider_id int, model_version text, segment_kind text, segment_key text
metric text                     -- 'hit_rate'|'roi'|'ece'|'agreement_rate'|'context_psi'
detector text                   -- 'cusum'|'page_hinkley'|'psi'|'wilson_disjoint'
baseline_value numeric, current_value numeric, statistic numeric, threshold numeric
severity text                   -- 'info'|'warn'|'critical'
detected_at, window_days, evidence_json
```

**`meta_learning_runs`** — run journal, mirroring `calibration_runs` (mig. 024)
```
id bigserial pk
mode text, started_at, finished_at, ok boolean
config_json jsonb, summary_json jsonb, error text, created_at
```

### 3.3 Indexes

Unique keys as declared above; plus `(kickoff_at desc)` on `meta_fixture_context`;
`(provider_id, market_family, result)` and `(fixture_id)` on `meta_provider_selections`;
`(segment_kind, segment_key, window_end desc)` on `meta_segment_performance`;
`(verdict, q_value)` and `(segment_kind, segment_key)` on `meta_pairwise_verdicts`;
`(detected_at desc, severity)` on `meta_drift_events`.

### 3.4 Bucket definitions (versioned in `context_version`)

- **odds band** (on the priced odd of the selection): `<1.25`, `1.25–1.50`, `1.50–1.80`,
  `1.80–2.20`, `2.20+` — half-open intervals `[low, high)`.
- **confidence bucket**: `<50`, `50–55`, `55–60`, `60–65`, `65–70`, `70+`.
- **favouritism** (from `1/odds` normalised across the 1X2 triple, vig removed):
  `clear_favourite` p_fav ≥ 0.60 · `moderate_favourite` 0.45 ≤ p < 0.60 ·
  `balanced` p < 0.45 with |p_home − p_away| < 0.08 · else `outsider_led`.
  Plus the sharper axis: **was our selection the market favourite or not** — that, more
  than the match shape, is where model-vs-market edge lives.
- **season phase** (days since that league's season start, per G6):
  `early` ≤ 60 · `mid` 61–210 · `late` > 210.
- **market move** (1X2 only): `(closing − opening) / opening` on the selected side;
  `toward` ≤ −2% (price shortened, market agreed with us), `against` ≥ +2%, else `flat`;
  `unknown` when `closing_odds_captured_at is null`.
- **league tier**: from the new config below.

### 3.5 `leagueTiers.config.json` (new, additive)

```json
{
  "version": "lt-v1",
  "tiers": { "1": "Top 5", "2": "Top 10", "3": "Rest" },
  "leagues": {
    "39":  { "tier": 1, "seasonStartMonth": 8 },
    "140": { "tier": 1, "seasonStartMonth": 8 },
    "135": { "tier": 1, "seasonStartMonth": 8 },
    "78":  { "tier": 1, "seasonStartMonth": 8 },
    "61":  { "tier": 1, "seasonStartMonth": 8 },
    "283": { "tier": 3, "seasonStartMonth": 7 },
    "71":  { "tier": 3, "seasonStartMonth": 1 },
    "253": { "tier": 3, "seasonStartMonth": 2 }
  },
  "default": { "tier": 3, "seasonStartMonth": 8 }
}
```
Overridable via `META_LEAGUE_TIERS_JSON` / `_PATH`, exactly like
`LEAGUE_PROFILES_JSON`/`_PATH`. **`leagueProfiles.config.json` is not touched.**

Ids `39`/`140`/`135`/`78`/`61`/`283` are confirmed present in `leagueProfiles.config.json`.
`71` (Brazil) and `253` (MLS) are illustrative of the calendar-year case behind G6 and
**[VERIFY]** against the live league list before seeding — they are the two examples whose
`seasonStartMonth` actually matters. Tier assignment itself is an editorial call
(Appendix C.4), not a technical one.

### 3.6 Where the code lives — and why not new API files

```
server-utils/metaLearning/
  MetaContextBuilder.js        # predictions_history -> meta_fixture_context
  MetaSelectionProjector.js    # predictions_history + prediction_benchmarks -> meta_provider_selections
  providers/
    predictorV3Provider.js     # reads OUR rows; no PredictorV3 import
    apiFootballProvider.js     # reads prediction_benchmarks.consensus/api_prediction
  MetaSegmentEngine.js         # segment enumeration + rollup (reuses BacktestAnalytics)
  MetaStatistics.js            # Wilson, McNemar, BH-FDR, empirical-Bayes shrinkage
  MetaSegmentDiscovery.js      # greedy recursive partitioning (Phase 5)
  MetaScoringEngine.js         # dominance score + verdict assignment
  MetaCalibrationEngine.js     # reuses isotonicCalibration.js
  MetaDriftDetector.js         # CUSUM / Page-Hinkley / PSI
  MetaRecommendationLayer.js   # pure decision function, DORMANT (Phase 7)
  metaLearningConfig.js        # thresholds, buckets, weights — no magic numbers elsewhere
  leagueTiers.config.json
```

**Extension seams (both mandated by existing constraints):**
- API: add `view=meta-*` cases to the existing `api/backtest.js` dispatch. New API files
  are ruled out — this repo already consolidated endpoints to stay under the Vercel Hobby
  serverless-function count limit; `api/predictionBenchmark.js` was folded into
  `api/backtest.js` for exactly that reason, as that file's own section header records.
  Reuse the existing `isAuthorizedForMetrics()` gate and add every new view to `gatedViews`.
- Cron: add `mode=meta-learning-refresh` to `api/cron/daily-ml.js`, scheduled **after**
  the 11:45 UTC benchmark sweep (proposed 04:15 UTC, after the 03:00 snapshot and 03:35
  model-selection jobs). One new `crons` entry in `vercel.json`, no new function.

The layer imports **only** `BacktestAnalytics.js`, `benchmarkMetrics.js`,
`benchmarkEvents.js`, `isotonicCalibration.js`, `predictionsHistory.js` (settlement
helpers), `TipEvent.js` (`tipMarketFamily`, for legacy rows with no declared family),
`supabaseAdmin.js`, and `modelConstants.js`. It must import **nothing** from
`server-utils/PredictionEngine/`, `pipeline/`, `confidence/`, `value/`, or `context/`.

This is enforced, not documented: `tests/metaLearning/importBoundary.test.js` walks every
module in the layer and fails the build both on a forbidden import and on any repo import
outside that allowlist — so widening the dependency surface is a deliberate, reviewable
edit to the allowlist rather than an accident.

**Write strategy.** The derived tables are rewritten per refresh window
(delete-then-insert, scoped to `model_version` + window) rather than upserted. Two
reasons: the unique index on `meta_provider_selections` uses `coalesce(line, -1)` (an
expression index cannot be a PostgREST `on_conflict` target), and a full rewrite is what
makes "idempotent, no incremental state that can rot" literally true. At these table
sizes the rewrite is cheap.

---

## Phase 4 — Meta Learning Engine architecture

### 4.1 Pipeline

```
[read-only]                     [derive]                    [aggregate]           [infer]
predictions_history  ─┐
                      ├─> MetaContextBuilder ────> meta_fixture_context ─┐
prediction_benchmarks ─┘                                                 │
                      └─> MetaSelectionProjector ─> meta_provider_selections
                                                                          │
                                              MetaSegmentEngine ──────────┴─> meta_segment_performance
                                                     │
                                              MetaSegmentDiscovery ──> candidate composite segments
                                                     │
                                              MetaScoringEngine ─────> meta_pairwise_verdicts
                                              MetaCalibrationEngine ─> meta_calibration_bins
                                                                       meta_confidence_calibration
                                              MetaDriftDetector ─────> meta_drift_events
```

Every stage is a pure function of its inputs plus a Supabase read; every stage is
idempotent and fully recomputable. There is no incremental state that can silently rot —
a nightly full rebuild over a bounded window (default 365 days) is cheap because the
tables are small (thousands of rows, not millions).

### 4.2 Paired inference is the core primitive

Both providers predict the **same fixtures**. That makes this a paired design, and paired
designs must not be analysed with two independent proportions — doing so throws away the
pairing and inflates variance badly at these sample sizes.

The correct primitive is the 2×2 discordance table that `computeHeadToHead()` already
produces:

```
                     B correct   B wrong
        A correct        a           b        b = only_a_correct
        A wrong          c           d        c = only_b_correct
```

**McNemar's test** on `b` vs `c`:
- χ² (with continuity correction) `= (|b − c| − 1)² / (b + c)` when `b + c ≥ 25`
- **exact binomial** `Binom(b; b+c, 0.5)` two-sided when `b + c < 25`

`a` and `d` carry no information about which provider is better — which is why
`discordant_n = b + c` is stored as the *real* sample size, and why the dashboard must
display it more prominently than `n_paired`. A 500-fixture window with 12 discordant
pairs is a 12-sample study.

### 4.3 Shrinkage — the antidote to "Ligue 2 100% (n=3)"

Empirical-Bayes Beta-Binomial shrinkage of each segment's hit rate toward the pooled rate:

```
p̂_shrunk = (wins + k·p_global) / (n + k)
```

`k` is fitted from the between-segment variance of the observed rates (method of moments),
floored at `k ≥ 10`. Effect sizes and the dominance score always use `p̂_shrunk`; the raw
rate is stored alongside for transparency, and both are shown in the UI. Interval
estimates use **Wilson score** intervals, never normal-approximation intervals — at n<30
the normal approximation produces bounds outside [0,1].

### 4.4 Counterfactual pricing — how the provider side gets a ROI (closes G1)

API-Football publishes no odds, and the existing code correctly refuses to invent one.
But we already stored the market price for the same fixture. So:

> For each provider selection, attach the price **we recorded** for that same selection
> on that same fixture, and label its provenance.

| `priced_from` | Source | Coverage |
|---|---|---|
| `own_quote` | our own `raw_payload.recommended.odd` / `valueEngine` quote | PredictorV3 only |
| `our_recorded_1x2` | `predictions_history.odds_home/draw/away` matched to the provider's 1X2 selection | ~all fixtures, 1X2 selections only |
| `our_value_quote` | `raw_payload.valueEngine.bestMarket.odds` when the market matches | partial |
| `unpriced` | no price for that market | O/U, BTTS, DC in most rows |

This is a **counterfactual, not a fabrication**: "if we had staked 1u on API-Football's
pick at the price our bookmaker feed showed at prediction time, the P&L would have been
X." It is the only apples-to-apples ROI comparison available, and it must always be
reported with `priced_coverage_pct` next to it. Every ROI/Yield/Kelly/Drawdown figure then
comes from the *existing* `computeBacktestMetrics()` / `computeQuantMetrics()` by mapping
selections onto the flat bet-event shape — the same trick `toOurBetEvent()` already uses.
No new financial math is written.

Two honesty rules: (a) a segment whose `priced_coverage_pct < 60%` may not display a ROI
verdict, only a hit-rate verdict; (b) the price is our *opening* price, so this ROI is a
"could we have beaten the opening line" question, not "could we have beaten the closing
line" — that second question is what `clv_pct` answers.

### 4.5 Multiplicity control — the single most important safeguard

Testing 6 dimensions × ~5 buckets × 4 comparable families ≈ **120 primary hypotheses**,
before composite segments. At α = 0.05 that is ~6 false "dominances" from pure noise, and
those false positives are exactly the exciting-looking ones (small n, extreme rates).

Mandatory controls, in order:
1. **Minimum support gate** before any test: `discordant_n ≥ 25` for a verdict of
   `dominant`; `≥ 12` for `leaning`; below that the verdict is hard-set to
   `insufficient_data` and no p-value is computed or displayed.
2. **Benjamini–Hochberg FDR** across the whole family of tests in a run; store both
   `p_value` and `q_value`. Verdicts key off `q`, never `p`.
3. **Pre-registered dimension list.** The one-dimensional slices in §3.4 are fixed in
   `metaLearningConfig.js`. Discovered composite segments (§5.1) are tested in a *separate*
   family with its own BH correction and a stricter `q` threshold.
4. **Walk-forward out-of-sample validation.** Fit segment discovery on data up to time T,
   evaluate the verdict on `(T, T+Δ]`, roll forward. `fold_scheme` records which regime a
   verdict came from; only `walk_forward_oos` verdicts may ever be labelled `dominant`.
   The repo already has a walk-forward precedent (`view=walk-forward-tip`).

### 4.6 Stratification invariants

- **Never pool across `model_version`.** PredictorV3 changed; a pooled comparison is a
  comparison of a moving target. Every verdict is scoped to a `model_version`, with an
  explicit opt-in `pooled` pseudo-version that is flagged in the UI.
- **Never pool across `signal_quality`** without a flag: `advice`-derived provider
  selections are excluded from `dominant` verdicts by default.
- **Never let `agree = null` enter a denominator.** Three-state accounting throughout.
- **Drop pairs where the two settlement paths disagree** (§2.2) rather than picking one.

### 4.7 What is deliberately *not* in the engine

No gradient boosting, no neural net, no LLM, no clustering, no embedding. Not because
they cannot help in principle, but because at `discordant_n` in the tens, any learner will
fit noise, and — decisively — its output cannot be defended to a human who is about to
risk money on it. Every number this engine emits must be reconstructible with a
calculator. `ml_training_examples` / `ml_model_registry` (mig. 022) remain the home for
genuine ML, unaffected by this layer.

---

## Phase 5 — Scoring Engine: automatic discovery of "P is better in context X"

### 5.1 Segment discovery — greedy recursive partitioning on the *paired difference*

Enumerating the full cross-product is both computationally silly and statistically
suicidal. Instead, discovery works on the paired signed outcome per fixture:

```
d_i = ourWon_i − providerWon_i   ∈ {−1, 0, +1}
```

`d_i = 0` are concordant pairs (uninformative); the informative signal is the mean of
`d_i` over the discordant subset.

A plain CART-style greedy split, no ML library:
1. Root = all paired settled fixtures for one `(provider, model_version, market_family)`.
2. For every candidate dimension and every candidate cut, compute the split gain as the
   **weighted reduction in variance of `d`**, penalised by a minimum-support constraint
   (`discordant_n ≥ 25` in *both* children).
3. Take the best split if the gain exceeds a configured threshold; recurse.
4. Depth cap **2** (i.e. at most two conditions per rule, e.g. `tier1 AND odds 1.50–1.80`).
   Depth 3+ is unfittable at this sample size and is refused by config, not by discipline.
5. Every leaf becomes a candidate composite segment, written to `meta_segment_performance`
   with `segment_kind='composite'`, then tested and BH-corrected as its own family (§4.5).

Note the deliberate asymmetry: discovery demands `discordant_n ≥ 25` per child, while §5.3
will report a `leaning` verdict from 12. That is intentional — *searching* for a split is
far more prone to fitting noise than *reporting* a pre-registered slice, so the search
threshold is stricter than the reporting threshold, not the same number reused.

This is what makes the discovery *automatic*: nobody has to guess that "PredictorV3 wins
in tier-1 leagues at short odds" — the split search finds it, and the significance
machinery decides whether to believe it.

### 5.2 Dominance score

For each `(provider_a, provider_b, segment, market_family, window)`:

```
DS = w_hit · z(Δp̂_shrunk)
   + w_roi · z(Δroi)            · [priced_coverage ≥ 60%]
   + w_cal · z(−Δece)
   + w_prob· z(−Δlog_loss)      · [both providers have calibrated probabilities]
   + w_stab· z(−Δmax_drawdown)
```

Default weights `w_hit 0.40 · w_roi 0.25 · w_cal 0.15 · w_prob 0.10 · w_stab 0.10`, all in
`metaLearningConfig.js`, all overridable, all recorded in `evidence_json` so a historical
verdict stays interpretable after a weight change. `z(·)` normalises against the
distribution of that delta across segments in the same run.

`DS` is a **ranking device only**. It never decides a verdict on its own.

### 5.3 Verdict assignment — gates first, score second

```
if discordant_n < 12                         -> 'insufficient_data'
elif q_value >= 0.20                         -> 'inconclusive'
elif discordant_n >= 25 and q_value < 0.05
     and |Δp̂_shrunk| >= 4pp
     and fold_scheme == 'walk_forward_oos'   -> 'a_dominant' | 'b_dominant'   (sign of DS)
else                                         -> 'a_leaning'  | 'b_leaning'
```

Non-negotiable reporting rules:
- `insufficient_data` is a **first-class, prominently displayed** verdict, not an empty cell.
- Absence of evidence is never rendered as parity.
- Every verdict card shows `discordant_n`, `q_value`, the Wilson interval, and
  `priced_coverage_pct`. A verdict without its uncertainty is a lie by omission.
- A verdict that flips sign between consecutive windows is auto-downgraded to
  `inconclusive` and raises a `meta_drift_events` row — sign instability is the classic
  signature of a fitted artefact.

### 5.4 The agreement / disagreement analysis (explicitly requested)

Three cohorts, reported side by side with their own hit rate, ROI, and Wilson interval:

| Cohort | Expected reading |
|---|---|
| `agree = true` | both providers on the same side — the "easy" fixtures. Hit rate here is a **difficulty baseline**, not a skill measure. |
| `agree = false` | the only cohort where skill is measurable. `onlyOurCorrect` vs `onlyApiCorrect` **is** McNemar's `b` vs `c`. |
| `not comparable` | our published pick had no counterpart. Reported for coverage honesty; excluded from every rate. |

**Confidence disagreement** (our 72% vs provider 51%) is a continuous version of the same
question. Bucket `confidence_delta` into `≤ −20, −20..−10, −10..+10, +10..+20, ≥ +20` and
report our realised hit rate per bucket. The diagnostic: if our hit rate is **flat or
falling** as `confidence_delta` grows, our extra confidence carries no information and is
pure overconfidence; if it rises, our confidence is genuinely informative where the
provider hesitates. This single chart is, in my judgement, the highest-information-per-pixel
output of the entire layer — and it is computable from data that already exists today.

---

## Phase 6 — Confidence calibration without touching the engine

### 6.1 What is measured

For each `(provider, model_version, market_family, league_tier)`:
- **Reliability curve**: stated confidence bin → realised hit rate, with Wilson bands
  (→ `meta_calibration_bins`).
- **ECE** `Σ (n_b/n)·|realised_b − stated_b|` and **MCE** = max bin gap.
- **Overconfidence slope/intercept**: OLS of `realised` on `stated` across bins, weighted
  by `n_b`. Slope < 1 ⇒ overconfident (stated moves faster than reality); intercept < 0 ⇒
  systematic optimism. This yields the crisp answers the prompt asks for: *is PredictorV3
  overconfident?* → slope and intercept. *Is API-Football better calibrated?* → compare
  ECE, but only after §6.3.
- **Brier / LogLoss** via the existing `computeQuantMetrics()`.

### 6.2 How recalibration is fitted — reuse, don't invent

`server-utils/isotonicCalibration.js` + `calibration_maps` (mig. 014) already provide this,
per that migration's own header: *"PAV fit stores (raw, calibrated) point pairs; inference
uses piecewise-linear interpolation"*, stored as `x_points`/`y_points` with
`brier_raw`/`brier_calibrated`. Phase 6 fits the same object on a different pair
(`stated confidence → realised outcome`) and stores it in `meta_confidence_calibration`
with an identical column shape. Monotone isotonic regression is the right tool: it cannot
invert the confidence ordering, which is precisely the guarantee you want from a
recalibrator you are not going to babysit.

Fallbacks by sample size: `n ≥ 200` isotonic PAV · `50 ≤ n < 200` Platt (1-D logistic) ·
`n < 50` **no fit at all**, report raw bins only. A recalibration fitted on 30 samples is
a random-number generator.

### 6.3 The provider-confidence caveat

`winPercent` is not a probability — it is an undocumented score summing to ~100, available
for 1X2 only, and `33/33/33` is a no-data sentinel. Comparing our calibrated confidence to
raw `winPercent` measures nothing. The only defensible comparison is **after** fitting a
provider-specific calibration map on its own score, then comparing post-calibration ECE.
Any "API-Football is better calibrated" claim made before that step must be blocked by the
design, and I would surface it in the UI as an explicit note on the panel rather than a
footnote nobody reads.

### 6.4 How the engine stays untouched

Three layers of separation:
1. The calibrated confidence is written **only** to `meta_confidence_calibration` and
   surfaced **only** in the admin dashboard as `calibratedConfidence` alongside the raw
   value. User-facing predictions are unaffected.
2. `applied_at_runtime` is a stored boolean, **hard-false in Phase X**. No code reads it.
   It exists so the future activation decision is a visible, auditable flag rather than a
   diff.
3. The **future** activation seam (out of scope, documented only) mirrors the existing
   `auto_calibration_overlays` + `overlayRuntime.js` + `manualLocks.js` pattern: a Stage09
   post-processing overlay applied only for non-locked keys, clamped to a maximum delta,
   behind a feature flag, with a shadow-mode A/B against `model_version`. That is a
   separate future phase with its own approval — mentioned here so the data model does not
   have to change when it happens.

**Shadow evaluation** is how calibration proves itself in the meantime: replay historical
confidences through the fitted map and report `ece_before/ece_after`,
`brier_before/brier_after` on **out-of-sample folds only**. If shadow mode does not
improve out-of-sample Brier, the map is not worth activating — and we learn that for free,
with zero production risk.

---

## Phase 7 — Meta Recommendation Layer (design only; dormant)

A **pure function**, no I/O, no side effects, never called by the prediction path:

```
resolveMetaAdvice({ context, selections, verdicts, calibration, config })
  -> { action, providerKey, confidence, rationale[], guardrails[], evidence }

action ∈ 'use_predictor_v3' | 'use_provider' | 'consensus_only' | 'no_bet' | 'defer'
```

### 7.1 Decision rules (ordered; first match wins)

1. **`defer`** — no verdict for this segment, or verdict is `insufficient_data`.
   *Deferring to existing behaviour is the default*, and the most common outcome for a long
   time. Any design where the meta layer usually has an opinion is a design that is
   overfitting.
2. **`no_bet`** — providers disagree **and** both are poorly calibrated in this segment
   (ECE above threshold) **and** no `dominant` verdict exists. Genuine ambiguity;
   abstention is a real, valuable action and must be a first-class arm.
3. **`consensus_only`** — the `agree = true` cohort shows a materially better hit
   rate/ROI than either provider's overall rate, **with** BH-corrected significance.
   Note: consensus superiority must be *earned from the data*, not assumed. Agreement
   often just selects easy fixtures, which raises hit rate while *lowering* ROI because the
   prices are shorter. The rule therefore keys on ROI, not hit rate.
4. **`use_provider`** — a `b_dominant` verdict for this segment, `discordant_n ≥ 25`,
   `q < 0.05`, from `walk_forward_oos`, and the segment is not in drift.
5. **`use_predictor_v3`** — the symmetric case, and the default when we hold any positive
   verdict.

### 7.2 Guardrails

- Every advice object carries the verdict ids it used → fully auditable.
- Segment in active `critical` drift ⇒ forced `defer`.
- Verdicts older than a configurable staleness window ⇒ forced `defer`.
- Rate limit on advice flipping (hysteresis) so a borderline segment does not oscillate
  between providers week to week.
- The function is **exercised only by tests and the admin dashboard's simulation view**
  in Phase X. It is not wired to `/api/predict`; the constraint that PredictorV3 alone
  owns the user-facing recommendation is untouched.

### 7.3 Honest assessment

With API-Football as the only external provider and a ~10% comparability rate, this layer
will realistically return `defer` for the overwhelming majority of fixtures for many
months. That is not a failure of the design — it is the design working. Its value now is
(a) the schema and decision contract exist before the data does, so nothing has to be
rewritten later, and (b) it becomes genuinely useful the moment a second or third provider
with broader market coverage is added, which is exactly what the provider-registry grain
is built for.

---

## Phase 8 — Internal admin dashboard

Not user-facing. Integrates as a new `section === "meta"` branch in
`src/components/panels/PerformancePanel.tsx`, lazily loaded next to the existing
`BenchmarkPanel`, behind the existing admin auth. New service module
`src/services/metaLearningService.ts` mirroring `predictionBenchmarkService.ts`
(`fetchWithAuth` + `getJson`, typed responses). Charts reuse whatever the existing
`BacktestAnalyticsPanel` uses — no new charting dependency.

### 8.1 Panels

| Panel | Content | Source |
|---|---|---|
| **Provider Leaderboard** | providers × market family: hit rate (Wilson), counterfactual ROI, ECE, Brier, `n`, coverage %, abstention rate | `meta_segment_performance` |
| **League Performance** | per-league split for each provider, sortable, `insufficient_data` rows visibly greyed and *not* sorted to the top | `meta_segment_performance` |
| **Agreement Matrix** | provider × provider: agreement %, discordant `n`, McNemar `q`, verdict chip | `meta_pairwise_verdicts` |
| **Confusion Matrix** | the 2×2 `bothCorrect / bothWrong / onlyA / onlyB` with `b` vs `c` highlighted as *the* sample size | `computeHeadToHead()` + verdicts |
| **Calibration Curve** | stated vs realised per confidence bin, per provider, diagonal reference line | `meta_calibration_bins` |
| **Reliability Diagram** | calibration curve + Wilson bands + bin histogram underneath + ECE/MCE/slope readout | `meta_calibration_bins` |
| **Confidence Calibration** | before/after isotonic shadow evaluation, `ece_before → ece_after`, `brier_before → brier_after`, method, `n`, **and a prominent "not applied at runtime" badge** | `meta_confidence_calibration` |
| **ROI / Yield** | equity curve, Kelly bankroll curve, max drawdown, Sharpe, yield — per provider, with `priced_coverage_pct` shown next to every figure | `computeBacktestMetrics()` / `computeQuantMetrics()` |
| **Drift Detection** | timeline of `meta_drift_events` by severity; rolling hit rate / ECE / agreement with CUSUM bands; context PSI | `meta_drift_events` |
| **Segment Explorer** | the discovered composite segments ranked by dominance score, each expandable to `n`, `q`, interval, and the split path that produced it | `meta_pairwise_verdicts` |
| **Data Health** | comparability %, `agree=null` share, `advice`-sourced share, provider abstention rate, settlement disagreements dropped, accrual rate + **projected days until each segment reaches minimum support** | ETL diagnostics |

The Data Health panel is not an afterthought. Given §0, it is the panel that tells the
operator whether anything else on the screen may be believed yet, and it should ship in
Sprint 1 — before any verdict UI exists.

### 8.2 UI honesty requirements

Sample size next to every rate, without exception · Wilson intervals rendered, not just
point estimates · `insufficient_data` styled distinctly from "no edge" · `q` shown, `p`
never shown alone · counterfactual ROI always badged as counterfactual with its coverage %
· `model_version` scope visible in every panel header.

### 8.3 API surface (all added to `api/backtest.js` `view=` dispatch, all in `gatedViews`)

```
view=meta-leaderboard        &days=&modelVersion=&family=
view=meta-segments           &kind=&family=&minN=
view=meta-verdicts           &kind=&family=&verdict=
view=meta-calibration        &provider=&family=
view=meta-agreement-matrix   &days=
view=meta-drift              &severity=&days=
view=meta-data-health        &days=
view=meta-advice-simulation  &fixtureId=       # Phase 7 dry-run, read-only
```

---

## Phase 9 — Roadmap

Complexity: **S** ≈ 1–2 days · **M** ≈ 3–5 days · **L** ≈ 1–2 weeks (single developer).

### Sprint 1 — Foundation, ETL, and the honesty layer  ·  M  ·  ✅ DELIVERED

Shipped:

| Deliverable | Files |
|---|---|
| Migration (9 tables, RLS `using(false)`, indexes, provider seed) | `supabase/migrations/040_meta_learning_foundation.sql` |
| Config layer (all thresholds; no magic numbers elsewhere) | `server-utils/metaLearning/metaLearningConfig.js`, `leagueTiers.config.json` |
| Context projection | `server-utils/metaLearning/MetaContextBuilder.js` |
| Family resolution (goals `ou` vs `ou_other`) | `server-utils/metaLearning/marketFamily.js` |
| Provider adapters | `server-utils/metaLearning/providers/{predictorV3Provider,apiFootballProvider}.js` |
| Selection projection + counterfactual pricing | `server-utils/metaLearning/MetaSelectionProjector.js` |
| Data Health | `server-utils/metaLearning/MetaDataHealth.js` |
| ETL orchestrator (only module touching Supabase) | `server-utils/metaLearning/runMetaLearningRefresh.js` |
| Cron + API seams | `api/cron/daily-ml.js` (`mode=meta-learning-refresh`), `api/backtest.js` (`view=meta-data-health`, in `gatedViews`), `vercel.json` (04:15 UTC) |
| Admin panel | `src/services/metaLearningService.ts`, `src/components/admin/MetaDataHealthPanel.tsx`, wired as the `meta-learning` `AdminSection` |
| Tests (50, all passing) | `tests/metaLearning/{importBoundary,MetaContextBuilder,MetaSelectionProjector,MetaDataHealth}.test.js`, `npm run test:meta` |
| Sweep budget | `runBenchmarkSweep.js`: 30→120 fetches, 3→7 day window, **and** the scan-vs-fetch cap fix (§0.2) |

**Two defects the tests caught during implementation**, both from the same root cause —
`evaluateTopPick()` parses *any* over/under as a **goals** total:
1. `gradeSelection()` would have graded a corners "Over 7.5" against the goal count and
   recorded a loss. Now family-guarded to `{1x2, dc, btts, ou}`, else `ungradeable`.
2. Worse, `detectSettlementDisagreement()` would have flagged **every winning
   corners/cards/shots pick** as a settlement conflict and dropped its entire fixture —
   silently deleting most non-1X2 data from the layer. Same guard applied.

No backfill script was needed: the ETL is a full window rewrite, so the first cron run
(or a manual `?mode=meta-learning-refresh&windowDays=365`) *is* the backfill.

*Exit criteria:* every historical benchmark row is projected into the new grain; the Data
Health panel reports the true comparability %, accrual rate, and projected days-to-support
per segment. **This number decides how much of Sprints 3–5 is worth building now** — which
is why it comes first.

*Risks:* backfill discovers unparseable legacy rows (mitigate: `source_row` jsonb keeps the
original, unusable rows are counted not dropped silently). Vercel Hobby function/cron
limits (mitigate: reuse existing dispatchers — already verified as the required approach).

*Dependencies:* migrations 038/039 applied in production (they are).

---

### Sprint 2 — Segmentation and descriptive metrics  ·  M

`MetaStatistics.js` (Wilson, McNemar exact + χ², BH-FDR, Beta-Binomial shrinkage) with
unit tests against textbook worked examples · `MetaSegmentEngine.js` over the fixed
one-dimensional dimensions · counterfactual pricing (§4.4) with `priced_from` provenance ·
`meta_segment_performance` rollup reusing `computeBacktestMetrics()`/`computeQuantMetrics()` ·
`view=meta-leaderboard`, `view=meta-segments` · Provider Leaderboard, League Performance,
ROI/Yield panels.

*Exit criteria:* every requested one-dimensional dimension (league, odds band,
favouritism, confidence bucket, market family, league tier, season phase, market move,
agreement cohort) is reported per provider with `n`, Wilson interval, and coverage %.

*Risks:* counterfactual pricing misinterpreted as real provider ROI (mitigate: schema-level
`priced_from` + mandatory UI badge + coverage gate). Statistical helpers subtly wrong
(mitigate: TDD against published worked examples — this is the one place where a bug
silently corrupts every downstream conclusion).

*Dependencies:* Sprint 1.

---

### Sprint 3 — Pairwise verdicts and the scoring engine  ·  L

`MetaSegmentDiscovery.js` (depth-capped greedy partitioning on `d_i`) ·
`MetaScoringEngine.js` (dominance score, gates, verdict assignment) · walk-forward
out-of-sample fold harness (pattern already present in `view=walk-forward-tip`) ·
`meta_pairwise_verdicts` · `view=meta-verdicts`, `view=meta-agreement-matrix` ·
Agreement Matrix, Confusion Matrix, Segment Explorer panels.

*Exit criteria:* the system automatically emits "provider P dominates segment S
(`discordant_n=…`, `q=…`, `Δ=…pp`, OOS)" — or, correctly and loudly,
`insufficient_data` for everything.

*Risks:* **overfitting / p-hacking — the highest-severity risk in the whole project.**
Mitigations are structural, not procedural: minimum-support gates before any test,
BH-FDR, depth cap 2, separate hypothesis families for discovered segments, OOS-only
`dominant` verdicts, sign-flip auto-downgrade. Second risk: the honest answer is
"insufficient data everywhere", which is unsatisfying — but it is the correct answer, and
the Data Health panel from Sprint 1 will have predicted it, so it should not be a surprise
at this point.

*Dependencies:* Sprint 2. Sensitive to accrual — if Sprint 1's projection shows
minimum support is many months away, Sprint 3 should still ship (the machinery is what
makes later data usable) but its UI should be explicitly framed as pre-provisioned.

---

### Sprint 4 — Calibration intelligence and drift  ·  M

`MetaCalibrationEngine.js` reusing `isotonicCalibration.js`, with the
isotonic/Platt/none sample-size ladder · `meta_calibration_bins`,
`meta_confidence_calibration` (`applied_at_runtime` hard-false) · out-of-sample shadow
evaluation (`ece_before/after`, `brier_before/after`) · `MetaDriftDetector.js`
(CUSUM + Page-Hinkley on rates, PSI on the context distribution) · `meta_drift_events` ·
`view=meta-calibration`, `view=meta-drift` · Calibration Curve, Reliability Diagram,
Confidence Calibration, Drift Detection panels.

*Exit criteria:* PredictorV3's overconfidence slope/intercept and ECE are reported per
market family and league tier; a fitted-but-dormant recalibration map exists with an
out-of-sample shadow verdict on whether it would help.

*Risks:* someone activates the overlay because the dashboard makes it look good
(mitigate: `applied_at_runtime` is read by no code, activation is a documented separate
phase requiring approval, and the panel carries a permanent "not applied" badge).
Provider `winPercent` treated as a probability (mitigate: §6.3 gate — no cross-provider
calibration claim before both sides are calibrated on their own scale).

*Dependencies:* Sprint 2 (bins need segments); independent of Sprint 3 — **these two can
run in parallel** if capacity allows.

---

### Sprint 5 — Meta Recommendation Layer (dormant) and multi-provider proof  ·  M

`MetaRecommendationLayer.js` as a pure, fully unit-tested decision function ·
`view=meta-advice-simulation` (read-only dry run over historical fixtures) · a simulation
panel showing what the layer *would* have advised and the counterfactual P&L of following
it · **a second provider adapter as the architecture proof** — implement one additional
provider end-to-end (adapter + `meta_providers` row) and confirm zero schema or scoring
changes were required.

*Exit criteria:* the decision contract is fixed and tested; adding provider #3 is
demonstrably a new adapter file plus a registry row.

*Risks:* scope creep toward wiring the layer into `/api/predict` (mitigate: the layer has
no Supabase write path and no import from the prediction stack; the import-boundary test
from Sprint 1 fails the build if that changes). Second-provider licensing/ToS and API
budget (mitigate: verify terms and `apiBudgetCircuit.js` headroom **before** the sprint,
not during).

*Dependencies:* Sprints 3 and 4. The second provider is a business/legal decision, not
just a technical one, and should be settled before Sprint 5 starts.

---

### Cross-cutting risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **Statistical power** — most segments never reach minimum support | **High / near-certain** | measured and projected in Sprint 1 before verdict work; hard `insufficient_data` gating; consider raising the sweep budget and window if the API budget allows |
| **Overfitting / p-hacking** producing confident nonsense | **High** | BH-FDR, minimum support, depth cap 2, OOS-only `dominant`, sign-flip downgrade, pre-registered dimensions |
| **Counterfactual ROI misread as real** | Medium | `priced_from` in the schema, coverage gate, mandatory UI badge |
| **Accidental coupling to PredictorV3** | Medium | import-boundary test in CI; new tables service-role only; no write path to existing tables |
| **Vercel Hobby function/cron limits** | Medium | extend existing `view=`/`mode=` dispatchers; zero new API files (this repo has already hit this limit once) |
| **Cross-`model_version` pooling** invalidating comparisons | Medium | stratification is a schema-level invariant, not a convention |
| **Provider ToS / budget** for provider #2+ | Medium | verify before Sprint 5; route every call through `getWithCache` + `apiBudgetCircuit.js` |
| **Dashboard implies certainty it does not have** | Medium | intervals, `n`, `q`, coverage %, and scope on every panel; Data Health ships first |

---

## Appendix A — Architectural decisions and rationale

1. **Selection-grained star schema instead of extending `prediction_benchmarks`.**
   The existing table is pairwise and fixture-grained; N providers do not fit it, and it
   already discards `perFamilyBreakdown` information at read time. Changing the grain in a
   *new* table is the only way to get multi-provider scalability without rewriting anything
   — and it satisfies the constraint that the existing benchmark stays frozen.

2. **PredictorV3 registered as a provider row.** Makes "us vs them" a symmetric self-join.
   Without this, every future provider needs bespoke comparison code; with it, comparison is
   data.

3. **Statistics, not ML.** At `discordant_n` in the tens, any learner fits noise, and its
   output cannot be defended to someone about to stake money. Every emitted number must be
   reproducible with a calculator. `ml_training_examples` (mig. 022) remains the correct
   home for real ML, untouched.

4. **McNemar over two-proportion tests.** The design is paired by construction. `bothCorrect`
   and `bothWrong` carry no information about relative skill; treating the two providers as
   independent samples discards the pairing and inflates variance exactly where samples are
   smallest.

5. **BH-FDR + minimum support + OOS folds as load-bearing features.** Roughly 120 primary
   hypotheses at α=0.05 yields ~6 false discoveries, and they will be the most
   attention-grabbing cells on the screen. Without multiplicity control this layer is not
   neutral-but-useless, it is actively harmful.

6. **Counterfactual pricing rather than no provider ROI.** The existing code is right to
   refuse to fabricate a price. But we recorded the market price for the same fixture, so
   "what if we had staked their pick at our recorded price" is a real, auditable question —
   provided provenance and coverage travel with every figure.

7. **Reuse `BacktestAnalytics` / `benchmarkMetrics` / `isotonicCalibration` wholesale.**
   Every metric the prompt asks for (ROI, Yield, EV, Kelly growth, max drawdown, Brier,
   LogLoss, CLV) already exists and is already tested. Re-deriving them would create a
   second source of truth that drifts — the exact anti-pattern the existing benchmark code
   explicitly avoided when it delegated to `computeBacktestMetrics()`.

8. **Extend existing dispatchers, add zero API files.** Not stylistic: this repo already
   consolidated `api/predictionBenchmark.js` into `api/backtest.js` to stay under the
   Vercel Hobby function limit. Any design that adds endpoints breaks deployment.

9. **Calibration overlay fitted but dormant (`applied_at_runtime` false, read by nothing).**
   Satisfies "recalibrate without modifying the engine" literally, while pre-shaping the
   data model so a future, separately-approved activation — mirroring the existing
   `auto_calibration_overlays` + `overlayRuntime.js` + `manualLocks.js` pattern — needs no
   schema change.

10. **`insufficient_data` as a first-class verdict, and Data Health shipping first.**
    Given a ~10% comparability rate and a 30-fixture daily budget, the honest answer will
    usually be "we do not know yet". A design that cannot say that clearly will instead say
    something false, and someone will bet on it.

11. **Live vs pre-match scoped out, not approximated.** `isPreKickoff()` means the data does
    not exist. Approximating it would fabricate a finding.

12. **Depth-2 cap on discovered segments.** Interaction depth is limited by sample size, not
    by imagination. Encoding the cap in config makes the constraint visible and reviewable
    rather than leaving it to discipline.

---

## Appendix B — Constraint compliance checklist

| Constraint | How this design satisfies it |
|---|---|
| Do not modify PredictorV3 | no import from `server-utils/PredictionEngine/`; enforced by a CI import-boundary test |
| Do not modify PredictionEngine | same |
| Do not modify Stage00–Stage12 | no pipeline import; no write to `predictions_history` |
| Do not modify the recommendation selection | `MetaRecommendationLayer` is pure, dormant, unwired |
| Do not modify ValueEngine | no import from `server-utils/value/` |
| Do not modify the existing benchmark | `prediction_benchmarks`, `BenchmarkConsensus`, `normalizeApiFootballPrediction`, `runBenchmarkSweep`, `benchmark*` views and `BenchmarkPanel` are read-only inputs |
| Separate, read-only layer | new tables only; all sources read-only; service-role RLS throughout |
| Scalable to N providers | `meta_providers` registry + selection-grained facts + symmetric pairwise verdicts; new provider = adapter file + registry row |
| No implementation in this phase | document only; no code written |

---

## Appendix C — Open questions for the product owner

These are decisions the design deliberately leaves open, because they are yours and not
mine. None of them block Sprint 1.

1. **Is raising the sweep budget acceptable?** `PREDICTION_BENCHMARK_SWEEP_BUDGET` is 30/day
   and `PREDICTION_BENCHMARK_SWEEP_WINDOW_DAYS` is 3. Accrual is the binding constraint on
   the entire feature (§0). Raising the budget is the single highest-leverage change
   available, and it trades directly against the `apiBudgetCircuit.js` daily cap. Sprint 1's
   Data Health panel will quantify that trade before you have to decide.
2. **Which provider is #2?** Forebet, BetMines, and Opta differ enormously in market
   coverage, price availability, and licensing. A provider that publishes *odds* would close
   G1 properly instead of via counterfactual pricing, and one that covers corners/cards
   would close G4. Coverage breadth matters more here than accuracy.
3. **Is `no_bet` acceptable as a product outcome?** Phase 7 treats abstention as a
   first-class action. That is statistically correct, but it is a product decision whether
   the platform is ever willing to say "no recommendation today for this fixture".
4. **League tier assignments.** §3.5 seeds a defensible default, but "Top 5 / Top 10 / rest"
   is ultimately an editorial judgement about which competitions you consider comparable.
5. **Retention.** `meta_*` tables are small, but the retention RPC pattern from migration
   019 exists and should probably be extended to them. Suggested default: keep aggregates
   indefinitely, prune `meta_provider_selections` beyond 720 days.
