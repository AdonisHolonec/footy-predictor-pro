-- 048: store the human-readable fixture and league on a Global Special Bet
-- selection, so a stored snapshot can be read without the rest of the app.
--
-- `special_bet_selections` records fixture_id and league_id and nothing else
-- identifying, so the history has been rendering "Meci #900009" and "LIGA #78"
-- for anything the browser no longer holds a prediction for. The UI resolves
-- names by joining against rows it happens to have loaded; that join misses
-- exactly when it matters most, on older bets.
--
-- The engine has always computed the label — globalSpecialBetEngine.js builds
-- `fixtureLabel` and its own comment says "so a stored snapshot stays readable".
-- The persistence layer simply dropped it. This migration gives it somewhere to
-- land, and globalSpecialBets.js starts sending it.
--
-- Both columns are nullable and there is NO backfill. Rows written before this
-- keep NULL and fall back to the join, then to the id, exactly as today. Filling
-- them in would mean rewriting stored snapshots from data the engine no longer
-- has, which is a worse answer than an honest "Meci #900009".

alter table public.special_bet_selections
  add column if not exists fixture_label text;

alter table public.special_bet_selections
  add column if not exists league_name text;

comment on column public.special_bet_selections.fixture_label is
  'Home - Away as it read when the bet was generated. NULL for selections stored before migration 048; the UI falls back to the fixture id.';
comment on column public.special_bet_selections.league_name is
  'League name as it read when the bet was generated. NULL for selections stored before migration 048.';

/**
 * Reissued from 043 with the two new columns in the INSERT and nothing else
 * changed. The signature is identical, so this is a genuine replace: the ACL
 * set by 046 survives, and no privilege statement is needed here.
 *
 * The body below is 043's, verbatim apart from the two added columns. Its
 * guarantees are unchanged: one transaction, ON CONFLICT DO NOTHING for the
 * identity race, and no opinion about WHICH selections belong in the bet.
 */
create or replace function public.create_global_special_bet(
  p_user_id uuid,
  p_bet_date date,
  p_variant smallint,
  p_league_ids int[],
  p_total_odds numeric,
  p_average_confidence numeric,
  p_model_version text,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_leagues int[];
  v_bet_id uuid;
  v_created boolean := false;
  v_sel jsonb;
begin
  if p_variant not in (3, 5, 8) then
    return jsonb_build_object('ok', false, 'error', 'invalid_variant');
  end if;
  if p_user_id is null or p_bet_date is null then
    return jsonb_build_object('ok', false, 'error', 'missing_identity');
  end if;
  if p_league_ids is null or array_length(p_league_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'missing_leagues');
  end if;
  if p_selections is null or jsonb_array_length(p_selections) <> p_variant then
    return jsonb_build_object('ok', false, 'error', 'selection_count_mismatch');
  end if;

  -- Canonicalise here, so the identity key is the same whatever order or
  -- duplicates the caller happened to send.
  select array_agg(x order by x), string_agg(x::text, ',' order by x)
  into v_leagues, v_scope
  from (select distinct unnest(p_league_ids) as x) s;

  insert into public.special_bets as b (
    user_id, bet_date, league_ids, league_scope, variant,
    total_odds, average_confidence, model_version
  )
  values (
    p_user_id, p_bet_date, v_leagues, v_scope, p_variant,
    p_total_odds, p_average_confidence, p_model_version
  )
  on conflict (user_id, bet_date, variant, league_scope) do nothing
  returning b.id into v_bet_id;

  if v_bet_id is not null then
    v_created := true;
    for v_sel in select * from jsonb_array_elements(p_selections)
    loop
      insert into public.special_bet_selections (
        special_bet_id, fixture_id, league_id, kickoff_at,
        market, selection, side, line, odds, confidence, value_score,
        fixture_label, league_name
      )
      values (
        v_bet_id,
        (v_sel ->> 'fixture_id')::bigint,
        (v_sel ->> 'league_id')::int,
        (v_sel ->> 'kickoff_at')::timestamptz,
        v_sel ->> 'market',
        v_sel ->> 'selection',
        nullif(v_sel ->> 'side', ''),
        nullif(v_sel ->> 'line', '')::numeric,
        (v_sel ->> 'odds')::numeric,
        (v_sel ->> 'confidence')::numeric,
        nullif(v_sel ->> 'value_score', '')::numeric,
        -- Absent stays absent: a caller that sends no label writes NULL rather
        -- than an empty string the UI would have to special-case.
        nullif(v_sel ->> 'fixture_label', ''),
        nullif(v_sel ->> 'league_name', '')
      );
    end loop;
  else
    -- Someone else won the race, or this is a repeat request.
    select b.id into v_bet_id
    from public.special_bets b
    where b.user_id = p_user_id
      and b.bet_date = p_bet_date
      and b.variant = p_variant
      and b.league_scope = v_scope;

    if v_bet_id is null then
      return jsonb_build_object('ok', false, 'error', 'conflict_without_row');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'bet', (select to_jsonb(b) from public.special_bets b where b.id = v_bet_id),
    'selections', coalesce(
      (
        select jsonb_agg(to_jsonb(s) order by s.kickoff_at, s.fixture_id)
        from public.special_bet_selections s
        where s.special_bet_id = v_bet_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;
