-- 070: the write path for a GLOBAL ticket.
--
-- 068 taught special_bets to HOLD an admin ticket; 069 supplied a candidate
-- source that does not read raw_payload. Neither could create one, deliberately:
-- create_global_special_bet still rejects a NULL p_user_id and a NULL
-- p_league_ids, so the only write path in existence produces USER rows. This
-- migration adds the second write path, and only that.
--
-- ── WHY A SECOND FUNCTION AND NOT A FLAG ON THE FIRST ────────────────────────
-- The obvious alternative is a p_bet_type argument on create_global_special_bet.
-- It was rejected on one ground: the USER function's contract is that the caller
-- names the owner, and a GLOBAL ticket's contract is that NOBODY can. Folding
-- both into one signature keeps p_user_id in the argument list of a call that
-- must never have an owner, which makes "pass null and it becomes global" the
-- rule — a rule enforced by nothing, one typo away from writing an admin ticket
-- into a real user's account, and untestable except by inspection.
--
-- Here the parameter does not exist. There is no p_user_id and no p_league_ids
-- to get wrong: user_id, league_ids and league_scope are written NULL by the
-- function body, bet_type and bet_source are written as literals, and no caller
-- can influence any of the five. That is the whole reason for the duplication.
--
-- Ownership is also not inferred. This function never calls auth.uid(): it is
-- SECURITY DEFINER, reachable only by service_role, and a GLOBAL ticket belongs
-- to the product rather than to whichever administrator pressed the button.
-- Recording that person belongs in an audit trail, not in user_id, where every
-- existing owner policy would then hand them the ticket as their own.
--
-- create_global_special_bet IS NOT TOUCHED. Not dropped, not recreated, not
-- re-granted. USER idempotency, USER validation and USER ACL are exactly what
-- 054 left them, and this migration cannot regress them because it does not
-- mention them.
--
-- ── VALIDATION IS 054'S, MINUS WHAT DOES NOT APPLY ───────────────────────────
-- Same order, same error strings, same semantics: bet_kind, system_k coherence,
-- variant allow-list, the system-is-always-5 rule, and the selection count. Two
-- of 054's checks are gone because 068 made their subjects NULL for a GLOBAL
-- row — missing_leagues, and the p_user_id half of missing_identity. The date
-- half stays: a ticket with no date has no identity and no idempotency key.
--
-- The error strings are deliberately identical rather than prefixed. They name
-- the product rule that was broken, and the rule is the same rule.
--
-- ── IDENTITY ─────────────────────────────────────────────────────────────────
-- ON CONFLICT names 068's partial index, WHERE clause included. Postgres can
-- only infer a partial index as the arbiter when the statement repeats its
-- predicate — that is precisely why 068 refused to rebuild the USER index as a
-- partial one (the USER RPC's ON CONFLICT has no WHERE and would have failed on
-- every call). Here the predicate is written, so inference succeeds. Asserted in
-- the integration suite rather than assumed, because the failure mode is a hard
-- error on every single insert.
--
-- `coalesce(system_k, 0)` matches the index expression exactly. A bare column
-- would make every GLOBAL combo unique — NULLs are distinct — and duplicate
-- tickets would appear with no error at all.

create function public.create_global_ticket(
  p_bet_date date,
  p_variant smallint,
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
  v_bet_id uuid;
  v_created boolean := false;
  v_sel jsonb;
begin
  if p_bet_kind is null or p_bet_kind not in ('combo', 'system') then
    return jsonb_build_object('ok', false, 'error', 'invalid_bet_kind');
  end if;

  -- A combo has no k, and a system has exactly one of the three the product
  -- sells. Checked here as well as in the table CHECK so the caller gets a named
  -- error instead of a constraint violation.
  if p_bet_kind = 'combo' and p_system_k is not null then
    return jsonb_build_object('ok', false, 'error', 'system_k_not_allowed_for_combo');
  end if;
  if p_bet_kind = 'system' and (p_system_k is null or p_system_k not in (3, 4, 5)) then
    return jsonb_build_object('ok', false, 'error', 'invalid_system_k');
  end if;

  if p_variant is null or p_variant not in (3, 5, 8) then
    return jsonb_build_object('ok', false, 'error', 'invalid_variant');
  end if;

  -- "Is this a variant we sell" is answered above; this answers "is this a
  -- variant this KIND is sold in", which for a system is only 5. Ordered after
  -- it on purpose, exactly as in 054.
  if p_bet_kind = 'system' and p_variant <> 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_system_variant');
  end if;

  -- No owner to check — there cannot be one. The date is the whole of a GLOBAL
  -- ticket's identity beyond its shape, and it is also its idempotency key.
  if p_bet_date is null then
    return jsonb_build_object('ok', false, 'error', 'missing_identity');
  end if;

  if p_selections is null or jsonb_array_length(p_selections) <> p_variant then
    return jsonb_build_object('ok', false, 'error', 'selection_count_mismatch');
  end if;

  -- The five values a caller cannot supply, because they are not parameters:
  -- unowned, league-less, GLOBAL, admin-sourced, and unpublished. A GLOBAL
  -- ticket becomes visible through a later, separate publish step; nothing that
  -- creates one may also release it.
  insert into public.special_bets as b (
    user_id, league_ids, league_scope,
    bet_type, bet_source, published_at,
    bet_date, variant,
    total_odds, average_confidence, model_version, ticket_probability,
    bet_kind, system_k
  )
  values (
    null, null, null,
    'GLOBAL', 'ADMIN_PREDICTIONS', null,
    p_bet_date, p_variant,
    p_total_odds, p_average_confidence, p_model_version, p_ticket_probability,
    p_bet_kind, p_system_k
  )
  on conflict (bet_date, variant, bet_kind, (coalesce(system_k, 0)))
    where bet_type = 'GLOBAL'
  do nothing
  returning b.id into v_bet_id;

  if v_bet_id is not null then
    v_created := true;
    for v_sel in select * from jsonb_array_elements(p_selections)
    loop
      -- Byte for byte the USER path's snapshot insert (054). A selection means
      -- the same thing on either ticket, and the columns it lands in are the
      -- same columns; nothing here reinterprets what the engine produced.
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
        nullif(v_sel ->> 'fixture_label', ''),
        nullif(v_sel ->> 'league_name', ''),
        nullif(v_sel ->> 'probability', '')::numeric
      );
    end loop;
  else
    -- A repeat request, or a lost race. The lookup mirrors the partial index
    -- exactly — bet_type included — so a repeat of one GLOBAL ticket can never
    -- return a USER row that happens to share a date and a shape.
    select b.id into v_bet_id
    from public.special_bets b
    where b.bet_type = 'GLOBAL'
      and b.bet_date = p_bet_date
      and b.variant = p_variant
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

-- A new SECURITY DEFINER function comes up on hosted Supabase with the
-- platform's default EXECUTE for anon and authenticated — the exact leak 046
-- exists to close, and a function that writes unowned rows readable by every
-- authenticated user once published is the worst possible thing to leave open.
-- Locked down by name first, then granted to the one caller.
revoke execute on function public.create_global_ticket(
  date, smallint, numeric, numeric, text, jsonb, numeric, text, smallint
) from public, anon, authenticated;

grant execute on function public.create_global_ticket(
  date, smallint, numeric, numeric, text, jsonb, numeric, text, smallint
) to service_role;

/*
  ROLLBACK.

    drop function if exists public.create_global_ticket(
      date, smallint, numeric, numeric, text, jsonb, numeric, text, smallint
    );

  Safe while no GLOBAL ticket exists, and safe afterwards too: dropping the
  writer leaves the rows it wrote in place and readable. It removes the ability
  to create more, which is the intended effect of a rollback here.

  DEPLOY ORDER. Safe ahead of the application: nothing calls this function until
  the admin generation service ships, and the service refuses non-admin callers
  before it ever reaches here. 068's constraints are the backstop — a row that
  somehow arrived with an owner and bet_type GLOBAL would be rejected by
  special_bets_identity_coherent, not stored.
*/
