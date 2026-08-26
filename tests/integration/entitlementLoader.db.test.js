import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { before, beforeEach, test } from "node:test";

import { loadEntitlement } from "../../server-utils/entitlement.js";

/**
 * PR2a — the loader against a REAL Postgres.
 *
 * tests/entitlementLoader.test.js proves the loader's contract with fakes and
 * tests/integration/timeGrantsRls.db.test.js proves the SQL. Neither proves the
 * two TOGETHER: that a row physically present in `time_grants`, read through the
 * real query with the real filters, reaches `resolveEffectiveTierFromProfile`
 * and comes back as ultra. That join is what fails first when a column is
 * renamed, an index changes, or `revoked_at`/`effective_until` semantics drift —
 * and it is exactly what a fake cannot catch.
 *
 * Nothing here is mocked: not the loader, not accessTier, not the time_grants
 * query, not the SQL. The full migration chain 001..061 is applied to an empty
 * schema and every statement runs against it.
 *
 * ONE HONEST CAVEAT, because a reviewer should not have to discover it:
 * the container is plain Postgres with no PostgREST, and this repo has no
 * Postgres driver in node_modules. So `psqlClient()` below is a TRANSPORT SHIM
 * standing in for @supabase/postgrest-js — it implements only the builder subset
 * loadEntitlement uses and turns each call into real SQL. The queries, the
 * filters, the data and the tier decision are all genuine; only the wire
 * protocol differs. If a Postgres driver is ever added, swap the shim and this
 * suite keeps asserting the same things.
 *
 * Runs against a throwaway container, never a real database:
 *   node scripts/run-gsb-integration.mjs tests/integration/entitlementLoader.db.test.js
 */

const CONTAINER = process.env.GSB_TEST_CONTAINER || "fp-gsb-test";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function psql(sqlText, { expectFailure = false } = {}) {
  const res = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-f", "-"],
    { input: sqlText, encoding: "utf8" }
  );
  const out = `${res.stdout || ""}${res.stderr || ""}`;
  if (expectFailure) {
    assert.notEqual(res.status, 0, `expected failure:\n${sqlText}\n${out}`);
    return out;
  }
  assert.equal(res.status, 0, `SQL failed:\n${sqlText}\n${out}`);
  return (res.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(BEGIN|COMMIT|ROLLBACK|SET|INSERT \d|UPDATE \d|DELETE \d|TRUNCATE TABLE)/.test(l))
    .join("\n");
}

/** SQL literal. `now()` is passed through as an expression, as PostgREST does. */
function lit(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (v === "now()") return "now()";
  return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * The builder subset loadEntitlement uses, executed as real SQL.
 * Records every query so the test can also assert the query COUNT.
 */
function psqlClient() {
  const calls = [];
  return {
    calls,
    rpcCalls: [],
    rpc(name, args) {
      this.rpcCalls.push({ name, args });
      throw new Error(`entitlement must not call the ${name} RPC per request`);
    },
    from(table) {
      const q = { table, cols: "*", where: [], order: "", limit: "" };
      calls.push(q);
      const run = (single) => {
        const inner =
          `select ${q.cols} from public.${q.table}` +
          (q.where.length ? ` where ${q.where.join(" and ")}` : "") +
          q.order +
          (single ? " limit 1" : q.limit);
        // json so the shim returns the same shape PostgREST would
        const raw = psql(`select coalesce(json_agg(t), '[]'::json)::text from (${inner}) t;`);
        const rows = JSON.parse(raw || "[]");
        return Promise.resolve(single ? { data: rows[0] ?? null, error: null } : { data: rows, error: null });
      };
      const chain = {
        select(cols) {
          q.cols = cols;
          return chain;
        },
        eq(c, v) {
          q.where.push(`${c} = ${lit(v)}`);
          return chain;
        },
        is(c, v) {
          q.where.push(`${c} is ${v === null ? "null" : lit(v)}`);
          return chain;
        },
        gt(c, v) {
          q.where.push(`${c} > ${lit(v)}`);
          return chain;
        },
        order(c, o) {
          q.order = ` order by ${c} ${o?.ascending ? "asc" : "desc"}`;
          return chain;
        },
        limit(n) {
          q.limit = ` limit ${Number(n)}`;
          return run(false);
        },
        maybeSingle: () => run(true)
      };
      return chain;
    }
  };
}

before(() => {
  psql("drop schema if exists public cascade; create schema public;");
  psql(fs.readFileSync("tests/integration/bootstrap.auth.sql", "utf8"));
  for (const file of fs.readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    psql(fs.readFileSync(`supabase/migrations/${file}`, "utf8"));
  }
  psql(`insert into auth.users (id, email) values ('${USER}', 'entitlement@example.test')
        on conflict (id) do nothing;`);
});

/** Rebuild the fixture per case; profile guards (027/029) only let service_role write tier. */
function seed({ subscriptionExpiresAt, grant }) {
  psql(`delete from public.time_grants where user_id = '${USER}';`);
  psql(
    `begin;
     set local role service_role;
     insert into public.profiles (user_id, tier, subscription_expires_at)
     values ('${USER}', 'premium', ${subscriptionExpiresAt})
     on conflict (user_id) do update
       set tier = 'premium', subscription_expires_at = ${subscriptionExpiresAt};
     commit;`
  );
  if (grant) {
    psql(
      `insert into public.time_grants (user_id, source, days, granted_at, effective_until, idempotency_key)
       values ('${USER}', 'referral_inviter', 5, ${grant.grantedAt}, ${grant.effectiveUntil}, 'itest-${grant.key}');`
    );
  }
}

beforeEach(() => {
  psql(`delete from public.time_grants where user_id = '${USER}';`);
});

const FUTURE = "now() + interval '15 days'";
const PAST = "now() - interval '1 day'";

/* ------------------------------------------------------------------ */

test("[B] Premium + active 5-day bonus -> ULTRA, through the real loader", async () => {
  seed({
    subscriptionExpiresAt: FUTURE,
    grant: { grantedAt: "now()", effectiveUntil: "now() + interval '5 days'", key: "b" }
  });
  const before = psql(`select subscription_expires_at from public.profiles where user_id = '${USER}';`);

  const supabase = psqlClient();
  const out = await loadEntitlement(USER, { supabase });

  assert.equal(out.hasActiveBonus, true);
  assert.ok(out.bonusUntil, "a bonus window must come back from the real table");
  assert.ok(new Date(out.bonusUntil) > new Date(), "bonusUntil must be in the future");
  assert.equal(out.tierInfo.effectiveTier, "ultra");
  assert.equal(out.tierInfo.requestedTier, "premium");
  assert.equal(out.tierInfo.hasActiveSubscription, true);

  // [F] one profiles read, one time_grants read, no RPC
  assert.equal(supabase.calls.filter((c) => c.table === "profiles").length, 1);
  assert.equal(supabase.calls.filter((c) => c.table === "time_grants").length, 1);
  assert.equal(supabase.rpcCalls.length, 0);

  // [E] Stripe isolation: the loader wrote nothing
  const after = psql(`select subscription_expires_at from public.profiles where user_id = '${USER}';`);
  assert.equal(after, before, "subscription_expires_at must be byte-identical after loadEntitlement");
  assert.equal(psql(`select count(*) from public.time_grants where user_id = '${USER}';`), "1", "no grant written");
});

test("[C] EXPIRED Premium + active bonus -> ULTRA, independent of paid state", async () => {
  seed({
    subscriptionExpiresAt: PAST,
    grant: { grantedAt: "now()", effectiveUntil: "now() + interval '3 days'", key: "c" }
  });
  const out = await loadEntitlement(USER, { supabase: psqlClient() });

  assert.equal(out.tierInfo.effectiveTier, "ultra", "bonus must grant ultra even with no live subscription");
  assert.equal(out.tierInfo.requestedTier, "premium", "the user's own plan is unchanged");
  assert.equal(out.tierInfo.hasActiveSubscription, false, "a bonus is NOT a subscription");
  assert.equal(out.hasActiveBonus, true);
});

test("[D] EXPIRED Premium + EXPIRED bonus -> FREE, not a lingering Premium", async () => {
  seed({
    subscriptionExpiresAt: PAST,
    grant: { grantedAt: "now() - interval '30 days'", effectiveUntil: "now() - interval '25 days'", key: "d" }
  });
  // the row exists, but the query's `effective_until > now()` must exclude it
  assert.equal(psql(`select count(*) from public.time_grants where user_id = '${USER}';`), "1");

  const out = await loadEntitlement(USER, { supabase: psqlClient() });
  assert.equal(out.hasActiveBonus, false);
  assert.equal(out.bonusUntil, null);
  assert.equal(out.tierInfo.effectiveTier, "free", "an expired paid tier must NOT survive on a spent bonus");
});

test("a revoked grant is excluded by the real query even while the window is open", async () => {
  seed({
    subscriptionExpiresAt: PAST,
    grant: { grantedAt: "now()", effectiveUntil: "now() + interval '10 days'", key: "rev" }
  });
  psql(`update public.time_grants set revoked_at = now(), revoked_reason = 'test'
        where user_id = '${USER}';`);

  const out = await loadEntitlement(USER, { supabase: psqlClient() });
  assert.equal(out.hasActiveBonus, false, "revoked_at is null must be enforced by the QUERY");
  assert.equal(out.tierInfo.effectiveTier, "free");
  // and the row is still there — revocation is non-destructive
  assert.equal(psql(`select count(*) from public.time_grants where user_id = '${USER}';`), "1");
});

test("with two active grants the real query returns the later window", async () => {
  seed({
    subscriptionExpiresAt: PAST,
    grant: { grantedAt: "now()", effectiveUntil: "now() + interval '5 days'", key: "s1" }
  });
  psql(
    `insert into public.time_grants (user_id, source, days, effective_until, idempotency_key)
     values ('${USER}', 'admin_grant', 15, now() + interval '15 days', 'itest-s2');`
  );
  const out = await loadEntitlement(USER, { supabase: psqlClient() });
  const days = Math.round((new Date(out.bonusUntil) - Date.now()) / 864e5);
  assert.equal(days, 15, "order by effective_until desc limit 1 must pick the maximum");
  assert.equal(out.tierInfo.effectiveTier, "ultra");
});
