drop policy if exists "users_can_update_own_profile" on public.profiles;

create policy "admins_manage_profiles"
on public.profiles
for update
using (
  exists (
    select 1
    from public.profiles as admin_profile
    where admin_profile.user_id = auth.uid()
      and admin_profile.role = 'admin'
      and admin_profile.is_blocked = false
  )
)
with check (
  exists (
    select 1
    from public.profiles as admin_profile
    where admin_profile.user_id = auth.uid()
      and admin_profile.role = 'admin'
      and admin_profile.is_blocked = false
  )
);

create policy "users_update_own_favorites_only"
on public.profiles
for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and role = 'user'
  and is_blocked = false
);
