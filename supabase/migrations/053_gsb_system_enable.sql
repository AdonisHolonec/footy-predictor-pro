-- 053: let a System ticket be created.
--
-- Migration 052 shipped the schema for k-of-n tickets and then refused to store
-- one, because settlement could not grade k-of-n yet. It can now: settleTicket
-- enumerates the winning combinations, and its equality with the combo path at
-- k = n is asserted over all 4^5 leg outcomes. The gate has done its job and
-- comes out.
--
-- 052 IS NOT EDITED. It is already applied in production, and Supabase tracks
-- migrations by name — editing it would leave the deployed function untouched
-- while the repository claimed otherwise, and the integration suites would
-- apply the edited copy and go green against a database that never changed. So
-- the function is dropped and recreated here, exactly as 050 and 052 did.
--
-- The body below is 052's, verbatim, with two coordinated changes and nothing
-- else:
--
--   1. the `system_not_enabled` branch is gone;
--   2. the k check became kind-aware. It read "any k at all is an error", which
--      was right while only combos could exist and would now reject every
--      System. A combo still may not carry a k; a system must carry one of the
--      three the product sells.
--
-- Nothing else moves: same signature, same defaults, same return type, same
-- SECURITY DEFINER and search_path, same validations, same canonicalisation,
-- same ON CONFLICT identity, same inserts, same ACL.
--
-- Creating a System is now possible through the RPC. It is still not possible
-- through the product: no HTTP route accepts a k, and nothing in the API calls
-- the system builder. That wiring is the next increment.

-- The live signature after 052 is the ELEVEN-argument one. Dropping the nine
-- it replaced would fail on a database where 052 has already run, which is
-- every database this migration will ever meet.
drop function public.create_global_special_bet(
  uuid, date, smallint, int[], numeric, numeric, text, jsonb, numeric, text, smallint
);

create function public.create_global_special_bet(
  p_user_id uuid,
  p_bet_date date,
  p_variant smallint,
  p_league_ids int[],
  p_total_odds numeric,
  p_average_confidence numeric,
  p_model_version text,
  p_selections jsonb,
  p_ticket_probability numeric default null,
  p_bet_kind text default 'combo',
  p_system_k smallint default null
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
  if p_bet_kind is null or p_bet_kind not in ('combo', 'system') then
    return jsonb_build_object('ok', false, 'error', 'invalid_bet_kind');
  end if;


  -- A combo has no k, and a system has exactly one of the three the product
  -- sells. Checked in the function as well as in the CHECK so the caller gets a
  -- named error instead of a constraint violation — and because the CHECK is
  -- deliberately looser than the product: it accepts any k from 2 to variant,
  -- while 3, 4 and 5 are the only tickets that exist.
  if p_bet_kind = 'combo' and p_system_k is not null then
    return jsonb_build_object('ok', false, 'error', 'system_k_not_allowed_for_combo');
  end if;
  if p_bet_kind = 'system' and (p_system_k is null or p_system_k not in (3, 4, 5)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_system_k');
  end if;

  if p_variant not in (3, 5, 8) then
    return jsonb_build_object('ok', false, 'error', 'invalid_variant');
  end if;
  if p_user_id is null or p_bet_date is null then
    return jsonb_build_object('ok', false, 'error', 'missing_identity');
  end if;
  if p_league_ids is null or array_length(p_league_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'missing_leagues');
  end if;
  -- A combo's selection count IS its variant. The system rule ("exactly variant
  -- selections, of which k must win") is the same count check, and lands with
  -- the increment that lifts the gate above.
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
    total_odds, average_confidence, model_version, ticket_probability,
    bet_kind, system_k
  )
  values (
    p_user_id, p_bet_date, v_leagues, v_scope, p_variant,
    p_total_odds, p_average_confidence, p_model_version, p_ticket_probability,
    p_bet_kind, p_system_k
  )
  on conflict (user_id, bet_date, variant, league_scope, bet_kind, (coalesce(system_k, 0)))
  do nothing
  returning b.id into v_bet_id;

  if v_bet_id is not null then
    v_created := true;
    for v_sel in select * from jsonb_array_elements(p_selections)
    loop
      insert into public.special_bet_selections (
        special_bet_id, fixture_id, league_id, kickoff_at,
        market, selection, side, line, odds, confidence, value_score,
        fixture_label, league_name, probability
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
        nullif(v_sel ->> 'league_name', ''),
        -- Same rule for probability: a pre-050 caller simply never wrote it.
        nullif(v_sel ->> 'probability', '')::numeric
      );
    end loop;
  else
    -- Someone else won the race, or this is a repeat request. The lookup mirrors
    -- the identity index exactly, k included, so a repeat of one ticket can
    -- never return a different one that happens to share the other four columns.
    select b.id into v_bet_id
    from public.special_bets b
    where b.user_id = p_user_id
      and b.bet_date = p_bet_date
      and b.variant = p_variant
      and b.league_scope = v_scope
      and b.bet_kind = p_bet_kind
      and coalesce(b.system_k, 0) = coalesce(p_system_k, 0);

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

-- Fresh function, fresh ACL: a dropped-and-recreated function does NOT inherit
-- the grants 043/046/050 set, and on hosted Supabase it comes up with the
-- platform's default EXECUTE for anon and authenticated — the exact leak 046
-- exists to close. Lock it down by name, then grant the one caller.
revoke execute on function public.create_global_special_bet(
  uuid, date, smallint, int[], numeric, numeric, text, jsonb, numeric, text, smallint
) from public, anon, authenticated;

grant execute on function public.create_global_special_bet(
  uuid, date, smallint, int[], numeric, numeric, text, jsonb, numeric, text, smallint
) to service_role;
