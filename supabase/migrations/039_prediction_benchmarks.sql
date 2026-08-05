-- 039: API-Football /predictions benchmark capture — comparison-only.
-- Stores our own finalized recommendation (copied from predictions_history at
-- sweep time), API-Football's normalized prediction, the deterministic
-- BenchmarkConsensus comparison result, and (once settled) the final result —
-- for long-term analytics only (Admin Benchmark Dashboard). Never read by
-- PredictorV3 / Stage00-08 / the Recommendation Engine; populated entirely by
-- a decoupled cron sweep (server-utils/predictionBenchmark/runBenchmarkSweep.js)
-- that reads already-persisted predictions_history rows.

create table if not exists public.prediction_benchmarks (
  id uuid primary key default gen_random_uuid(),
  fixture_id bigint not null,
  league_id integer,
  kickoff_at timestamptz,
  model_version text not null,
  schema_version text not null default 'benchmark-v1',

  our_pick text not null,
  our_family text,
  our_confidence numeric,
  our_odd numeric,

  api_prediction jsonb not null,
  api_raw jsonb,

  consensus jsonb not null,
  agree boolean,
  confidence_delta numeric,

  score_home integer,
  score_away integer,
  our_result text not null default 'pending' check (our_result in ('pending', 'win', 'loss')),
  api_result text not null default 'pending' check (api_result in ('pending', 'win', 'loss')),

  fetched_at timestamptz not null default now(),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists prediction_benchmarks_fixture_model_idx
  on public.prediction_benchmarks (fixture_id, model_version, schema_version);

create index if not exists prediction_benchmarks_kickoff_idx
  on public.prediction_benchmarks (kickoff_at desc);

create index if not exists prediction_benchmarks_league_idx
  on public.prediction_benchmarks (league_id);

create index if not exists prediction_benchmarks_agree_idx
  on public.prediction_benchmarks (agree);

alter table public.prediction_benchmarks enable row level security;
drop policy if exists "service_only_prediction_benchmarks" on public.prediction_benchmarks;
create policy "service_only_prediction_benchmarks"
on public.prediction_benchmarks
for all
using (false);

comment on table public.prediction_benchmarks is
  'API-Football /predictions benchmark vs our own recommendation, comparison-only (service_role only). Never consumed by PredictorV3/Stage00-08 or the Recommendation Engine — read-only analytics + admin dashboard input.';
