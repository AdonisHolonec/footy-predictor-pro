-- 047: bring the rls_auto_enable() event trigger under migration control.
--
-- `public.rls_auto_enable()` and the `ensure_rls` event trigger that calls it
-- have been live in production for some time, but exist in no migration, no
-- test bootstrap and nowhere in this repository. A read-only catalog audit
-- established:
--
--   * owner is `postgres`, not `supabase_admin` — so it is ours, not platform
--     infrastructure. All six of Supabase's own event triggers are owned by
--     supabase_admin, and none of them are SECURITY DEFINER.
--   * it belongs to no extension, so nothing recreates it.
--   * it appears in none of the 46 recorded migration statements.
--
-- The consequence is not a security hole, it is a reproducibility hole: any
-- database rebuilt from these migrations — a preview project, a fresh
-- environment, the integration suite's container — comes up WITHOUT automatic
-- RLS on newly created tables, and nothing says so. This migration closes that
-- gap by writing down what production already runs.
--
-- The function body below is reproduced verbatim from pg_get_functiondef() in
-- production. It is deliberately not tidied: the redundant schema checks and the
-- log wording are what is actually deployed, and changing behaviour is not this
-- migration's job. Bringing it under version control is.
--
-- Effect on production: none in behaviour. `create or replace function` on an
-- identical body is a no-op, the event trigger is recreated with the same
-- definition, and the only real change is the revoke at the end.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

comment on function public.rls_auto_enable() is
  'Event trigger body: enables RLS on tables created in public. Fired by ensure_rls, never called directly - a function returning the event_trigger pseudo-type cannot be invoked from SQL.';

-- PostgreSQL has no CREATE OR REPLACE EVENT TRIGGER and no IF NOT EXISTS for
-- one, so replacing it means dropping first. The migration runs in a
-- transaction, so there is no window in which the trigger is missing.
drop event trigger if exists ensure_rls;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- The same hygiene 032 and 046 apply, for the same reason: a function created in
-- `public` inherits EXECUTE for PUBLIC from PostgreSQL and for anon/authenticated
-- from Supabase's pg_default_acl, whether or not anyone wanted that.
--
-- Here those grants are inert rather than dangerous — `rls_auto_enable` returns
-- the `event_trigger` pseudo-type, so PostgreSQL refuses to invoke it from SQL
-- no matter who holds EXECUTE, and PostgREST cannot expose it at all. They are
-- removed anyway so the privilege matrix says what is true, and so the security
-- regression suite does not have to carve out an exception.
--
-- service_role is not granted here, because nothing calls this function and
-- nothing can: the event trigger machinery invokes it on the engine's behalf
-- and never consults EXECUTE. Where the platform's default privileges already
-- handed service_role the grant it simply stays, which is why the end state
-- reads `postgres=X service_role=X` rather than `postgres=X` alone. Harmless
-- either way — the grant buys that role nothing.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
