-- 045: the table privileges every earlier migration assumed but none granted.
--
-- Hosted Supabase configures ALTER DEFAULT PRIVILEGES so that anything created
-- in `public` is automatically granted to anon / authenticated / service_role.
-- Production has therefore always worked, and 001-044 never needed a GRANT.
--
-- A plain Postgres does not do that. On a fresh `supabase start` these roles
-- hold only REFERENCES/TRIGGER/TRUNCATE, so PostgREST answers 42501
-- "permission denied for table profiles" to a request that succeeds in
-- production. tests/integration/bootstrap.auth.sql already patches around this
-- for the Docker suite, which is the clearest sign the schema, not the test
-- harness, is where it belongs.
--
-- Additive and idempotent: on production every grant below is already in
-- effect, so this widens nothing. It only writes the assumption down.
--
-- FUNCTIONS ARE DELIBERATELY ABSENT.
-- Execute privileges are granted one function at a time (009, 011, 012, 041,
-- 042, 043) and revoked from PUBLIC / anon / authenticated by 032, which exists
-- because SECURITY DEFINER functions taking an arbitrary p_user_id were once
-- reachable with the public anon key — enough to read another user's full
-- prediction history. A blanket GRANT ON ALL FUNCTIONS would reopen exactly
-- that. Never add one here.

grant usage on schema public to anon, authenticated, service_role;

-- RLS is the gate, not the grant: all 35 tables in `public` have row level
-- security enabled, and the only write policies anywhere are on `profiles`,
-- each scoped to `auth.uid() = user_id`. For anon, auth.uid() is null, so those
-- fail closed.
--
-- anon reads only. Production also grants it writes through the hosted default,
-- but nothing in this product asks anon to write and RLS refuses it either way,
-- so the narrower grant is kept — matching the posture the integration
-- bootstrap already chose.
grant select on all tables in schema public to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all privileges on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- Same shape for whatever later migrations create, so this gap cannot reopen
-- one table at a time.
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
