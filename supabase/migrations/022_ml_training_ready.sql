-- 022: ML-ready training scaffolding (NO model training in this migration).
-- Provides a feature-store style table for labeled examples derived from predictions_history,
-- plus a model registry stub for future XGBoost / CatBoost / RF / LightGBM / NN adapters.

-- -----------------------------------------------------------------------------
-- 1. Training examples (flat feature rows + labels). Populated by offline jobs later.
-- -----------------------------------------------------------------------------
create table if not exists public.ml_training_examples (
  id uuid primary key default gen_random_uuid(),
  fixture_id bigint not null,
  league_id integer,
  kickoff_at timestamptz,
  model_version text not null,
  feature_schema_version text not null default 'fs-v1',
  -- Labels (null until match is settled / known)
  label_1x2 text check (label_1x2 is null or label_1x2 in ('1', 'X', '2')),
  label_gg boolean,
  label_over25 boolean,
  -- Dense feature payload used by trainers
  features jsonb not null default '{}'::jsonb,
  feature_names text[] not null default '{}',
  -- Provenance
  source_row jsonb,
  split text check (split is null or split in ('train', 'valid', 'test', 'holdout')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ml_training_examples_fixture_schema_idx
  on public.ml_training_examples (fixture_id, model_version, feature_schema_version);

create index if not exists ml_training_examples_kickoff_idx
  on public.ml_training_examples (kickoff_at desc);

create index if not exists ml_training_examples_league_split_idx
  on public.ml_training_examples (league_id, split);

create index if not exists ml_training_examples_label_idx
  on public.ml_training_examples (label_1x2)
  where label_1x2 is not null;

alter table public.ml_training_examples enable row level security;
drop policy if exists "service_only_ml_training_examples" on public.ml_training_examples;
create policy "service_only_ml_training_examples"
on public.ml_training_examples
for all
using (false);

comment on table public.ml_training_examples is
  'ML-ready labeled feature rows (populated offline). Not used by online predict yet. Service role only.';

-- -----------------------------------------------------------------------------
-- 2. Model registry (metadata only — no weights / no inference wiring yet).
-- -----------------------------------------------------------------------------
create table if not exists public.ml_model_registry (
  id uuid primary key default gen_random_uuid(),
  model_key text not null,
  family text not null check (
    family in ('xgboost', 'catboost', 'random_forest', 'lightgbm', 'neural_net', 'stacker_lr', 'isotonic', 'other')
  ),
  task text not null default '1x2' check (task in ('1x2', 'o25', 'gg', 'value', 'multi')),
  feature_schema_version text not null default 'fs-v1',
  model_version text not null,
  status text not null default 'planned'
    check (status in ('planned', 'training', 'candidate', 'active', 'retired', 'failed')),
  metrics_json jsonb,
  artifact_uri text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ml_model_registry_key_version_idx
  on public.ml_model_registry (model_key, model_version);

create index if not exists ml_model_registry_status_idx
  on public.ml_model_registry (status, family);

alter table public.ml_model_registry enable row level security;
drop policy if exists "service_only_ml_model_registry" on public.ml_model_registry;
create policy "service_only_ml_model_registry"
on public.ml_model_registry
for all
using (false);

comment on table public.ml_model_registry is
  'Future model registry (XGBoost/CatBoost/RF/LightGBM/NN). Metadata only until trainers land.';

-- Seed planned model slots (idempotent).
insert into public.ml_model_registry (model_key, family, task, feature_schema_version, model_version, status, notes)
values
  ('planned_xgboost_1x2', 'xgboost', '1x2', 'fs-v1', 'planned', 'planned', 'Gradient boosting classifier for 1X2'),
  ('planned_catboost_1x2', 'catboost', '1x2', 'fs-v1', 'planned', 'planned', 'CatBoost with categorical league_id'),
  ('planned_rf_1x2', 'random_forest', '1x2', 'fs-v1', 'planned', 'planned', 'Random Forest baseline'),
  ('planned_lightgbm_1x2', 'lightgbm', '1x2', 'fs-v1', 'planned', 'planned', 'LightGBM ranking/classifier'),
  ('planned_nn_1x2', 'neural_net', '1x2', 'fs-v1', 'planned', 'planned', 'Small MLP / tabular NN')
on conflict (model_key, model_version) do nothing;
