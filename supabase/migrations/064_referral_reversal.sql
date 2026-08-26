/*
  PR3d1 — atomic referral reversal. One function. 061, 062 and 063 are untouched.

  WHY THIS IS A DATABASE FUNCTION AND NOT THREE SERVICE CALLS. Reversal is three
  writes — revoke the inviter's grant, revoke the invitee's grant, move the
  attribution to `reversed` — and any two of them without the third is a state the
  system cannot describe. Revoke both grants but leave `state = 'rewarded'` and the
  inviter has silently lost a cap slot forever, with nothing recording why. Move the
  state but miss a revoke and a reversed referral keeps paying. JavaScript cannot
  hold a transaction across PostgREST calls, so the only place all three can be one
  decision is here — the same reasoning that put `reward_referral` in 063.

  `state = 'reversed'` IS THE AUTHORITATIVE MARKER. Not `rejected_reason is not
  null`: PR3b writes `attribution_window_elapsed` into that column on lazy expiry, so
  it is the terminal-REASON column and says nothing about fraud. Any query asking
  "was this reversed" asks `state`.

  THE REWARD TIMESTAMPS SURVIVE. `rewarded_at`, `inviter_rewarded_at` and
  `invitee_rewarded_at` are the audit record that the money once moved, and clearing
  them would make a reversal indistinguishable from a referral that never paid. The
  cap frees its slot through `state <> 'reversed'` in 063's count, so nothing has to
  be erased for the inviter to earn again.
*/

create or replace function public.reverse_referral(
  p_attribution_id uuid,
  p_reason text
)
returns table (
  ok boolean,
  reason text,
  state text,
  reversed_at timestamptz,
  inviter_grant_revoked boolean,
  invitee_grant_revoked boolean
)
language plpgsql
security definer
set search_path = public
as $$
  -- 061, 062 and 063 all needed this: RETURNS TABLE columns are also OUT variables
  -- and shadow identically named table columns, failing at RUNTIME while compiling
  -- clean. `state` and `reason` below are exactly such names.
  #variable_conflict use_column
declare
  /*
    Longest reversal reason we will store. Bounded because this string arrives in an
    HTTP body and lands permanently in a ledger row: unbounded free text is how a
    stack trace, a request body or a pasted customer email ends up in the database.
    500 characters is far more than "duplicate account, support ticket 1423" needs.
  */
  v_max_reason constant integer := 500;

  v_a public.referral_attributions%rowtype;
  v_now timestamptz := now();
  /*
    btrim's DEFAULT character set is the space alone, so a reason of just a tab or
    a newline would survive the emptiness check below and be stored as a blank
    justification. The explicit set makes "whitespace-only" mean what it says.
  */
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\r\n');
  v_inviter_grant uuid;
  v_invitee_grant uuid;
  v_inviter_revoked boolean := false;
  v_invitee_revoked boolean := false;
begin
  if p_attribution_id is null then
    raise exception 'reverse_referral: attribution id is required';
  end if;

  /*
    A REASON IS MANDATORY. Reversal takes a reward away from two people, and the
    reason is the only durable answer to "why did my bonus stop?" — a question PR1's
    ledger was explicitly built to answer. Refusing an empty reason here rather than
    in the API means no future caller can skip it.
  */
  if v_reason = '' then
    return query select false, 'reason_required', null::text, null::timestamptz, false, false;
    return;
  end if;

  if length(v_reason) > v_max_reason then
    return query select false, 'reason_too_long', null::text, null::timestamptz, false, false;
    return;
  end if;

  select * into v_a
    from public.referral_attributions ra
   where ra.id = p_attribution_id
     for update;

  if not found then
    return query select false, 'not_found', null::text, null::timestamptz, false, false;
    return;
  end if;

  -- Already reversed: converge rather than raise, so a double-clicked admin button
  -- and a retried request both end in the same place.
  if v_a.state = 'reversed' then
    return query select true, 'already_reversed', v_a.state, null::timestamptz,
                        (v_a.inviter_rewarded_at is not null), true;
    return;
  end if;

  /*
    Only a REWARDED referral can be reversed. There is nothing to take back from an
    attributed, qualified or expired one, and moving those to `reversed` would
    destroy the distinction between "never paid" and "paid, then withdrawn".
  */
  if v_a.state <> 'rewarded' then
    return query select false, 'not_rewarded', v_a.state, null::timestamptz, false, false;
    return;
  end if;

  /*
    Grants are located by the reward's own reference, never by an id the caller
    supplies. The admin endpoint accepts an attribution id and nothing else, so there
    is no argument through which a reviewer could revoke an unrelated grant.

    `revoked_at is null` is part of the lookup so a grant an admin already revoked by
    hand is left alone; 061's revoke is idempotent regardless.
  */
  select g.id into v_inviter_grant
    from public.time_grants g
   where g.reference_id = v_a.id::text
     and g.source = 'referral_inviter'
     and g.revoked_at is null
   limit 1;

  select g.id into v_invitee_grant
    from public.time_grants g
   where g.reference_id = v_a.id::text
     and g.source = 'referral_invitee'
     and g.revoked_at is null
   limit 1;

  /*
    A MISSING INVITER GRANT IS NORMAL. When the inviter was at their lifetime cap,
    063 paid the invitee only and never created an inviter grant — `inviter_rewarded_at`
    is null and there is nothing to revoke. Treating that as an error would make
    capped referrals permanently un-reversible.
  */
  if v_inviter_grant is not null then
    perform public.revoke_time_grant(v_inviter_grant, v_reason);
    v_inviter_revoked := true;
  end if;

  if v_invitee_grant is not null then
    perform public.revoke_time_grant(v_invitee_grant, v_reason);
    v_invitee_revoked := true;
  end if;

  /*
    The state change, guarded so a concurrent reversal cannot double-apply. Every
    reward timestamp is deliberately left in place; only `state` and the terminal
    reason move. If this UPDATE fails, the revokes above roll back with it — which is
    the entire reason the three writes share one function.
  */
  update public.referral_attributions ra
     set state = 'reversed',
         rejected_reason = v_reason
   where ra.id = p_attribution_id
     and ra.state = 'rewarded';

  if not found then
    raise exception 'reverse_referral: attribution % changed state mid-transaction', p_attribution_id;
  end if;

  return query select true, null::text, 'reversed', v_now, v_inviter_revoked, v_invitee_revoked;
end;
$$;

comment on function public.reverse_referral(uuid, text) is
  'Atomically revoke both referral grants and mark the attribution reversed. Reward timestamps are preserved for audit; the cap slot is freed by state <> reversed in reward_referral''s count.';

/*
  Service role only, exactly like claim_referral, qualify_referral, reward_referral
  and revoke_time_grant.

  A client that could execute this could strip another user's bonus, or its own
  inviter's. The admin endpoint reaches it as the server, after assertAdmin.
*/
revoke all on function public.reverse_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.reverse_referral(uuid, text) to service_role;
