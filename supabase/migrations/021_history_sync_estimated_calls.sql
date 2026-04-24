alter table if exists public.history_sync_status
  add column if not exists last_estimated_calls integer not null default 0;

alter table if exists public.history_sync_log
  add column if not exists estimated_calls integer not null default 0;

create index if not exists idx_history_sync_log_ran_at_estimated_calls
  on public.history_sync_log (ran_at desc, estimated_calls desc);
