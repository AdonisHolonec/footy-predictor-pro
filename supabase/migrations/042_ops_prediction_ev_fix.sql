-- Observability S3 follow-up: make the prediction aggregate describe the bet we recommend.
--
-- 041 exposed `avgEv` as avg(raw_payload->'valueBet'->>'ev'). Three defects made that
-- number unusable on a dashboard card:
--
--   1. Wrong bet. `valueBet.ev` is the expected value of `valueEngine.bestMarket` — the
--      best-value market found — while `avgOdds` reads `recommended.odd`. Those are
--      different wagers sitting in the same row. Measured on 7 days of production, 48 of
--      84 rows with a detected value market had `valueBet.type` unrelated to the
--      recommended pick (e.g. type "X2" beside a recommended "Over 7.5"). The pairing is
--      also arithmetically impossible to read as one bet: avgOdds 1.446 with avgEv 53.13
--      would require p > 1 in EV = (p x odds - 1) x 100.
--
--   2. Mean over a heavy tail. Distribution was min 0 / median 34.3 / p75 60.0 / max
--      446.6, with 13% of rows above +100%. A +446% EV is not an edge, it is the model
--      disagreeing violently with the book on an exotic market. The mean reports the tail.
--
--   3. Mixed populations. 16 of 100 rows were exactly 0, meaning "no value detected" —
--      semantically not an EV at all, yet averaged in with the 446.
--
-- The honest figure for "how much edge do we claim on what we actually recommend" is
-- computed here from `recommended_confidence` and `recommended.odd`: median -2.10%,
-- mean +4.35%, 59 of 98 negative. A median just below zero is what a sanely calibrated
-- model looks like against a price carrying the bookmaker's margin.
--
-- `avgEv` is REMOVED rather than kept alongside: leaving it in the payload invites the
-- exact misreading this migration exists to prevent. The best-market figure survives
-- under `valueMarketEv`, named for what it measures and carrying its own tail stats.
--
-- Read-only, additive to behaviour: this replaces one reporting function. No table, no
-- prediction path, no value engine, no recommendation logic is touched.

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
  -- Odds and EV live in raw_payload rather than columns, so both are guarded by a numeric
  -- regex before the cast: a malformed payload must yield a null, never abort the snapshot.
  parsed as (
    select
      w.recommended_pick,
      w.recommended_confidence,
      case when w.raw_payload->'recommended'->>'odd' ~ '^[0-9]+(\.[0-9]+)?$'
           then (w.raw_payload->'recommended'->>'odd')::numeric end as rec_odd,
      case when w.raw_payload->'valueBet'->>'ev' ~ '^-?[0-9]+(\.[0-9]+)?$'
           then (w.raw_payload->'valueBet'->>'ev')::numeric end as market_ev,
      nullif(w.raw_payload->'valueBet'->>'type', '') as market_type,
      (w.raw_payload->'valueBet'->>'detected') = 'true' as market_detected,
      coalesce(nullif(w.raw_payload->'recommended'->>'family', ''), 'unknown') as family
    from win w
  ),
  -- EV of the recommended pick itself. Uses recommended_confidence as the model
  -- probability: it is the only per-row probability persisted as a column, and the
  -- resulting median — just under zero, i.e. just inside the bookmaker's margin — is
  -- consistent with that reading.
  rec_ev as (
    select ((recommended_confidence / 100.0) * rec_odd - 1) * 100 as ev
    from parsed
    where rec_odd is not null
      and rec_odd > 1
      and recommended_confidence is not null
      and recommended_confidence > 0
  ),
  -- EV of the best-value market. Kept separate because it grades a DIFFERENT bet.
  mkt_ev as (
    select market_ev as ev
    from parsed
    where market_ev is not null
  ),
  counts as (
    select
      count(*)::bigint as total,
      round(avg(recommended_confidence)::numeric, 2) as avg_confidence,
      round(avg(rec_odd)::numeric, 3) as avg_odds,
      count(*) filter (where market_detected)::bigint as value_detected,
      -- Substring heuristic, deliberately approximate: it answers "does the value market
      -- even mention the recommended pick", which is enough to size the divergence.
      count(*) filter (
        where market_detected
          and market_type is not null
          and position(lower(market_type) in lower(recommended_pick)) = 0
      )::bigint as value_differs,
      count(*) filter (where family = 'unknown')::bigint as unknown_family
    from parsed
  ),
  families as (
    select family, count(*)::bigint as n
    from parsed
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
    'total', (select total from counts),
    'avgConfidence', (select avg_confidence from counts),
    'avgOdds', (select avg_odds from counts),

    -- The card-worthy figure: edge claimed on the pick we actually surface.
    -- Median leads because the distribution has a heavy right tail.
    'recommendedEv', (
      select case when count(*) = 0 then null else jsonb_build_object(
        'n', count(*)::bigint,
        'median', round(percentile_cont(0.5) within group (order by ev::double precision)::numeric, 2),
        'p25', round(percentile_cont(0.25) within group (order by ev::double precision)::numeric, 2),
        'p75', round(percentile_cont(0.75) within group (order by ev::double precision)::numeric, 2),
        'mean', round(avg(ev)::numeric, 2),
        'negativePct', round((count(*) filter (where ev < 0)::numeric / count(*)::numeric) * 100, 1),
        'unit', 'percent'
      ) end
      from rec_ev
    ),

    -- Best-value-market EV. NOT the recommended bet. `differsFromRecommended` is how
    -- often the two disagree; `zeroRows` are "no value found", not a zero edge.
    'valueMarketEv', (
      select case when count(*) = 0 then null else jsonb_build_object(
        'n', count(*)::bigint,
        'median', round(percentile_cont(0.5) within group (order by ev::double precision)::numeric, 2),
        'p75', round(percentile_cont(0.75) within group (order by ev::double precision)::numeric, 2),
        'max', round(max(ev)::numeric, 2),
        'zeroRows', count(*) filter (where ev = 0)::bigint,
        'above100Rows', count(*) filter (where ev > 100)::bigint,
        'detected', (select value_detected from counts),
        'differsFromRecommended', (select value_differs from counts),
        'describesRecommendedPick', false,
        'unit', 'percent'
      ) end
      from mkt_ev
    ),

    'byFamily', coalesce((select jsonb_agg(jsonb_build_object('family', family, 'count', n)) from families), '[]'::jsonb),
    -- Surfaces the Phase 3 settlement debt: picks without a persisted family fall back to
    -- line heuristics when grading.
    'unknownFamilyPct', (
      select case when total = 0 then null
             else round((unknown_family::numeric / total::numeric) * 100, 1) end
      from counts
    ),
    'topLeagues', coalesce((select jsonb_agg(jsonb_build_object('leagueId', league_id, 'league', league_name, 'count', n)) from leagues), '[]'::jsonb)
  );
$$;

revoke all on function public.ops_prediction_aggregates (integer) from public;
grant execute on function public.ops_prediction_aggregates (integer) to service_role;

comment on function public.ops_prediction_aggregates (integer) is
  'Prediction aggregates for the ops snapshot. recommendedEv grades the recommended pick; valueMarketEv grades the best-value market and is a different bet. Both in percent.';
