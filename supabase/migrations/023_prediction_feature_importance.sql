-- 023: Store per-prediction feature importance contributions for ML / analytics.
-- Populated from FeatureImportanceEngine; does not affect online predict math.

create table if not exists public.prediction_feature_importance (
  id uuid primary key default gen_random_uuid(),
  fixture_id bigint not null,
  model_version text not null,
  schema_version text not null default 'fi-v1',
  league_id integer,
  kickoff_at timestamptz,
  recommended_pick text,
  contributions jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  top_features text[] not null default '{}',
  method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists prediction_feature_importance_fixture_model_idx
  on public.prediction_feature_importance (fixture_id, model_version, schema_version);

create index if not exists prediction_feature_importance_kickoff_idx
  on public.prediction_feature_importance (kickoff_at desc);

create index if not exists prediction_feature_importance_league_idx
  on public.prediction_feature_importance (league_id);

alter table public.prediction_feature_importance enable row level security;
drop policy if exists "service_only_prediction_feature_importance" on public.prediction_feature_importance;
create policy "service_only_prediction_feature_importance"
on public.prediction_feature_importance
for all
using (false);

comment on table public.prediction_feature_importance is
  'Per-fixture feature contribution % for UI charts and future ML (service_role only).';
