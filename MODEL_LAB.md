# Model Laboratory

**Date:** 2026-07-18
**Purpose:** Run **multiple prediction models independently** over the same settled history and score each with **Accuracy, ROI, Yield, LogLoss, Brier Score, Expected Value**.

> The lab is **analysis-only**. It reconstructs each model's 1X2 probabilities from data already stored in `predictions_history` — no re-fetching from the upstream API and no fabricated numbers. It never changes live predictions.

---

## Models

Defined in `server-utils/modelLab/ModelLab.js` (`MODEL_REGISTRY`), each a blend of probability **sources** (+ optional **modifiers**):

| ID | Name | Sources | Modifiers |
|----|------|---------|-----------|
| **A** | Poisson | `poisson` | — |
| **B** | Poisson + Elo | `poisson`, `elo` | — |
| **C** | Poisson + Elo + xG | `poisson`, `elo`, `xg` | — |
| **D** | Poisson + xG + Injuries | `poisson`, `xg` | `injuries` |
| **E** | Everything enabled | `everything` | — |

Each model is executed **independently** by `evaluateModel(model, rows)`; the full sweep is `runModelLab(rows)`.

---

## Sources (reconstructed from stored data — no fabrication)

| Source | Reconstruction | Origin field |
|--------|----------------|--------------|
| `poisson` | Raw Poisson/Dixon–Coles 1X2 | `raw_payload.evaluation.rawPoissonProbs1x2Pct` |
| `elo` | `eloProbabilities()` recomputed from stored ratings | `raw_payload.modelMeta.elo.{home,away}` |
| `xg` | `computeMatchProbs()` over stored expected-goals λ | `luck_hxg`, `luck_axg` columns / `raw_payload.luckStats` |
| `market` | Shin de-vig of consensus odds | `odds_home/draw/away` columns |
| `everything` | Final production probs (calibration + stacker + market blend already applied) | `raw_payload.evaluation.modelProbs1x2Pct` |
| `injuries` *(modifier)* | Home/away goal multipliers from the injuries module | `raw_payload.modelMeta.modularScores.injuries.detail` |

**Blend:** equal-weight average of the required source triples, renormalized to sum 1. If a model requires a source a row does not have, that row is skipped for that model (tracked per model as `samples`).

**Injuries modifier:** `p1·=injHome`, `p2·=injAway`, `pX·=√(injHome·injAway)`, renormalized.

**Note on xG:** in this project xG is expected-goals (λ)-based, so Model C/D's xG source reinforces the goal model rather than adding an independent shot-xG signal. This is reported honestly — divergence between models reflects real stored signals, not synthetic noise. Historical rows created before module activation carry a neutral injuries factor.

---

## Metrics (per model)

Computed in `evaluateModel` over settled rows (`actual1x2FromScore` from `score_home/away`):

| Metric | Definition |
|--------|------------|
| **Accuracy** | % of rows where `argmax(blended) === actual` |
| **ROI** | flat 1u stake on the model's top pick at consensus odds; `Σprofit / Σstake × 100` |
| **Yield** | equals ROI under flat staking (reported for parity with the backtest lab) |
| **LogLoss** | mean `−ln(p_actual)` (`logLoss1x2`) |
| **Brier Score** | mean `Σ(p_i − o_i)²` (`brier1x2`) |
| **Expected Value** | mean `(p_pick · odds_pick − 1) × 100` |

`profit = correct ? odds−1 : −1`. All six metrics come from the shared, tested helpers in `server-utils/probabilityMetrics.js`.

---

## API

Folded into the backtest route (Hobby function-limit safe):

```
GET /api/backtest?view=model-lab&days=90
```

Response:

```json
{
  "ok": true,
  "days": 90,
  "cutoff": "2026-04-19T…",
  "schemaVersion": "modellab-v1",
  "totalSettled": 1234,
  "best": { "id": "E", "name": "Everything enabled", "roi": 4.8 },
  "metrics": ["accuracy","roi","yield","logLoss","brier","expectedValue"],
  "models": [
    { "id": "A", "name": "Poisson", "sources": ["poisson"], "modifiers": [],
      "samples": 1234, "bets": 1234, "accuracy": 51.2, "roi": -1.4, "yield": -1.4,
      "logLoss": 1.012, "brier": 0.612, "expectedValue": -0.8 },
    { "id": "B", "name": "Poisson + Elo", "…": "…" }
  ]
}
```

Client: `loadModelLab(days)` in `src/services/backtestService.ts`.

---

## UI

`src/components/modelLab/ModelLabPanel.tsx` — a responsive table (Model × Accuracy · ROI · Yield · LogLoss · Brier · EV) with 30/90/180-day windows, a "best ROI" pointer, and colored ROI/EV. Lazy-mounted in `PerformancePanel` under the Health Dashboard.

---

## Configuration

- Models/sources: edit `MODEL_REGISTRY` in `server-utils/modelLab/ModelLab.js`.
- Blend weights are pluggable via the `opts.models` argument to `runModelLab` (env hooks reserved as `MODEL_LAB_WEIGHT_*`).
- Window: `?days=` (7–365, default 90).

---

## Verification

- `node --test tests/math.test.js` → **59 pass** (includes a Model Lab test asserting all six metrics per model + source reconstruction).
- `npm run build` → frontend compiles with the new panel.
- `node --check` on `api/backtest.js` and `ModelLab.js` → OK.

## Files

| File | Change |
|------|--------|
| `server-utils/modelLab/ModelLab.js` | **New** registry + source reconstruction + per-model evaluator |
| `api/backtest.js` | **New** `view=model-lab` handler |
| `src/services/backtestService.ts` | `loadModelLab()` |
| `src/types.ts` | `ModelLabResult` / `ModelLabBundle` |
| `src/components/modelLab/ModelLabPanel.tsx` | **New** results table UI |
| `src/components/panels/PerformancePanel.tsx` | Mount the panel |
| `tests/math.test.js` | Model Lab unit test |

*Model comparison is evaluative only — it does not alter any live prediction.*
