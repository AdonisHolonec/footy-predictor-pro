-- 025: Persist which calibration method won the daily-ml bake-off
-- (isotonic / platt / temperature / beta / none) plus CV metrics for audit.

alter table public.calibration_maps
  add column if not exists method text not null default 'isotonic';

alter table public.calibration_maps
  add column if not exists metrics_json jsonb;

comment on column public.calibration_maps.method is
  'Winning calibration method: isotonic | platt | temperature | beta | none';

comment on column public.calibration_maps.metrics_json is
  'CV ranking + baseline metrics from CalibrationSelector (logLoss/ECE/Brier).';
