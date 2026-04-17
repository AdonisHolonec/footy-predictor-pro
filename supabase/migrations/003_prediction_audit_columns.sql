alter table if exists public.predictions_history
  add column if not exists reason_codes jsonb,
  add column if not exists top_features jsonb;
