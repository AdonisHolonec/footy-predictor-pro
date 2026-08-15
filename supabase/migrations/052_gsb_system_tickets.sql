-- 052: make the schema able to hold a GSB SYSTEM ticket, without making one
-- generatable yet.
--
-- A system ticket carries TWO numbers where the schema has one. "System 3/5" is
-- five selections of which any three must win; `variant` already means "how many
-- selections", so the k belongs in a column of its own — not in a re-typed
-- `variant`, and not in a magic value like 'system_3_of_5'. Combo keeps meaning
-- exactly what it means today.
--
--   Combo 5      variant = 5, bet_kind = 'combo',  system_k = NULL
--   System 3/5   variant = 5, bet_kind = 'system', system_k = 3
--   System 4/5   variant = 5, bet_kind = 'system', system_k = 4
--   System 5/5   variant = 5, bet_kind = 'system', system_k = 5
--
-- FOUNDATION ONLY. The schema accepts every system shape; the RPC refuses to
-- write one. A system ticket cannot be settled yet — aggregateBetStatus() turns
-- any lost leg into a lost bet, which would report a winning 3/5 as a loss — so
-- generating one before the settlement increment would mean lying to the user
-- about money. The guard in the RPC below is what makes that impossible by
-- construction rather than by convention.
--
-- No backfill, nothing destructive: every existing row becomes 'combo' with a
-- NULL k through the column default, which is exactly what it already was.

alter table public.special_bets
  add column if not exists bet_kind text not null default 'combo';

alter table public.special_bets
  add column if not exists system_k smallint;

comment on column public.special_bets.bet_kind is
  'combo = every selection must win (the 3/5/8 accumulators). system = any system_k of the variant selections must win. Existing rows default to combo.';
comment on column public.special_bets.system_k is
  'Winning legs required by a system ticket, 2..variant. NULL for combo — a combo needs all of them, which is not a k.';

alter table public.special_bets
  add constraint special_bets_kind_allowed check (bet_kind in ('combo', 'system'));

-- The two columns are one fact, so they are constrained as one. A combo with a
-- k, or a system without one, is not a ticket with an odd field — it is a row
-- whose payout rule cannot be determined, and settlement must never have to
-- guess. The lower bound is 2 because a 1-of-n "system" is n separate single
-- bets, and the upper bound is `variant` because you cannot require more winners
-- than the ticket has legs. 5/5 is deliberately legal: it settles like a combo
-- but is priced and displayed as the top row of a system, and refusing it here
-- would push that special case into application code.
--
-- Written as a CASE, not as the obvious
--   (bet_kind = 'combo' and system_k is null) or (bet_kind = 'system' and system_k between 2 and variant)
-- because that form does not reject a system with a NULL k. The second branch
-- evaluates to `true and NULL` = NULL, `false or NULL` is NULL, and a CHECK that
-- evaluates to NULL is SATISFIED. The row would be stored — a system ticket with
-- no k, which settlement cannot grade. Proven by S9b in
-- tests/integration/gsbSystemFoundation.db.test.js, which failed against the OR
-- form. CASE returns a real boolean on every branch, and the `else false` makes
-- an unrecognised kind fail here too rather than fall through as NULL.
alter table public.special_bets
  add constraint special_bets_system_shape check (
    case bet_kind
      when 'combo' then system_k is null
      when 'system' then system_k is not null and system_k >= 2 and system_k <= variant
      else false
    end
  );

-- Identity has to separate the four tickets a single (user, date, scope) can now
-- hold: Combo 5, System 3/5, System 4/5 and System 5/5 all have variant = 5.
-- Under the old key they would collide on the first one written and every later
-- one would silently return it as "already exists".
--
-- coalesce(system_k, 0) rather than the bare column: NULL is not equal to NULL
-- in a unique index, so a nullable k would stop the index from constraining
-- combos at all — two identical Combo 5 rows would both be accepted, and the
-- idempotency 043 exists to provide would be gone.
drop index if exists public.special_bets_identity_idx;

create unique index special_bets_identity_idx
  on public.special_bets (
    user_id, bet_date, variant, league_scope, bet_kind, (coalesce(system_k, 0))
  );

/**
 * Reissued with p_bet_kind and p_system_k.
 *
 * The signature CHANGES, so — exactly as in 050 — CREATE OR REPLACE would not
 * replace anything; it would leave a second overload callable beside this one,
 * still inserting through the old ON CONFLICT target. The old signature is
 * therefore dropped explicitly first.
 *
 * Both new parameters carry defaults, so the 9-argument call shape that
 * deployed server code uses (server-utils/globalSpecialBets.js, and the
 * integration suites) keeps resolving through the deploy window and keeps
 * writing exactly the rows it wrote before: bet_kind 'combo', system_k NULL.
 *
 * SYSTEM IS REFUSED HERE. The parameters exist so the next increment has
 * nothing to re-plumb, and so the shape is exercised end to end today; the
 * guard is what stops a system ticket from reaching a database whose settlement
 * cannot grade it. Removing that single branch is the API/engine increment's
 * job, and it must not happen before globalSpecialBetSettlement.js can compute
 * a k-of-n outcome.
 *
 * Everything else is 050's body verbatim, with the two values threaded into the
 * INSERT and the ON CONFLICT target widened to match the new index. One
 * transaction, ON CONFLICT DO NOTHING for the identity race, and no opinion
 * about WHICH selections belong in the bet.
 */
drop function public.create_global_special_bet(
  uuid, date, smallint, int[], numeric, numeric, text, jsonb, numeric
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

  -- Foundation gate. The schema can hold a system ticket; nothing may write one
  -- until settlement can grade k-of-n. Removed in the API/engine increment, not
  -- before.
  if p_bet_kind = 'system' then
    return jsonb_build_object('ok', false, 'error', 'system_not_enabled');
  end if;

  -- Only combos reach here, and a combo has no k. Checked in the function as
  -- well as in the CHECK so the caller gets a named error instead of a
  -- constraint violation.
  if p_system_k is not null then
    return jsonb_build_object('ok', false, 'error', 'system_k_not_allowed_for_combo');
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
