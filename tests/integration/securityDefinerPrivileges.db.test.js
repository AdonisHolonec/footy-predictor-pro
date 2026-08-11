import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

/**
 * SECURITY DEFINER execute privileges — DATABASE integration suite.
 *
 * A SECURITY DEFINER function runs with its owner's rights, so who may CALL it
 * is the whole of its access control. This suite applies every migration to a
 * throwaway Postgres and asserts that no server-only function is reachable by
 * anon or authenticated.
 *
 * It exists because that assertion was false in production while every local
 * run said otherwise. Hosted Supabase grants EXECUTE on new functions to
 * anon/authenticated explicitly (pg_default_acl), and a migration ending in
 * `revoke all on function ... from public` clears only the PUBLIC entry.
 * bootstrap.auth.sql now reproduces that default, so this suite fails for the
 * same reason production was wrong rather than passing on a database that was
 * stricter than the real one.
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const MIGRATIONS_DIR = "supabase/migrations";

/**
 * SECURITY DEFINER functions ALLOWED to be called by anon or authenticated.
 * Empty on purpose: nothing in this product is meant to be.
 *
 * Adding a name here is a deliberate security decision and should be argued in
 * review. Leaving it empty is what makes the guard below fail closed — a new
 * SECURITY DEFINER function inherits EXECUTE from the platform default and will
 * trip this suite until it is either locked down or listed here on purpose.
 */
const INTENTIONALLY_CALLABLE_BY_CLIENTS = new Set();

function psql(sqlText) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sqlText, encoding: "utf8" }
  );
  if (res.error) {
    throw new Error(
      `Cannot reach the test container "${CONTAINER}". Start it with ` +
        `npm run test:integration:global-special-bets. Underlying error: ${res.error.message}`
    );
  }
  if (res.status !== 0) {
    throw new Error(`SQL failed:\n${sqlText}\n---\n${(res.stderr || "").trim()}`);
  }
  return (res.stdout || "").trim();
}

/** One row per SECURITY DEFINER function: name, args, and the three verdicts. */
function securityDefinerFunctions() {
  const out = psql(`
    select p.proname
           || '|' || pg_get_function_identity_arguments(p.oid)
           || '|' || has_function_privilege('anon', p.oid, 'EXECUTE')
           || '|' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
           || '|' || has_function_privilege('service_role', p.oid, 'EXECUTE')
           || '|' || (p.prorettype = 'pg_catalog.event_trigger'::regtype)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by p.proname, pg_get_function_identity_arguments(p.oid);
  `);
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, args, anon, authenticated, serviceRole, isEventTrigger] = line.split("|");
      // `boolean || text` renders as 'true'/'false', not psql's display 't'/'f'.
      // Reading it as 't' silently made every verdict false, which turned the
      // guard below into a test that could not fail. Parse strictly instead.
      const bool = (raw) => {
        if (raw === "true") return true;
        if (raw === "false") return false;
        throw new Error(`unexpected boolean "${raw}" for ${name}; the privilege query changed shape`);
      };
      return {
        name,
        args,
        anon: bool(anon),
        authenticated: bool(authenticated),
        serviceRole: bool(serviceRole),
        // Returns the event_trigger pseudo-type: invoked by the engine, never
        // callable from SQL by anyone, whatever EXECUTE says.
        isEventTrigger: bool(isEventTrigger)
      };
    });
}

function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

before(() => {
  // The whole chain, in order, exactly as a deployed database received it.
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  for (const file of migrationFiles()) {
    psql(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
});

test("every migration applies to a clean database", () => {
  assert.ok(migrationFiles().length >= 46, `expected at least 46 migrations, found ${migrationFiles().length}`);
  assert.equal(psql("select count(*) from pg_namespace where nspname='public';"), "1");
});

test("the privilege inventory is real, not an empty list", () => {
  // The guard below passes when nothing is exposed — including when nothing was
  // read at all. This is its positive control: an inventory that is empty, or in
  // which no role ever holds EXECUTE, means the query or the parsing broke and
  // every other assertion in this file is worthless.
  const functions = securityDefinerFunctions();
  assert.ok(functions.length >= 10, `expected the full SECURITY DEFINER inventory, got ${functions.length}`);
  assert.ok(
    functions.some((fn) => fn.serviceRole),
    "service_role holds EXECUTE somewhere; if not, the privilege query is not returning real verdicts"
  );
});

test("no SECURITY DEFINER function is reachable by anon or authenticated", () => {
  // The regression guard. A new SECURITY DEFINER function inherits EXECUTE from
  // the platform default reproduced in the bootstrap, so this fails the moment
  // one is added without a matching revoke — which is exactly how
  // create_global_special_bet reached production unnoticed.
  const exposed = securityDefinerFunctions().filter(
    (fn) => (fn.anon || fn.authenticated) && !INTENTIONALLY_CALLABLE_BY_CLIENTS.has(fn.name)
  );

  assert.deepEqual(
    exposed.map((fn) => `${fn.name}(${fn.args}) anon=${fn.anon} authenticated=${fn.authenticated}`),
    [],
    "SECURITY DEFINER functions must be revoked from anon and authenticated by name; " +
      "`revoke ... from public` is not enough on hosted Supabase"
  );
});

test("create_global_special_bet is service-role only", () => {
  // Called by server-utils/globalSpecialBets.js through the service role. It
  // takes p_user_id and never compares it with auth.uid(), so a client able to
  // call it could write bets attributed to any user.
  const fn = securityDefinerFunctions().find((f) => f.name === "create_global_special_bet");
  assert.ok(fn, "create_global_special_bet should exist");
  assert.equal(fn.anon, false, "anon must not execute create_global_special_bet");
  assert.equal(fn.authenticated, false, "authenticated must not execute create_global_special_bet");
  assert.equal(fn.serviceRole, true, "service_role is the only intended caller");
});

test("the ops_* aggregates stay server-only", () => {
  // Whole-platform revenue, settlement and prediction telemetry. Never shown to
  // a user; read by server-utils/observability/opsSnapshot.js.
  const functions = securityDefinerFunctions();
  for (const name of ["ops_business_metrics", "ops_prediction_aggregates", "ops_settlement_aggregates"]) {
    const fn = functions.find((f) => f.name === name);
    assert.ok(fn, `${name} should exist`);
    assert.equal(fn.anon, false, `anon must not execute ${name}`);
    assert.equal(fn.authenticated, false, `authenticated must not execute ${name}`);
    assert.equal(fn.serviceRole, true, `service_role must still execute ${name}`);
  }
});

test("the functions hardened by 032 are still restricted", () => {
  // These are the reason 032 exists: SECURITY DEFINER functions accepting an
  // arbitrary p_user_id, once reachable with the public anon key. 046 must not
  // have disturbed them.
  const functions = securityDefinerFunctions();
  for (const name of [
    "predictions_history_for_user",
    "performance_counter_by_user_league",
    "rollback_predict_increment",
    "increment_warm_predict_usage",
    "cleanup_operational_logs"
  ]) {
    const fn = functions.find((f) => f.name === name);
    assert.ok(fn, `${name} should exist`);
    assert.equal(fn.anon, false, `anon must not execute ${name}`);
    assert.equal(fn.authenticated, false, `authenticated must not execute ${name}`);
    assert.equal(fn.serviceRole, true, `service_role must still execute ${name}`);
  }
});

test("service_role keeps EXECUTE on every callable SECURITY DEFINER function", () => {
  // 046 narrows client access; it must not have cost the server its own.
  //
  // Event trigger functions are exempt, and not as a convenience: they return a
  // pseudo-type, so PostgreSQL will not invoke them from SQL for any role. The
  // engine fires them without consulting EXECUTE at all, which makes a grant to
  // service_role meaningless rather than useful. 047 deliberately grants none.
  const withoutServiceRole = securityDefinerFunctions()
    .filter((fn) => !fn.isEventTrigger && !fn.serviceRole)
    .map((fn) => fn.name);
  assert.deepEqual(withoutServiceRole, [], "service_role lost EXECUTE somewhere");
});

test("the ensure_rls event trigger is installed by the migrations", () => {
  // The point of 047. Before it, rls_auto_enable and ensure_rls existed only in
  // production: a database rebuilt from these migrations came up with no
  // automatic RLS on new tables and nothing said so.
  const row = psql(`
    -- evtenabled is "char"; concatenating it without a cast is ambiguous.
    select et.evtname || '|' || et.evtevent || '|' || et.evtenabled::text || '|' || p.proname
    from pg_event_trigger et
    join pg_proc p on p.oid = et.evtfoid
    where et.evtname = 'ensure_rls';
  `);
  assert.equal(row, "ensure_rls|ddl_command_end|O|rls_auto_enable", "ensure_rls should be installed and enabled");
});

test("a table created after the migrations gets RLS without being asked", () => {
  // Proves the mechanism works, not merely that it is installed. This is the
  // behaviour production has always had and a rebuilt database silently lacked.
  psql("create table if not exists public.rls_auto_enable_probe (id int);");
  const enabled = psql(`
    select c.relrowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'rls_auto_enable_probe';
  `);
  psql("drop table if exists public.rls_auto_enable_probe;");
  assert.equal(enabled, "true", "the event trigger should have enabled RLS on the new table");
});

test("046 changes nothing but function privileges", () => {
  // Tables, policies and RLS are 045's business and earlier's. If 046 ever grows
  // a table or policy statement, this notices.
  const source = fs.readFileSync(
    path.join(MIGRATIONS_DIR, "046_revoke_public_security_definer_execute.sql"),
    "utf8"
  );
  const statements = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  assert.ok(statements.length > 0, "046 should contain statements");
  for (const statement of statements) {
    assert.match(
      statement,
      /^(revoke|grant) execute on function/i,
      `046 may only grant or revoke EXECUTE on functions, found: ${statement.slice(0, 80)}`
    );
  }
});

test("RLS survives 046 untouched", () => {
  const off = psql(`
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  `);
  assert.equal(off, "0", "every public table must still have RLS enabled");
});
