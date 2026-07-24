-- 037: Capture the Context Engine's raw inputs at prediction time, so future
-- backtests can replay real injuries/lineups/rest-days/weather/referee data
-- instead of reconstructing a lossy approximation from the display payload.
-- Populated from data already fetched by moduleInputs.collectModuleInputs()
-- (no extra API-Football calls) plus referee stats computed from our own
-- settled predictions_history rows (Supabase read, not API-Football).

create table if not exists public.prediction_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  fixture_id bigint not null,
  model_version text not null,
  schema_version text not null default 'ctx-snapshot-v1',
  league_id integer,
  kickoff_at timestamptz,
  referee_name text,
  injuries jsonb,
  home_lineup jsonb,
  away_lineup jsonb,
  home_recent_matches jsonb,
  away_recent_matches jsonb,
  home_last_match_date timestamptz,
  away_last_match_date timestamptz,
  weather jsonb,
  referee_stats jsonb,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists prediction_context_snapshots_fixture_model_idx
  on public.prediction_context_snapshots (fixture_id, model_version, schema_version);

create index if not exists prediction_context_snapshots_kickoff_idx
  on public.prediction_context_snapshots (kickoff_at desc);

create index if not exists prediction_context_snapshots_league_idx
  on public.prediction_context_snapshots (league_id);

alter table public.prediction_context_snapshots enable row level security;
drop policy if exists "service_only_prediction_context_snapshots" on public.prediction_context_snapshots;
create policy "service_only_prediction_context_snapshots"
on public.prediction_context_snapshots
for all
using (false);

comment on table public.prediction_context_snapshots is
  'Raw Context Engine inputs captured at predict time for backtesting (service_role only). Additive/backward-compatible: absence of a row for a fixture means it predates this capture layer.';
