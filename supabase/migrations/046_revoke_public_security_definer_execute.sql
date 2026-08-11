-- 046: take EXECUTE back from anon and authenticated on the server-only
-- SECURITY DEFINER functions.
--
-- 041, 042 and 043 each end with `revoke all on function ... from public`
-- followed by a grant to service_role. On a plain Postgres that is enough: a new
-- function's only default privilege is EXECUTE to PUBLIC, and revoking PUBLIC
-- removes it.
--
-- Hosted Supabase is different. `pg_default_acl` for functions in `public`
-- carries an EXPLICIT grant to anon, authenticated and service_role:
--
--   postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- Those explicit grants are written at CREATE time and survive
-- `revoke ... from public`, which only clears the PUBLIC entry. So in production
-- the functions below have been reachable by anon and authenticated ever since
-- they were created, while the same migrations on a clean database produce the
-- intended state. That divergence is why it went unnoticed: the integration
-- suite was more restrictive than production.
--
-- 032 escaped this because it revokes `from anon, authenticated` by name rather
-- than relying on `from public`. This migration applies that lesson to the four
-- functions that missed it.
--
-- Why each of these must stay server-only:
--
--   create_global_special_bet  SECURITY DEFINER, takes p_user_id and never
--                              checks it against auth.uid(). Reachable by anon,
--                              it lets any holder of the public key write bets
--                              attributed to any user. Called only by
--                              server-utils/globalSpecialBets.js through the
--                              service role.
--   ops_business_metrics       Aggregate revenue and account metrics across all
--   ops_settlement_aggregates  users. Operational telemetry, never user-facing.
--   ops_prediction_aggregates  Called only by
--                              server-utils/observability/opsSnapshot.js through
--                              the service role.
--
-- No browser code path calls any RPC, so nothing in the application loses
-- access.
--
-- Signatures are the identity arguments read from pg_proc in production, not
-- reconstructed from these files.
--
-- PUBLIC is included for the same reason 032 included it: the entry is already
-- absent, and naming it keeps a later accidental grant to public from quietly
-- restoring access.

revoke execute on function public.create_global_special_bet(
  uuid, date, smallint, integer[], numeric, numeric, text, jsonb
) from public, anon, authenticated;

revoke execute on function public.ops_business_metrics(integer) from public, anon, authenticated;
revoke execute on function public.ops_prediction_aggregates(integer) from public, anon, authenticated;
revoke execute on function public.ops_settlement_aggregates(integer) from public, anon, authenticated;

-- service_role keeps EXECUTE: it is the only caller, and it is never exposed to
-- a browser. Re-granted rather than assumed, so this migration is complete on
-- its own if it is ever replayed against a database where the grant was lost.
grant execute on function public.create_global_special_bet(
  uuid, date, smallint, integer[], numeric, numeric, text, jsonb
) to service_role;

grant execute on function public.ops_business_metrics(integer) to service_role;
grant execute on function public.ops_prediction_aggregates(integer) to service_role;
grant execute on function public.ops_settlement_aggregates(integer) to service_role;

-- DEFAULT PRIVILEGES ARE DELIBERATELY NOT CHANGED HERE.
--
-- Neutralising them would need
--   alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- repeated for every creating role (postgres AND supabase_admin, both present in
-- pg_default_acl). It would also apply to EVERY future function in `public`, not
-- just SECURITY DEFINER ones, so the first function genuinely meant to be called
-- by a signed-in user through PostgREST would fail with a permission error that
-- points nowhere near this file. That is a broad change with its own blast
-- radius and belongs in its own reviewed increment, not smuggled in behind a
-- security fix. See the PR for the full argument.
