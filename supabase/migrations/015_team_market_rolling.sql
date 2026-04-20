-- 015: Rolling averages per echipă pentru pieţe care NU sunt agregate în /teams/statistics
--       (cornere, şuturi la poartă, total şuturi). Construite din /fixtures/statistics
--       pe ultimele N meciuri terminate, cache-ate local pentru a evita call-uri repetate.

create table if not exists public.team_market_rolling (
  team_id bigint not null,
  league_id integer not null,
  season integer not null,
  matches_sampled integer not null default 0,

  -- cornere
  corners_for_avg numeric,
  corners_against_avg numeric,
  corners_for_home_avg numeric,
  corners_against_home_avg numeric,
  corners_for_away_avg numeric,
  corners_against_away_avg numeric,

  -- şuturi la poartă (on target)
  sot_for_avg numeric,
  sot_against_avg numeric,

  -- şuturi totale
  shots_total_for_avg numeric,
  shots_total_against_avg numeric,

  -- pentru incremental refresh
  last_fixture_id bigint,
  last_fixture_date timestamptz,

  updated_at timestamptz not null default now(),
  primary key (team_id, league_id, season)
);

create index if not exists team_market_rolling_league_season_idx
  on public.team_market_rolling (league_id, season);
create index if not exists team_market_rolling_updated_idx
  on public.team_market_rolling (updated_at desc);

alter table public.team_market_rolling enable row level security;
drop policy if exists "service_only_team_market_rolling" on public.team_market_rolling;
create policy "service_only_team_market_rolling"
on public.team_market_rolling
for all
using (false);

comment on table public.team_market_rolling is
  'Rolling averages pentru cornere / şuturi la poartă / total şuturi per (team, league, season). Actualizat din /fixtures/statistics. Service role only.';
