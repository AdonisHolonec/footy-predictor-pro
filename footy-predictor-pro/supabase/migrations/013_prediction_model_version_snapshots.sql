-- Model versioning, value-bet validation column, immutable prediction_snapshots for analysis.

alter table public.predictions_history
  add column if not exists model_version text;

alter table public.predictions_history
  add column if not exists value_bet_validation text;

create table if not exists public.prediction_snapshots (
  id uuid primary key default gen_random_uuid (),
  fixture_id bigint not null,
  model_version text not null,
  generated_at timestamptz not null default now (),
  league_id integer,
  kickoff_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists prediction_snapshots_fixture_version_idx
  on public.prediction_snapshots (fixture_id, model_version);

create index if not exists prediction_snapshots_kickoff_idx
  on public.prediction_snapshots (kickoff_at desc);

alter table public.prediction_snapshots enable row level security;

drop policy if exists "service_only_prediction_snapshots" on public.prediction_snapshots;

create policy "service_only_prediction_snapshots"
on public.prediction_snapshots
for all
using (false);

comment on table public.prediction_snapshots is 'Immutable runs per fixture+model_version for calibration and A/B (service role only).';
