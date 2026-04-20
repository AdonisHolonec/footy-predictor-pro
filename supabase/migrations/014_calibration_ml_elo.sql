-- 014: Post-model calibration (isotonic PAV), Elo team ratings, multinomial stacker weights,
--       and per-run model performance snapshots for observatory dashboards.

-- -----------------------------------------------------------------------------
-- 1. Isotonic calibration maps per (league_id, model_version, outcome).
--    PAV fit stores (raw, calibrated) point pairs; inference uses piecewise-linear interpolation.
-- -----------------------------------------------------------------------------
create table if not exists public.calibration_maps (
  id uuid primary key default gen_random_uuid(),
  league_id integer not null,
  model_version text not null,
  outcome text not null check (outcome in ('1', 'X', '2', 'O25', 'GG')),
  x_points numeric[] not null,
  y_points numeric[] not null,
  sample_size integer not null default 0,
  brier_raw numeric,
  brier_calibrated numeric,
  fitted_at timestamptz not null default now()
);

create unique index if not exists calibration_maps_unique_idx
  on public.calibration_maps (league_id, model_version, outcome);

create index if not exists calibration_maps_fitted_idx
  on public.calibration_maps (fitted_at desc);

alter table public.calibration_maps enable row level security;
drop policy if exists "service_only_calibration_maps" on public.calibration_maps;
create policy "service_only_calibration_maps"
on public.calibration_maps
for all
using (false);

comment on table public.calibration_maps is
  'Isotonic PAV calibration (raw → empirical) per (league, model_version, outcome). Service role only.';

-- -----------------------------------------------------------------------------
-- 2. Elo team ratings (per team, optionally scoped per league). One row per team.
--    Rebuilt by scripts/rebuildElo.js; updated incrementally by cron/elo-update.
-- -----------------------------------------------------------------------------
create table if not exists public.team_elo (
  team_id bigint not null,
  league_id integer not null,
  elo numeric not null default 1500,
  matches_played integer not null default 0,
  last_match_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (team_id, league_id)
);

create index if not exists team_elo_league_idx on public.team_elo (league_id);
create index if not exists team_elo_updated_idx on public.team_elo (updated_at desc);

alter table public.team_elo enable row level security;
drop policy if exists "service_only_team_elo" on public.team_elo;
create policy "service_only_team_elo"
on public.team_elo
for all
using (false);

comment on table public.team_elo is 'Goal-based Elo ratings per (team, league). Service role only.';

-- -----------------------------------------------------------------------------
-- 3. Multinomial logistic regression weights (stacker) per (league_id, model_version).
--    weights_json: { intercept:[3], coef:[[n_features x 3]], feature_names:[string] }
-- -----------------------------------------------------------------------------
create table if not exists public.ml_stacker_weights (
  id uuid primary key default gen_random_uuid(),
  league_id integer,
  model_version text not null,
  weights_json jsonb not null,
  feature_count integer,
  sample_size integer,
  metrics_json jsonb,
  fitted_at timestamptz not null default now(),
  active boolean not null default true
);

create unique index if not exists ml_stacker_weights_active_idx
  on public.ml_stacker_weights (league_id, model_version)
  where active;

create index if not exists ml_stacker_weights_fitted_idx
  on public.ml_stacker_weights (fitted_at desc);

alter table public.ml_stacker_weights enable row level security;
drop policy if exists "service_only_ml_stacker_weights" on public.ml_stacker_weights;
create policy "service_only_ml_stacker_weights"
on public.ml_stacker_weights
for all
using (false);

comment on table public.ml_stacker_weights is
  'Multinomial LR stacker weights per league. league_id NULL = global fallback. Service role only.';

-- -----------------------------------------------------------------------------
-- 4. Model performance snapshots (per model_version + window) for observatory trend.
--    Different from backtest_snapshots (which is value-bet ROI focused).
-- -----------------------------------------------------------------------------
create table if not exists public.model_performance_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default (now() at time zone 'utc')::date,
  model_version text not null,
  league_id integer,
  window_days integer not null,
  sample_size integer not null default 0,
  brier numeric,
  log_loss numeric,
  ece numeric,
  hit_rate numeric,
  metrics_json jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists model_performance_snapshots_unique_idx
  on public.model_performance_snapshots (snapshot_date, model_version, league_id, window_days);

alter table public.model_performance_snapshots enable row level security;
drop policy if exists "service_only_model_performance_snapshots" on public.model_performance_snapshots;
create policy "service_only_model_performance_snapshots"
on public.model_performance_snapshots
for all
using (false);

comment on table public.model_performance_snapshots is
  'Daily Brier/logloss/ECE per (model_version, league_id, window). Service role only.';
