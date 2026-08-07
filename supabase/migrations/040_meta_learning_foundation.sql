-- 040: Meta Learning & Benchmark Intelligence foundation (Sprint 1).
--
-- A separate, additive, READ-ONLY analytics layer over data that already exists in
-- predictions_history + prediction_benchmarks. See
-- docs/META_LEARNING_BENCHMARK_INTELLIGENCE.md for the full design.
--
-- Nothing here is read by PredictorV3 / server-utils/PredictionEngine / Stage00-12 /
-- the Recommendation Engine / ValueEngine. Nothing here writes to predictions_history
-- or prediction_benchmarks. Populated entirely by a decoupled cron
-- (api/cron/daily-ml.js?mode=meta-learning-refresh ->
-- server-utils/metaLearning/runMetaLearningRefresh.js).
--
-- Grain note: prediction_benchmarks is pairwise + fixture-grained (one row = our pick
-- vs THE api pick). That shape cannot express N providers. These tables move to a
-- selection grain — one row per (provider, fixture, market family, selection) — with
-- PredictorV3 registered as just another provider, so adding a provider is a registry
-- row plus an adapter, never a schema change.
--
-- All tables are service_role only (RLS enabled, `using (false)`), matching the
-- convention established by migrations 022 / 024 / 035 / 037 / 039.

-- -----------------------------------------------------------------------------
-- 1. Provider registry (dimension). Adding a provider = one row.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_providers (
  id serial primary key,
  key text not null unique,
  display_name text not null,
  kind text not null default 'external' check (kind in ('internal', 'external')),
  supports_odds boolean not null default false,
  supports_confidence boolean not null default false,
  covered_families text[] not null default '{}',
  schema_version text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.meta_providers is
  'Prediction provider registry for the meta-learning layer. PredictorV3 is registered as a provider so head-to-head is a symmetric self-join. Service role only.';

insert into public.meta_providers
  (key, display_name, kind, supports_odds, supports_confidence, covered_families, schema_version, notes)
values
  (
    'predictor_v3', 'PredictorV3', 'internal', true, true,
    '{1x2,dc,btts,ou,ou_other,corners,cards,shots,correct_score}',
    'stage08',
    'Our own published recommendation, read from predictions_history. Never modified by this layer.'
  ),
  (
    'api_football', 'API-Football', 'external', false, true,
    '{1x2,ou,btts,dc}',
    'afb-v1',
    'Publishes no odds (ROI requires counterfactual pricing). Confidence (winPercent) exists for 1X2 only; btts/dc are derived from free-text advice and are second-class signals.'
  )
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Materialized context vector (dimension). Pure projection of columns we
--    already store — no upstream API calls, fully recomputable at any time.
--    context_version lets bucket definitions evolve without destroying history.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_fixture_context (
  id bigserial primary key,
  fixture_id bigint not null,
  model_version text not null,
  context_version text not null default 'ctx-v1',

  league_id integer,
  league_name text,
  league_tier smallint,
  league_quality text,

  -- Not stored on predictions_history or prediction_benchmarks; recovered from
  -- prediction_benchmarks.api_raw during ETL so the sweep's /fixtures lookup never
  -- has to be repeated for analytics.
  home_team_id integer,
  away_team_id integer,

  kickoff_at timestamptz,
  season_phase text check (season_phase is null or season_phase in ('early', 'mid', 'late')),
  days_since_season_start integer,

  odds_home numeric,
  odds_draw numeric,
  odds_away numeric,
  closing_odds_home numeric,
  closing_odds_draw numeric,
  closing_odds_away numeric,

  favourite_side text check (favourite_side is null or favourite_side in ('home', 'away', 'none')),
  favourite_implied_prob numeric,
  favouritism_class text check (
    favouritism_class is null or favouritism_class in
      ('clear_favourite', 'moderate_favourite', 'balanced', 'outsider_led')
  ),
  pick_is_favourite boolean,
  odds_band text,

  -- 1X2 only: closing odds are captured for 1X2 columns only (migration 030).
  market_move_pct numeric,
  market_move_class text check (
    market_move_class is null or market_move_class in ('toward', 'against', 'flat', 'unknown')
  ),

  match_status text,
  score_home integer,
  score_away integer,
  settled boolean not null default false,

  computed_at timestamptz not null default now()
);

create unique index if not exists meta_fixture_context_unique_idx
  on public.meta_fixture_context (fixture_id, model_version, context_version);

create index if not exists meta_fixture_context_kickoff_idx
  on public.meta_fixture_context (kickoff_at desc);

create index if not exists meta_fixture_context_league_idx
  on public.meta_fixture_context (league_id, league_tier);

comment on table public.meta_fixture_context is
  'Derived per-fixture context buckets (league tier, odds band, favouritism, season phase, market move) for meta-learning segmentation. Pure projection of predictions_history; no upstream calls. Service role only.';

-- -----------------------------------------------------------------------------
-- 3. Fact table: one row per provider opinion, at selection grain.
--    is_primary=false rows capture secondary family opinions that
--    prediction_benchmarks.consensus.perFamilyBreakdown already stores but that
--    nothing currently analyses.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_provider_selections (
  id bigserial primary key,
  fixture_id bigint not null,
  provider_id integer not null references public.meta_providers (id),
  model_version text not null,

  market_family text not null,
  selection text not null,
  line numeric,
  is_primary boolean not null default true,

  stated_confidence numeric,
  signal_source text,
  -- 1 = structural upstream field, 2 = derived, 3 = free-text advice (least trusted).
  signal_quality smallint not null default 1 check (signal_quality between 1 and 3),

  -- API-Football publishes no price. Rather than fabricate one, a provider selection is
  -- priced at the market odd WE recorded for that same selection on that same fixture —
  -- a counterfactual, labelled by provenance and never presented as the provider's own
  -- quote. priced_from='unpriced' means no ROI may be reported for this row.
  priced_odd numeric,
  priced_from text not null default 'unpriced' check (
    priced_from in ('own_quote', 'our_recorded_1x2', 'our_value_quote', 'unpriced')
  ),
  closing_odd numeric,
  clv_pct numeric,

  result text not null default 'pending' check (result in ('pending', 'win', 'loss', 'ungradeable')),
  pnl_units numeric,

  settled_at timestamptz,
  kickoff_at timestamptz,
  source_row jsonb,
  created_at timestamptz not null default now()
);

-- COALESCE on line: NULL never equals NULL in a unique index, so an unlined market
-- would otherwise admit duplicates on re-runs of an idempotent ETL.
create unique index if not exists meta_provider_selections_unique_idx
  on public.meta_provider_selections
     (fixture_id, provider_id, model_version, market_family, selection, coalesce(line, -1));

create index if not exists meta_provider_selections_fixture_idx
  on public.meta_provider_selections (fixture_id);

create index if not exists meta_provider_selections_provider_family_idx
  on public.meta_provider_selections (provider_id, market_family, result);

create index if not exists meta_provider_selections_kickoff_idx
  on public.meta_provider_selections (kickoff_at desc);

comment on table public.meta_provider_selections is
  'Selection-grained provider predictions (one row per provider/fixture/family/selection) — the fact table that makes multi-provider comparison possible without schema change. Projected read-only from predictions_history + prediction_benchmarks. Service role only.';

-- -----------------------------------------------------------------------------
-- 4. Segment rollup (Sprint 2 consumer; created now so the ETL contract is fixed).
-- -----------------------------------------------------------------------------
create table if not exists public.meta_segment_performance (
  id bigserial primary key,
  provider_id integer not null references public.meta_providers (id),
  model_version text not null,

  segment_kind text not null,
  segment_key text not null,
  market_family text not null default 'all',
  window_days integer not null,
  window_end date not null,

  n integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,

  hit_rate numeric,
  hit_rate_shrunk numeric,
  wilson_low numeric,
  wilson_high numeric,

  roi numeric,
  yield_pct numeric,
  expected_value numeric,
  kelly_growth_pct numeric,
  max_drawdown numeric,
  sharpe numeric,

  brier numeric,
  log_loss numeric,
  ece numeric,

  -- Share of n that had a usable price. Below the configured floor, no ROI verdict
  -- may be displayed for this segment — only a hit-rate verdict.
  priced_coverage_pct numeric,

  metrics_json jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create unique index if not exists meta_segment_performance_unique_idx
  on public.meta_segment_performance
     (provider_id, model_version, segment_kind, segment_key, market_family, window_days, window_end);

create index if not exists meta_segment_performance_lookup_idx
  on public.meta_segment_performance (segment_kind, segment_key, window_end desc);

comment on table public.meta_segment_performance is
  'Per-provider aggregate performance per context segment and window. Every rate is stored with its sample size, Wilson bounds, shrunk estimate and price coverage. Service role only.';

-- -----------------------------------------------------------------------------
-- 5. Pairwise verdicts (Sprint 3 consumer).
--    discordant_n = only_a_correct + only_b_correct is the REAL sample size for a
--    head-to-head claim: both_correct/both_wrong carry no information about which
--    provider is better, which is why McNemar tests b vs c only.
-- -----------------------------------------------------------------------------
create table if not exists public.meta_pairwise_verdicts (
  id bigserial primary key,
  provider_a_id integer not null references public.meta_providers (id),
  provider_b_id integer not null references public.meta_providers (id),
  model_version text not null,

  segment_kind text not null,
  segment_key text not null,
  market_family text not null default 'all',
  window_days integer not null,
  window_end date not null,

  n_paired integer not null default 0,
  both_correct integer not null default 0,
  both_wrong integer not null default 0,
  only_a_correct integer not null default 0,
  only_b_correct integer not null default 0,
  discordant_n integer not null default 0,

  hit_rate_delta numeric,
  roi_delta numeric,

  mcnemar_statistic numeric,
  p_value numeric,
  -- Benjamini-Hochberg adjusted. Verdicts key off q, never off p.
  q_value numeric,
  effect_size numeric,
  dominance_score numeric,

  verdict text not null default 'insufficient_data' check (
    verdict in ('a_dominant', 'a_leaning', 'inconclusive', 'b_leaning', 'b_dominant', 'insufficient_data')
  ),
  -- Only 'walk_forward_oos' verdicts may ever be labelled *_dominant.
  fold_scheme text not null default 'in_sample' check (fold_scheme in ('walk_forward_oos', 'in_sample')),

  evidence_json jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now()
);

create unique index if not exists meta_pairwise_verdicts_unique_idx
  on public.meta_pairwise_verdicts
     (provider_a_id, provider_b_id, model_version, segment_kind, segment_key,
      market_family, window_days, window_end);

create index if not exists meta_pairwise_verdicts_verdict_idx
  on public.meta_pairwise_verdicts (verdict, q_value);

comment on table public.meta_pairwise_verdicts is
  'McNemar-tested, BH-corrected head-to-head verdicts per context segment. insufficient_data is a first-class verdict, not an empty cell. Service role only.';

-- -----------------------------------------------------------------------------
-- 6. Calibration bins + fitted (DORMANT) recalibration maps (Sprint 4 consumers).
-- -----------------------------------------------------------------------------
create table if not exists public.meta_calibration_bins (
  id bigserial primary key,
  provider_id integer not null references public.meta_providers (id),
  model_version text not null,
  market_family text not null default 'all',
  league_tier smallint,

  bin_low numeric not null,
  bin_high numeric not null,
  n integer not null default 0,
  stated_mean numeric,
  realised_rate numeric,
  wilson_low numeric,
  wilson_high numeric,

  window_days integer not null,
  window_end date not null,
  computed_at timestamptz not null default now()
);

create unique index if not exists meta_calibration_bins_unique_idx
  on public.meta_calibration_bins
     (provider_id, model_version, market_family, coalesce(league_tier, -1),
      bin_low, window_days, window_end);

comment on table public.meta_calibration_bins is
  'Reliability-diagram bins (stated confidence -> realised hit rate) per provider. Service role only.';

create table if not exists public.meta_confidence_calibration (
  id bigserial primary key,
  provider_id integer not null references public.meta_providers (id),
  model_version text not null,
  market_family text not null default 'all',
  scope text not null default 'global',

  method text not null check (method in ('isotonic_pav', 'platt', 'linear_shift')),
  -- Same shape as calibration_maps (migration 014): PAV point pairs, piecewise-linear
  -- interpolation at inference.
  x_points numeric[] not null default '{}',
  y_points numeric[] not null default '{}',

  overconfidence_slope numeric,
  overconfidence_intercept numeric,
  ece_before numeric,
  ece_after numeric,
  brier_before numeric,
  brier_after numeric,
  sample_size integer not null default 0,

  active boolean not null default true,
  -- HARD OFF. No code reads this column. It exists so that a future, separately
  -- approved activation is a visible auditable flag rather than a silent diff.
  -- Phase X does not apply any recalibration to PredictorV3's runtime output.
  applied_at_runtime boolean not null default false,

  fitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists meta_confidence_calibration_active_uidx
  on public.meta_confidence_calibration (provider_id, model_version, market_family, scope)
  where active = true;

comment on table public.meta_confidence_calibration is
  'Fitted but DORMANT confidence recalibration maps. applied_at_runtime is always false in this phase and is read by no code — PredictorV3 output is never modified. Admin/shadow-evaluation only. Service role only.';

-- -----------------------------------------------------------------------------
-- 7. Drift events (Sprint 4 consumer).
-- -----------------------------------------------------------------------------
create table if not exists public.meta_drift_events (
  id bigserial primary key,
  provider_id integer references public.meta_providers (id),
  model_version text,
  segment_kind text,
  segment_key text,

  metric text not null,
  detector text not null,
  baseline_value numeric,
  current_value numeric,
  statistic numeric,
  threshold numeric,
  severity text not null default 'info' check (severity in ('info', 'warn', 'critical')),

  window_days integer,
  evidence_json jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);

create index if not exists meta_drift_events_detected_idx
  on public.meta_drift_events (detected_at desc, severity);

comment on table public.meta_drift_events is
  'Drift detections (CUSUM / Page-Hinkley / PSI) on provider performance and context distribution. Service role only.';

-- -----------------------------------------------------------------------------
-- 8. Run journal, mirroring calibration_runs (migration 024).
-- -----------------------------------------------------------------------------
create table if not exists public.meta_learning_runs (
  id bigserial primary key,
  mode text not null default 'refresh',
  started_at timestamptz not null,
  finished_at timestamptz,
  ok boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists meta_learning_runs_started_idx
  on public.meta_learning_runs (started_at desc);

comment on table public.meta_learning_runs is
  'Meta-learning ETL run journal (mirrors calibration_runs). Service role only.';

-- -----------------------------------------------------------------------------
-- RLS: service role / backend only. No public policies anywhere in this layer.
-- -----------------------------------------------------------------------------
alter table public.meta_providers enable row level security;
alter table public.meta_fixture_context enable row level security;
alter table public.meta_provider_selections enable row level security;
alter table public.meta_segment_performance enable row level security;
alter table public.meta_pairwise_verdicts enable row level security;
alter table public.meta_calibration_bins enable row level security;
alter table public.meta_confidence_calibration enable row level security;
alter table public.meta_drift_events enable row level security;
alter table public.meta_learning_runs enable row level security;

drop policy if exists "service_only_meta_providers" on public.meta_providers;
create policy "service_only_meta_providers" on public.meta_providers for all using (false);

drop policy if exists "service_only_meta_fixture_context" on public.meta_fixture_context;
create policy "service_only_meta_fixture_context" on public.meta_fixture_context for all using (false);

drop policy if exists "service_only_meta_provider_selections" on public.meta_provider_selections;
create policy "service_only_meta_provider_selections" on public.meta_provider_selections for all using (false);

drop policy if exists "service_only_meta_segment_performance" on public.meta_segment_performance;
create policy "service_only_meta_segment_performance" on public.meta_segment_performance for all using (false);

drop policy if exists "service_only_meta_pairwise_verdicts" on public.meta_pairwise_verdicts;
create policy "service_only_meta_pairwise_verdicts" on public.meta_pairwise_verdicts for all using (false);

drop policy if exists "service_only_meta_calibration_bins" on public.meta_calibration_bins;
create policy "service_only_meta_calibration_bins" on public.meta_calibration_bins for all using (false);

drop policy if exists "service_only_meta_confidence_calibration" on public.meta_confidence_calibration;
create policy "service_only_meta_confidence_calibration" on public.meta_confidence_calibration for all using (false);

drop policy if exists "service_only_meta_drift_events" on public.meta_drift_events;
create policy "service_only_meta_drift_events" on public.meta_drift_events for all using (false);

drop policy if exists "service_only_meta_learning_runs" on public.meta_learning_runs;
create policy "service_only_meta_learning_runs" on public.meta_learning_runs for all using (false);
