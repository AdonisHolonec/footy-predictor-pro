-- 049: Asian totals — honest settlement outcomes for integer/quarter lines.
--
-- Increment B (Asian O/U semantics) settles integer lines with a push when the
-- observed total equals the line, and quarter lines with half_win / half_loss.
-- The original CHECK from 001 only allowed pending/win/loss, which forced a
-- push to be persisted as a lie (win inflates accuracy, loss destroys it,
-- pending hangs forever in the health counters).
--
-- Additive only: every previously valid value remains valid. Deploy order:
-- this migration must be applied before code that can emit the new outcomes.
--
-- Deliberately NOT extended here (reported, not silently changed):
--   * prediction_benchmarks.our_result/api_result (039) — benchmark grades
--     goals 1.5/2.5/3.5 only; no push is reachable there today.
--   * meta-learning result (040) — separate grading path with its own
--     'ungradeable' state; extending it is a follow-up decision.
--   * special_bets/special_bet_selections status (043) — push maps to the
--     existing 'void' (multiplier 1.00); quarter legs are gated out of the
--     Global Special Bet until half outcomes can be represented per leg.

alter table public.predictions_history
  drop constraint if exists predictions_history_validation_check;

alter table public.predictions_history
  add constraint predictions_history_validation_check
  check (validation in ('pending', 'win', 'loss', 'push', 'half_win', 'half_loss'));

comment on column public.predictions_history.validation is
  'Settlement of the recommended pick. pending/win/loss, plus Asian outcomes: push (stake returned, actual == integer line), half_win / half_loss (quarter lines).';
