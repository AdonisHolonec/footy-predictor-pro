create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  favorite_leagues integer[] not null default '{}',
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_profiles_updated_at();

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, role, favorite_leagues, is_blocked)
  values (new.id, 'user', '{}', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

alter table public.profiles enable row level security;

drop policy if exists "users_can_read_own_profile" on public.profiles;
create policy "users_can_read_own_profile"
on public.profiles
for select
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles as admin_profile
    where admin_profile.user_id = auth.uid()
      and admin_profile.role = 'admin'
  )
);

drop policy if exists "users_can_update_own_profile" on public.profiles;
create policy "users_can_update_own_profile"
on public.profiles
for update
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles as admin_profile
    where admin_profile.user_id = auth.uid()
      and admin_profile.role = 'admin'
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles as admin_profile
    where admin_profile.user_id = auth.uid()
      and admin_profile.role = 'admin'
  )
);

drop policy if exists "users_can_insert_own_profile" on public.profiles;
create policy "users_can_insert_own_profile"
on public.profiles
for insert
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.profiles as admin_profile
    where admin_profile.user_id = auth.uid()
      and admin_profile.role = 'admin'
  )
);
