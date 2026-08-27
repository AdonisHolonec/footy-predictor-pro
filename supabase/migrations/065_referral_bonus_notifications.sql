-- 065 — Referral bonus notifications.
--
-- Two things this feature could not be built without, and nothing else.
--
-- 1. A PUBLIC DISPLAY NAME. The product had no user identity other than the email
--    address: `profiles` carried role, favourite leagues and flags, and every
--    surface that shows "who you are" renders `user.email`. Telling an inviter WHO
--    joined therefore had no safe source — an email is not a display name, and
--    showing one person's email to another is exactly what the referral privacy
--    rules forbid. This adds the missing field rather than leaking the address.
--
-- 2. AN ACKNOWLEDGEMENT LEDGER. "Show this reward once" is an account-level fact,
--    not a device-level one. The app already had `notificationsSeenIds` in
--    localStorage, but that re-announces the same reward on every new device and
--    forgets it whenever site data is cleared. A row per delivered grant is the
--    only way the second device can know the first already showed it.
--
-- Deliberately NOT a column on time_grants. That ledger is the audit record for
-- entitlement: it is written once by grant_bonus_days and revoked only by
-- revoke_time_grant. Marking it "notified" would make a presentation concern
-- mutate a financial row, so the acknowledgement lives in its own table and
-- time_grants stays immutable.

-- ---------------------------------------------------------------- display name

alter table public.profiles
  add column if not exists display_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_display_name_shape'
  ) then
    alter table public.profiles
      add constraint profiles_display_name_shape check (
        display_name is null
        or (
          -- Trimmed length, so "   " cannot pass as a two-character name.
          char_length(btrim(display_name)) between 2 and 40
          -- An email address must never become a display name. Without this a
          -- user could paste their address here and the referral notification
          -- would hand it to their inviter — the precise leak this column
          -- exists to avoid. Belt and braces with the API-side validation.
          and display_name !~ '@'
          -- No control characters or line breaks: this string is rendered inline
          -- in a toast and must not be able to restructure it.
          and display_name !~ '[[:cntrl:]]'
        )
      );
  end if;
end
$$;

comment on column public.profiles.display_name is
  'Optional public display name. The ONLY user identity that may be shown to another user (a referral inviter sees their invitee''s). Never an email — enforced by profiles_display_name_shape.';

-- display_name is intentionally absent from protect_profiles_privilege_columns
-- (027): it is the user's own to set, unlike role/tier/is_blocked. The existing
-- "users_update_own_profile" policy already scopes updates to auth.uid(), so no
-- new policy is required and none is added here.

-- ------------------------------------------------- acknowledgement ledger

create table if not exists public.referral_grant_notifications (
  -- grant_id is the PRIMARY KEY, not a plain column with an index. Duplicate
  -- delivery is then impossible by construction rather than by careful code:
  -- a second acknowledgement of the same grant cannot be inserted at all.
  grant_id uuid primary key references public.time_grants(id) on delete cascade,
  -- Denormalised from the grant so the "what has this user already seen" read is
  -- a single indexed lookup instead of a join back to time_grants on every boot.
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now()
);

create index if not exists referral_grant_notifications_user_idx
  on public.referral_grant_notifications (user_id);

alter table public.referral_grant_notifications enable row level security;

-- Readable by the owner; that is the whole client-facing surface. There is
-- deliberately NO insert/update/delete policy: acknowledgement is written by the
-- API with the service role after it has verified the grant belongs to the
-- caller, so a client cannot acknowledge — or un-acknowledge — anything by
-- talking to PostgREST directly.
drop policy if exists "users_read_own_referral_grant_notifications"
  on public.referral_grant_notifications;
create policy "users_read_own_referral_grant_notifications"
  on public.referral_grant_notifications
  for select
  using (auth.uid() = user_id);

comment on table public.referral_grant_notifications is
  'One row per referral bonus grant already announced to its recipient. Presentation state only — never entitlement. Absence of a row is what makes a grant "new".';
