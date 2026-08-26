-- 061_time_grants.sql
--
-- Bonus-time ledger. Every row is an ULTRA bonus.
--
-- WHY A LEDGER AND NOT A COLUMN ON profiles:
--
-- `profiles.subscription_expires_at` is owned by Stripe. server-utils/stripeBilling.js
-- overwrites it from `subscription.current_period_end` on EVERY webhook, and nulls it
-- on canceled/unpaid/incomplete_expired. Bonus days written there would be silently
-- destroyed by the next renewal, with nothing to restore them from. Paid entitlement
-- and bonus entitlement therefore stay in separate stores and are combined only at
-- read time, in resolveEffectiveTierFromProfile.
--
-- WHY EVERY ROW IS ULTRA:
--
-- Fixed product rule: bonus time always grants ULTRA regardless of the user's paid
-- tier. There is deliberately no per-grant tier column — adding one would invite the
-- rule to drift per-campaign. If a future campaign genuinely needs a different tier,
-- that is a migration and a product decision, not a silent per-row flag.
--
-- WHY DAYS AND NOT MINUTES:
--
-- Nothing in the application meters access by elapsed minutes; entitlement is a
-- wall-clock instant (`subscription_expires_at`) plus per-day quotas. A minute
-- balance would need a consumption mechanism that has no consumer.
--
-- This migration is additive and idempotent: create-if-not-exists only, no existing
-- row is read or modified, no existing table is rewritten.

create table if not exists public.time_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Ledger sources. referral_* are reserved for a later PR; PR1 implements none of
  -- that lifecycle, it only guarantees the ledger can carry it.
  source text not null check (
    source in ('referral_inviter', 'referral_invitee', 'admin_grant', 'compensation', 'promo_campaign')
  ),
  days integer not null check (days > 0),
  granted_at timestamptz not null default now(),
  -- Materialised at grant time so the value is auditable and immune to later policy
  -- changes. Sequential stacking means this is (max(now, current bonus end) + days),
  -- NOT (now + days) — see public.grant_bonus_days.
  effective_until timestamptz not null,
  -- Revocation is a flag, never a delete: disputes and fraud review need the row.
  revoked_at timestamptz null,
  revoked_reason text null,
  reference_id text null,
  -- The race guard. Uniqueness is enforced here, not in application code, for the
  -- same reason stripe_webhook_events uses event_id as its primary key.
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.time_grants is
  'Bonus-time ledger. Every row grants ULTRA for its window. Never written by Stripe; combined with profiles.subscription_expires_at only at read time.';
comment on column public.time_grants.effective_until is
  'Materialised end of THIS grant, computed with sequential stacking: max(now(), current active bonus end) + days.';
comment on column public.time_grants.idempotency_key is
  'Unique. Duplicate grant attempts return the existing row instead of creating a second one.';
comment on column public.time_grants.revoked_at is
  'Set to stop the grant contributing to entitlement. Rows are never deleted, and days/effective_until are never mutated.';

-- The only hot-path query: active bonus for one user. Partial index keeps it to the
-- non-revoked rows, which is the entire read pattern.
create index if not exists time_grants_active_by_user_idx
  on public.time_grants (user_id, effective_until desc)
  where revoked_at is null;

alter table public.time_grants enable row level security;

-- Users may read their own grants and nothing else. They may never write: every
-- mutation goes through the SECURITY DEFINER functions below, so a compromised
-- client cannot mint itself ULTRA.
drop policy if exists "users_read_own_time_grants" on public.time_grants;
create policy "users_read_own_time_grants"
on public.time_grants
for select
to authenticated
using (auth.uid() = user_id);

grant select on public.time_grants to authenticated;
grant all privileges on public.time_grants to service_role;
-- No anon access: bonus state is per-user and never public.
revoke all on public.time_grants from anon;

/*
  Grant N bonus days with SEQUENTIAL stacking, atomically and idempotently.

  Stacking: a second grant issued while the first is still running must EXTEND it,
  not be swallowed by it.

      base            = max(now(), current active bonus end)
      effective_until = base + days

  The naive `max(existing_until, now() + days)` is wrong: +5 days on Aug 26 then +5
  on Aug 28 would yield Aug 31 both times, silently discarding the second grant.
  This function yields Aug 31 then Sep 5.

  Atomicity: the per-user advisory lock serialises concurrent grants for one user, so
  two simultaneous requests cannot both read the same `base` and produce overlapping
  windows. The lock is transaction-scoped and released on commit or rollback.

  Idempotency: `on conflict (idempotency_key) do nothing` plus a follow-up select.
  A replayed request returns the ORIGINAL row unchanged — it never re-stacks, and it
  never mutates the stored window.

  Returns the grant row plus `created`, so the caller can distinguish a new grant
  from a replay deterministically.
*/
create or replace function public.grant_bonus_days(
  p_user_id uuid,
  p_days integer,
  p_source text,
  p_idempotency_key text,
  p_reference_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  user_id uuid,
  source text,
  days integer,
  granted_at timestamptz,
  effective_until timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  reference_id text,
  idempotency_key text,
  metadata jsonb,
  created_at timestamptz,
  created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base timestamptz;
  v_id uuid;
begin
  if p_user_id is null then
    raise exception 'grant_bonus_days: user_id is required';
  end if;
  if p_days is null or p_days <= 0 then
    raise exception 'grant_bonus_days: days must be a positive integer, got %', p_days;
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'grant_bonus_days: idempotency_key is required';
  end if;

  -- Serialise concurrent grants for THIS user only; different users never contend.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select greatest(now(), coalesce(max(g.effective_until), now()))
    into v_base
    from public.time_grants g
   where g.user_id = p_user_id
     and g.revoked_at is null;

  v_base := coalesce(v_base, now());

  insert into public.time_grants (
    user_id, source, days, effective_until, reference_id, idempotency_key, metadata
  )
  values (
    p_user_id, p_source, p_days, v_base + make_interval(days => p_days),
    p_reference_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning public.time_grants.id into v_id;

  return query
  select g.id, g.user_id, g.source, g.days, g.granted_at, g.effective_until,
         g.revoked_at, g.revoked_reason, g.reference_id, g.idempotency_key,
         g.metadata, g.created_at,
         (v_id is not null) as created
    from public.time_grants g
   where g.idempotency_key = p_idempotency_key;
end;
$$;

/*
  Revoke a grant. Non-destructive: sets revoked_at/revoked_reason and leaves days and
  effective_until untouched so the original award stays auditable. Idempotent — a
  second revoke of the same grant does not overwrite the first timestamp or reason.
*/
create or replace function public.revoke_time_grant(
  p_grant_id uuid,
  p_reason text default null
)
returns table (
  id uuid,
  user_id uuid,
  effective_until timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  revoked boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
begin
  if p_grant_id is null then
    raise exception 'revoke_time_grant: grant_id is required';
  end if;

  update public.time_grants g
     set revoked_at = now(),
         revoked_reason = p_reason
   where g.id = p_grant_id
     and g.revoked_at is null;

  get diagnostics v_changed = row_count;

  return query
  select g.id, g.user_id, g.effective_until, g.revoked_at, g.revoked_reason,
         (v_changed > 0) as revoked
    from public.time_grants g
   where g.id = p_grant_id;
end;
$$;

/*
  The single read the entitlement path needs: the end of the user's active bonus
  window, or NULL when there is none. Non-revoked and still in the future.
*/
create or replace function public.active_bonus_until(p_user_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(g.effective_until)
    from public.time_grants g
   where g.user_id = p_user_id
     and g.revoked_at is null
     and g.effective_until > now();
$$;

-- Mutating functions are server-side only. active_bonus_until is readable by a
-- signed-in user for their own row (the function is user-scoped by argument and the
-- table policy already limits direct reads).
revoke all on function public.grant_bonus_days(uuid, integer, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.revoke_time_grant(uuid, text) from public, anon, authenticated;
revoke all on function public.active_bonus_until(uuid) from public, anon;
grant execute on function public.grant_bonus_days(uuid, integer, text, text, text, jsonb) to service_role;
grant execute on function public.revoke_time_grant(uuid, text) to service_role;
grant execute on function public.active_bonus_until(uuid) to authenticated, service_role;
