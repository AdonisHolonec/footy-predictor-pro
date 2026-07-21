-- Applied live via Supabase migration tooling as two steps (versions
-- 20260721191734 and 20260721191805); combined here as one file for repo
-- history, matching this repo's local sequential numbering convention.
--
-- These SECURITY DEFINER functions accept an arbitrary p_user_id with no check
-- that it matches the caller's own auth.uid(), and were reachable by anon
-- (unauthenticated) and authenticated -- via either an explicit per-role grant
-- or the PUBLIC pseudo-role, which every role implicitly inherits. Any holder
-- of the public anon key could call them directly via PostgREST, bypassing the
-- app entirely, to: read another user's full prediction history
-- (predictions_history_for_user), enumerate every user's UUID + performance
-- stats in one call (performance_counter_by_user_league -- no user filter at
-- all), reset their own daily predict quota indefinitely
-- (rollback_predict_increment, defeating tier-based rate limiting), or grief
-- another user's daily quota (increment_warm_predict_usage).
--
-- The application never calls these via the anon/authenticated client -- only
-- server-side via the service_role client (server-utils/userDailyWarmPredictUsage.js,
-- server-utils/predictionsHistory.js), which already holds its own explicit
-- EXECUTE grant independent of these. Revoking anon/authenticated/PUBLIC access
-- closes the direct-PostgREST attack path with zero effect on the app --
-- verified locally against the live database both ways: the app's own
-- service_role call still succeeds, and a direct `set role anon` call is now
-- rejected with "permission denied for function ...".

revoke execute on function public.predictions_history_for_user(uuid, integer, integer) from anon, authenticated;
revoke execute on function public.performance_counter_by_user_league(integer) from anon, authenticated;
revoke execute on function public.rollback_predict_increment(uuid, date) from anon, authenticated;
revoke execute on function public.increment_warm_predict_usage(uuid, date, text, integer) from anon, authenticated;
revoke execute on function public.cleanup_operational_logs(integer, integer, integer) from anon, authenticated;

-- handle_new_user_profile / protect_profiles_privilege_columns are trigger-only
-- functions (reference NEW/OLD, only meaningful inside a trigger context) that
-- Postgres already rejects on direct RPC invocation -- revoking here is
-- hygiene, not a live vulnerability fix.
revoke execute on function public.handle_new_user_profile() from anon, authenticated;
revoke execute on function public.protect_profiles_privilege_columns() from anon, authenticated;

-- Revoking the named-role grants above is not enough on its own: every role
-- (including anon and authenticated) implicitly inherits any EXECUTE grant
-- still held by the PUBLIC pseudo-role. cleanup_operational_logs still had a
-- real unauthenticated-callable path through PUBLIC after the revokes above;
-- the other two are closed here for the same hygiene reason as above.
revoke execute on function public.cleanup_operational_logs(integer, integer, integer) from public;
revoke execute on function public.handle_new_user_profile() from public;
revoke execute on function public.protect_profiles_privilege_columns() from public;
