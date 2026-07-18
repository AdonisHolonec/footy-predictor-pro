-- P0: block client self-escalation of tier / role / subscription / trials.
-- Users may still update favorites, notification prefs, onboarding via RLS.
-- Service role (API admin / activate-trial) can still mutate privilege columns.

create or replace function public.protect_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  db_role text := coalesce(current_setting('role', true), '');
begin
  -- service_role bypasses (PostgREST + supabaseAdmin)
  if jwt_role = 'service_role' or db_role = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_blocked is distinct from old.is_blocked
     or new.tier is distinct from old.tier
     or new.subscription_expires_at is distinct from old.subscription_expires_at
     or new.premium_trial_activated_at is distinct from old.premium_trial_activated_at
     or new.ultra_trial_activated_at is distinct from old.ultra_trial_activated_at
  then
    raise exception 'profiles privilege columns are immutable for clients';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profiles_privilege_columns on public.profiles;
create trigger trg_protect_profiles_privilege_columns
before update on public.profiles
for each row
execute function public.protect_profiles_privilege_columns();

-- Keep role=user + not blocked on client updates (existing policy intent).
drop policy if exists "users_update_own_profile" on public.profiles;
create policy "users_update_own_profile"
on public.profiles
for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and role = 'user'
  and is_blocked = false
);
