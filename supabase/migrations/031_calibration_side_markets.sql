-- 031: Widen calibration_maps outcomes for side-market calibration (O/U + BTTS).
-- Existing rows (1/X/2/O25/GG) remain valid; adds O15 and U35.
--
-- Apply on Supabase (SQL editor or CLI):
--   supabase db push
--   -- or paste this file into the SQL editor and run.
-- After apply, retrain: GET /api/cron/daily-ml?mode=all (calibration then stacker).

alter table public.calibration_maps
  drop constraint if exists calibration_maps_outcome_check;

alter table public.calibration_maps
  add constraint calibration_maps_outcome_check
  check (outcome in ('1', 'X', '2', 'O15', 'O25', 'U35', 'GG'));

comment on column public.calibration_maps.outcome is
  '1X2 outcomes plus side markets: O15, O25, U35, GG (binary isotonic maps).';
