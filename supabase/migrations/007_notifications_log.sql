create table if not exists public.notification_dispatch_log (
  id bigserial primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  fixture_id bigint not null,
  notification_type text not null check (notification_type in ('safe', 'value')),
  channel text not null default 'email' check (channel in ('email')),
  status text not null default 'sent' check (status in ('sent', 'skipped', 'error')),
  detail text,
  created_at timestamptz not null default now()
);

create unique index if not exists notification_dispatch_unique_idx
  on public.notification_dispatch_log (user_id, fixture_id, notification_type, channel);

create index if not exists notification_dispatch_created_at_idx
  on public.notification_dispatch_log (created_at desc);
