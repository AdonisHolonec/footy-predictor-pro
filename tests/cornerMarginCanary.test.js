import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCornerMargin,
  buildGlobalSpecialBets,
  buildGlobalSystemBets,
  collectGlobalCandidates,
  cornerMarginFromEnv,
  diversifyGlobalCandidates,
  rankGlobalCandidates
} from "../server-utils/globalSpecialBetEngine.js";

/**
 * Corners margin canary (design D1) — selection-layer only, default OFF.
 *
 * The rule: a fixture's corners candidate keeps the lead over that fixture's
 * best non-corners candidate only while
 *
 *     cornerProbability - bestNonCornerProbability >= margin
 *
 * The boundary is INCLUSIVE, so a gap of exactly the margin keeps corners.
 *
 * A note on the epsilon, because it looks like a fudge and is not: probabilities
 * are round2 payload values, and in IEEE754 `0.95 - 0.80` is 0.1499999999999999
 * while `0.80 - 0.65` is 0.1500000000000000. Without the tolerance the inclusive
 * boundary would hold for some decimal pairs and not others, which is a rule
 * nobody could state. diversifyGlobalCandidates guards its league band the same
 * way and for the same reason.
 */

const NOW = Date.parse("2026-08-09T10:00:00.000Z");
const KICKOFF = "2026-08-09T18:00:00.000Z";

/** Minimal candidate: applyCornerMargin reads only fixtureId, market, probability. */
const cand = (fixtureId, market, probability, odds = 1.5) => ({
  fixtureId,
  market,
  probability,
  odds,
  selection: `${market}@${probability}`
});

/** The candidate a ranked list would hand to diversification for one fixture. */
const headOf = (ranked, fixtureId) => ranked.find((c) => c.fixtureId === fixtureId);

// ── env gate ───────────────────────────────────────────────────────────────

test("[E1] unset, empty and zero all mean OFF", () => {
  assert.equal(cornerMarginFromEnv({}), 0);
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "" }), 0);
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "   " }), 0);
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "0" }), 0);
});

test("[E2] a valid margin is read as probability units", () => {
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "0.15" }), 0.15);
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: " 0.15 " }), 0.15);
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "0.05" }), 0.05);
});

test("[E3] an invalid value falls back to OFF and never throws", () => {
  for (const raw of ["abc", "NaN", "-1", "-0.5", "{}"]) {
    assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: raw }), 0, `expected OFF for ${raw}`);
  }
});

test("[E4] a value above 1 is refused, not honoured", () => {
  /*
    "15" almost certainly means 15 percentage points. Honouring it as a margin
    would demand a 1500pp lead and so disable corners outright — a far bigger
    change than the canary, arrived at by typo.
  */
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "15" }), 0);
  assert.equal(cornerMarginFromEnv({ CORNER_MARGIN_PP: "1.5" }), 0);
});

// ── boundary semantics ─────────────────────────────────────────────────────
//
// The task brief listed its cases 1 and 3 as "Corners stays" at gaps of 0.10
// and 0.14. Both are below the 0.15 margin, so both yield; the expectations
// below are the corrected ones. Brief cases 2/4 and 3/5 were the same pair
// stated twice, so each appears once here.

test("[B1] gap 0.10 is below the margin, so corners YIELDS", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.8), cand(1, "shots", 0.7)]);
  const { ranked: out, yielded } = applyCornerMargin(ranked, 0.15);
  assert.equal(headOf(out, 1).market, "shots");
  assert.equal(yielded, 1);
});

test("[B2] gap of exactly 0.15 KEEPS corners (inclusive boundary)", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.8), cand(1, "shots", 0.65)]);
  const { ranked: out, yielded } = applyCornerMargin(ranked, 0.15);
  assert.equal(headOf(out, 1).market, "corners");
  assert.equal(yielded, 0);
});

test("[B3] gap 0.14 is below the margin, so corners YIELDS", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.8), cand(1, "shots", 0.66)]);
  assert.equal(headOf(applyCornerMargin(ranked, 0.15).ranked, 1).market, "shots");
});

test("[B4] gap 0.139 yields", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.8), cand(1, "shots", 0.661)]);
  assert.equal(headOf(applyCornerMargin(ranked, 0.15).ranked, 1).market, "shots");
});

test("[B5] gap just above the margin keeps corners", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.8), cand(1, "shots", 0.649)]);
  assert.equal(headOf(applyCornerMargin(ranked, 0.15).ranked, 1).market, "corners");
});

test("[B6] the inclusive boundary holds for decimal pairs that underflow in IEEE754", () => {
  /*
    Each pair is an exact 0.15 gap in decimal but evaluates BELOW 0.15 in
    floating point. Without the epsilon these three would yield while other
    pairs would not, for no reason a user could ever discover.
  */
  for (const [c, o] of [
    [0.95, 0.8],
    [0.7, 0.55],
    [0.83, 0.68]
  ]) {
    assert.ok(c - o < 0.15, `precondition: ${c}-${o} must underflow`);
    const ranked = rankGlobalCandidates([cand(1, "corners", c), cand(1, "shots", o)]);
    assert.equal(headOf(applyCornerMargin(ranked, 0.15).ranked, 1).market, "corners", `${c} vs ${o}`);
  }
});

// ── degenerate populations ─────────────────────────────────────────────────

test("[D1] a corners-only fixture keeps corners rather than dropping the fixture", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.9), cand(1, "corners", 0.7)]);
  const { ranked: out, considered, yielded } = applyCornerMargin(ranked, 0.15);
  assert.equal(headOf(out, 1).market, "corners");
  assert.equal(considered, 1);
  assert.equal(yielded, 0);
});

test("[D2] a fixture with no corners is untouched and not counted", () => {
  const ranked = rankGlobalCandidates([cand(1, "shots", 0.9), cand(1, "ou", 0.7)]);
  const { ranked: out, considered, yielded } = applyCornerMargin(ranked, 0.15);
  assert.deepEqual(
    out.map((c) => c.selection),
    ranked.map((c) => c.selection)
  );
  assert.equal(considered, 0);
  assert.equal(yielded, 0);
});

test("[D3] a corners candidate that is not the fixture head is ignored entirely", () => {
  // shots already leads, so there is no margin question to ask.
  const ranked = rankGlobalCandidates([cand(1, "shots", 0.9), cand(1, "corners", 0.88)]);
  const { ranked: out, considered, yielded } = applyCornerMargin(ranked, 0.15);
  assert.equal(headOf(out, 1).market, "shots");
  assert.equal(considered, 0);
  assert.equal(yielded, 0);
});

test("[D4] with several corners, the BEST-ranked corners is the one tested", () => {
  const ranked = rankGlobalCandidates([
    cand(1, "corners", 0.9),
    cand(1, "corners", 0.7),
    cand(1, "shots", 0.8)
  ]);
  // 0.90 - 0.80 = 0.10 < 0.15 -> yields, even though a weaker corners exists.
  assert.equal(headOf(applyCornerMargin(ranked, 0.15).ranked, 1).market, "shots");
});

test("[D5] with several non-corners, the BEST-ranked one is the rival and is promoted", () => {
  const ranked = rankGlobalCandidates([
    cand(1, "corners", 0.9),
    cand(1, "shots", 0.85),
    cand(1, "ou", 0.62)
  ]);
  const head = headOf(applyCornerMargin(ranked, 0.15).ranked, 1);
  assert.equal(head.market, "shots");
  assert.equal(head.probability, 0.85);
});

test("[D6] empty and absent inputs are handled without throwing", () => {
  assert.deepEqual(applyCornerMargin([], 0.15).ranked, []);
  assert.equal(applyCornerMargin(null, 0.15).ranked, null);
  assert.equal(applyCornerMargin(undefined, 0.15).yielded, 0);
});

// ── ordering guarantees ────────────────────────────────────────────────────

test("[O1] a probability tie keeps the existing rank tie-break (odds ascending)", () => {
  // Equal probability: rankGlobalCandidates prefers the shorter price, so shots
  // already leads and the canary has nothing to decide.
  const ranked = rankGlobalCandidates([
    cand(1, "corners", 0.8, 2.0),
    cand(1, "shots", 0.8, 1.4),
    cand(1, "ou", 0.8, 1.9)
  ]);
  assert.equal(ranked[0].market, "shots", "precondition: ranking already leads with shots");
  const { ranked: out, considered } = applyCornerMargin(ranked, 0.15);
  assert.deepEqual(
    out.map((c) => c.selection),
    ranked.map((c) => c.selection)
  );
  assert.equal(considered, 0);
});

test("[O2] other fixtures are left exactly where ranking put them", () => {
  const ranked = rankGlobalCandidates([
    cand(1, "corners", 0.9),
    cand(1, "shots", 0.85),
    cand(2, "shots", 0.88),
    cand(2, "ou", 0.7),
    cand(3, "corners", 0.95),
    cand(3, "ou", 0.6)
  ]);
  const { ranked: out } = applyCornerMargin(ranked, 0.15);
  assert.equal(headOf(out, 1).market, "shots", "fixture 1 yields (0.05 gap)");
  assert.equal(headOf(out, 2).market, "shots", "fixture 2 has no corners");
  assert.equal(headOf(out, 3).market, "corners", "fixture 3 leads by 0.35");
  // Nothing is lost or duplicated by the reorder.
  assert.equal(out.length, ranked.length);
  assert.deepEqual(new Set(out), new Set(ranked));
});

test("[O3] candidate objects are neither mutated nor replaced", () => {
  const corners = cand(1, "corners", 0.8);
  const shots = cand(1, "shots", 0.75);
  const before = JSON.stringify([corners, shots]);
  const { ranked: out } = applyCornerMargin(rankGlobalCandidates([corners, shots]), 0.15);
  assert.equal(JSON.stringify([corners, shots]), before, "inputs unchanged");
  assert.ok(out.includes(corners) && out.includes(shots), "same object identities returned");
});

test("[O4] the surviving order still feeds diversification one leg per fixture", () => {
  const ranked = rankGlobalCandidates([
    cand(1, "corners", 0.9),
    cand(1, "shots", 0.85),
    cand(2, "corners", 0.9),
    cand(2, "ou", 0.7)
  ]);
  const pool = diversifyGlobalCandidates(applyCornerMargin(ranked, 0.15).ranked);
  assert.equal(pool.length, 2);
  assert.equal(new Set(pool.map((c) => c.fixtureId)).size, 2);
});

// ── OFF is genuinely off ───────────────────────────────────────────────────

test("[F1] margin 0 returns the very same array reference", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.9), cand(1, "shots", 0.85)]);
  const off = applyCornerMargin(ranked, 0);
  assert.equal(off.ranked, ranked, "not a copy — the same array");
  assert.equal(off.margin, 0);
  assert.equal(off.considered, 0);
  assert.equal(off.yielded, 0);
});

test("[F2] a negative or non-numeric margin is treated as OFF", () => {
  const ranked = rankGlobalCandidates([cand(1, "corners", 0.9), cand(1, "shots", 0.85)]);
  for (const m of [-0.1, NaN, undefined, null, "0.15"]) {
    assert.equal(applyCornerMargin(ranked, m).ranked, ranked, `margin ${String(m)} must be OFF`);
  }
});

// ── integration through the builder ────────────────────────────────────────

function fixture(id, leagueId, markets) {
  return {
    id,
    leagueId,
    kickoff: KICKOFF,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    recommended: { pick: "Over 2.5", family: "Goals", confidence: 80 },
    modelMeta: { dataQuality: 0.8 },
    valueEngine: { markets }
  };
}

const market = (overrides = {}) => ({
  type: "Over 2.5",
  family: "Goals",
  line: 2.5,
  odds: 1.5,
  probability: 0.7,
  valueScore: 60,
  recommendable: true,
  tradable: true,
  betType: "over_under",
  period: "full_match",
  scope: "match",
  ...overrides
});

const cornersMarket = (probability, line = 9.5) =>
  market({ type: `Under ${line}`, family: "Corners", line, probability, betType: "total" });

/** Four fixtures, each led by corners over a close non-corners rival. */
const rows = () =>
  [1, 2, 3, 4].map((i) =>
    fixture(i, 39 + (i % 2), [cornersMarket(0.88), market({ probability: 0.8 })])
  );

const OPTIONS = () => ({ rows: rows(), leagueIds: [39, 40], now: NOW });

test("[I1] OFF: the returned object keeps exactly its pre-canary shape", () => {
  const built = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]);
  assert.deepEqual(Object.keys(built).sort(), [
    "bets",
    "candidates",
    "examined",
    "pool",
    "rejected",
    "reusedByVariant",
    "unavailable"
  ]);
  assert.equal("cornerMargin" in built, false, "no telemetry key while OFF");
});

test("[I2] OFF: every selection is corners, as production does today", () => {
  const built = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]);
  assert.equal(built.pool.length, 4);
  assert.ok(
    built.pool.every((c) => c.market === "corners"),
    "precondition: today's ranking leads with corners on every fixture"
  );
});

test("[I3] ON: corners yields where the lead is under the margin", () => {
  // 0.88 - 0.80 = 0.08, below 0.15.
  const built = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]);
  assert.ok(
    built.pool.every((c) => c.market === "ou"),
    `expected goals to lead every fixture, got ${built.pool.map((c) => c.market).join(",")}`
  );
});

test("[I4] ON: telemetry reports the margin, the counts and the resulting mix", () => {
  const built = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]);
  assert.deepEqual(built.cornerMargin, {
    margin: 0.15,
    cornersConsidered: 4,
    cornersYielded: 4,
    fixturesAffected: 4,
    poolFamilyMix: { ou: 4 }
  });
});

test("[I5] ON: a corners lead at the margin is preserved end to end", () => {
  const wide = [1, 2].map((i) => fixture(i, 39, [cornersMarket(0.95), market({ probability: 0.8 })]));
  // 0.95 - 0.80 is exactly 0.15 in decimal and underflows in IEEE754.
  const built = buildGlobalSpecialBets({ rows: wide, leagueIds: [39], now: NOW, cornerMarginPp: 0.15 }, [3]);
  assert.ok(built.pool.every((c) => c.market === "corners"));
  assert.equal(built.cornerMargin.cornersYielded, 0);
});

test("[I6] the ticket still respects one leg per fixture and the requested size", () => {
  const built = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]);
  const legs = built.bets[3].selections;
  assert.equal(legs.length, 3);
  assert.equal(new Set(legs.map((l) => l.fixtureId)).size, 3);
});

test("[I7] no probability, odds, confidence or valueScore is altered by the canary", () => {
  const off = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]);
  const on = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]);
  const byKey = new Map(off.candidates.map((c) => [`${c.fixtureId}|${c.selection}`, c]));
  for (const c of on.candidates) {
    const same = byKey.get(`${c.fixtureId}|${c.selection}`);
    assert.ok(same, `candidate ${c.selection} disappeared`);
    assert.equal(c.probability, same.probability);
    assert.equal(c.odds, same.odds);
    assert.equal(c.confidence, same.confidence);
    assert.equal(c.valueScore, same.valueScore);
  }
  assert.equal(on.candidates.length, off.candidates.length, "the candidate set is unchanged");
});

// ── System is out of scope, and must stay out ──────────────────────────────

test("[S1] System selections are identical with the canary on and off", () => {
  /*
    rankSystemCandidates orders by EV bucket first. A margin expressed in
    probability applied there would silently reorder an EV ranking, so System is
    excluded by construction: buildGlobalSystemBets never calls the canary.
  */
  const base = { rows: rows(), leagueIds: [39, 40], now: NOW, systemK: 3 };
  const off = buildGlobalSystemBets({ ...base, cornerMarginPp: 0 });
  const on = buildGlobalSystemBets({ ...base, cornerMarginPp: 0.15 });
  assert.deepEqual(
    on.selections.map((s) => `${s.fixtureId}|${s.selection}`),
    off.selections.map((s) => `${s.fixtureId}|${s.selection}`)
  );
  assert.equal("cornerMargin" in on, false, "System never reports canary telemetry");
});

test("[S2] the env var alone cannot reach the System path", () => {
  const previous = process.env.CORNER_MARGIN_PP;
  process.env.CORNER_MARGIN_PP = "0.15";
  try {
    const base = { rows: rows(), leagueIds: [39, 40], now: NOW, systemK: 3 };
    const withEnv = buildGlobalSystemBets(base);
    const explicit = buildGlobalSystemBets({ ...base, cornerMarginPp: 0 });
    assert.deepEqual(
      withEnv.selections.map((s) => s.selection),
      explicit.selections.map((s) => s.selection)
    );
  } finally {
    if (previous === undefined) delete process.env.CORNER_MARGIN_PP;
    else process.env.CORNER_MARGIN_PP = previous;
  }
});

test("[S3] the env var drives the combo path when no explicit margin is passed", () => {
  const previous = process.env.CORNER_MARGIN_PP;
  process.env.CORNER_MARGIN_PP = "0.15";
  try {
    const built = buildGlobalSpecialBets(OPTIONS(), [3]);
    assert.equal(built.cornerMargin.margin, 0.15);
    assert.ok(built.pool.every((c) => c.market === "ou"));
  } finally {
    if (previous === undefined) delete process.env.CORNER_MARGIN_PP;
    else process.env.CORNER_MARGIN_PP = previous;
  }
});

test("[S4] with the env unset the combo path is byte-identical to an explicit OFF", () => {
  const previous = process.env.CORNER_MARGIN_PP;
  delete process.env.CORNER_MARGIN_PP;
  try {
    const built = buildGlobalSpecialBets(OPTIONS(), [3]);
    const explicitOff = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0 }, [3]);
    assert.equal(JSON.stringify(built), JSON.stringify(explicitOff));
    assert.equal("cornerMargin" in built, false);
  } finally {
    if (previous !== undefined) process.env.CORNER_MARGIN_PP = previous;
  }
});

// ── the collector is upstream of all of this and must not move ─────────────

test("[C1] the canary changes no gate: the candidate set is identical either way", () => {
  const collected = collectGlobalCandidates(OPTIONS());
  const on = buildGlobalSpecialBets({ ...OPTIONS(), cornerMarginPp: 0.15 }, [3]);
  assert.equal(on.examined, collected.examined);
  assert.deepEqual(on.rejected, collected.rejected);
  assert.equal(on.candidates.length, collected.candidates.length);
});
