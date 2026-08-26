/*
  PR3a — referral attribution foundation.

  Two tables and three functions. No rewards: this migration cannot grant bonus time
  and deliberately does not reference public.time_grants at all. Qualification and
  reward issuance are PR3c.

  THE SHAPE OF THE TRUST BOUNDARY. A referral is a claim by the INVITEE about who
  invited them, and the only thing the client is allowed to say is a CODE. It never
  names an inviter. `claim_referral` resolves code -> inviter server-side, takes the
  invitee identity from the caller's verified session, and does the whole thing in
  one statement so that resolution, the self-referral checks and the insert cannot
  drift apart under concurrency.

  This mirrors 061's grant_bonus_days on purpose: the invariants live in the
  database, not in the application, because an application check is only as good as
  the last caller that remembered it.
*/

-- ---------------------------------------------------------------- referral_codes

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Generated server-side from a CSPRNG. Never derived from user id, email,
  -- timestamp or any sequence: a guessable code is a free attribution.
  code text not null unique,
  created_at timestamptz not null default now(),
  disabled_at timestamptz null
);

/*
  ONE ACTIVE code per inviter — as a PARTIAL unique index, not a plain
  unique(user_id).

  A plain unique would force code rotation to be destructive: disabling a leaked
  code and issuing a replacement would mean UPDATEing the row and losing the record
  that the old code ever existed. Attribution rows store `code` as text, so a
  vanished code turns historic attributions into unresolvable references. Partial
  uniqueness keeps rotation additive and the history intact.
*/
create unique index if not exists referral_codes_one_active_per_user_uidx
  on public.referral_codes (user_id)
  where disabled_at is null;

comment on table public.referral_codes is
  'Referral codes. One ACTIVE code per inviter (partial unique index); disabled codes are kept so historic attributions stay resolvable.';

alter table public.referral_codes enable row level security;

-- An inviter may read their own code. Nobody writes from the client: issuance goes
-- through the server, so a compromised client cannot mint a code for another user.
drop policy if exists "users_read_own_referral_codes" on public.referral_codes;
create policy "users_read_own_referral_codes"
on public.referral_codes
for select
to authenticated
using (auth.uid() = user_id);

grant select on public.referral_codes to authenticated;
grant all privileges on public.referral_codes to service_role;
revoke all on public.referral_codes from anon;

-- --------------------------------------------------------- referral_attributions

create table if not exists public.referral_attributions (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  -- The code as claimed, kept verbatim for audit even if it is later disabled.
  code text not null,
  state text not null default 'attributed'
    check (state in ('attributed', 'qualified', 'rewarded', 'rejected', 'expired', 'reversed')),
  attributed_at timestamptz not null default now(),
  qualified_at timestamptz null,
  rewarded_at timestamptz null,
  rejected_reason text null,
  -- Soft signal only, never a block. NULL throughout PR3a — see the module header
  -- in server-utils/referrals.js for why no hash is written yet.
  ip_hash text null,
  created_at timestamptz not null default now(),
  -- Cheapest self-referral block there is, and the one that cannot be forgotten by
  -- a caller. The richer identity checks live in claim_referral below.
  constraint referral_attributions_not_self check (inviter_id <> invitee_id),
  -- ONE attribution per invitee, ever. This is the idempotency anchor for the whole
  -- feature: PR3c derives its reward idempotency keys from `id`, so a second
  -- attribution would be a second reward.
  constraint referral_attributions_invitee_uniq unique (invitee_id)
);

create index if not exists referral_attributions_inviter_idx
  on public.referral_attributions (inviter_id, state);

comment on table public.referral_attributions is
  'Who invited whom. One row per invitee, immutable inviter. PR3a only ever writes state=attributed.';
comment on column public.referral_attributions.state is
  'attributed -> qualified -> rewarded, with rejected/expired/reversed terminal. PR3a writes only attributed; later states belong to PR3b/PR3c.';
comment on column public.referral_attributions.attributed_at is
  'Start of the 30-day qualification window. Expiry is DERIVED from this column, never stored, so there is one source of truth and no cron.';

alter table public.referral_attributions enable row level security;

/*
  The invitee may read their own attribution. The INVITER deliberately gets no
  policy at all: a row exposes invitee_id, and handing an inviter the internal user
  id of everyone who accepted their link is a privacy leak for a counter. Inviter
  totals come back as aggregates through the server, which reads as service_role.
*/
drop policy if exists "invitee_reads_own_attribution" on public.referral_attributions;
create policy "invitee_reads_own_attribution"
on public.referral_attributions
for select
to authenticated
using (auth.uid() = invitee_id);

grant select on public.referral_attributions to authenticated;
grant all privileges on public.referral_attributions to service_role;
revoke all on public.referral_attributions from anon;

-- ------------------------------------------------------------------- email rules

/*
  Email normalisation, in SQL and ONLY in SQL.

  A JavaScript twin of this rule would be a second implementation of one rule, which
  is exactly the drift PR2a and PR2b spent two PRs removing. The self-referral check
  runs inside claim_referral, so the rule belongs next to the data it compares.

  Gmail's dot-insensitivity is applied ONLY for Gmail. Stripping dots globally would
  wrongly equate two distinct addresses at providers that treat dots as significant.
*/
create or replace function public.referral_normalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_local text;
  v_domain text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return null;
  end if;

  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);

  -- Sub-addressing: everything from the first '+' is a label, not an identity.
  v_local := split_part(v_local, '+', 1);

  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;

  if v_local = '' then
    return null;
  end if;

  return v_local || '@' || v_domain;
end;
$$;

-- ----------------------------------------------------------------- claim_referral

/*
  Resolve a code and attribute the caller to its owner, atomically.

  Returns a row rather than raising: "you cannot refer yourself" is an ordinary
  outcome the API turns into a 4xx, not an exception. Reasons are stable strings so
  the handler maps them without parsing prose.

  REJECTIONS ARE NOT PERSISTED. A rejected claim writes nothing, because
  referral_attributions is UNIQUE(invitee_id): storing a rejection would consume the
  invitee's only attribution slot and permanently bar them from a legitimate
  referral over a typo or a self-referral attempt. The `rejected` state exists for
  PR3c, where a REWARDED attribution can be rejected by fraud review.

  CONCURRENCY. Two simultaneous claims by the same invitee both reach the insert;
  one wins, the other hits the unique constraint and falls through to the read
  below. If the loser named the same inviter it converges on the winner's row and
  reports success; if it named a different inviter it reports already_attributed.
  No advisory lock is needed — the unique constraint is the serialisation point.
*/
create or replace function public.claim_referral(
  p_invitee_id uuid,
  p_code text,
  p_ip_hash text default null
)
returns table (
  ok boolean,
  reason text,
  attribution_id uuid,
  inviter_id uuid,
  code text,
  state text,
  attributed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
  -- 061 shipped a runtime-fatal ambiguity because RETURNS TABLE columns shadow
  -- identically named table columns. Same guard, same reason.
  #variable_conflict use_column
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_row public.referral_codes%rowtype;
  v_inviter uuid;
  v_reason text;
  v_new public.referral_attributions%rowtype;
  v_existing public.referral_attributions%rowtype;
begin
  if p_invitee_id is null then
    raise exception 'claim_referral: invitee id is required';
  end if;

  if v_code = '' then
    return query select false, 'missing_code', null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- Looked up WITHOUT the disabled filter so a disabled code can be reported as
  -- disabled rather than as merely invalid. The distinction matters to the user.
  select * into v_row from public.referral_codes rc where rc.code = v_code;

  if not found then
    return query select false, 'invalid_code', null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_row.disabled_at is not null then
    return query select false, 'disabled_code', null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_inviter := v_row.user_id;

  -- Self-referral, hardest signal first. Every one of these is a HARD BLOCK.
  select case
    when v_inviter = p_invitee_id then 'self_referral_same_account'
    when exists (
      select 1
        from auth.users iu
        join auth.users vu on vu.id = p_invitee_id
       where iu.id = v_inviter
         and lower(btrim(iu.email)) = lower(btrim(vu.email))
    ) then 'self_referral_same_email'
    when exists (
      select 1
        from auth.users iu
        join auth.users vu on vu.id = p_invitee_id
       where iu.id = v_inviter
         and public.referral_normalize_email(iu.email) is not null
         and public.referral_normalize_email(iu.email) = public.referral_normalize_email(vu.email)
    ) then 'self_referral_normalized_email'
    /*
      DEFENCE IN DEPTH, not the live protection. Migration 028 already carries
      profiles_stripe_customer_id_uidx (partial UNIQUE where not null), so two
      accounts cannot share a customer id to begin with and this branch is
      currently unreachable. Kept because it costs one CASE arm and survives that
      index being relaxed — but do not mistake it for what stops the attack.
    */
    when exists (
      select 1
        from public.profiles ip
        join public.profiles vp on vp.user_id = p_invitee_id
       where ip.user_id = v_inviter
         and ip.stripe_customer_id is not null
         and ip.stripe_customer_id = vp.stripe_customer_id
    ) then 'self_referral_same_stripe_customer'
    else null
  end into v_reason;

  if v_reason is not null then
    return query select false, v_reason, null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  insert into public.referral_attributions (inviter_id, invitee_id, code, state, ip_hash)
  values (v_inviter, p_invitee_id, v_code, 'attributed', p_ip_hash)
  on conflict on constraint referral_attributions_invitee_uniq do nothing
  returning * into v_new;

  if v_new.id is not null then
    return query select true, null::text, v_new.id, v_new.inviter_id, v_new.code, v_new.state, v_new.attributed_at;
    return;
  end if;

  -- Lost the race, or this invitee was already attributed earlier.
  select * into v_existing
    from public.referral_attributions ra
   where ra.invitee_id = p_invitee_id;

  if v_existing.inviter_id = v_inviter then
    -- Same answer as the winner: converge instead of failing a correct claim.
    return query select true, null::text, v_existing.id, v_existing.inviter_id, v_existing.code,
                        v_existing.state, v_existing.attributed_at;
    return;
  end if;

  return query select false, 'already_attributed', null::uuid, null::uuid, null::text, null::text, null::timestamptz;
end;
$$;

/*
  Aggregate counts for one inviter, with NO invitee identities in the result.

  This is why referral_attributions has no inviter SELECT policy: the inviter needs
  a number, not a list of user ids.
*/
create or replace function public.referral_inviter_summary(p_user_id uuid)
returns table (
  attributed_count integer,
  qualified_count integer,
  rewarded_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where ra.state = 'attributed')::integer,
    count(*) filter (where ra.state = 'qualified')::integer,
    count(*) filter (where ra.state = 'rewarded')::integer
  from public.referral_attributions ra
  where ra.inviter_id = p_user_id;
$$;

-- Both stateful functions are server-side only: claim_referral trusts its invitee
-- argument absolutely, and referral_inviter_summary would leak another user's
-- totals if it could be called with an arbitrary id. The API supplies an id taken
-- from a verified session, and nothing else may call them.
revoke all on function public.claim_referral(uuid, text, text) from public, anon, authenticated;
revoke all on function public.referral_inviter_summary(uuid) from public, anon, authenticated;
revoke all on function public.referral_normalize_email(text) from public, anon;
grant execute on function public.claim_referral(uuid, text, text) to service_role;
grant execute on function public.referral_inviter_summary(uuid) to service_role;
grant execute on function public.referral_normalize_email(text) to service_role;
