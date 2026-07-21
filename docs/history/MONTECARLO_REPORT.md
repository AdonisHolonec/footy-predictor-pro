# Monte Carlo Adaptive Simulations Report

**Date:** 2026-07-18  
**Objective:** Replace the fixed **10 000** simulations budget with an **uncertainty-adaptive** budget: `1000 | 3000 | 5000 | 10000 | 25000`.

---

## 1. Verdict

**Spend sims where sampling error hurts most.** Clear favourites use fewer draws; coin-flip / high-entropy matches use up to **25 000**.

| Uncertainty | Sims | Typical match |
|-------------|------|----------------|
| Very low (`u < 0.25`) | **1 000** | Heavy favourite (e.g. λ 4.5 / 0.3) |
| Low (`u < 0.40`) | **3 000** | Strong favourite |
| Medium (`u < 0.55`) | **5 000** | Solid but not locked home edge |
| High (`u < 0.75`) | **10 000** | Contested / O·U near 50% |
| Very high (`u ≥ 0.75`) | **25 000** | Balanced 1X2 / tight high-scoring |

Default when adaptive is disabled: still **10 000** (`DEFAULT_MONTE_CARLO_SIMS`).  
Engine version: `mc-v2-adaptive`.

---

## 2. Before → after

| | Before | After |
|---|--------|--------|
| Budget | Always 10 000 | Adaptive tier from analytical uncertainty |
| Cost | Fixed CPU per fixture | ~1k–25k; blowouts cheaper, toss-ups richer |
| CI width | Same for all matches | Narrower where it matters (tight markets) |
| Override | `MONTE_CARLO_SIMS` / explicit `simulations` | Same + `MONTE_CARLO_ADAPTIVE=0` to force fixed |
| UI | “N sims” | “N sims · adaptive (u=…)” when adaptive |

---

## 3. Uncertainty model

Computed **before** sampling from the same bivariate Poisson + Dixon–Coles PMF (no pilot MC needed).

```
u = 0.40·entropyNorm
  + 0.30·competitiveness
  + 0.15·goalVarNorm
  + 0.15·ouCloseness
```

| Component | Meaning |
|-----------|---------|
| `entropyNorm` | Shannon entropy of 1X2 / ln(3) — max when p1≈pX≈p2 |
| `competitiveness` | 1 when favourite ≈ ⅓; 0 when near-certain |
| `goalVarNorm` | Total λ scaled so high-scoring games buy more tail resolution |
| `ouCloseness` | 1 when P(Over 2.5) ≈ 50% (widest binomial CI) |

Implementation: `estimateMonteCarloUncertainty` → `selectAdaptiveSimulations` → `resolveMonteCarloSimulations` in  
`server-utils/monteCarlo/MonteCarloEngine.js`.

---

## 4. Tier map (empirical)

Scenarios with `correlation=0.12`, `rho=-0.11`:

| Scenario | λ home / away | u | Tier | Favourite p |
|----------|---------------|---|------|-------------|
| Heavy favourite | 4.5 / 0.3 | 0.225 | **1 000** | ~97.5% |
| Strong favourite | 3.4 / 0.45 | 0.329 | **3 000** | ~91.3% |
| Solid home | 2.8 / 0.7 | 0.477 | **5 000** | ~81.0% |
| Contested | 2.1 / 0.9 | 0.668 | **10 000** | ~64.4% |
| Balanced | 1.45 / 1.35 | 0.871 | **25 000** | ~37.7% |
| High-scoring tight | 2.4 / 2.2 | 0.808 | **25 000** | ~43.2% |
| Low-scoring tight | 0.95 / 0.9 | 0.774 | **25 000** | draw-heavy |

---

## 5. Production wiring

```
api/predict.js
  → runMonteCarloSimulation(λh, λa, { fixtureId, correlation, rho })
       // no fixed simulations — adaptive by default
  → result.adaptive = { enabled, score, tier, components, probs }
  → result.simulations = chosen tier

UI MonteCarloPanel
  → "{N} sims · adaptive (u=0.xx) · bivariate Poisson + Dixon–Coles"
```

**Overrides**

| Control | Effect |
|---------|--------|
| `options.simulations = N` | Force N (clamped 1k–50k); `adaptive.enabled=false` |
| `MONTE_CARLO_SIMS` | Fixed default when adaptive disabled |
| `MONTE_CARLO_ADAPTIVE=0` | Disable adaptive; use fixed default (10k or env) |
| `options.adaptive = false` | Same, per-call |

---

## 6. Why this improves Monte Carlo

1. **Sampling error ∝ √(p(1−p)/N)** — markets near 50% need ~√(2.5×) more sims than a 90% favourite for the same Wilson half-width; adaptive allocates that.
2. **CPU budget** — a slate of blowouts no longer pays 10k each; savings fund 25k on toss-ups.
3. **Deterministic tiering** — uncertainty from the closed-form PMF (same seed still → same samples for a given N).
4. **Auditability** — every payload carries `adaptive.score` + component breakdown.

---

## 7. Tests

`tests/math.test.js`

- Fixed 10k path still deterministic + CI complete  
- Tier thresholds for all five budgets  
- Blowout uncertainty &lt; tight match; adaptive run uses a valid tier  

`npm run test:math` — all passing (incl. adaptive suite).

---

## 8. Files touched

| File | Change |
|------|--------|
| `server-utils/monteCarlo/MonteCarloEngine.js` | Adaptive estimator + tiers; `mc-v2-adaptive` |
| `api/predict.js` | Drop hardcoded 10k; use adaptive default |
| `src/types.ts` | `MonteCarloAdaptiveMeta` |
| `src/components/MonteCarloPanel.tsx` | Show adaptive uncertainty |
| `tests/math.test.js` | Adaptive coverage |
| `MONTECARLO_REPORT.md` | This report |
