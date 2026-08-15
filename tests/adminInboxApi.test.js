import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";

import {
  INBOX_DEFAULT_LIMIT,
  INBOX_MAX_LIMIT,
  handleAdminInbox,
  isValidInboxKind,
  normalizeInboxContext,
  parseInboxPaging
} from "../server-utils/adminInboxApi.js";

/**
 * Admin inbox — the read side of Support, Reports and Feedback.
 *
 * The authorisation tests are the point of this file. Migration 051 gives the three tables
 * owner-only RLS with no admin policy, so this endpoint reads them with the service role;
 * `assertAdmin` is therefore the only thing standing between a logged-in stranger and every
 * user's messages. That is asserted behaviourally — the handler is driven with a refusing
 * gate and the query client is watched to prove no table was ever reached.
 */

const ADMIN = { ok: true, user: { id: "admin-1" } };
const NON_ADMIN = { ok: false, status: 403, error: "Este necesar acces de administrator." };
const UNAUTHENTICATED = { ok: false, status: 401, error: "Neautorizat" };

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
}

/**
 * A Supabase stub that records every query it is asked to build.
 *
 * `touched` is the evidence for the authorisation tests: if the gate refuses and that array
 * is still empty, no data was reached — a stronger claim than the status code alone.
 */
function mockSupabase({ tickets = [], messages = [], feedback = [] } = {}) {
  const calls = { touched: [], filters: [], ranges: [], orders: [] };

  const chain = (rows) => {
    const q = {
      select: () => q,
      order: (col, opts) => {
        calls.orders.push({ col, ...opts });
        return q;
      },
      range: (from, to) => {
        calls.ranges.push({ from, to });
        return q;
      },
      in: (col, val) => {
        calls.filters.push({ op: "in", col, val });
        return q;
      },
      not: (col, op, val) => {
        calls.filters.push({ op: `not.${op}`, col, val });
        return q;
      },
      then: (resolve) => resolve({ data: rows, error: null })
    };
    return q;
  };

  return {
    calls,
    from(table) {
      calls.touched.push(table);
      if (table === "support_tickets") return chain(tickets);
      if (table === "support_messages") return chain(messages);
      return chain(feedback);
    }
  };
}

const deps = (assertAdminResult, supabase) => ({
  assertAdmin: async () => assertAdminResult,
  assertSupabaseConfigured: () => ({ ok: true }),
  getSupabaseAdmin: () => supabase
});

const ticket = (id, overrides = {}) => ({
  id,
  user_id: "user-1",
  category: "general",
  subject: `subject ${id}`,
  status: "open",
  priority: "normal",
  contact_requested: false,
  context: null,
  page_route: null,
  app_version: null,
  created_at: "2026-08-15T05:50:35.000Z",
  updated_at: "2026-08-15T05:50:35.000Z",
  ...overrides
});

const req = (query = {}, method = "GET") => ({ method, query });

// ── authorisation ─────────────────────────────────────────────────────────

test("[auth] an admin can list Support", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support" }), res, deps(ADMIN, supabase));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.kind, "support");
  assert.equal(res.body.items.length, 1);
});

test("[auth] an admin can list Reports", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1", { category: "prediction" })] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "report" }), res, deps(ADMIN, supabase));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].kind, "report");
});

test("[auth] an admin can list Feedback", async () => {
  const supabase = mockSupabase({
    feedback: [
      {
        id: "f1",
        user_id: "user-1",
        category: "ux",
        message: "hello",
        rating: 4,
        would_recommend: 9,
        contact_requested: false,
        context: null,
        created_at: "2026-08-15T05:50:35.000Z"
      }
    ]
  });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "feedback" }), res, deps(ADMIN, supabase));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items[0].kind, "feedback");
  assert.equal(res.body.items[0].rating, 4);
});

test("[auth] an authenticated non-admin is refused, and no table is touched", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support" }), res, deps(NON_ADMIN, supabase));
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  // The real claim: refusal happened BEFORE any data was reached.
  assert.deepEqual(supabase.calls.touched, []);
});

test("[auth] an unauthenticated request is refused, and no table is touched", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "report" }), res, deps(UNAUTHENTICATED, supabase));
  assert.equal(res.statusCode, 401);
  assert.deepEqual(supabase.calls.touched, []);
});

test("[auth] authorisation is checked before the parameters are validated", async () => {
  // An invalid kind from a stranger must not reveal which kinds exist.
  const supabase = mockSupabase();
  const res = mockRes();
  await handleAdminInbox(req({ kind: "nonsense" }), res, deps(NON_ADMIN, supabase));
  assert.equal(res.statusCode, 403, "the gate answers first, not the validator");
  assert.deepEqual(supabase.calls.touched, []);
});

// ── validation ────────────────────────────────────────────────────────────

test("[validation] only support, report and feedback are kinds", () => {
  for (const good of ["support", "report", "feedback"]) assert.equal(isValidInboxKind(good), true);
  for (const bad of ["", "tickets", "Support", "all", null, undefined, 3]) {
    assert.equal(isValidInboxKind(bad), false, `${String(bad)} must be refused`);
  }
});

test("[validation] an invalid kind is a 400 for an admin, not an empty list", async () => {
  const supabase = mockSupabase();
  for (const bad of ["nonsense", "", "all"]) {
    const res = mockRes();
    await handleAdminInbox(req({ kind: bad }), res, deps(ADMIN, supabase));
    assert.equal(res.statusCode, 400, `kind=${bad}`);
    assert.equal(res.body.ok, false);
  }
  assert.deepEqual(supabase.calls.touched, [], "a rejected kind reads nothing");
});

test("[validation] a non-GET method is refused before anything else", async () => {
  const supabase = mockSupabase();
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support" }, "POST"), res, deps(ADMIN, supabase));
  assert.equal(res.statusCode, 405);
  assert.deepEqual(supabase.calls.touched, []);
});

test("[validation] paging is clamped server-side", () => {
  assert.equal(parseInboxPaging({}).limit, INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxPaging({ limit: "5000" }).limit, INBOX_MAX_LIMIT, "the ceiling is the server's");
  assert.equal(parseInboxPaging({ limit: "0" }).limit, 1);
  assert.equal(parseInboxPaging({ limit: "abc" }).limit, INBOX_DEFAULT_LIMIT);
  assert.equal(parseInboxPaging({ offset: "-4" }).offset, 0);
  assert.equal(parseInboxPaging({ offset: "40" }).offset, 40);
});

// ── query shape ───────────────────────────────────────────────────────────

test("[query] newest-first is requested from the database, not sorted in JS", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support" }), res, deps(ADMIN, supabase));
  const order = supabase.calls.orders.find((o) => o.col === "created_at");
  assert.ok(order, "created_at must be ordered by the query");
  assert.equal(order.ascending, false, "descending — newest first");
});

test("[query] paging is a range, never a full read sliced in memory", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support", limit: "10", offset: "20" }), res, deps(ADMIN, supabase));
  assert.deepEqual(supabase.calls.ranges[0], { from: 20, to: 29 });
});

test("[query] Support and Reports split the same table on category", async () => {
  const supportSupabase = mockSupabase({ tickets: [] });
  await handleAdminInbox(req({ kind: "support" }), mockRes(), deps(ADMIN, supportSupabase));
  const supportFilter = supportSupabase.calls.filters.find((f) => f.col === "category");
  assert.equal(supportFilter.op, "not.in", "plain support excludes the report categories");

  const reportSupabase = mockSupabase({ tickets: [] });
  await handleAdminInbox(req({ kind: "report" }), mockRes(), deps(ADMIN, reportSupabase));
  const reportFilter = reportSupabase.calls.filters.find((f) => f.col === "category");
  assert.equal(reportFilter.op, "in");
  assert.deepEqual(reportFilter.val, ["prediction", "gsb"]);
});

test("[query] a page shorter than the limit reports no more", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support", limit: "20" }), res, deps(ADMIN, supabase));
  assert.equal(res.body.hasMore, false);
});

test("[query] a full page reports there may be more", async () => {
  const supabase = mockSupabase({ tickets: [ticket("t1"), ticket("t2")] });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support", limit: "2" }), res, deps(ADMIN, supabase));
  assert.equal(res.body.hasMore, true);
});

test("[query] successive offsets ask for disjoint windows and return no duplicates", async () => {
  const first = mockSupabase({ tickets: [ticket("t1"), ticket("t2")] });
  const second = mockSupabase({ tickets: [ticket("t3"), ticket("t4")] });
  const a = mockRes();
  const b = mockRes();
  await handleAdminInbox(req({ kind: "support", limit: "2", offset: "0" }), a, deps(ADMIN, first));
  await handleAdminInbox(req({ kind: "support", limit: "2", offset: "2" }), b, deps(ADMIN, second));

  assert.deepEqual(first.calls.ranges[0], { from: 0, to: 1 });
  assert.deepEqual(second.calls.ranges[0], { from: 2, to: 3 });
  const ids = [...a.body.items, ...b.body.items].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicates across pages");
});

test("[query] an empty result is an empty list, not an error", async () => {
  for (const kind of ["support", "report", "feedback"]) {
    const res = mockRes();
    await handleAdminInbox(req({ kind }), res, deps(ADMIN, mockSupabase()));
    assert.equal(res.statusCode, 200, kind);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.hasMore, false);
  }
});

test("[query] a ticket carries its own messages, matched by ticket id", async () => {
  const supabase = mockSupabase({
    tickets: [ticket("t1"), ticket("t2")],
    messages: [
      { id: "m1", ticket_id: "t1", author_role: "user", body: "first", is_internal_note: false, created_at: "x" },
      { id: "m2", ticket_id: "t2", author_role: "user", body: "second", is_internal_note: false, created_at: "y" }
    ]
  });
  const res = mockRes();
  await handleAdminInbox(req({ kind: "support" }), res, deps(ADMIN, supabase));
  const [t1, t2] = res.body.items;
  assert.deepEqual(
    t1.messages.map((m) => m.id),
    ["m1"]
  );
  assert.deepEqual(
    t2.messages.map((m) => m.id),
    ["m2"]
  );
});

// ── untrusted context ─────────────────────────────────────────────────────

test("[context] only known keys survive, and only as primitives", () => {
  const out = normalizeInboxContext({
    fixtureId: 12345,
    market: "ou",
    // Not on the allow-list — a caller cannot widen the response by inventing a field.
    role: "admin",
    isAdmin: true,
    // Structured values would make the row unbounded.
    nested: { a: 1 },
    list: [1, 2, 3]
  });
  assert.deepEqual(out, { fixtureId: 12345, market: "ou" });
});

test("[context] nothing recognisable becomes null, not an empty object", () => {
  assert.equal(normalizeInboxContext({ role: "admin" }), null);
  assert.equal(normalizeInboxContext(null), null);
  assert.equal(normalizeInboxContext("not an object"), null);
  assert.equal(normalizeInboxContext([1, 2]), null);
});

test("[context] a crafted string is carried as data, unchanged and uninterpreted", () => {
  // The value survives verbatim because the UI renders it as text. What matters is that
  // nothing here parses, unescapes or rewrites it.
  const payload = "<script>alert(1)</script>";
  assert.deepEqual(normalizeInboxContext({ market: payload }), { market: payload });
});

// ── structural guard ──────────────────────────────────────────────────────

test("[guard] the inbox is read-only and admin-gated at its only entry point", () => {
  const handler = fs.readFileSync("server-utils/adminInboxApi.js", "utf8");
  const route = fs.readFileSync("api/admin.js", "utf8");

  // No write verb reaches these tables from this module.
  for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(!handler.includes(verb), `the inbox must not ${verb} anything`);
  }
  assert.ok(handler.includes("assertAdmin"), "the handler gates on assertAdmin");
  assert.ok(route.includes("handleAdminInbox"), "the route delegates to the inbox handler");

  // The user's write path is untouched by the admin read path.
  const support = fs.readFileSync("server-utils/supportApi.js", "utf8");
  assert.ok(!support.includes("adminInboxApi"), "supportApi.js must not know about the admin inbox");
});
