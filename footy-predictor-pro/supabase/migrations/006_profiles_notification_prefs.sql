alter table public.profiles
  add column if not exists notify_safe boolean not null default true,
  add column if not exists notify_value boolean not null default true,
  add column if not exists notify_email boolean not null default false,
  add column if not exists onboarding_completed boolean not null default false;
