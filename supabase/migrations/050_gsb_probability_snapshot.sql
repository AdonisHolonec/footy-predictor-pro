-- 050: store the probability a Global Special Bet was actually built on.
--
-- Increment 1 (engine) made GSB probability-first: legs are chosen by
-- P(full win) — `valueEngine.markets[].probability`, the same semantics
-- Recommended ranks by — and the engine computes the ticket's estimated chance
-- as Π p_i. The snapshot could not carry either number, so the API had to
-- answer `null` for any bet it did not create in the same request, and history
-- showed only the misleading average_confidence. This migration gives both
-- numbers somewhere to land; server-utils/globalSpecialBets.js starts sending
-- them.
--
-- Both columns are nullable and there is NO backfill. Rows written before this
-- keep NULL — the probabilities those bets were built on were never stored, and
-- reconstructing them from today's regenerated raw_payload would attribute
-- numbers to a bet they were not computed from. NULL is the honest answer, and
-- the UI renders it as "—".
--
-- Precision: probability numeric(5,4) and ticket_probability numeric(6,4) —
-- four decimals, matching the engine's own rounding of Π p_i. The range CHECKs
-- only bind non-NULL values, so legacy rows are untouched.

alter table public.special_bet_selections
  add column if not exists probability numeric(5,4);

alter table public.special_bets
  add column if not exists ticket_probability numeric(6,4);

comment on column public.special_bet_selections.probability is
  'Model P(full win) of this selection at generation time, 0-1 — the exact value the probability-first ranking used. NULL for selections stored before migration 050.';
comment on column public.special_bets.ticket_probability is
  'Engine-estimated ticket chance: product of the selections'' probabilities, assuming leg independence. NULL for bets stored before migration 050.';

-- A probability outside (0, 1] is a data defect, not a probability. Guarded
-- here with the same posture as special_bet_selections_odds_positive, but NULL
-- stays legal — legacy rows and legacy callers must keep working.
alter table public.special_bet_selections
  add constraint special_bet_selections_probability_range
  check (probability is null or (probability > 0 and probability <= 1));

alter table public.special_bets
  add constraint special_bets_ticket_probability_range
  check (ticket_probability is null or (ticket_probability > 0 and ticket_probability <= 1));

/**
 * Reissued with p_ticket_probability and the selections' `probability` key.
 *
 * Unlike 048, the parameter list CHANGES, and CREATE OR REPLACE with a new
 * signature would not replace anything — it would create a second overload and
 * leave the old function callable beside it. So the old signature is dropped
 * explicitly first.
 *
 * p_ticket_probability carries DEFAULT NULL, so the 8-argument call shape that
 * exists in already-deployed server code (and in the settlement integration
 * suite) keeps resolving during the deploy window — it simply stores NULL,
 * exactly what those callers stored before.
 *
 * A dropped-and-recreated function does NOT inherit the ACL 043/046 set; on
 * hosted Supabase it comes up with the platform's default EXPLICIT grants to
 * anon and authenticated (the exact leak 046 exists to fix). The revoke below
 * therefore names anon and authenticated, not just PUBLIC, and the
 * securityDefinerPrivileges suite asserts the end state.
 *
 * The body is 048's with the two new values threaded through and nothing else
 * changed. Its guarantees are unchanged: one transaction, ON CONFLICT DO
 * NOTHING for the identity race, and no opinion about WHICH selections belong
 * in the bet.
 */
drop function public.create_global_special_bet(uuid, date, smallint, int[], numeric, numeric, text, jsonb);

create function public.create_global_special_bet(
  p_user_id uuid,
  p_bet_date date,
  p_variant smallint,
  p_league_ids int[],
  p_total_odds numeric,
  p_average_confidence numeric,
  p_model_version text,
  p_selections jsonb,
  p_ticket_probability numeric default null
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
    total_odds, average_confidence, model_version, ticket_probability
  )
  values (
    p_user_id, p_bet_date, v_leagues, v_scope, p_variant,
    p_total_odds, p_average_confidence, p_model_version, p_ticket_probability
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

-- Fresh function, fresh ACL: lock it down by name, then grant the one caller.
revoke execute on function public.create_global_special_bet(
  uuid, date, smallint, int[], numeric, numeric, text, jsonb, numeric
) from public, anon, authenticated;

grant execute on function public.create_global_special_bet(
  uuid, date, smallint, int[], numeric, numeric, text, jsonb, numeric
) to service_role;
