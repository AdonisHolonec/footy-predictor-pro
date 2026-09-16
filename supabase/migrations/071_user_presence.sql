-- Live presence, and daily application access.
--
-- TWO TABLES BECAUSE THEY ARE TWO DIFFERENT LIFETIMES. Presence is volatile and
-- authenticated-only: one row per user, overwritten forever. Access is a daily
-- set that includes anonymous visitors, so it cannot be keyed by user_id and
-- cannot live on the presence row.
--
-- NOT REALTIME. The browser client is assembled from @supabase/auth-js +
-- @supabase/postgrest-js precisely so realtime stays out of the bundle
-- (src/utils/supabaseClient.ts), and there is no websocket anywhere in the app,
-- so presence is a heartbeat and "online" is a window over `last_seen_at`.
--
-- SERVICE ROLE ONLY, BOTH TABLES. RLS is enabled with NO policies — the shape
-- 009_user_daily_warm_predict_usage established. PostgREST cannot read either
-- table with an anon or authenticated JWT at all, so "a normal user cannot query
-- raw presence rows" is a property of the schema, not of the UI. Every read goes
-- through the API route, which is where the admin check and the identity
-- redaction live.

create table if not exists public.user_presence (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- "Online" is a window over this, never a stored boolean: a boolean would need
  -- a cleanup job to ever go false, and a tab that dies without unmounting would
  -- stay online forever. Staleness expires presence on its own, which is why no
  -- logout request is required to go offline.
  last_seen_at timestamptz not null default now(),
  -- Start of the CURRENT online stretch, for the admin "Online since" column.
  -- Reset only when the previous heartbeat fell outside the window — i.e. a new
  -- session, not the next beat of an existing one. Refreshing it every beat
  -- would make it a duplicate of `last_seen_at` and always read "just now".
  online_since timestamptz not null default now(),
  constraint user_presence_pkey primary key (user_id)
);

comment on table public.user_presence is
  'Volatile authenticated presence heartbeat, one row per user. Service role only.';

create index if not exists user_presence_last_seen_idx on public.user_presence (last_seen_at);

alter table public.user_presence enable row level security;

/*
  Daily access — one row per distinct visitor per Europe/Bucharest day.

  `visitor_key` is NOT an identity and must never be read as one:

    'u:<uuid>'    an authenticated user, deduplicated by user id
    'a:<sha256>'  an anonymous browser session, deduplicated by a random token
                  the client generates and keeps in sessionStorage

  NO RAW IP, AND NO PERMANENT ANONYMOUS IDENTITY. The anonymous key is a hash of
  a random value that the browser itself discards when the session ends, so it
  identifies a visit, not a person, and there is nothing to correlate across days.

  REFERRAL_IP_HASH_SECRET WAS CONSIDERED AND REJECTED. server-utils/referralIpHash.js
  states that its secret "rotates when someone decides the historic signal is worth
  discarding". Keying this to it would mean a referral-driven rotation silently
  re-keys every anonymous visitor mid-day and counts them twice — the same
  invisible failure that file warns about, which is why it has a secret of its own.
*/
create table if not exists public.daily_access (
  access_day date not null,
  visitor_key text not null,
  first_seen_at timestamptz not null default now(),
  constraint daily_access_pkey primary key (access_day, visitor_key),
  constraint daily_access_visitor_key_shape check (visitor_key ~ '^[ua]:[0-9a-f-]{16,64}$')
);

comment on table public.daily_access is
  'One row per distinct visitor per Europe/Bucharest day. visitor_key is a dedupe token, not an identity. Service role only.';

-- The only read is `count(*) where access_day = <today>`, which the primary key's
-- leading column already serves. No second index is added speculatively.

alter table public.daily_access enable row level security;

/*
  The heartbeat, as one atomic statement.

  A function rather than a PostgREST upsert because `online_since` is CONDITIONAL:
  it must survive an ongoing session and reset only after a gap longer than the
  window. Expressing that client-side would be a read, a decision and a write —
  three round trips racing every other tab the same user has open, which is
  exactly the case this feature has to get right.

  `p_visitor_key` is recorded in the same call so an access is never counted
  separately from the beat that caused it. ON CONFLICT DO NOTHING is the dedupe:
  the second visit of the day is a no-op, so repeat visits cannot inflate.

  SECURITY DEFINER with a pinned search_path, EXECUTE granted to service_role
  only: migration 032 established that user-scoped RPCs must not be callable by
  public/authenticated, and this one writes presence for an arbitrary user id.
*/
create or replace function public.record_user_presence(
  p_user_id uuid,
  p_access_day date,
  p_window_seconds integer,
  p_visitor_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Anonymous visitors have no user id and are never "online" — they only count
  -- toward the day's access set.
  if p_user_id is not null then
    insert into public.user_presence (user_id, last_seen_at, online_since)
    values (p_user_id, now(), now())
    on conflict (user_id) do update
    set last_seen_at = now(),
        online_since = case
          when public.user_presence.last_seen_at
               < now() - make_interval(secs => greatest(p_window_seconds, 1))
            then now()
          else public.user_presence.online_since
        end;
  end if;

  if p_visitor_key is not null and p_visitor_key <> '' then
    insert into public.daily_access (access_day, visitor_key)
    values (p_access_day, p_visitor_key)
    on conflict (access_day, visitor_key) do nothing;
  end if;
end;
$$;

revoke all on function public.record_user_presence(uuid, date, integer, text) from public;
revoke all on function public.record_user_presence(uuid, date, integer, text) from anon;
revoke all on function public.record_user_presence(uuid, date, integer, text) from authenticated;
grant execute on function public.record_user_presence(uuid, date, integer, text) to service_role;

/*
  Retention for `daily_access`: at most 90 days.

  SHAPE BORROWED FROM 019_operational_indexes_and_retention's
  `cleanup_operational_logs` — security definer, `make_interval(days => greatest(...))`,
  execute revoked from anon/authenticated (032). It is deliberately a SEPARATE
  function rather than a fourth statement inside that one: `cleanup_operational_logs`
  currently has no callers, and giving it one would change when 180-day
  prediction_snapshots deletion runs. That is somebody else's decision, not a
  side effect of adding an activity badge.

  BOUNDED, UNLIKE ITS MODEL. `cleanup_operational_logs` deletes everything
  matching in one statement, which is fine for a job somebody runs deliberately.
  This one is called from a request path, so it deletes at most `p_max_rows` per
  invocation via a ctid subquery — a long lock on a request-path DELETE is the
  failure mode worth designing out. The backlog drains across calls.

  IT CANNOT TOUCH TODAY. The predicate is strictly `access_day < cutoff`, and the
  cutoff is at least one day in the past, so today's insert and today's count are
  outside its reach by construction — not by timing.
*/
create or replace function public.cleanup_daily_access(
  p_retention_days integer default 90,
  p_max_rows integer default 500
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff date;
  v_count bigint;
begin
  -- greatest(1, ...) mirrors 019: a zero or negative argument must never be
  -- read as "delete everything".
  v_cutoff := (now() at time zone 'Europe/Bucharest')::date
              - greatest(1, p_retention_days);

  delete from public.daily_access
  where ctid in (
    select ctid
    from public.daily_access
    where access_day < v_cutoff
    limit greatest(1, least(p_max_rows, 5000))
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.cleanup_daily_access(integer, integer)
  is 'Bounded deletion of daily_access rows older than the retention window. Never touches the current day.';

revoke all on function public.cleanup_daily_access(integer, integer) from public;
revoke all on function public.cleanup_daily_access(integer, integer) from anon;
revoke all on function public.cleanup_daily_access(integer, integer) from authenticated;
grant execute on function public.cleanup_daily_access(integer, integer) to service_role;
