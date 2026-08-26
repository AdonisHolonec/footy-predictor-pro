/*
  PR3c — referral qualification and reward. THE FIRST REWARD-PRODUCING MIGRATION.

  Two columns and two functions. 062 is not touched.

  WHY THE WHOLE REWARD IS ONE SQL FUNCTION. Two grants, a lifetime cap and a state
  transition have to happen together or not at all, and the only place that "or not
  at all" is free is inside a single transaction. `grant_bonus_days` (061) serialises
  with pg_advisory_XACT_lock — transaction-scoped, not session-scoped — so it can be
  called twice inside one statement and both grants commit or both roll back. An
  application-level orchestration of two RPCs cannot offer that: it would need a
  compensating revoke for every partial failure, and a compensation that itself fails
  leaves the ledger wrong with nothing left to fix it.

  THE CAP IS NOT A COUNT-THEN-INSERT. `inviter_rewarded_at` is counted while holding
  an advisory lock on the inviter, inside the same transaction that writes the grant.
  Releasing the lock between the count and the write is exactly the race that lets
  referral 10 and referral 11 both see nine.

  NOTHING HERE TRUSTS A CALLER. Email verification is read from auth.users at
  decision time rather than accepted as an argument; a JWT minted before the user
  confirmed their address stays valid afterwards, so a session-derived boolean is
  stale in precisely the direction that would pay out wrongly. The qualifying Predict
  is read from user_prediction_fixtures, the ownership table Stage10Persistence
  writes AFTER predictions_history succeeds — not from a click, a 200, an attempt
  counter or history_sync_log.
*/

-- ------------------------------------------------------------------- columns

/*
  Which HALF of the reward was actually paid.

  `rewarded_at` says the attribution was processed; it cannot say whether the
  inviter got anything, because an inviter at their lifetime cap is processed
  successfully and paid nothing. The cap counts inviter payouts, so it needs the
  inviter payout recorded — inferring it from `rewarded_at` would count capped
  referrals against the cap and shrink it every time it was reached.
*/
alter table public.referral_attributions
  add column if not exists inviter_rewarded_at timestamptz null;

/*
  Symmetric, and today always equal to `rewarded_at` because the invitee is paid on
  every reward. Recorded explicitly anyway: "was this half paid?" should be a column
  read for both roles rather than a column read for one and a policy assumption for
  the other. The day a policy skips an invitee, the inference breaks silently.
*/
alter table public.referral_attributions
  add column if not exists invitee_rewarded_at timestamptz null;

comment on column public.referral_attributions.inviter_rewarded_at is
  'When the INVITER half was paid. NULL when the inviter was at their lifetime cap. This column, not rewarded_at, is what the cap counts.';
comment on column public.referral_attributions.invitee_rewarded_at is
  'When the INVITEE half was paid. Always set on a successful reward in V1.';

/*
  Partial index: the cap count only ever asks for rows that were actually paid, and
  the table is dominated by rows that were not.
*/
create index if not exists referral_attributions_inviter_rewarded_idx
  on public.referral_attributions (inviter_id)
  where inviter_rewarded_at is not null;

-- --------------------------------------------------------------- qualification

/*
  Can this attribution be marked qualified, right now?

  Returns a row rather than raising: "the invitee has not confirmed their email yet"
  is an ordinary, expected outcome that the caller retries later, not an exception.
  Reasons are stable strings.

  WRITES NOTHING TO time_grants. Qualification records that a reward was EARNED;
  paying it is reward_referral's job, and keeping them apart is what makes a failed
  payment retryable without re-deciding eligibility.
*/
create or replace function public.qualify_referral(p_attribution_id uuid)
returns table (
  ok boolean,
  reason text,
  qualified_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
  -- 061 and 062 both hit this: RETURNS TABLE columns are also OUT variables and
  -- shadow identically named table columns, failing at RUNTIME while compiling clean.
  #variable_conflict use_column
declare
  v_a public.referral_attributions%rowtype;
  v_now timestamptz := now();
  v_window interval := interval '30 days';
begin
  if p_attribution_id is null then
    raise exception 'qualify_referral: attribution id is required';
  end if;

  -- FOR UPDATE, so a concurrent qualification of the same row waits here rather
  -- than racing the eligibility checks below against a row that is already moving.
  select * into v_a
    from public.referral_attributions ra
   where ra.id = p_attribution_id
     for update;

  if not found then
    return query select false, 'not_found', null::timestamptz;
    return;
  end if;

  /*
    Already-terminal states answer for themselves. `already_qualified` and
    `already_rewarded` are reported distinctly from a refusal because the caller
    treats them as SUCCESS on replay — a retried Predict hook must converge, not
    escalate.
  */
  if v_a.state = 'qualified' then
    return query select false, 'already_qualified', v_a.qualified_at;
    return;
  end if;

  if v_a.state = 'rewarded' then
    return query select false, 'already_rewarded', v_a.qualified_at;
    return;
  end if;

  if v_a.state <> 'attributed' then
    -- expired / rejected / reversed. Each is terminal and none may be qualified.
    return query select false, v_a.state, null::timestamptz;
    return;
  end if;

  /*
    HALF-OPEN WINDOW, identical to isAttributionExpired in server-utils/referrals.js:
    the boundary instant is EXPIRED (>=, not >). One clock, one comparison, two
    languages — if these ever disagree, a referral qualifies through one door and
    expires through the other.
  */
  if v_now - v_a.attributed_at >= v_window then
    return query select false, 'expired', null::timestamptz;
    return;
  end if;

  -- Server-authoritative, read now. Never an argument, never a JWT claim.
  if not exists (
    select 1 from auth.users u
     where u.id = v_a.invitee_id
       and u.email_confirmed_at is not null
  ) then
    return query select false, 'email_unverified', null::timestamptz;
    return;
  end if;

  /*
    NEW ACCOUNTS ONLY, enforced here rather than at claim time.

    An account that had already predicted before the referral existed was not
    activated by it, so there is nothing to reward. This is the durable form of
    "new": no prior USE of the product. Account age is deliberately not the test —
    profiles.created_at happily calls a two-year-old dormant signup old, when it is
    exactly the account a referral is supposed to activate.
  */
  if exists (
    select 1 from public.user_prediction_fixtures upf
     where upf.user_id = v_a.invitee_id
       and upf.first_predicted_at < v_a.attributed_at
  ) then
    return query select false, 'not_new_account', null::timestamptz;
    return;
  end if;

  /*
    The qualifying event. user_prediction_fixtures is written by
    linkUserPredictionFixtures.js AFTER predictions_history persists, so a row here
    means the invitee durably received predictions — not that they clicked, not that
    an endpoint returned 200, and not that an attempt counter moved (that counter is
    incremented BEFORE persistence, which is why rollback_predict_increment exists).
  */
  if not exists (
    select 1 from public.user_prediction_fixtures upf
     where upf.user_id = v_a.invitee_id
       and upf.first_predicted_at >= v_a.attributed_at
  ) then
    return query select false, 'no_qualifying_predict', null::timestamptz;
    return;
  end if;

  -- The state predicate is redundant under FOR UPDATE and kept anyway: it is the
  -- assertion that makes this a compare-and-swap even if the lock is ever relaxed.
  update public.referral_attributions ra
     set state = 'qualified',
         qualified_at = v_now
   where ra.id = p_attribution_id
     and ra.state = 'attributed';

  if not found then
    return query select false, 'state_changed', null::timestamptz;
    return;
  end if;

  return query select true, null::text, v_now;
end;
$$;

-- --------------------------------------------------------------------- reward

/*
  Pay a qualified referral. Both grants, the cap and the state change, atomically.

  EXPIRY IS NOT RE-CHECKED, deliberately. The window governs whether the reward was
  EARNED, and qualify_referral already answered that at `qualified_at`. Re-testing
  the clock here would mean a transient failure on day 29 silently confiscates a
  reward on day 31 — punishing the user for our outage, in a way they cannot
  distinguish from being cheated.

  LOCK ORDER IS BY UUID, NOT BY ROLE. Reciprocal referral is allowed in V1 (A invites
  B, B invites A), so two simultaneous rewards can want the same two per-user grant
  locks. Ordering by role would have one transaction take (inviter=A, invitee=B) and
  the other (inviter=B, invitee=A) — opposite orders, a textbook deadlock. Sorting
  both calls by user id gives every transaction in the system one global order.
*/
create or replace function public.reward_referral(p_attribution_id uuid)
returns table (
  ok boolean,
  reason text,
  invitee_grant_id uuid,
  inviter_grant_id uuid,
  inviter_capped boolean,
  inviter_reward_count integer,
  rewarded_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
  #variable_conflict use_column
declare
  /*
    Mirrors STANDARD_BONUS_DAYS and REFERRAL_INVITER_CAP in JavaScript. The values
    live here because this function owns the transaction, and a test in
    tests/referralRewards.test.js reads this file and asserts the two agree — a
    duplicated constant is only safe when something fails on drift.
  */
  v_days constant integer := 5;
  v_cap constant integer := 10;

  v_a public.referral_attributions%rowtype;
  v_now timestamptz := now();
  v_count integer;
  v_inviter_eligible boolean;
  v_invitee_grant uuid;
  v_inviter_grant uuid;
begin
  if p_attribution_id is null then
    raise exception 'reward_referral: attribution id is required';
  end if;

  select * into v_a
    from public.referral_attributions ra
   where ra.id = p_attribution_id
     for update;

  if not found then
    return query select false, 'not_found', null::uuid, null::uuid, null::boolean, null::integer, null::timestamptz;
    return;
  end if;

  -- Replay converges instead of paying twice. The grant idempotency keys would
  -- catch it anyway; returning early means a retry does not even take the locks.
  if v_a.state = 'rewarded' then
    return query select true, 'already_rewarded', null::uuid, null::uuid,
                        (v_a.inviter_rewarded_at is null), null::integer, v_a.rewarded_at;
    return;
  end if;

  if v_a.state <> 'qualified' then
    return query select false, 'not_qualified', null::uuid, null::uuid, null::boolean, null::integer, null::timestamptz;
    return;
  end if;

  /*
    CAP LOCK. Namespace 1 keeps it distinct from grant_bonus_days' own per-user lock
    (seed 0) so the two mean different things, and it is taken BEFORE any grant lock
    so every transaction that touches this inviter's cap agrees on the order.

    Held until commit, which is the entire point: the count below and the write that
    follows it are one indivisible decision. Nine rewarded referrals plus two
    simultaneous qualifications yields exactly one more payout, because the second
    transaction cannot read the count until the first has committed its row.
  */
  perform pg_advisory_xact_lock(hashtextextended(v_a.inviter_id::text, 1));

  select count(*)::integer into v_count
    from public.referral_attributions ra
   where ra.inviter_id = v_a.inviter_id
     and ra.inviter_rewarded_at is not null
     and ra.state <> 'reversed';

  v_inviter_eligible := v_count < v_cap;

  /*
    THE GRANTS, in ascending user-id order. See the header on lock ordering.

    A capped inviter is not an error and does not withhold the invitee's reward: the
    invitee did the work, and the cap limits what the INVITER can earn, not what the
    invitee is owed. No inviter grant means no inviter idempotency key is ever
    created, so a later policy change could pay it without colliding with a replay.
  */
  if v_inviter_eligible and v_a.inviter_id::text < v_a.invitee_id::text then
    select g.id into v_inviter_grant from public.grant_bonus_days(
      v_a.inviter_id, v_days, 'referral_inviter',
      'ref:v1:' || v_a.id::text || ':inviter', v_a.id::text,
      jsonb_build_object('referral', jsonb_build_object(
        'campaign', 'v1', 'role', 'inviter', 'qualifiedAt', v_a.qualified_at))
    ) g;

    select g.id into v_invitee_grant from public.grant_bonus_days(
      v_a.invitee_id, v_days, 'referral_invitee',
      'ref:v1:' || v_a.id::text || ':invitee', v_a.id::text,
      jsonb_build_object('referral', jsonb_build_object(
        'campaign', 'v1', 'role', 'invitee', 'qualifiedAt', v_a.qualified_at))
    ) g;
  else
    select g.id into v_invitee_grant from public.grant_bonus_days(
      v_a.invitee_id, v_days, 'referral_invitee',
      'ref:v1:' || v_a.id::text || ':invitee', v_a.id::text,
      jsonb_build_object('referral', jsonb_build_object(
        'campaign', 'v1', 'role', 'invitee', 'qualifiedAt', v_a.qualified_at))
    ) g;

    if v_inviter_eligible then
      select g.id into v_inviter_grant from public.grant_bonus_days(
        v_a.inviter_id, v_days, 'referral_inviter',
        'ref:v1:' || v_a.id::text || ':inviter', v_a.id::text,
        jsonb_build_object('referral', jsonb_build_object(
          'campaign', 'v1', 'role', 'inviter', 'qualifiedAt', v_a.qualified_at))
      ) g;
    end if;
  end if;

  if v_invitee_grant is null then
    -- grant_bonus_days always returns a row (created or replayed). A null id here
    -- means something is wrong that we must not paper over with a 'rewarded' state.
    raise exception 'reward_referral: invitee grant produced no row for %', p_attribution_id;
  end if;

  update public.referral_attributions ra
     set state = 'rewarded',
         rewarded_at = v_now,
         invitee_rewarded_at = v_now,
         inviter_rewarded_at = case when v_inviter_eligible then v_now else null end
   where ra.id = p_attribution_id
     and ra.state = 'qualified';

  if not found then
    raise exception 'reward_referral: attribution % changed state mid-transaction', p_attribution_id;
  end if;

  return query select true, null::text, v_invitee_grant, v_inviter_grant,
                      (not v_inviter_eligible), v_count, v_now;
end;
$$;

-- ------------------------------------------------------------------- security

/*
  Service role only, exactly like claim_referral and grant_bonus_days.

  A signed-in client that could execute either of these could qualify its own
  referral, or pay itself — both functions take an attribution id and trust it
  absolutely, because the caller is the server.
*/
revoke all on function public.qualify_referral(uuid) from public, anon, authenticated;
revoke all on function public.reward_referral(uuid) from public, anon, authenticated;
grant execute on function public.qualify_referral(uuid) to service_role;
grant execute on function public.reward_referral(uuid) to service_role;
