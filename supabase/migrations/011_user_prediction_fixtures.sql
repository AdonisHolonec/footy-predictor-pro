-- Links authenticated users to fixtures they generated via Predict (for per-user / per-league performance).

create table if not exists public.user_prediction_fixtures (
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  fixture_id bigint not null references public.predictions_history (fixture_id) on delete cascade,
  first_predicted_at timestamptz not null default now(),
  primary key (user_id, fixture_id)
);

create index if not exists user_prediction_fixtures_user_idx
  on public.user_prediction_fixtures (user_id);

create index if not exists user_prediction_fixtures_fixture_idx
  on public.user_prediction_fixtures (fixture_id);

alter table public.user_prediction_fixtures enable row level security;

drop policy if exists "service_only_user_prediction_fixtures" on public.user_prediction_fixtures;
create policy "service_only_user_prediction_fixtures"
on public.user_prediction_fixtures
for all
using (false);

-- Aggregated counters for admin API (service_role / admin client only).
create or replace function public.performance_counter_by_user_league (p_days integer)
returns table (
  user_id uuid,
  league_id integer,
  league_name text,
  wins bigint,
  losses bigint,
  pending bigint,
  settled bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.user_id,
    coalesce(h.league_id, 0)::integer as league_id,
    coalesce(h.league_name, '')::text as league_name,
    count(*) filter (where h.validation = 'win')::bigint as wins,
    count(*) filter (where h.validation = 'loss')::bigint as losses,
    count(*) filter (where h.validation = 'pending')::bigint as pending,
    count(*) filter (where h.validation in ('win', 'loss'))::bigint as settled
  from public.user_prediction_fixtures u
  inner join public.predictions_history h on h.fixture_id = u.fixture_id
  where h.kickoff_at >= (timezone('utc', now()) - (greatest(1, least(coalesce(p_days, 30), 120))) * interval '1 day')
  group by u.user_id, h.league_id, h.league_name;
$$;

revoke all on function public.performance_counter_by_user_league (integer) from public;
grant execute on function public.performance_counter_by_user_league (integer) to service_role;
