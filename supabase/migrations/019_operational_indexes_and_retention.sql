-- Operational scale-up: indexes for frequent history queries + helper cleanup function for append-only logs.

create index if not exists predictions_history_league_kickoff_idx
  on public.predictions_history (league_id, kickoff_at desc);

create index if not exists predictions_history_pending_kickoff_idx
  on public.predictions_history (kickoff_at desc)
  where validation = 'pending';

create index if not exists user_daily_warm_predict_usage_day_idx
  on public.user_daily_warm_predict_usage (usage_day desc);

create or replace function public.cleanup_operational_logs(
  p_history_sync_days integer default 90,
  p_notification_days integer default 90,
  p_prediction_snapshots_days integer default 180
)
returns table (table_name text, deleted_rows bigint)
language plpgsql
security definer
as $$
declare
  v_count bigint;
begin
  delete from public.history_sync_log
  where ran_at < now() - make_interval(days => greatest(1, p_history_sync_days));
  get diagnostics v_count = row_count;
  table_name := 'history_sync_log';
  deleted_rows := v_count;
  return next;

  delete from public.notification_dispatch_log
  where created_at < now() - make_interval(days => greatest(1, p_notification_days));
  get diagnostics v_count = row_count;
  table_name := 'notification_dispatch_log';
  deleted_rows := v_count;
  return next;

  delete from public.prediction_snapshots
  where generated_at < now() - make_interval(days => greatest(1, p_prediction_snapshots_days));
  get diagnostics v_count = row_count;
  table_name := 'prediction_snapshots';
  deleted_rows := v_count;
  return next;
end;
$$;

comment on function public.cleanup_operational_logs(integer, integer, integer)
  is 'Retention helper for append-only operational tables. Intended for service_role/cron usage.';
