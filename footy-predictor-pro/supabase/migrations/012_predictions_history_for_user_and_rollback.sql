-- User-scoped history read (join user_prediction_fixtures) + rollback for failed persist after quota increment.

create or replace function public.predictions_history_for_user (
  p_user_id uuid,
  p_days integer,
  p_limit integer
)
returns setof public.predictions_history
language sql
stable
security definer
set search_path = public
as $$
  select h.*
  from public.predictions_history h
  inner join public.user_prediction_fixtures u
    on u.fixture_id = h.fixture_id and u.user_id = p_user_id
  where h.kickoff_at >= (timezone('utc', now()) - (greatest(1, least(coalesce(p_days, 30), 120))) * interval '1 day')
  order by h.kickoff_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
$$;

revoke all on function public.predictions_history_for_user (uuid, integer, integer) from public;
grant execute on function public.predictions_history_for_user (uuid, integer, integer) to service_role;

comment on function public.predictions_history_for_user is 'Service role: predictions_history rows linked to a user via user_prediction_fixtures.';

create or replace function public.rollback_predict_increment (
  p_user_id uuid,
  p_day date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_p int;
begin
  update public.user_daily_warm_predict_usage u
  set
    predict_count = greatest(0, u.predict_count - 1),
    updated_at = now()
  where u.user_id = p_user_id
    and u.usage_day = p_day
    and u.predict_count > 0
  returning u.predict_count into new_p;

  if new_p is null then
    return jsonb_build_object('ok', true, 'rolled_back', false);
  end if;

  return jsonb_build_object('ok', true, 'rolled_back', true, 'predict_count', new_p);
end;
$$;

revoke all on function public.rollback_predict_increment (uuid, date) from public;
grant execute on function public.rollback_predict_increment (uuid, date) to service_role;
