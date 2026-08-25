-- 059: the 1X2 model outputs still readable only out of raw_payload, promoted to
-- real columns so the metrics and risk-context reads can eventually stop
-- detoasting the document.
--
-- WHY (D9 forensics):
--
-- D9 set out to drop raw_payload from /api/backtest?view=metrics and from
-- loadRiskContext, and proved it cannot be done today. Every promoted column on
-- predictions_history was enumerated across migrations 001-058; the fields those
-- two paths consume are not among them:
--
--   evaluation.modelProbs1x2Pct / probs   -> no column (Brier + log-loss inputs)
--   modelMeta.method                      -> no column ('method' is on calibration_maps)
--   modelMeta.dataQuality                 -> no column
--   evaluation.recommended1x2 /
--     predictions.oneXtwo                 -> no column
--
-- recommended_pick cannot stand in for the 1X2 pick: it is
-- prediction.recommended?.pick, the MARKET pick ("Over 2.5"). And projecting
-- raw_payload->key is measured in this repo at 12.2x SLOWER than columns,
-- because Postgres must de-TOAST the whole document to evaluate one key.
--
-- Same measurements 057 recorded, unchanged since:
--
--   raw_payload      limit=100   2,161 ms   30,964 KB   200
--   raw_payload      limit=250  10,441 ms        0 KB   500  57014 statement timeout
--   promoted columns limit=250     269 ms      158 KB   200
--
-- UNITS — the part that is easy to get wrong:
--
-- prob_1/x/2 are PERCENTAGES summing to ~100, not fractions. Stage08 writes
-- modelProbs1x2Pct = { p1: p1Adj, ... } where p1Adj is (p1Adj / sumAdj) * 100,
-- and probs goes through clampPct() = max(0, min(100, n)). Stage07 then compares
-- |p1Adj - riskContext.avgDist.p1| against a threshold of 24 — a percentage-point
-- threshold that could never fire on 0-1 values. Storing fractions here would
-- silently disable the drift penalty. They are stored exactly as produced.
--
-- model_data_quality is the opposite: a 0-1 fraction, Number(dataQuality.toFixed(3)),
-- bucketed by the metrics endpoint at >= 0.75 high / >= 0.55 mid.
--
-- TYPES:
--
-- numeric without precision/scale, deliberately. JS serialises a double as its
-- shortest round-tripping decimal, so unbounded numeric stores and returns that
-- value unchanged and the metrics output stays byte-identical. numeric(5,2) would
-- round 43.21739... to 43.22 and move the published Brier score.
--
-- NO constraints, NO indexes, NO trigger:
--
--   - CHECK (prob_1 between 0 and 100) is tempting and wrong. probs is clamped but
--     modelProbs1x2Pct is raw p1Adj, and applyModelLabOverride can rewrite it. A
--     rejected value would fail the whole bulk upsert and break Predict
--     persistence — a far worse outcome than an out-of-range number in a
--     projection column.
--   - nothing filters or orders on these columns; they exist to be SELECTed. An
--     index would slow every write for no read benefit.
--   - no trigger, so old rows are left exactly as they are and this migration is
--     safe to apply while the previous application version is still serving.
--
-- This migration is additive and idempotent: ADD COLUMN IF NOT EXISTS only, no
-- data written, no raw_payload rewritten. Backfill is deliberately NOT here — it
-- is a separate, chunked, resumable operation (D9b-2), because doing it inline
-- would be the very unbounded statement these columns exist to remove.
--
-- Rollback is a code revert, never a migration: until D9b-3 switches the read
-- paths, nothing reads these columns, so an unpopulated or half-populated table
-- is indistinguishable from today.

alter table public.predictions_history
  add column if not exists prob_1 numeric,
  add column if not exists prob_x numeric,
  add column if not exists prob_2 numeric,
  add column if not exists model_method text,
  add column if not exists model_data_quality numeric,
  add column if not exists pick_1x2 text;

comment on column public.predictions_history.prob_1 is
  'Model P(home win) as a PERCENTAGE 0-100, from evaluation.modelProbs1x2Pct.p1 (fallback probs.p1). NULL when the source triple is absent or non-finite.';
comment on column public.predictions_history.prob_x is
  'Model P(draw) as a PERCENTAGE 0-100, from evaluation.modelProbs1x2Pct.pX (fallback probs.pX). NULL when the source triple is absent or non-finite.';
comment on column public.predictions_history.prob_2 is
  'Model P(away win) as a PERCENTAGE 0-100, from evaluation.modelProbs1x2Pct.p2 (fallback probs.p2). NULL when the source triple is absent or non-finite.';
comment on column public.predictions_history.model_method is
  'modelMeta.method — the lambda method label (strength-ratings, standings, modular-engine, ...). NULL when absent; never an empty string.';
comment on column public.predictions_history.model_data_quality is
  'modelMeta.dataQuality — a 0-1 FRACTION at 3dp, bucketed >= 0.75 high / >= 0.55 mid. NULL when absent; never 0.';
comment on column public.predictions_history.pick_1x2 is
  'The 1X2 pick, from evaluation.recommended1x2 (fallback predictions.oneXtwo). Only 1, X or 2 are stored; anything else is NULL. Distinct from recommended_pick, which is the MARKET pick.';
