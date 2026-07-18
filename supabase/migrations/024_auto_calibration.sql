-- Auto Calibration Engine: weight overlays + run history.
-- Never mutates DEFAULT_* code constants or env-configured manual weights.
-- Overlays are applied at runtime only for keys that are not env-locked.

create table if not exists public.auto_calibration_overlays (
  id bigserial primary key,
  model_version text not null,
  kind text not null check (kind in ('confidence', 'feature_importance', 'prediction', 'value')),
  scope text not null default 'global',
  weights_json jsonb not null default '{}'::jsonb,
  deltas_json jsonb not null default '{}'::jsonb,
  locked_keys jsonb not null default '[]'::jsonb,
  metrics_json jsonb not null default '{}'::jsonb,
  sample_size integer not null default 0,
  active boolean not null default true,
  fitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists auto_calibration_overlays_active_uidx
  on public.auto_calibration_overlays (model_version, kind, scope)
  where active = true;

create index if not exists auto_calibration_overlays_fitted_idx
  on public.auto_calibration_overlays (fitted_at desc);

create table if not exists public.calibration_runs (
  id bigserial primary key,
  model_version text not null,
  mode text not null default 'auto',
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  report_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists calibration_runs_started_idx
  on public.calibration_runs (started_at desc);

alter table public.auto_calibration_overlays enable row level security;
alter table public.calibration_runs enable row level security;

-- Service role / backend only (no public policies).
