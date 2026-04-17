-- Server-side daily caps for /api/warm and /api/predict (per user calendar day).
-- Access only via service role; RLS enabled with no policies for PostgREST.

create table if not exists public.user_daily_warm_predict_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_day date not null,
  warm_count smallint not null default 0,
  predict_count smallint not null default 0,
  updated_at timestamptz not null default now(),
  constraint user_daily_warm_predict_usage_pkey primary key (user_id, usage_day),
  constraint user_daily_warm_predict_usage_warm_nonneg check (warm_count >= 0 and warm_count <= 99),
  constraint user_daily_warm_predict_usage_pred_nonneg check (predict_count >= 0 and predict_count <= 99)
);

comment on table public.user_daily_warm_predict_usage is 'Daily warm/predict counts; updated from API routes using service role.';

alter table public.user_daily_warm_predict_usage enable row level security;

create or replace function public.increment_warm_predict_usage(
  p_user_id uuid,
  p_day date,
  p_kind text,
  p_max int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_w int;
  new_p int;
  cur_w int := 0;
  cur_p int := 0;
begin
  if p_kind not in ('warm', 'predict') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;
  if p_max is null or p_max < 1 or p_max > 100 then
    p_max := 3;
  end if;

  insert into public.user_daily_warm_predict_usage as u (user_id, usage_day, warm_count, predict_count)
  values (p_user_id, p_day, 0, 0)
  on conflict (user_id, usage_day) do nothing;

  if p_kind = 'warm' then
    update public.user_daily_warm_predict_usage u
    set
      warm_count = u.warm_count + 1,
      updated_at = now()
    where u.user_id = p_user_id
      and u.usage_day = p_day
      and u.warm_count < p_max
    returning u.warm_count, u.predict_count into new_w, new_p;

    if new_w is null then
      select coalesce(u.warm_count, 0), coalesce(u.predict_count, 0)
      into cur_w, cur_p
      from public.user_daily_warm_predict_usage u
      where u.user_id = p_user_id and u.usage_day = p_day;
      return jsonb_build_object('ok', false, 'reason', 'warm_limit', 'warm_count', cur_w, 'predict_count', cur_p, 'usage_day', p_day);
    end if;

    return jsonb_build_object('ok', true, 'kind', 'warm', 'warm_count', new_w, 'predict_count', new_p, 'usage_day', p_day);
  end if;

  update public.user_daily_warm_predict_usage u
  set
    predict_count = u.predict_count + 1,
    updated_at = now()
  where u.user_id = p_user_id
    and u.usage_day = p_day
    and u.predict_count < p_max
  returning u.warm_count, u.predict_count into new_w, new_p;

  if new_w is null then
    select coalesce(u.warm_count, 0), coalesce(u.predict_count, 0)
    into cur_w, cur_p
    from public.user_daily_warm_predict_usage u
    where u.user_id = p_user_id and u.usage_day = p_day;
    return jsonb_build_object('ok', false, 'reason', 'predict_limit', 'warm_count', cur_w, 'predict_count', cur_p, 'usage_day', p_day);
  end if;

  return jsonb_build_object('ok', true, 'kind', 'predict', 'warm_count', new_w, 'predict_count', new_p, 'usage_day', p_day);
end;
$$;

revoke all on function public.increment_warm_predict_usage(uuid, date, text, int) from public;
grant execute on function public.increment_warm_predict_usage(uuid, date, text, int) to service_role;
