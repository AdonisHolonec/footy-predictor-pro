/**
 * Presence and daily access: what each audience may receive, and what counts.
 *
 * THE POINT OF THESE TESTS IS THE PAYLOAD, NOT THE UI. "The list is hidden for
 * non-admins" is not a security property — the browser already has whatever the
 * server sent. So every privacy assertion below is on the RESPONSE BODY: a normal
 * user's response must not contain a name, an email or another user's id anywhere
 * in it, whatever the database holds.
 *
 * Deduplication is asserted through the ARGUMENTS the handler sends to
 * `record_user_presence`, because that is where the dedupe key is decided. The
 * collapsing itself is the database's primary keys — `user_presence(user_id)` and
 * `daily_access(access_day, visitor_key)` — so two tabs producing one key is the
 * whole proof; a test that also faked the upsert would be testing its own mock.
 *
 * No network, no Supabase, no KV: every collaborator is injected.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  handlePresenceApi,
  presenceCutoffIso,
  resolveIdentity,
  visitorKeyFor,
  PRESENCE_WINDOW_SECONDS,
  HEARTBEAT_MIN_INTERVAL_MS,
  VISITOR_HEADER,
  DAILY_ACCESS_RETENTION_DAYS,
  ANON_MAX_ACCESS_PER_HOUR
} from "../server-utils/presenceApi.js";

const NOW = Date.parse("2026-01-01T12:00:00.000Z");
const TODAY = "2026-01-01";

const PRESENCE_ROWS = [
  { user_id: "u-1", online_since: "2026-01-01T11:42:00.000Z", last_seen_at: "2026-01-01T11:59:30.000Z" },
  { user_id: "u-2", online_since: "2026-01-01T11:45:00.000Z", last_seen_at: "2026-01-01T11:59:40.000Z" }
];
const PROFILES = [
  { user_id: "u-1", display_name: "MariaP" },
  { user_id: "u-2", display_name: null }
];

function makeRes() {
  return {
    statusCode: 0,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function makeSupabase({ rpcCalls = [], onlineCount = 2, accessesToday = 74 } = {}) {
  return {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { error: null };
    },
    from(table) {
      const builder = {
        _count: null,
        select(_cols, opts) {
          // Each table answers its own count, so the two aggregates cannot be
          // silently read from the same place.
          if (opts?.count === "exact") this._count = table === "daily_access" ? accessesToday : onlineCount;
          return this;
        },
        gte() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        then(resolve, reject) {
          const result =
            this._count !== null
              ? { data: null, error: null, count: this._count }
              : table === "profiles"
                ? { data: PROFILES, error: null }
                : { data: PRESENCE_ROWS, error: null };
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

function makeDeps({
  admin = false,
  authed = true,
  rpcCalls = [],
  today = TODAY,
  rateLimit = { ok: true },
  rateLimitThrows = false,
  sweep = false,
  rateLimitCalls = []
} = {}) {
  return {
    checkAnonymousRateLimit: async (_req, opts) => {
      rateLimitCalls.push(opts);
      if (rateLimitThrows) throw new Error("kv down");
      return rateLimit;
    },
    // Sampling is injected so the sweep is deterministic here rather than a
    // 1-in-200 coin flip.
    shouldSweep: () => sweep,
    assertAdmin: async () =>
      admin
        ? { ok: true, user: { id: "admin-1" } }
        : { ok: false, status: 403, error: "Este necesar acces de administrator." },
    getRequester: async () =>
      authed
        ? { ok: true, user: { id: "u-1" } }
        : { ok: false, status: 401, error: "Lipsește token-ul de autorizare." },
    getSupabaseAdmin: () => makeSupabase({ rpcCalls }),
    mapUserIdsToEmails: async () =>
      new Map([
        ["u-1", "maria@example.com"],
        ["u-2", "andrei@example.com"]
      ]),
    today: () => today,
    now: () => NOW
  };
}

const req = (overrides = {}) => ({ method: "GET", query: {}, headers: {}, ...overrides });
const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

// ── the public contract ────────────────────────────────────────────────────

test("[P1] a normal user receives exactly two public metrics", async () => {
  const res = makeRes();
  await handlePresenceApi(req(), res, makeDeps());

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.onlineCount, 2);
  assert.equal(res.body.accessesToday, 74);
  assert.deepEqual(
    Object.keys(res.body).sort(),
    ["accessesToday", "ok", "onlineCount"],
    "a new key here is how identity leaks"
  );
});

test("[P2] a normal user's payload contains no identity, at any depth", async () => {
  const res = makeRes();
  await handlePresenceApi(req(), res, makeDeps());

  const serialised = JSON.stringify(res.body);
  for (const secret of ["MariaP", "maria@example.com", "andrei@example.com", "u-2", "users", "displayName"]) {
    assert.equal(serialised.includes(secret), false, `"${secret}" must never reach a normal user`);
  }
});

test("[P3] a non-admin asking for the admin scope gets 403 with no identity payload", async () => {
  const res = makeRes();
  await handlePresenceApi(req({ query: { scope: "admin" } }), res, makeDeps({ admin: false }));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.users, undefined);
  const serialised = JSON.stringify(res.body);
  for (const secret of ["MariaP", "maria@example.com", "u-1", "u-2"]) {
    assert.equal(serialised.includes(secret), false, "a refusal must not leak what it refused");
  }
});

test("[P4] an anonymous visitor may read the aggregate", async () => {
  // Anonymous visitors count toward accesses, so they are not turned away.
  const res = makeRes();
  await handlePresenceApi(req(), res, makeDeps({ authed: false }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accessesToday, 74);
  assert.equal(res.body.users, undefined);
});

// ── admin ──────────────────────────────────────────────────────────────────

test("[P5] an admin receives both metrics and the nominal list", async () => {
  const res = makeRes();
  await handlePresenceApi(req({ query: { scope: "admin" } }), res, makeDeps({ admin: true }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.onlineCount, 2);
  assert.equal(res.body.accessesToday, 74);
  assert.equal(res.body.users.length, 2);
  for (const field of ["displayName", "email", "onlineSince"]) {
    assert.ok(field in res.body.users[0], `admin rows must carry ${field}`);
  }
});

test("[P6] identity is display_name first, email as fallback, never a raw id", async () => {
  const res = makeRes();
  await handlePresenceApi(req({ query: { scope: "admin" } }), res, makeDeps({ admin: true }));

  const [withName, withoutName] = res.body.users;
  assert.equal(withName.displayName, "MariaP");
  assert.equal(withName.name, "MariaP", "a configured display name wins");
  assert.equal(withoutName.displayName, null);
  assert.equal(withoutName.name, "andrei@example.com", "email is the fallback when display_name is unset");
  assert.equal(withoutName.name.includes("u-2"), false, "a uuid is never shown as a name");
  assert.equal(withName.onlineSince, "2026-01-01T11:42:00.000Z");
});

test("[P7] resolveIdentity prefers display name, then email, then a dash", () => {
  assert.equal(resolveIdentity({ displayName: "Florin", email: "f@example.com" }), "Florin");
  assert.equal(resolveIdentity({ displayName: "   ", email: "f@example.com" }), "f@example.com");
  assert.equal(resolveIdentity({ displayName: null, email: null }), "—");
  assert.equal(resolveIdentity(), "—");
});

// ── deduplication: the visitor key IS the dedupe ───────────────────────────

test("[P8] one logical user is one key, however many tabs or devices", () => {
  const tab1 = visitorKeyFor({ userId: "u-1", visitorToken: TOKEN_A });
  const tab2 = visitorKeyFor({ userId: "u-1", visitorToken: TOKEN_B });
  const phone = visitorKeyFor({ userId: "u-1", visitorToken: null });

  assert.equal(tab1, "u:u-1");
  assert.equal(tab2, "u:u-1", "a second tab is the same logical user");
  assert.equal(phone, "u:u-1", "a different device is still the same logical user");
  // Against the primary keys user_presence(user_id) and daily_access(day, key),
  // one key means one row means one online user and one access.
  assert.notEqual(visitorKeyFor({ userId: "u-2" }), tab1, "a second user is a second key");
});

test("[P9] an authenticated user's key ignores any supplied anonymous token", () => {
  // Otherwise signing in would create a second "visitor" for the same person.
  assert.equal(visitorKeyFor({ userId: "u-1", visitorToken: TOKEN_B }), "u:u-1");
});

test("[P10] an anonymous session is one stable key, and different sessions differ", () => {
  const first = visitorKeyFor({ visitorToken: TOKEN_A });
  const again = visitorKeyFor({ visitorToken: TOKEN_A });
  const other = visitorKeyFor({ visitorToken: TOKEN_B });

  assert.equal(first, again, "the same session revisiting must not count twice");
  assert.notEqual(first, other, "a different visitor is a different access");
  assert.match(first, /^a:[0-9a-f]{32}$/);
});

test("[P11] the anonymous key is a hash — the raw token never becomes the key", () => {
  const key = visitorKeyFor({ visitorToken: TOKEN_A });
  assert.equal(key.includes(TOKEN_A), false, "storing the token verbatim would make it resumable");
});

test("[P12] an unusable or absent token yields no key at all", () => {
  // Nothing to deduplicate by, so nothing is written — counting it would make
  // every such request a brand new "visitor".
  assert.equal(visitorKeyFor({ visitorToken: "short" }), null);
  assert.equal(visitorKeyFor({ visitorToken: "x".repeat(500) }), null);
  assert.equal(visitorKeyFor({}), null);
  assert.equal(visitorKeyFor(), null);
});

// ── recording ──────────────────────────────────────────────────────────────

test("[P13] POST records presence and access for the CALLER, never a supplied id", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", body: { userId: "u-999" }, headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ rpcCalls })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "record_user_presence");
  assert.equal(rpcCalls[0].args.p_user_id, "u-1", "the id comes from the verified token, never the request");
  assert.equal(rpcCalls[0].args.p_visitor_key, "u:u-1", "an authenticated visitor keys on their identity");
  assert.equal(rpcCalls[0].args.p_access_day, TODAY);
  assert.equal(rpcCalls[0].args.p_window_seconds, PRESENCE_WINDOW_SECONDS);
});

test("[P14] an anonymous POST records an access but no presence", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ authed: false, rpcCalls })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].args.p_user_id, null, "an anonymous visitor is never online");
  assert.match(rpcCalls[0].args.p_visitor_key, /^a:/);
});

test("[P15] an anonymous POST with no usable token writes nothing", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(req({ method: "POST" }), res, makeDeps({ authed: false, rpcCalls }));

  assert.equal(res.statusCode, 200, "the badge still gets its numbers");
  assert.equal(rpcCalls.length, 0, "an untrackable request must not inflate the count");
});

test("[P16] GET never records — reading is not visiting", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(req({ headers: { [VISITOR_HEADER]: TOKEN_A } }), res, makeDeps({ rpcCalls }));
  assert.equal(rpcCalls.length, 0);
});

test("[P17] the access day follows the app's Europe/Bucharest convention", async () => {
  // 2026-01-01T23:30Z is already 2026-01-02 in Bucharest (UTC+2), and the
  // handler must use whatever todayCalendarEuropeBucharest says rather than UTC.
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ rpcCalls, today: "2026-01-02" })
  );
  assert.equal(rpcCalls[0].args.p_access_day, "2026-01-02", "the day boundary is Bucharest's, not UTC's");
});

test("[P18] an unsupported method is rejected before any auth or database work", async () => {
  const res = makeRes();
  await handlePresenceApi(req({ method: "DELETE" }), res, makeDeps());
  assert.equal(res.statusCode, 405);
});

// ── the online window ──────────────────────────────────────────────────────

test("[P19] online is a 90s window that absorbs two missed 30s beats", () => {
  const cutoff = Date.parse(presenceCutoffIso(NOW));
  assert.equal(NOW - cutoff, 90 * 1000);
  assert.equal(PRESENCE_WINDOW_SECONDS, 90);
  assert.ok(
    PRESENCE_WINDOW_SECONDS * 1000 > 2 * HEARTBEAT_MIN_INTERVAL_MS,
    "a dropped heartbeat must never report a present user as offline"
  );
});

// ── retention ──────────────────────────────────────────────────────────────

test("[P21] a sampled POST sweeps expired access rows, bounded", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ rpcCalls, sweep: true })
  );

  const cleanup = rpcCalls.find((c) => c.name === "cleanup_daily_access");
  assert.ok(cleanup, "a sampled POST must sweep");
  assert.equal(cleanup.args.p_retention_days, DAILY_ACCESS_RETENTION_DAYS);
  assert.equal(DAILY_ACCESS_RETENTION_DAYS, 90);
  assert.ok(cleanup.args.p_max_rows > 0 && cleanup.args.p_max_rows <= 5000, "the delete must be bounded");

  // Recorded first, swept second: today's access is never at the mercy of retention.
  const recordIdx = rpcCalls.findIndex((c) => c.name === "record_user_presence");
  assert.ok(recordIdx >= 0 && recordIdx < rpcCalls.indexOf(cleanup));
});

test("[P22] an unsampled POST does not sweep — no delete on every heartbeat", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ rpcCalls, sweep: false })
  );
  assert.equal(rpcCalls.some((c) => c.name === "cleanup_daily_access"), false);
  assert.equal(rpcCalls.some((c) => c.name === "record_user_presence"), true, "the access is still recorded");
});

test("[P23] a failing sweep leaves today's access and the response intact", async () => {
  const rpcCalls = [];
  const res = makeRes();
  const deps = makeDeps({ rpcCalls, sweep: true });
  const supabase = deps.getSupabaseAdmin();
  deps.getSupabaseAdmin = () => ({
    ...supabase,
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === "cleanup_daily_access") throw new Error("deadlock detected");
      return { error: null };
    }
  });

  await handlePresenceApi(req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }), res, deps);

  assert.equal(res.statusCode, 200, "retention must never fail the activity response");
  assert.equal(res.body.accessesToday, 74);
  assert.equal(rpcCalls.some((c) => c.name === "record_user_presence"), true, "the access was still recorded");
});

test("[P24] the retention SQL can only reach rows strictly older than the cutoff", () => {
  // The predicate is the safety property, so it is asserted where it lives.
  const sql = readFileSync(new URL("../supabase/migrations/071_user_presence.sql", import.meta.url), "utf8");
  assert.match(sql, /where access_day < v_cutoff/, "the delete must be strictly older-than");
  assert.match(sql, /greatest\(1, p_retention_days\)/, "a zero retention must not mean 'delete everything'");
  assert.match(sql, /limit greatest\(1, least\(p_max_rows, 5000\)\)/, "the delete must be bounded");
  assert.equal(/delete from public\.daily_access\s*;/.test(sql), false, "no unbounded delete may exist");
  for (const role of ["anon", "authenticated"]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.cleanup_daily_access\\(integer, integer\\) from ${role}`),
      `${role} must not be able to execute the cleanup`
    );
  }
});

// ── anonymous inflation guard ──────────────────────────────────────────────

test("[P25] a normal anonymous visit passes the limiter and is recorded", async () => {
  const rpcCalls = [];
  const rateLimitCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ authed: false, rpcCalls, rateLimitCalls })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(rpcCalls.some((c) => c.name === "record_user_presence"), true);
  assert.equal(rateLimitCalls.length, 1);
  assert.equal(rateLimitCalls[0].maxPerHour, ANON_MAX_ACCESS_PER_HOUR);
  assert.ok(ANON_MAX_ACCESS_PER_HOUR >= 240, "a legitimate session beats 120/h — the ceiling must clear NAT");
});

test("[P26] obvious anonymous inflation is not counted, and is not an error", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ authed: false, rpcCalls, rateLimit: { ok: false, retryAfterSec: 3600 } })
  );

  assert.equal(rpcCalls.some((c) => c.name === "record_user_presence"), false, "a blocked access must not be counted");
  // Same response either way, so the limiter cannot be probed and leaks nothing.
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["accessesToday", "ok", "onlineCount"]);
});

test("[P27] authenticated visitors never reach the anonymous limiter", async () => {
  const rateLimitCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ authed: true, rateLimitCalls })
  );
  // Their key is their user id, which no client can forge — there is nothing to guard.
  assert.equal(rateLimitCalls.length, 0);
});

test("[P28] a limiter failure neither drops the visit nor leaks anything", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({ method: "POST", headers: { [VISITOR_HEADER]: TOKEN_A } }),
    res,
    makeDeps({ authed: false, rpcCalls, rateLimitThrows: true })
  );

  assert.equal(res.statusCode, 200);
  assert.equal(rpcCalls.some((c) => c.name === "record_user_presence"), true, "a legitimate visit survives a KV outage");
  const serialised = JSON.stringify(res.body);
  for (const secret of ["MariaP", "maria@example.com", "u-1", TOKEN_A]) {
    assert.equal(serialised.includes(secret), false);
  }
});

test("[P29] neither the raw token nor an IP is ever sent to the database", async () => {
  const rpcCalls = [];
  const res = makeRes();
  await handlePresenceApi(
    req({
      method: "POST",
      headers: { [VISITOR_HEADER]: TOKEN_A, "x-forwarded-for": "203.0.113.7" }
    }),
    res,
    makeDeps({ authed: false, rpcCalls })
  );

  const args = JSON.stringify(rpcCalls.find((c) => c.name === "record_user_presence").args);
  assert.equal(args.includes(TOKEN_A), false, "the raw token must never be persisted");
  assert.equal(args.includes("203.0.113.7"), false, "no IP may reach the database");
  assert.match(args, /a:[0-9a-f]{32}/, "only the hash is stored");
});

test("[P20] presence expires by staleness, so no logout request is needed", () => {
  // A row last seen before the cutoff is simply not counted — there is no
  // "offline" write anywhere, which is what makes a closed tab resolve itself.
  const cutoff = Date.parse(presenceCutoffIso(NOW));
  const stale = Date.parse("2026-01-01T11:58:00.000Z"); // 120s old
  const fresh = Date.parse("2026-01-01T11:59:30.000Z"); // 30s old
  assert.ok(stale < cutoff, "a stale heartbeat falls outside the window");
  assert.ok(fresh >= cutoff, "a recent heartbeat stays inside it");
});
