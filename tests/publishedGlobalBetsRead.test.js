import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONSUMER_HISTORY_WINDOW_DAYS,
  PUBLISHED_GLOBAL_PAGE_SIZE,
  consumerHistoryWindowStart,
  listPublishedGlobalBets
} from "../server-utils/globalSpecialBets.js";
import { handleGlobalSpecialBets } from "../server-utils/globalSpecialBetsApi.js";
import { BET_STATUS } from "../server-utils/globalSpecialBetSettlement.js";
import { todayCalendarEuropeBucharest } from "../server-utils/fixtureCalendarDateKey.js";

/**
 * Consumer Global Bets — the read that exposes published GLOBAL tickets.
 *
 * The whole risk here is exposure, so these assertions are written against the
 * QUERY rather than against today's rows: a filter that happens to return the
 * right data on this fixture but is expressible by a client is still a leak.
 *
 * Three properties carry the weight:
 *
 *   1. `bet_type` and `published_at` are NOT parameters. A caller cannot ask
 *      for a draft or a USER row, because neither is something this endpoint
 *      can express — asserted on the filters the query carries.
 *
 *   2. The USER read is untouched. `listGlobalSpecialBets` still scopes to
 *      `user_id`, and the new branch passes none: a published GLOBAL ticket
 *      belongs to nobody, so scoping it to the caller would both return
 *      nothing and imply an ownership that does not exist.
 *
 *   3. Authentication is required but ADMIN is not. Requiring admin would make
 *      a consumer surface useless; requiring nothing would make it public.
 */

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeRes() {
  const out = { statusCode: null, body: null };
  return {
    out,
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    }
  };
}

/**
 * PostgREST comparison operators, on strings.
 *
 * `bet_date` is a `date` and every value here is ISO `YYYY-MM-DD`, which orders
 * lexicographically exactly as it orders chronologically — the same property
 * Postgres relies on, so comparing as text is faithful rather than a shortcut.
 */
const OR_OPS = {
  eq: (a, b) => String(a) === b,
  gte: (a, b) => String(a) >= b,
  gt: (a, b) => String(a) > b,
  lte: (a, b) => String(a) <= b,
  lt: (a, b) => String(a) < b
};

/**
 * Evaluate the `.or()` filters the way PostgREST would.
 *
 * The double APPLIES the filter instead of merely recording it. A double that
 * only recorded the string would let the window rule pass every boundary test
 * while returning the wrong rows in production — the assertions would be about
 * a string, not about who can see which ticket.
 *
 * An unknown operator throws rather than being ignored: silently dropping a
 * predicate would turn a leak into a green test.
 */
const matchesOrFilters = (row, orFilters) =>
  orFilters.every((filter) =>
    filter.split(",").some((clause) => {
      const [col, op, ...rest] = clause.split(".");
      const compare = OR_OPS[op];
      if (!compare) throw new Error(`fakeSupabase: unsupported or() operator "${op}" in "${clause}"`);
      return compare(row[col], rest.join("."));
    })
  );

/** Records every filter, so scope is asserted rather than inferred from output. */
function fakeSupabase({ bets = [], selections = [] } = {}) {
  const log = { queries: [] };
  return {
    log,
    from(table) {
      const ctx = { table, eqs: {}, nots: [], ins: {}, ors: [], range: null, orders: [] };
      log.queries.push(ctx);
      const b = {
        select: (cols) => ((ctx.select = cols), b),
        eq: (col, val) => ((ctx.eqs[col] = val), b),
        not: (col, op, val) => (ctx.nots.push([col, op, val]), b),
        is: (col, val) => ((ctx.eqs[`is:${col}`] = val), b),
        in: (col, vals) => ((ctx.ins[col] = vals), b),
        or: (filter) => (ctx.ors.push(filter), b),
        order: (col, o) => (ctx.orders.push([col, o?.ascending]), b),
        range: (from, to) => ((ctx.range = [from, to]), b),
        then(resolve) {
          if (table === "special_bets") {
            const rows = bets.filter((x) => Object.entries(ctx.eqs).every(([k, v]) => x[k] === v));
            const published = ctx.nots.some(([c, , v]) => c === "published_at" && v === null)
              ? rows.filter((x) => x.published_at != null)
              : rows;
            // Ordering is applied before the page is cut, as the database does.
            const filtered = published
              .filter((x) => matchesOrFilters(x, ctx.ors))
              .sort(
                (x, y) =>
                  String(y.bet_date).localeCompare(String(x.bet_date)) ||
                  String(y.created_at).localeCompare(String(x.created_at))
              );
            const [from, to] = ctx.range || [0, filtered.length];
            return resolve({ data: filtered.slice(from, to + 1), error: null });
          }
          return resolve({
            data: selections.filter((s) => (ctx.ins.special_bet_id || []).includes(s.special_bet_id)),
            error: null
          });
        }
      };
      return b;
    }
  };
}

/*
  The scope/auth tests below are about WHO may see a ticket, not about WHEN, so
  their fixtures must stay inside the history window forever. Dating them to the
  current business day keeps them meaning "a currently visible ticket"; a
  hardcoded 2026-09-05 would quietly start failing once that date aged out of
  the window and its `pending` status hid it — a green suite turning red on a
  calendar boundary rather than on a code change.

  The window tests further down do the opposite and pin BOTH the clock and the
  dates, because there the date IS the subject.
*/
const TODAY = todayCalendarEuropeBucharest();

const ticket = (o = {}) => ({
  id: "g1",
  bet_date: TODAY,
  variant: 3,
  bet_kind: "combo",
  status: "pending",
  bet_type: "GLOBAL",
  user_id: null,
  published_at: `${TODAY}T17:27:27.000Z`,
  created_at: `${TODAY}T17:27:10.000Z`,
  total_odds: "2.422",
  ...o
});

const draft = (o = {}) => ticket({ id: "g-draft", published_at: null, ...o });
const userTicket = (o = {}) => ticket({ id: "u1", bet_type: "USER", user_id: USER_ID, published_at: null, ...o });

const AUTH_OK = { ok: true, user: { id: USER_ID } };

// ── the service ────────────────────────────────────────────────────────────

test("the query fixes bet_type GLOBAL and published_at NOT NULL", async () => {
  const supabase = fakeSupabase({ bets: [ticket()] });
  await listPublishedGlobalBets({ supabase });

  const q = supabase.log.queries[0];
  assert.equal(q.table, "special_bets");
  assert.equal(q.eqs.bet_type, "GLOBAL");
  assert.deepEqual(
    q.nots.find(([c]) => c === "published_at"),
    ["published_at", "is", null]
  );
  // The caller cannot scope it to a person: a published GLOBAL ticket has none.
  assert.equal("user_id" in q.eqs, false);
});

test("drafts and USER tickets are excluded by the query, not by the caller", async () => {
  const supabase = fakeSupabase({ bets: [ticket(), draft(), userTicket()] });
  const { bets } = await listPublishedGlobalBets({ supabase });

  assert.deepEqual(
    bets.map((b) => b.id),
    ["g1"]
  );
});

test("the page is bounded and a client cannot ask for more", async () => {
  const many = Array.from({ length: 120 }, (_, i) => ticket({ id: `g${i}` }));

  const dflt = fakeSupabase({ bets: many });
  await listPublishedGlobalBets({ supabase: dflt });
  assert.deepEqual(dflt.log.queries[0].range, [0, PUBLISHED_GLOBAL_PAGE_SIZE - 1]);

  // An absurd limit is capped server-side rather than honoured.
  const huge = fakeSupabase({ bets: many });
  const { bets } = await listPublishedGlobalBets({ supabase: huge, limit: 100000 });
  assert.equal(bets.length <= 50, true, "the server ceiling must hold");
  assert.equal(huge.log.queries[0].range[1] <= 49, true);
});

test("selections come from the stored snapshot, in one keyed query", async () => {
  const supabase = fakeSupabase({
    bets: [ticket(), ticket({ id: "g2" })],
    selections: [
      { id: "s1", special_bet_id: "g1", fixture_id: 901 },
      { id: "s2", special_bet_id: "g2", fixture_id: 902 }
    ]
  });
  const { bets } = await listPublishedGlobalBets({ supabase });

  assert.deepEqual(
    bets[0].selections.map((s) => s.fixture_id),
    [901]
  );
  assert.deepEqual(
    bets[1].selections.map((s) => s.fixture_id),
    [902]
  );
  // Two queries for two tickets — never one per ticket.
  assert.equal(supabase.log.queries.length, 2);
  assert.equal(supabase.log.queries[1].ins.special_bet_id.length, 2);
  // Never predictions_history: the snapshot is authoritative.
  assert.equal(
    supabase.log.queries.some((q) => q.table === "predictions_history"),
    false
  );
});

test("no tickets yields an empty list rather than an error", async () => {
  const { bets } = await listPublishedGlobalBets({ supabase: fakeSupabase({ bets: [] }) });
  assert.deepEqual(bets, []);
});

// ── the HTTP view ──────────────────────────────────────────────────────────

const call = (req, deps) => {
  const res = fakeRes();
  return handleGlobalSpecialBets(req, res, deps).then(() => res.out);
};

test("an unauthenticated consumer is refused before anything is read", async () => {
  const supabase = fakeSupabase({ bets: [ticket()] });
  const out = await call(
    { method: "GET", query: { scope: "global" } },
    { supabase, getRequester: async () => ({ ok: false, status: 401, error: "Lipsește token-ul de autorizare." }) }
  );

  assert.equal(out.statusCode, 401);
  assert.deepEqual(supabase.log.queries, [], "nothing may be read before authentication");
});

test("an authenticated NON-admin consumer can read published Global Bets", async () => {
  const supabase = fakeSupabase({ bets: [ticket(), draft()] });
  const out = await call({ method: "GET", query: { scope: "global" } }, { supabase, getRequester: async () => AUTH_OK });

  assert.equal(out.statusCode, 200);
  assert.equal(out.body.ok, true);
  // Admin is NOT required — this is a consumer surface.
  assert.deepEqual(
    out.body.bets.map((b) => b.id),
    ["g1"]
  );
});

test("a client-supplied userId cannot switch scope", async () => {
  const supabase = fakeSupabase({ bets: [ticket(), userTicket({ published_at: "2026-09-05T00:00:00.000Z" })] });
  const out = await call(
    { method: "GET", query: { scope: "global", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: "x" } },
    { supabase, getRequester: async () => AUTH_OK }
  );

  assert.equal(out.statusCode, 200);
  assert.equal("user_id" in supabase.log.queries[0].eqs, false, "no user predicate may reach the query");
  // The USER row is excluded by bet_type, whatever the client sent.
  assert.deepEqual(
    out.body.bets.map((b) => b.id),
    ["g1"]
  );
});

test("a client cannot request drafts through this view", async () => {
  const supabase = fakeSupabase({ bets: [draft()] });
  const out = await call(
    { method: "GET", query: { scope: "global", published_at: "null", bet_type: "USER", status: "draft" } },
    { supabase, getRequester: async () => AUTH_OK }
  );

  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body.bets, [], "a draft must never surface");
  assert.equal(supabase.log.queries[0].eqs.bet_type, "GLOBAL", "the client's bet_type is ignored");
});

test("the USER read is untouched when scope is absent", async () => {
  const supabase = fakeSupabase({ bets: [userTicket()] });
  const out = await call({ method: "GET", query: {} }, { supabase, getRequester: async () => AUTH_OK });

  assert.equal(out.statusCode, 200);
  // The existing path still scopes to the caller.
  assert.equal(supabase.log.queries[0].eqs.user_id, USER_ID);
});

test("the response carries no payload internals", async () => {
  const supabase = fakeSupabase({
    bets: [ticket()],
    selections: [{ id: "s1", special_bet_id: "g1", fixture_id: 901, selection: "Over 2.5", odds: 1.85 }]
  });
  const out = await call({ method: "GET", query: { scope: "global" } }, { supabase, getRequester: async () => AUTH_OK });

  const wire = JSON.stringify(out.body);
  for (const forbidden of ["raw_payload", "ticket_candidates", "valueEngine", "hydration_payload", "service_role"]) {
    assert.equal(wire.includes(forbidden), false, `${forbidden} must never reach a consumer`);
  }
  // The snapshot fields the UI needs are present and unaltered.
  assert.equal(out.body.bets[0].total_odds, "2.422");
  assert.equal(out.body.bets[0].selections[0].odds, 1.85);
});

// ── the history window ─────────────────────────────────────────────────────

/*
  Recent tickets show at any status; older ones show only if they WON.

  Everything below pins the clock. `now` is a real instant in Bucharest, not a
  bare date string, because the rule's input is the BUSINESS DAY and resolving
  an instant to that day is exactly the step being tested. 09:00+03:00 is the
  middle of the Bucharest day under either offset, so the anchor cannot drift
  into a neighbouring date on a DST change.

  The reference day is 2026-09-06, so the window is 2026-08-31 .. 2026-09-06 and
  2026-08-30 is the first day outside it.
*/
const NOW = Date.parse("2026-09-06T09:00:00+03:00");
const WINDOW_START = "2026-08-31";
const JUST_OUTSIDE = "2026-08-30";

const RECENT_DATES = [
  "2026-09-06",
  "2026-09-05",
  "2026-09-04",
  "2026-09-03",
  "2026-09-02",
  "2026-09-01",
  "2026-08-31"
];

const at = (betDate, status, id = `${betDate}-${status}`) =>
  ticket({
    id,
    bet_date: betDate,
    status,
    published_at: `${betDate}T12:00:00.000Z`,
    created_at: `${betDate}T11:00:00.000Z`
  });

const visibleIds = async (bets, opts = {}) => {
  const supabase = fakeSupabase({ bets });
  const res = await listPublishedGlobalBets({ supabase, now: NOW, ...opts });
  return { ids: res.bets.map((b) => b.id), supabase };
};

test("the window is 7 calendar days INCLUSIVE of the business day", () => {
  assert.equal(CONSUMER_HISTORY_WINDOW_DAYS, 7);
  assert.equal(consumerHistoryWindowStart(NOW), WINDOW_START);
  // Exactly seven dates, and the listed boundary is the seventh.
  assert.equal(RECENT_DATES.length, CONSUMER_HISTORY_WINDOW_DAYS);
  assert.equal(RECENT_DATES.at(-1), WINDOW_START);
});

test("every one of the 7 recent days is visible at every status", async () => {
  const statuses = [BET_STATUS.WON, BET_STATUS.LOST, BET_STATUS.PENDING, BET_STATUS.VOID];
  const bets = RECENT_DATES.flatMap((d) => statuses.map((s) => at(d, s)));

  const { ids } = await visibleIds(bets, { limit: 50 });
  assert.equal(ids.length, bets.length, "no recent ticket may be hidden by its status");
  for (const d of RECENT_DATES) {
    for (const s of statuses) assert.equal(ids.includes(`${d}-${s}`), true, `${d} ${s} must be visible`);
  }
});

test("the boundary date is IN and the day before it is OUT unless won", async () => {
  const bets = [
    at(WINDOW_START, BET_STATUS.LOST, "boundary-lost"),
    at(WINDOW_START, BET_STATUS.PENDING, "boundary-pending"),
    at(JUST_OUTSIDE, BET_STATUS.WON, "outside-won"),
    at(JUST_OUTSIDE, BET_STATUS.LOST, "outside-lost"),
    at(JUST_OUTSIDE, BET_STATUS.PENDING, "outside-pending"),
    at(JUST_OUTSIDE, BET_STATUS.VOID, "outside-void")
  ];

  const { ids } = await visibleIds(bets, { limit: 50 });
  // One day apart, opposite rules: this is the whole product decision.
  assert.equal(ids.includes("boundary-lost"), true, "2026-08-31 is inside the window");
  assert.equal(ids.includes("boundary-pending"), true, "2026-08-31 is inside the window");
  assert.equal(ids.includes("outside-won"), true, "an old winner is the point of keeping history");
  assert.equal(ids.includes("outside-lost"), false);
  assert.equal(ids.includes("outside-pending"), false);
  // VOID is a distinct terminal status in the canonical model (aggregateBetStatus),
  // NOT a win — the stake came back, nothing was won. It is hidden once old.
  assert.equal(ids.includes("outside-void"), false, "void is not a win");
});

test("an old ticket is judged on the canonical WON status, not on odds", async () => {
  const bets = [
    at(JUST_OUTSIDE, BET_STATUS.WON, "old-won"),
    // A loser with far better odds: nothing about the payout may resurrect it.
    ticket({ id: "old-rich-loser", bet_date: JUST_OUTSIDE, status: BET_STATUS.LOST, total_odds: "99.999" })
  ];

  const { ids, supabase } = await visibleIds(bets, { limit: 50 });
  assert.deepEqual(ids, ["old-won"]);
  // The predicate names the status column and the canonical value, nothing else.
  assert.equal(supabase.log.queries[0].ors[0], `bet_date.gte.${WINDOW_START},status.eq.won`);
  assert.equal(BET_STATUS.WON, "won");
});

test("the window never widens the scope: drafts and USER rows stay out", async () => {
  const bets = [
    at(JUST_OUTSIDE, BET_STATUS.WON, "old-won"),
    // An old WINNING draft — qualifies on the window, must still be refused.
    ticket({ id: "old-won-draft", bet_date: JUST_OUTSIDE, status: BET_STATUS.WON, published_at: null }),
    // An old WINNING user ticket — same.
    ticket({ id: "old-won-user", bet_date: JUST_OUTSIDE, status: BET_STATUS.WON, bet_type: "USER", user_id: USER_ID })
  ];

  const { ids, supabase } = await visibleIds(bets, { limit: 50 });
  assert.deepEqual(ids, ["old-won"]);
  assert.equal(supabase.log.queries[0].eqs.bet_type, "GLOBAL");
});

test("a full page of qualifying winners is returned, not the survivors of one", async () => {
  /*
    The failure this pins: filter AFTER the page and a page of old losers
    returns almost nothing while winners sit unread further down. The filter
    runs in the database, so a page is 20 QUALIFYING rows or the end of the list.
  */
  const losers = Array.from({ length: 80 }, (_, i) =>
    at("2026-08-20", BET_STATUS.LOST, `old-lost-${String(i).padStart(2, "0")}`)
  );
  const winners = Array.from({ length: 25 }, (_, i) =>
    at("2026-08-15", BET_STATUS.WON, `old-won-${String(i).padStart(2, "0")}`)
  );

  const { ids, supabase } = await visibleIds([...losers, ...winners]);
  assert.equal(ids.length, PUBLISHED_GLOBAL_PAGE_SIZE, "a full page must still be a full page");
  assert.equal(
    ids.every((id) => id.startsWith("old-won-")),
    true,
    "no loser may occupy a slot"
  );

  // Still bounded: the page is cut in the database, not after loading history.
  assert.deepEqual(supabase.log.queries[0].range, [0, PUBLISHED_GLOBAL_PAGE_SIZE - 1]);

  // And the second page continues rather than repeating.
  const { ids: page2 } = await visibleIds([...losers, ...winners], { offset: PUBLISHED_GLOBAL_PAGE_SIZE });
  assert.equal(page2.length, 5, "the remaining winners are reachable");
  assert.equal(
    page2.some((id) => ids.includes(id)),
    false,
    "pages must not overlap"
  );
});

test("ordering stays bet_date DESC, created_at DESC", async () => {
  const bets = [
    at("2026-09-01", BET_STATUS.LOST, "older"),
    at("2026-09-06", BET_STATUS.LOST, "newest"),
    ticket({
      id: "same-day-earlier",
      bet_date: "2026-09-05",
      status: BET_STATUS.LOST,
      created_at: "2026-09-05T08:00:00.000Z"
    }),
    ticket({
      id: "same-day-later",
      bet_date: "2026-09-05",
      status: BET_STATUS.LOST,
      created_at: "2026-09-05T20:00:00.000Z"
    })
  ];

  const { ids, supabase } = await visibleIds(bets, { limit: 50 });
  assert.deepEqual(ids, ["newest", "same-day-later", "same-day-earlier", "older"]);
  assert.deepEqual(supabase.log.queries[0].orders, [
    ["bet_date", false],
    ["created_at", false]
  ]);
});

test("a future-dated published ticket keeps the existing semantics: visible", async () => {
  // No future filtering existed before this change and none is introduced.
  const { ids } = await visibleIds([at("2026-12-25", BET_STATUS.PENDING, "future")], { limit: 50 });
  assert.deepEqual(ids, ["future"]);
});

test("the window is calendar-based, so the hour of day cannot move it", async () => {
  const early = Date.parse("2026-09-06T00:05:00+03:00");
  const late = Date.parse("2026-09-06T23:55:00+03:00");
  assert.equal(consumerHistoryWindowStart(early), WINDOW_START);
  assert.equal(consumerHistoryWindowStart(late), WINDOW_START);

  // A rolling 168-hour window would have moved the cut between these two reads.
  const bets = [at(WINDOW_START, BET_STATUS.LOST, "edge")];
  for (const now of [early, late]) {
    const supabase = fakeSupabase({ bets });
    const { bets: got } = await listPublishedGlobalBets({ supabase, now });
    assert.deepEqual(
      got.map((b) => b.id),
      ["edge"]
    );
  }
});

test("the window survives a DST transition", () => {
  // Bucharest leaves summer time on 2026-10-25; a window computed in local time
  // would land a day out across it. Both ends are plain calendar dates here.
  assert.equal(consumerHistoryWindowStart(Date.parse("2026-10-28T09:00:00+02:00")), "2026-10-22");
  // And across the spring change (2026-03-29).
  assert.equal(consumerHistoryWindowStart(Date.parse("2026-04-01T09:00:00+03:00")), "2026-03-26");
});

test("the same inputs give the same answer every time", async () => {
  const bets = [
    at("2026-09-03", BET_STATUS.PENDING, "recent"),
    at(JUST_OUTSIDE, BET_STATUS.WON, "old-won"),
    at(JUST_OUTSIDE, BET_STATUS.LOST, "old-lost")
  ];
  const runs = await Promise.all([
    visibleIds(bets, { limit: 50 }),
    visibleIds(bets, { limit: 50 }),
    visibleIds(bets, { limit: 50 })
  ]);
  for (const r of runs) assert.deepEqual(r.ids, ["recent", "old-won"]);
});
