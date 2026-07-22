-- League Profile Recalibration: per-league prior overlays fitted from settled results.
-- Never mutates the static leagueProfiles.config.json — overlays blend on top at
-- runtime, clamped to a max delta from the static default (see LeagueProfile.js).

create table if not exists public.league_profile_overlays (
  id bigserial primary key,
  league_id integer not null,
  model_version text not null,
  over_frequency numeric,
  btts_rate numeric,
  draw_frequency numeric,
  goal_frequency numeric,
  home_advantage numeric,
  sample_size integer not null default 0,
  metrics_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  fitted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists league_profile_overlays_active_uidx
  on public.league_profile_overlays (league_id, model_version)
  where active = true;

create index if not exists league_profile_overlays_fitted_idx
  on public.league_profile_overlays (fitted_at desc);

alter table public.league_profile_overlays enable row level security;

-- Service role / backend only (no public policies).
