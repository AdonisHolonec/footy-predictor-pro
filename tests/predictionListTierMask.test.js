import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handleHistoryRead, maskPredictionListForRequester } from "../api/history.js";
import { USER_TIERS, maskPredictionForTier } from "../server-utils/accessTier.js";

/**
 * `view=prediction-list` must carry the same entitlement /api/predict does.
 *
 * Storage holds the UNMASKED Ultra-tier document — Stage10 persists before
 * Stage11 masks — and this endpoint restores the prediction board from it. It
 * used to hand those rows back as stored, so a FREE or PREMIUM caller received
 * on reload exactly what Predict had just withheld: `probs.firstHalf`, the
 * shots/cards probabilities, PREMIUM's exact confidence, Kelly, model internals.
 *
 * These tests drive the REAL handler. The point is the response body — a test
 * that only called maskPredictionForTier would pass with the leak still open.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

/** One row as storage holds it: the whole unmasked Ultra-tier document. */
const storedRow = (over = {}) => ({
  id: 1531636,
  modelVersion: "v3-dc-bp-shin-2026-04",
  league: "Liga I",
  teams: { home: "Dinamo Bucuresti", away: "Rapid" },
  kickoff: "2026-04-26T18:00:00+00:00",
  status: "NS",
  recommended: { pick: "Sub 3.5", confidence: 76.6, odd: 1.27 },
  probs: {
    p1: 44.3,
    pX: 31.7,
    p2: 24.0,
    pGG: 39.2,
    pO15: 58.4,
    pO25: 31.7,
    pU35: 85.2,
    corners: { total: { o8_5: 48.7 }, lambdaTotal: 8.58 },
    shotsOnTarget: { total: { o7_5: 59 } },
    shotsTotal: { total: { o22_5: 85.2 } },
    cards: { total: { o4_5: 41 } },
    firstHalf: { p1: 23.3, pX: 59.4, p2: 17.3, pGG: 14.9, pO05: 50.6, pO15: 20.4, pO25: 6.2 }
  },
  valueBet: { detected: true, type: "1", ev: 4.2, kelly: 1.3, stakePlan: "1u" },
  modelMeta: { method: "strength-ratings", topPickLift: 15.2, elo: { home: 1500, away: 1500 }, debug: { internal: true } },
  ...over
});

const STATS = { wins: 3, losses: 1, settled: 4, winRate: 75 };

function fakeRes() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    }
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/**
 * Drives the real handler for a caller of the given tier.
 * `rows` stands in for storage; it is what the hydration reader returns.
 */
async function hydrate({ tier, role = "user", email = "u@example.com", rows, query, exempt = false, entitlement } = {}) {
  const calls = { entitlement: 0, exempt: [] };
  const res = fakeRes();
  await handleHistoryRead(
    { method: "GET", query: query ?? { mine: "1", view: "prediction-list", days: "3", limit: "300" } },
    res,
    {
      assertSupabaseConfigured: () => ({ ok: true }),
      getRequester: async () => ({ ok: true, user: { id: "user-1", email } }),
      loadEntitlement:
        entitlement ??
        (async () => {
          calls.entitlement += 1;
          return { profile: { role }, tierInfo: { effectiveTier: tier } };
        }),
      isWarmPredictQuotaExempt: async (userId, emailLower) => {
        calls.exempt.push([userId, emailLower]);
        return exempt;
      },
      readPredictionsForHydration: async () => ({ items: rows ?? [storedRow()], stats: STATS }),
      readPredictionsHistoryListForUser: async () => ({ items: rows ?? [storedRow()], stats: STATS }),
      readPredictionsHistoryForUser: async () => ({ items: rows ?? [storedRow()], stats: STATS })
    }
  );
  return { res, calls };
}

// ---------------------------------------------------------------- the three tiers

test("[1] FREE: the hydrated response carries no probs.firstHalf", async () => {
  const { res } = await hydrate({ tier: USER_TIERS.FREE });
  assert.equal(res.statusCode, 200);
  const [row] = res.payload.items;
  assert.equal("firstHalf" in row.probs, false, "FREE must not receive the first-half block");
  assert.equal(JSON.stringify(res.payload).includes("firstHalf"), false, "not anywhere in the body");
});

test("[2] PREMIUM: the hydrated response carries no probs.firstHalf", async () => {
  const { res } = await hydrate({ tier: USER_TIERS.PREMIUM });
  assert.equal(res.statusCode, 200);
  const [row] = res.payload.items;
  assert.equal("firstHalf" in row.probs, false, "PREMIUM must not receive the first-half block");
  assert.equal(JSON.stringify(res.payload).includes("firstHalf"), false, "not anywhere in the body");
});

test("[3] ULTRA: the hydrated response keeps probs.firstHalf, exactly as stored", async () => {
  const { res } = await hydrate({ tier: USER_TIERS.ULTRA });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload.items[0].probs.firstHalf, storedRow().probs.firstHalf);
  assert.equal(res.payload.items[0].probs.firstHalf.pO15, 20.4);
});

test("[5] pGG / pO15 / pO25 are identical for every tier — masking removes, never rewrites", async () => {
  const stored = storedRow().probs;
  for (const tier of [USER_TIERS.FREE, USER_TIERS.PREMIUM, USER_TIERS.ULTRA]) {
    const { res } = await hydrate({ tier });
    const { probs } = res.payload.items[0];
    assert.equal(probs.pGG, stored.pGG, `${tier} pGG`);
    assert.equal(probs.pO15, stored.pO15, `${tier} pO15`);
    assert.equal(probs.pO25, stored.pO25, `${tier} pO25`);
    assert.equal(probs.p1, stored.p1, `${tier} p1`);
    assert.equal(probs.pU35, stored.pU35, `${tier} pU35`);
  }
});

test("PHASE 7: one fixture, two callers — absent for FREE, present for ULTRA", async () => {
  const rows = [storedRow({ id: 777 })];
  const free = await hydrate({ tier: USER_TIERS.FREE, rows });
  const ultra = await hydrate({ tier: USER_TIERS.ULTRA, rows });
  assert.equal(free.res.payload.items[0].id, 777);
  assert.equal(ultra.res.payload.items[0].id, 777);
  assert.equal(free.res.payload.items[0].probs.firstHalf, undefined);
  assert.equal(ultra.res.payload.items[0].probs.firstHalf.pO15, 20.4);
});

// ---------------------------------------------------------------- same rule as /api/predict

test("[4] hydration applies exactly the mask /api/predict applies — same function, same output", async () => {
  for (const tier of [USER_TIERS.FREE, USER_TIERS.PREMIUM, USER_TIERS.ULTRA]) {
    const { res } = await hydrate({ tier });
    assert.deepEqual(
      res.payload.items[0],
      maskPredictionForTier(storedRow(), tier),
      `${tier}: a hydrated row must equal what Predict would have returned for it`
    );
  }
});

test("[4] the Predict mask itself is unchanged by this fix", () => {
  const free = maskPredictionForTier(storedRow(), USER_TIERS.FREE);
  assert.deepEqual(Object.keys(free.probs).sort(), ["p1", "p2", "pGG", "pO15", "pO25", "pU35", "pX"]);
  assert.equal(free.recommended.confidence, 76.6, "FREE keeps the recommendation's confidence");
  assert.deepEqual(free.valueBet, { detected: true, type: "1", ev: 4.2, kelly: 0, stakePlan: "" });

  const premium = maskPredictionForTier(storedRow(), USER_TIERS.PREMIUM);
  assert.equal("corners" in premium.probs, true, "PREMIUM keeps corners");
  assert.equal("firstHalf" in premium.probs, false);
  assert.equal(premium.recommended.confidence, null, "PREMIUM gets a category, not the number");
  assert.equal(typeof premium.recommended.confidenceCategory, "string");

  const ultra = maskPredictionForTier(storedRow(), USER_TIERS.ULTRA);
  assert.deepEqual(ultra.probs, storedRow().probs);
  // Internal debug metadata is stripped at every tier, Ultra included.
  assert.equal("debug" in ultra.modelMeta, false);
});

test("the handler deletes nothing itself — one mask, one source of truth", () => {
  const src = read("api/history.js");
  assert.match(src, /import \{[^}]*maskPredictionForTier[^}]*\} from "\.\.\/server-utils\/accessTier\.js"/);
  assert.match(src, /import \{ loadEntitlement \} from "\.\.\/server-utils\/entitlement\.js"/);
  assert.doesNotMatch(src, /delete\s+\w+\.probs\b/, "field removal belongs to maskPredictionForTier alone");
  assert.doesNotMatch(src, /delete\s+[\w.]*firstHalf/);
});

test("admin / quota-exempt callers are unmasked, exactly as Stage11Masking treats them", async () => {
  const byRole = await hydrate({ tier: USER_TIERS.FREE, role: "admin" });
  assert.deepEqual(byRole.res.payload.items[0], storedRow(), "admin role bypasses the mask");
  assert.equal(byRole.calls.exempt.length, 0, "role short-circuits the second lookup, as in api/fixtures.js");

  const byEmail = await hydrate({ tier: USER_TIERS.FREE, exempt: true, email: "Boss@Example.COM" });
  assert.deepEqual(byEmail.res.payload.items[0], storedRow(), "bootstrap-email admin bypasses the mask");
  assert.deepEqual(byEmail.calls.exempt, [["user-1", "boss@example.com"]], "email is lower-cased before the check");
});

// ---------------------------------------------------------------- failing closed

test("an unknown tier is FREE — a caller with no profile is never handed the full document", async () => {
  for (const entitlement of [
    async () => ({ profile: null, tierInfo: null }),
    async () => ({ profile: { role: "user" }, tierInfo: null }),
    async () => ({ profile: { role: "user" }, tierInfo: { effectiveTier: "" } }),
    async () => null
  ]) {
    const { res } = await hydrate({ entitlement });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.items[0], maskPredictionForTier(storedRow(), USER_TIERS.FREE));
    assert.equal("firstHalf" in res.payload.items[0].probs, false);
  }
});

test("a FAILED entitlement read is a 500 — never an unmasked 200", async () => {
  const { res } = await hydrate({
    entitlement: async () => {
      throw new Error("entitlement: Supabase admin client unavailable");
    }
  });
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.ok, false);
  assert.equal("items" in res.payload, false, "no rows leave the server when the tier is unknowable");
  assert.equal(JSON.stringify(res.payload).includes("firstHalf"), false);
});

// ---------------------------------------------------------------- storage and shape

test("[7] storage is never mutated — the mask works on a copy", async () => {
  const rows = deepFreeze([storedRow(), storedRow({ id: 2 })]);
  const before = JSON.stringify(rows);
  for (const tier of [USER_TIERS.FREE, USER_TIERS.PREMIUM, USER_TIERS.ULTRA]) {
    // Frozen input: an in-place delete would throw in strict mode.
    const { res } = await hydrate({ tier, rows });
    assert.equal(res.statusCode, 200, `${tier} must not write to its input`);
    assert.notEqual(res.payload.items[0], rows[0], "a new object, not the stored one");
  }
  assert.equal(JSON.stringify(rows), before, "the stored rows are byte-identical afterwards");
  assert.equal(rows[0].probs.firstHalf.pO15, 20.4);
});

test("[6] rows stored before first-half existed, and rows with no probs at all, still hydrate", async () => {
  const noFirstHalf = storedRow({ id: 10 });
  delete noFirstHalf.probs.firstHalf;
  const insufficient = { id: 11, insufficientData: true, insufficientReason: "no_stats", teams: { home: "A", away: "B" } };
  for (const tier of [USER_TIERS.FREE, USER_TIERS.PREMIUM, USER_TIERS.ULTRA]) {
    const { res } = await hydrate({ tier, rows: [noFirstHalf, insufficient] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.items.map((r) => r.id), [10, 11], "same rows, same order");
    assert.equal(res.payload.items[0].probs.pO15, 58.4);
    assert.deepEqual(res.payload.items[1], insufficient, "a row with no probs passes through untouched");
  }
});

test("[8] the envelope, the stats and the row order are unchanged", async () => {
  const rows = [storedRow({ id: 3 }), storedRow({ id: 1 }), storedRow({ id: 2 })];
  const { res } = await hydrate({ tier: USER_TIERS.FREE, rows });
  assert.deepEqual(Object.keys(res.payload), ["ok", "mine", "days", "stats", "items"]);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.mine, true);
  assert.equal(res.payload.days, 3);
  assert.deepEqual(res.payload.stats, STATS);
  assert.deepEqual(res.payload.items.map((r) => r.id), [3, 1, 2]);

  const empty = await hydrate({ tier: USER_TIERS.FREE, rows: [] });
  assert.deepEqual(empty.res.payload.items, []);
});

test("[8] a masked row never looks 'legacy' to the client, so hydration cannot re-arm itself", async () => {
  /*
    hasLegacyPredictionShape() (src/pages/userDashboard/helpers.ts) re-triggers the
    rehydrate when restored rows look stale. It returns false for FREE as soon as
    a row has a modelVersion, and for PREMIUM as long as probs.corners is there.
    Both survive the mask — if either stopped surviving, a FREE or PREMIUM client
    would refetch this endpoint in a loop.
  */
  const free = (await hydrate({ tier: USER_TIERS.FREE })).res.payload.items[0];
  assert.equal(free.modelVersion, "v3-dc-bp-shin-2026-04");
  const premium = (await hydrate({ tier: USER_TIERS.PREMIUM })).res.payload.items[0];
  assert.ok(premium.probs.corners, "PREMIUM keeps probs.corners");
  const ultra = (await hydrate({ tier: USER_TIERS.ULTRA })).res.payload.items[0];
  assert.ok(ultra.probs.corners && ultra.probs.shotsOnTarget);
});

test("view=list is not masked and resolves no tier — it carries no document to gate", async () => {
  const { res, calls } = await hydrate({
    tier: USER_TIERS.FREE,
    query: { mine: "1", view: "list", days: "30", limit: "2000" }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.entitlement, 0, "no entitlement round-trips on a path that needs none");
});

test("the helper tolerates a non-array and resolves the tier once per request, not per row", async () => {
  let reads = 0;
  const deps = {
    loadEntitlement: async () => {
      reads += 1;
      return { profile: { role: "user" }, tierInfo: { effectiveTier: USER_TIERS.FREE } };
    },
    isWarmPredictQuotaExempt: async () => false
  };
  assert.deepEqual(await maskPredictionListForRequester({ id: "u" }, null, deps), []);
  const out = await maskPredictionListForRequester({ id: "u" }, [storedRow(), storedRow(), storedRow()], deps);
  assert.equal(out.length, 3);
  assert.equal(reads, 2, "one entitlement read per call, regardless of row count");
});
