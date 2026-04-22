create table if not exists public.predictions_history (
  fixture_id bigint primary key,
  league_id integer,
  league_name text,
  home_team text,
  away_team text,
  kickoff_at timestamptz,
  recommended_pick text,
  recommended_confidence numeric,
  odds_home numeric,
  odds_draw numeric,
  odds_away numeric,
  bookmaker text,
  luck_hg numeric,
  luck_hxg numeric,
  luck_ag numeric,
  luck_axg numeric,
  match_status text,
  score_home integer,
  score_away integer,
  validation text not null default 'pending' check (validation in ('pending', 'win', 'loss')),
  saved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists predictions_history_kickoff_idx
  on public.predictions_history (kickoff_at desc);

create index if not exists predictions_history_validation_idx
  on public.predictions_history (validation);

create or replace function public.set_predictions_history_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_predictions_history_updated_at on public.predictions_history;
create trigger trg_predictions_history_updated_at
before update on public.predictions_history
for each row
execute function public.set_predictions_history_updated_at();
