-- Observability S3: persisted health snapshots + the aggregate functions that feed them.
--
-- Why a snapshot rather than live queries: the Health dashboard needs averages and
-- distributions over predictions_history, which is thousands of rows. Running those
-- aggregates on every dashboard open would turn a status page into the slowest endpoint
-- in the product. The cron computes them once and writes one row; the dashboard reads
-- that row. Live probes (KV, Supabase, quota, route latency) stay real-time in
-- healthBundle.js and are deliberately NOT part of this table.
--
-- Everything here is read-only with respect to existing data: the functions only SELECT.

create table if not exists public.ops_health_snapshots (
  id bigserial primary key,
  captured_at timestamptz not null default now(),
  window_days integer not null default 7,
  prediction jsonb not null default '{}'::jsonb,
  settlement jsonb not null default '{}'::jsonb,
  business jsonb not null default '{}'::jsonb,
  notifications jsonb not null default '{}'::jsonb,
  cron jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ops_health_snapshots_captured_idx
  on public.ops_health_snapshots (captured_at desc);

alter table public.ops_health_snapshots enable row level security;

drop policy if exists "service_only_ops_health_snapshots" on public.ops_health_snapshots;
create policy "service_only_ops_health_snapshots"
  on public.ops_health_snapshots for all using (false);

comment on table public.ops_health_snapshots is
  'Ops health snapshots written by the daily cron; the dashboard reads the newest row. Service role only.';

-- -----------------------------------------------------------------------------
-- Prediction aggregates.
--
-- Odds and EV live in raw_payload rather than columns, so both are guarded by a numeric
-- regex before the cast: a malformed payload must yield a null average, never abort the
-- whole snapshot.
-- -----------------------------------------------------------------------------
create or replace function public.ops_prediction_aggregates (p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select *
    from public.predictions_history
    where kickoff_at >= (timezone('utc', now())
      - (greatest(1, least(coalesce(p_days, 7), 120))) * interval '1 day')
      and recommended_pick is not null
  ),
  base as (
    select
      count(*)::bigint as total,
      round(avg(recommended_confidence)::numeric, 2) as avg_confidence,
      round(avg(
        case when raw_payload->'recommended'->>'odd' ~ '^[0-9]+(\.[0-9]+)?$'
             then (raw_payload->'recommended'->>'odd')::numeric end
      )::numeric, 3) as avg_odds,
      round(avg(
        case when raw_payload->'valueBet'->>'ev' ~ '^-?[0-9]+(\.[0-9]+)?$'
             then (raw_payload->'valueBet'->>'ev')::numeric end
      )::numeric, 4) as avg_ev
    from win
  ),
  families as (
    select coalesce(nullif(raw_payload->'recommended'->>'family', ''), 'unknown') as family,
           count(*)::bigint as n
    from win
    group by 1
    order by n desc
    limit 20
  ),
  leagues as (
    select coalesce(league_id, 0) as league_id,
           coalesce(nullif(league_name, ''), 'unknown') as league_name,
           count(*)::bigint as n
    from win
    group by 1, 2
    order by n desc
    limit 10
  )
  select jsonb_build_object(
    'windowDays', greatest(1, least(coalesce(p_days, 7), 120)),
    'total', (select total from base),
    'avgConfidence', (select avg_confidence from base),
    'avgOdds', (select avg_odds from base),
    'avgEv', (select avg_ev from base),
    'byFamily', coalesce((select jsonb_agg(jsonb_build_object('family', family, 'count', n)) from families), '[]'::jsonb),
    'topLeagues', coalesce((select jsonb_agg(jsonb_build_object('leagueId', league_id, 'league', league_name, 'count', n)) from leagues), '[]'::jsonb)
  );
$$;

revoke all on function public.ops_prediction_aggregates (integer) from public;
grant execute on function public.ops_prediction_aggregates (integer) to service_role;

-- -----------------------------------------------------------------------------
-- Settlement aggregates.
--
-- `recommendedPending` is the number the P0 settlement inconsistency hid: finished
-- fixtures whose recommended pick never reached win/loss. S1 records it per sync run;
-- this measures the same quantity against the database rather than a run result, so the
-- two can be cross-checked.
-- -----------------------------------------------------------------------------
create or replace function public.ops_settlement_aggregates (p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select *
    from public.predictions_history
    where kickoff_at >= (timezone('utc', now())
      - (greatest(1, least(coalesce(p_days, 7), 120))) * interval '1 day')
  ),
  fin as (
    select * from win where match_status in ('FT', 'AET', 'PEN')
  )
  select jsonb_build_object(
    'windowDays', greatest(1, least(coalesce(p_days, 7), 120)),
    'rows', (select count(*) from win),
    'finished', (select count(*) from fin),
    'settled', (select count(*) from fin where validation in ('win', 'loss')),
    'pending', (select count(*) from fin where validation not in ('win', 'loss')),
    'recommendedPending', (select count(*) from fin
                            where recommended_pick is not null
                              and validation not in ('win', 'loss')),
    'settlementSuccessPct', (
      select case when count(*) = 0 then null
             else round((count(*) filter (where validation in ('win', 'loss'))::numeric
                         / count(*)::numeric) * 100, 1) end
      from fin
    ),
    -- Kickoff to settlement write, in minutes. Only settled rows contribute.
    'avgSettlementMinutes', (
      select round(avg(extract(epoch from (updated_at - kickoff_at)) / 60)::numeric, 1)
      from fin where validation in ('win', 'loss') and updated_at >= kickoff_at
    ),
    'oldestPendingAt', (
      select min(kickoff_at) from fin where validation not in ('win', 'loss')
    )
  );
$$;

revoke all on function public.ops_settlement_aggregates (integer) from public;
grant execute on function public.ops_settlement_aggregates (integer) to service_role;

-- -----------------------------------------------------------------------------
-- Business metrics.
--
-- DAU is proxied by user_daily_warm_predict_usage: it measures "ran Warm or Predict",
-- not "opened the app". That is the honest bound of what this schema records — real
-- activity tracking would need an events table, deliberately out of scope.
-- -----------------------------------------------------------------------------
create or replace function public.ops_business_metrics (p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with d as (
    select greatest(1, least(coalesce(p_days, 7), 120)) as days
  ),
  usage as (
    select u.* from public.user_daily_warm_predict_usage u, d
    where u.usage_day >= (current_date - d.days)
      and (u.predict_count > 0 or u.warm_count > 0)
  ),
  tiers as (
    select coalesce(nullif(tier, ''), 'free') as tier, count(*)::bigint as n
    from public.profiles group by 1 order by n desc
  ),
  fav as (
    select league_id, count(*)::bigint as n
    from public.profiles p, unnest(p.favorite_leagues) as league_id
    group by 1 order by n desc limit 10
  )
  select jsonb_build_object(
    'windowDays', (select days from d),
    'users', (select count(*) from public.profiles),
    'activeUsers', (select count(distinct user_id) from usage),
    'activeDays', (select count(distinct usage_day) from usage),
    'predictRuns', (select coalesce(sum(predict_count), 0) from usage),
    'warmRuns', (select coalesce(sum(warm_count), 0) from usage),
    'tierDistribution', coalesce((select jsonb_agg(jsonb_build_object('tier', tier, 'count', n)) from tiers), '[]'::jsonb),
    'topFavoriteLeagues', coalesce((select jsonb_agg(jsonb_build_object('leagueId', league_id, 'count', n)) from fav), '[]'::jsonb)
  );
$$;

revoke all on function public.ops_business_metrics (integer) from public;
grant execute on function public.ops_business_metrics (integer) to service_role;
