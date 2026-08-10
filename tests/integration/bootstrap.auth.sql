-- Test-harness only: the slice of Supabase that migration 043 depends on.
--
-- The project has no local Supabase stack (no supabase/config.toml), so the
-- integration suite runs against a plain Postgres container. Migration 043
-- references exactly three Supabase-provided things — the `auth.users` table it
-- keys users against, the `auth.uid()` function its RLS policies call, and the
-- `service_role` / `authenticated` / `anon` roles — so they are recreated here
-- with Supabase's own definitions.
--
-- `auth.uid()` is reproduced verbatim from Supabase's auth schema: it reads the
-- JWT claim the connection is running under, which is why a test can impersonate
-- a user with `set local request.jwt.claims`.
--
-- This file is NEVER applied to a real database; it exists only so the container
-- can run the production migration unmodified.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Supabase grants table privileges to these roles by default; RLS is what
-- actually restricts rows, and that is what the suite is here to prove.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
