-- 043: Global Special Bet — an accumulator built from the best selections ACROSS
-- the fixtures of a user's favourite leagues, distinct from the per-match
-- "Special Bet · Top signals" which stays untouched.
--
-- The row is a SNAPSHOT, not a view: odds, confidence and value score are frozen
-- at generation time and never recomputed. Only status/settled_at move later,
-- and settlement itself is a separate increment.

create table if not exists public.special_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  bet_date date not null,
  league_ids int[] not null,
  -- Canonical text form of league_ids (deduped, numerically sorted, comma-joined).
  -- The unique key uses THIS rather than the array: it is derived inside the RPC,
  -- so idempotency cannot depend on the caller sorting its input correctly.
  league_scope text not null,
  variant smallint not null,
  status text not null default 'pending',
  total_odds numeric(10, 3) not null,
  average_confidence numeric(5, 2) not null,
  model_version text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint special_bets_variant_allowed check (variant in (3, 5, 8)),
  constraint special_bets_status_allowed check (status in ('pending', 'won', 'lost', 'void')),
  constraint special_bets_total_odds_positive check (total_odds > 1),
  constraint special_bets_leagues_present check (array_length(league_ids, 1) >= 1)
);

-- Idempotency, enforced by the database rather than by a JavaScript pre-check:
-- a repeated POST, a double tap, a browser retry or two devices racing all land
-- on the same row.
create unique index if not exists special_bets_identity_idx
  on public.special_bets (user_id, bet_date, variant, league_scope);

create index if not exists special_bets_user_date_idx
  on public.special_bets (user_id, bet_date desc);

create table if not exists public.special_bet_selections (
  id uuid primary key default gen_random_uuid(),
  special_bet_id uuid not null references public.special_bets (id) on delete cascade,
  fixture_id bigint not null,
  league_id int not null,
  kickoff_at timestamptz not null,
  market text not null,
  selection text not null,
  side text,
  line numeric(5, 2),
  odds numeric(10, 3) not null,
  confidence numeric(5, 2) not null,
  value_score numeric(6, 2),
  status text not null default 'pending',
  settled_at timestamptz,
  constraint special_bet_selections_status_allowed check (status in ('pending', 'won', 'lost', 'void')),
  constraint special_bet_selections_side_allowed check (side is null or side in ('over', 'under')),
  constraint special_bet_selections_odds_positive check (odds > 1),
  -- Diversification enforced by the schema, not only by the engine: two markets
  -- from one fixture are a single correlated bet wearing two labels.
  constraint special_bet_selections_one_per_fixture unique (special_bet_id, fixture_id)
);

create index if not exists special_bet_selections_bet_idx
  on public.special_bet_selections (special_bet_id);

create index if not exists special_bet_selections_fixture_idx
  on public.special_bet_selections (fixture_id);

comment on table public.special_bets is
  'Global Special Bet snapshots. Written only through create_global_special_bet() with the service role; odds/confidence/value_score are immutable after creation.';
comment on column public.special_bets.league_scope is
  'Canonical, deduped, numerically sorted league_ids. Part of the idempotency key.';

-- RLS: reads are scoped to the owner (same shape as the profiles policies in
-- migration 005), writes have no policy at all, so they are reachable only via
-- the service role through the API. A user can never see another user's bets.
alter table public.special_bets enable row level security;
alter table public.special_bet_selections enable row level security;

drop policy if exists "users_read_own_special_bets" on public.special_bets;
create policy "users_read_own_special_bets"
on public.special_bets
for select
using (auth.uid() = user_id);

drop policy if exists "users_read_own_special_bet_selections" on public.special_bet_selections;
create policy "users_read_own_special_bet_selections"
on public.special_bet_selections
for select
using (
  exists (
    select 1
    from public.special_bets b
    where b.id = special_bet_selections.special_bet_id
      and b.user_id = auth.uid()
  )
);

/**
 * Create a Global Special Bet and its selections atomically, or return the one
 * that already exists.
 *
 * Everything inside a plpgsql function runs in one transaction, which is what
 * makes "bet inserted, third selection failed, snapshot left half-written"
 * impossible — the failure takes the bet row with it.
 *
 * Concurrency: the insert uses ON CONFLICT DO NOTHING against the identity
 * index. A racing caller blocks until the winner commits, then finds no row
 * returned and re-reads the winner's. Both callers get the same bet; neither
 * gets a duplicate and neither gets an error.
 *
 * The caller supplies selections already chosen by globalSpecialBetEngine.js;
 * this function decides nothing about WHICH selections belong in the bet.
 */
create or replace function public.create_global_special_bet(
  p_user_id uuid,
  p_bet_date date,
  p_variant smallint,
  p_league_ids int[],
  p_total_odds numeric,
  p_average_confidence numeric,
  p_model_version text,
  p_selections jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_leagues int[];
  v_bet_id uuid;
  v_created boolean := false;
  v_sel jsonb;
begin
  if p_variant not in (3, 5, 8) then
    return jsonb_build_object('ok', false, 'error', 'invalid_variant');
  end if;
  if p_user_id is null or p_bet_date is null then
    return jsonb_build_object('ok', false, 'error', 'missing_identity');
  end if;
  if p_league_ids is null or array_length(p_league_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'missing_leagues');
  end if;
  if p_selections is null or jsonb_array_length(p_selections) <> p_variant then
    return jsonb_build_object('ok', false, 'error', 'selection_count_mismatch');
  end if;

  -- Canonicalise here, so the identity key is the same whatever order or
  -- duplicates the caller happened to send.
  select array_agg(x order by x), string_agg(x::text, ',' order by x)
  into v_leagues, v_scope
  from (select distinct unnest(p_league_ids) as x) s;

  insert into public.special_bets as b (
    user_id, bet_date, league_ids, league_scope, variant,
    total_odds, average_confidence, model_version
  )
  values (
    p_user_id, p_bet_date, v_leagues, v_scope, p_variant,
    p_total_odds, p_average_confidence, p_model_version
  )
  on conflict (user_id, bet_date, variant, league_scope) do nothing
  returning b.id into v_bet_id;

  if v_bet_id is not null then
    v_created := true;
    for v_sel in select * from jsonb_array_elements(p_selections)
    loop
      insert into public.special_bet_selections (
        special_bet_id, fixture_id, league_id, kickoff_at,
        market, selection, side, line, odds, confidence, value_score
      )
      values (
        v_bet_id,
        (v_sel ->> 'fixture_id')::bigint,
        (v_sel ->> 'league_id')::int,
        (v_sel ->> 'kickoff_at')::timestamptz,
        v_sel ->> 'market',
        v_sel ->> 'selection',
        nullif(v_sel ->> 'side', ''),
        nullif(v_sel ->> 'line', '')::numeric,
        (v_sel ->> 'odds')::numeric,
        (v_sel ->> 'confidence')::numeric,
        nullif(v_sel ->> 'value_score', '')::numeric
      );
    end loop;
  else
    -- Someone else won the race, or this is a repeat request.
    select b.id into v_bet_id
    from public.special_bets b
    where b.user_id = p_user_id
      and b.bet_date = p_bet_date
      and b.variant = p_variant
      and b.league_scope = v_scope;

    if v_bet_id is null then
      return jsonb_build_object('ok', false, 'error', 'conflict_without_row');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'bet', (select to_jsonb(b) from public.special_bets b where b.id = v_bet_id),
    'selections', coalesce(
      (
        select jsonb_agg(to_jsonb(s) order by s.kickoff_at, s.fixture_id)
        from public.special_bet_selections s
        where s.special_bet_id = v_bet_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.create_global_special_bet(uuid, date, smallint, int[], numeric, numeric, text, jsonb) from public;
grant execute on function public.create_global_special_bet(uuid, date, smallint, int[], numeric, numeric, text, jsonb) to service_role;
