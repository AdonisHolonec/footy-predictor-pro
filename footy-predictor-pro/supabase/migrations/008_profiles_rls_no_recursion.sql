-- Fix RLS recursion on public.profiles.
-- Admin mutations are handled via server-side API (service role),
-- so client-side RLS should only allow users to access their own profile.

alter table public.profiles enable row level security;

drop policy if exists "users_can_read_own_profile" on public.profiles;
drop policy if exists "users_can_update_own_profile" on public.profiles;
drop policy if exists "users_can_insert_own_profile" on public.profiles;
drop policy if exists "admins_manage_profiles" on public.profiles;
drop policy if exists "users_update_own_favorites_only" on public.profiles;

create policy "users_can_read_own_profile"
on public.profiles
for select
using (auth.uid() = user_id);

create policy "users_can_insert_own_profile"
on public.profiles
for insert
with check (auth.uid() = user_id);

create policy "users_update_own_profile"
on public.profiles
for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and role = 'user'
  and is_blocked = false
);
