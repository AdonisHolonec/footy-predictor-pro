-- Hardening per Supabase advisor (function_search_path_mutable): lock down
-- search_path so these functions can't be tricked by a caller-manipulated
-- search_path into resolving an unqualified name to an attacker-controlled
-- object. cleanup_operational_logs already fully-qualifies every table
-- reference (public.x), so this closes the theoretical gap without changing
-- behavior; the two trigger functions are equally inert here (no unqualified
-- references at all) but are set for consistency with the rest of the schema.
-- CREATE OR REPLACE preserves existing grants/ownership for an unchanged
-- signature -- confirmed live that cleanup_operational_logs still shows only
-- postgres/service_role as grantees after this ran.

create or replace function public.cleanup_operational_logs(
  p_history_sync_days integer default 90,
  p_notification_days integer default 90,
  p_prediction_snapshots_days integer default 180
)
returns table(table_name text, deleted_rows bigint)
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

create or replace function public.set_predictions_history_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;
