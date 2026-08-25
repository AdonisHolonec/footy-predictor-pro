-- 060: the two valueBet fields loadRiskContext still reads out of raw_payload,
-- promoted to real columns so the last hot read of the document can drop it.
--
-- WHY (D9c forensics, measured against all 914 production rows):
--
-- D9b-4 took /api/backtest?view=metrics off raw_payload. loadRiskContext was
-- deliberately left behind, because estimateRollingDrawdown reads two fields
-- that migration 059 does not promote:
--
--   valueBet.kelly   -> no column (the stake, as a percentage)
--   valueBet.type    -> no column (which price the stake is settled at)
--
-- Dropping raw_payload from that SELECT without these would make the drawdown
-- silently 0, so cooldownCap would never tighten from 3 to 2.0/1.5 — a
-- behaviour change wearing a performance change's clothes.
--
-- WHAT THE AUDIT FOUND, and why only TWO columns are needed:
--
--   valueBet present        914/914 rows
--   valueBet.kelly present  914/914  (all numeric; 590 non-integer)
--   valueBet.type present     641/914
--
-- The other two payload reads in that path turned out NOT to need columns:
--
--   * avgDist reads raw_payload.probs.{p1,pX,p2}. Migration 059 already stores
--     these. The concern was precedence — prob_* is evaluation-first while
--     avgDist reads probs directly — so it was measured rather than assumed:
--     evaluation differs from probs on 0/914 rows, and prob_* differs from
--     probs.* on 0/914 rows. The 059 columns are an exact substitute.
--   * `row.value_bet_validation ?? payload.value_bet_validation` looks like a
--     third dependency. It is dead weight: 374 rows have a NULL column, and the
--     payload rescues 0 of them.
--
-- TYPES:
--
-- value_bet_kelly is numeric WITHOUT precision or scale, for the same reason 059
-- chose it: 590 of 914 values are non-integer (median 1.9) and JS serialises a
-- double as its shortest round-tripping decimal, so unbounded numeric returns
-- exactly what was stored. numeric(4,2) would round and move the drawdown.
--
-- value_bet_type is text, NOT an enum and NOT constrained. It reads like a 1X2
-- pick and is not: across 641 typed rows there are 56 distinct values, including
-- 'X2', '1X', 'Peste 3.5', 'Cards Under 3.5', 'Shots Under 26.5' and
-- 'Correct Score 0-0'. Only 208 rows carry '1', 'X' or '2'. It is stored
-- verbatim, exactly as the pipeline produced it.
--
-- NO constraints, NO indexes, NO trigger — the 059 reasoning applies unchanged:
--
--   - a CHECK on value_bet_type would have to enumerate a market vocabulary that
--     grows whenever a new market ships, and a rejected value fails the whole
--     bulk upsert, breaking Predict persistence.
--   - a CHECK on value_bet_kelly is equally wrong: the stake is clamped at READ
--     time (min(kelly/100, 0.03)), not at write time, so the stored value is
--     free to sit outside any range a constraint would guess.
--   - nothing filters or orders on these columns; they exist to be SELECTed.
--   - no trigger, so old rows are untouched and this is safe to apply while the
--     previous application version is still serving.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS only, no data written, no
-- raw_payload rewritten. Backfill is deliberately not here — it is a separate,
-- chunked, resumable operation, because doing it inline would be the very
-- unbounded statement these columns exist to remove.
--
-- Rollback is a code revert, never a migration: until the read path switches,
-- nothing reads these columns, so an unpopulated or half-populated table is
-- indistinguishable from today.

alter table public.predictions_history
  add column if not exists value_bet_kelly numeric,
  add column if not exists value_bet_type text;

comment on column public.predictions_history.value_bet_kelly is
  'valueBet.kelly — the Kelly stake as a PERCENTAGE (observed 0-3, median 1.9). Consumers clamp it as min(kelly/100, 0.03) at read time. NULL when absent; never 0, because 0 is a real stake.';
comment on column public.predictions_history.value_bet_type is
  'valueBet.type — the value-bet selection, stored VERBATIM. Free-form market text, not a 1X2 pick: 56 distinct values observed including X2, 1X, "Peste 3.5", "Cards Under 3.5", "Correct Score 0-0". NULL when absent; never an empty string.';
