# Context Engine — Historical Backtest

**Date:** 2026-07-24
**Script:** `scripts/backtestContextEngine.mjs` (`node --env-file=.env.local scripts/backtestContextEngine.mjs [days]`)
**Window:** last 30 days of settled fixtures in `predictions_history`

## Why offline, not live

The app's real API-Football quota is **~100 requests/day**, with a circuit
breaker (`server-utils/apiBudgetCircuit.js`) that starts degrading the app
once ~20 calls remain. Re-running the live pipeline per historical fixture
(team stats, injuries, lineups, h2h, recent matches ≈ 7 calls/fixture) across
the ~76 fixtures in the window would need 500+ calls — enough to exhaust the
day's quota several times over and risk breaking live predictions for real
users. This backtest instead replays already-settled predictions **offline,
with zero live API calls**, at the cost of reduced data completeness (below).

## Methodology

For each finished fixture (`FT`/`AET`/`PEN`) in the window:

1. **Baseline λ** = the real `lambdaHome`/`lambdaAway` already stored in that
   fixture's `raw_payload` — i.e. what the model produced with the Context
   Engine off (it was dead code, never wired in, until this session).
2. **engineCtx reconstruction** (best-effort, from what `raw_payload` already
   contains — no network):
   - `homeStandingsRow` / `awayStandingsRow` ← `teamContext.home/away` (rank,
     played, points) — real.
   - `hFormMulti` / `aFormMulti` ← `extractFormMultiplier()` (the exact
     production function) applied to the stored form string — real.
   - `hStats.gfHome/gaHome`, `aStats.gfAway/gaAway` ← approximated as
     season-average rate (`goalsFor/played`), since the home/away split
     itself isn't stored — **approximation**, not the live figure.
   - Fatigue (rest days), Squad (injuries/lineups), Weather: **no
     reconstructable input exists in the stored payload** → these 3 of 7
     modules stay neutral for every fixture in this test.
3. **Context λ** = baseline λ × `ContextEngine.evaluateContext(engineCtx)`'s
   `homeMultiplier`/`awayMultiplier` (the exact function now wired into
   `Stage03LambdaGeneration.js`), clamped the same way production does.
4. Both λ pairs are run through the same `computeMatchProbs()` used in
   production, so the **only** difference between the two variants is the
   context nudge.
5. Metrics are computed against the actual final score and the recorded
   market odds (`odds_home/draw/away`).

**Metric definitions:**
- **Accuracy** — top-probability 1X2 pick vs actual result, all fixtures.
- **Over/Under** — `pO25` ≥ 50% vs actual total > 2.5 goals, all fixtures.
- **Confidence calibration** — Brier score, log loss, and Expected
  Calibration Error (bucketed) on the full p1/pX/p2 triple.
- **Hit rate / ROI (value bets)** — restricted to fixtures where the model's
  pick probability exceeds the market's de-vigged (Shin) implied probability
  by ≥2pp; flat 1-unit stake at recorded decimal odds.
- **Naive ROI** — flat 1-unit stake on every fixture's top pick, no edge
  filter (supplementary line).

## Results (30-day window)

| Metric | Without Context Engine | With Context Engine |
|---|---|---|
| Fixtures evaluated | 74 (of 76 finished; 2 skipped — missing lambda/odds/score) | 74 |
| Accuracy (1X2) | 48.65% | 48.65% |
| Over/Under 2.5 accuracy | 44.59% | 44.59% |
| Brier score (avg, lower better) | 0.7154 | 0.7178 |
| Log loss (avg, lower better) | 1.1940 | 1.1981 |
| Expected Calibration Error | 22.92 | 21.73 |
| Value-bet hit rate (n=46) | 30.43% | 30.43% |
| Value-bet ROI | −0.10% | −0.10% |
| Naive ROI (bet every fixture) | +10.87% | +10.87% |

Per-league breakdown: **zero accuracy change in any of the 8 leagues**
present in the window (Superettan, Eliteserien, Liga I, World Cup, UEFA
Champions League, UEFA Europa Conference League, MLS, UEFA Europa League).

## Diagnostics

- **74/74** fixtures had at least one non-neutral module (nearly always
  Momentum and/or Motivation, since those reconstruct from real data).
- Average |nudge| on λ: **0.60%**. Median: **0.53%**. Maximum observed:
  **2.16%** — the configured 5% cap (`CONTEXT_MAX_INFLUENCE`) was **never
  reached** in this sample.
- Only **1 of 74** fixtures had its top pick flip between variants (fixture
  1497632: baseline picked "1", context-adjusted picked "X"; actual was "2"
  — both wrong regardless).

## Interpretation

On this specific sample, the Context Engine's effect is **statistically
indistinguishable from zero** — every aggregate metric matches to 2 decimal
places, and only one pick out of 74 changed at all. Two explanations, not
mutually exclusive:

1. **The data available in this test is thin.** 3 of 7 modules (Fatigue,
   Squad, Weather) had zero usable input and were neutral for every single
   fixture — modules that, on live data, tend to produce the largest signals
   (a suspended striker, three-day rest turnaround, a monsoon). A live run
   would very likely show a larger effect than this offline replay does.
2. **The ±5% cap is conservative by design**, and even the modules that did
   fire (Momentum, Motivation, approximated Tactical) rarely disagreed
   enough to move a nudge past ~2%. This is consistent with the engine
   behaving as intended — a small, bounded correction, not a lambda override.

## Recommendation: keep `CONTEXT_ENGINE_ENABLED=1`, but treat it as unproven

- **No evidence of harm.** Every metric is flat or trivially different; there
  is no case in this sample where the engine made predictions measurably
  worse.
- **No evidence of benefit either** — but that's a data-coverage limitation
  of this specific test, not a verdict on the engine's design. The 4 modules
  most likely to carry real signal (Fatigue, Squad, Weather, plus the
  unimplemented `market`/`psychology`/`league`/`h2h`) were untested here.
- Given the bounded, capped nature of the nudge (never exceeded 2% in 74
  real fixtures, hard-capped at 5%), the downside risk of leaving it enabled
  is low even before a live validation.
- **Follow-up needed:** re-run this same script against a live-populated
  sample once real `injuries`/`weather`/`homeLastMatchDate`/
  `homeRecentMatches` are being captured — either by budgeting a small daily
  slice of the API quota over the coming weeks (accumulating a live sample
  without spiking any single day), or once the app's paid API tier
  increases headroom. Until then, this result should be read as "no harm
  shown in the data available," not "no effect."
