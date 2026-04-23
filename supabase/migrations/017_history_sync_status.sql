-- Ultimul sync /api/history?sync=1 (cron sau JWT), pentru diagnostic fără Vercel Logs pe plan gratuit.
create table if not exists public.history_sync_status (
  id smallint primary key default 1,
  constraint history_sync_status_singleton check (id = 1),
  last_ran_at timestamptz not null default now(),
  last_source text,
  last_method text,
  last_scanned integer not null default 0,
  last_updated integer not null default 0,
  last_ok boolean not null default true,
  last_error text
);

alter table public.history_sync_status enable row level security;

drop policy if exists "service_only_history_sync_status" on public.history_sync_status;
create policy "service_only_history_sync_status"
on public.history_sync_status
for all
using (false);

comment on table public.history_sync_status is 'Row id=1: last predictions_history sync; written only by service_role (API). Inspect in Supabase Table Editor.';
