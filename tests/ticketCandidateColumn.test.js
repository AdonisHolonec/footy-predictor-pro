/**
 * ticket_candidates — the projection contract (migration 069).
 *
 * The column exists because collectGlobalCandidates() cannot be fed from
 * hydration_payload: that column keeps ONE market and no modelMeta, so a
 * candidate query over it would see one cards market per fixture and reject
 * every one on a null dataQuality. Reading raw_payload instead is the ~151 MB
 * statement that produced the 57014 timeouts.
 *
 * THE PROPERTY THESE TESTS DEFEND is not the size — it is WHICH rule moved.
 * Exactly one gate is materialised at write time (`recommendable === true`);
 * every other gate must still see complete, unmodified market objects at read
 * time. A projection that narrowed a retained market, or that stored only the
 * markets already passing today's odds floor, would look identical in
 * production until someone changed a constant — and then be silently wrong.
 * That failure mode is what tests 9 and 13 exist for.
 *
 * Production cannot exercise several of these branches: it has no fixture with
 * insufficientData set, and no cards market ever reaches a candidate because
 * cards is not a settleable family. Those are synthetic here on purpose — they
 * pin the algorithmic contract rather than describing an observation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketCandidates,
  deriveTicketCandidatesColumn,
  rehydrateTicketCandidateRow,
  TICKET_CANDIDATE_COLUMNS,
  TICKET_CANDIDATE_SELECT
} from "../server-utils/ticketCandidateColumn.js";

/** A market carrying every field the read-time gates consult. */
function market(over = {}) {
  return {
    type: "Over 2.5",
    family: "ou",
    betType: "ou",
    period: "ft",
    scope: "match",
    line: 2.5,
    odds: 1.85,
    probability: 0.72,
    valueScore: 61.2,
    recommendable: true,
    settleable: true,
    tradable: true,
    edge: 0.03,
    kellyPct: 2.1,
    fairOdds: 1.39,
    impliedProb: 0.54,
    explanation: "…",
    ...over
  };
}

function payload(over = {}) {
  return {
    id: 1234,
    leagueId: 39,
    kickoff: "2026-08-09T18:00:00Z",
    league: "Premier League",
    teams: { home: "Home FC", away: "Away FC" },
    modelVersion: "v3-test",
    insufficientData: false,
    recommended: { pick: "Over 2.5", confidence: 68.4, family: "ou" },
    modelMeta: { dataQuality: 0.9, activeModel: "B", elo: 1500 },
    probs: { p1: 51 },
    marketOdds: { home: 2.1 },
    valueEngine: { markets: [market()], bestMarket: {}, valueScore: 61.2 },
    ...over
  };
}

// ── the one write-time gate ─────────────────────────────────────────────────

test("1. recommendable=false markets are excluded", () => {
  const p = payload({
    valueEngine: {
      markets: [market({ type: "A" }), market({ type: "B", recommendable: false }), market({ type: "C" })]
    }
  });
  assert.deepEqual(buildTicketCandidates(p).markets.map((m) => m.type), ["A", "C"]);
});

test("1b. a missing or non-true recommendable is excluded — strict === true", () => {
  // A legacy payload cannot attest the market is recommendable, so it is
  // dropped rather than assumed, exactly as the engine treats `tradable`.
  const p = payload({
    valueEngine: {
      markets: [
        market({ type: "absent", recommendable: undefined }),
        market({ type: "truthy", recommendable: 1 }),
        market({ type: "string", recommendable: "true" }),
        market({ type: "kept" })
      ]
    }
  });
  assert.deepEqual(buildTicketCandidates(p).markets.map((m) => m.type), ["kept"]);
});

test("2. a retained market is preserved COMPLETELY, field for field", () => {
  const m = market({ someFutureField: { nested: [1, 2, 3] } });
  const tc = buildTicketCandidates(payload({ valueEngine: { markets: [m] } }));
  assert.deepEqual(tc.markets[0], m);
  // Not merely deep-equal: no key may be dropped, because a future gate may
  // read a field nothing reads today.
  assert.deepEqual(Object.keys(tc.markets[0]).sort(), Object.keys(m).sort());
});

test("3. market ORDER is preserved", () => {
  const types = ["a", "b", "c", "d", "e"];
  const p = payload({ valueEngine: { markets: types.map((t) => market({ type: t })) } });
  assert.deepEqual(buildTicketCandidates(p).markets.map((m) => m.type), types);
});

test("3b. order survives interleaved rejections", () => {
  const p = payload({
    valueEngine: {
      markets: [
        market({ type: "1" }),
        market({ type: "x", recommendable: false }),
        market({ type: "2" }),
        market({ type: "y", recommendable: false }),
        market({ type: "3" })
      ]
    }
  });
  assert.deepEqual(buildTicketCandidates(p).markets.map((m) => m.type), ["1", "2", "3"]);
});

// ── the four scalars the engine gates on ────────────────────────────────────

test("4. all four scalar fields are preserved", () => {
  const tc = buildTicketCandidates(payload());
  assert.equal(tc.dataQuality, 0.9);
  assert.equal(tc.insufficientData, false);
  assert.equal(tc.confidence, 68.4);
  assert.deepEqual(tc.teams, { home: "Home FC", away: "Away FC" });
});

test("5+6. examined and notRecommendable describe the discarded population", () => {
  const p = payload({
    valueEngine: {
      markets: [market(), market({ recommendable: false }), market({ recommendable: false }), market()]
    }
  });
  const tc = buildTicketCandidates(p);
  assert.equal(tc.examined, 4);
  assert.equal(tc.notRecommendable, 2);
  assert.equal(tc.markets.length, 2);
  assert.equal(tc.examined - tc.notRecommendable, tc.markets.length);
});

test("7. unrelated prediction fields are not copied", () => {
  const tc = buildTicketCandidates(payload());
  assert.deepEqual(
    Object.keys(tc).sort(),
    ["confidence", "dataQuality", "examined", "insufficientData", "markets", "notRecommendable", "teams"]
  );
  for (const absent of ["probs", "marketOdds", "explanation", "featureImportance", "logos", "modelMeta", "recommended", "valueEngine"]) {
    assert.ok(!(absent in tc), `${absent} must not be copied`);
  }
});

test("8. the projection never contains raw_payload, nor the whole document", () => {
  const p = payload({ raw_payload: { huge: "x".repeat(1000) } });
  const tc = buildTicketCandidates(p);
  assert.ok(!("raw_payload" in tc));
  assert.ok(!JSON.stringify(tc).includes("xxxxxxxxxx"));
});

// ── the reason this shape was chosen ────────────────────────────────────────

test("9. downstream thresholds do NOT change what is stored", () => {
  /*
    The whole design. A market that today fails the odds floor, the probability
    floor, the model-edge gate, the settleable-family set or the quarter-line
    rule is still STORED, because those gates run at read time. Storing only
    what passes them would make a constant change silently wrong until a
    backfill — measured at 103/115 stale for a 1.30 -> 1.60 odds move.
  */
  const p = payload({
    valueEngine: {
      markets: [
        market({ type: "below-odds-floor", odds: 1.01 }),
        market({ type: "below-prob-floor", probability: 0.01 }),
        market({ type: "cards-not-settleable", family: "cards" }),
        market({ type: "quarter-line", line: 2.25 }),
        market({ type: "not-tradable", tradable: false }),
        market({ type: "no-identity", betType: null, period: null, scope: null }),
        market({ type: "huge-edge", probability: 0.99, odds: 4.69 }),
        market({ type: "settleable-false", settleable: false })
      ]
    }
  });
  const tc = buildTicketCandidates(p);
  assert.equal(tc.markets.length, 8, "every recommendable market is retained regardless of later gates");
  assert.equal(tc.notRecommendable, 0);
});

test("9b. the retained set depends ONLY on recommendable", () => {
  for (const settleable of [true, false]) {
    for (const tradable of [true, false]) {
      const p = payload({ valueEngine: { markets: [market({ settleable, tradable })] } });
      assert.equal(buildTicketCandidates(p).markets.length, 1);
    }
  }
});

// ── deterministic edges ─────────────────────────────────────────────────────

test("10. no markets at all stores nothing", () => {
  assert.equal(buildTicketCandidates(payload({ valueEngine: { markets: [] } })), null);
  assert.equal(buildTicketCandidates(payload({ valueEngine: {} })), null);
  assert.equal(buildTicketCandidates(payload({ valueEngine: null })), null);
  assert.equal(buildTicketCandidates({}), null);
  assert.equal(buildTicketCandidates(null), null);
  assert.equal(buildTicketCandidates([]), null);
});

test("10b. markets present but none recommendable stores an EMPTY set, not null", () => {
  // Distinct from "no markets": this fixture was examined and rejected, and the
  // counters are the only surviving record of that.
  const p = payload({ valueEngine: { markets: [market({ recommendable: false }), market({ recommendable: false })] } });
  const tc = buildTicketCandidates(p);
  assert.deepEqual(tc.markets, []);
  assert.equal(tc.examined, 2);
  assert.equal(tc.notRecommendable, 2);
});

test("11. null semantics are preserved, never defaulted", () => {
  const missing = buildTicketCandidates(payload({ modelMeta: {}, recommended: {}, teams: null }));
  assert.equal(missing.dataQuality, null, "a null dataQuality must stay null — the engine rejects on it");
  assert.equal(missing.confidence, null);
  assert.equal(missing.teams, null);
  assert.equal(missing.insufficientData, false);

  assert.equal(buildTicketCandidates(payload({ modelMeta: { dataQuality: NaN } })).dataQuality, null, "NaN is not a data quality");
  assert.equal(buildTicketCandidates(payload({ modelMeta: { dataQuality: 0 } })).dataQuality, 0, "zero is a real value, not an absence");
});

test("11b. insufficientData is strict === true", () => {
  assert.equal(buildTicketCandidates(payload({ insufficientData: true })).insufficientData, true);
  assert.equal(buildTicketCandidates(payload({ insufficientData: "yes" })).insufficientData, false);
  assert.equal(buildTicketCandidates(payload({ insufficientData: undefined })).insufficientData, false);
});

test("11c. a half-known teams object keeps the half it knows", () => {
  assert.deepEqual(buildTicketCandidates(payload({ teams: { home: "Only Home" } })).teams, { home: "Only Home", away: null });
  assert.equal(buildTicketCandidates(payload({ teams: {} })).teams, null);
  assert.equal(buildTicketCandidates(payload({ teams: ["a", "b"] })).teams, null);
});

test("12. deterministic and non-mutating for the same source object", () => {
  const p = payload({ valueEngine: { markets: [market({ type: "A" }), market({ type: "B", recommendable: false })] } });
  const before = JSON.stringify(p);
  const a = buildTicketCandidates(p);
  const b = buildTicketCandidates(p);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "key order must be stable — this value is persisted");
  assert.equal(JSON.stringify(p), before, "the source document must not be mutated");
});

test("12b. every value is JSON-serialisable, with no undefined", () => {
  const tc = buildTicketCandidates(payload({ modelMeta: {}, recommended: {}, teams: null }));
  for (const [k, v] of Object.entries(tc)) assert.notEqual(v, undefined, `${k} must never be undefined`);
  assert.deepEqual(JSON.parse(JSON.stringify(tc)), tc);
});

// ── the semantic guard ──────────────────────────────────────────────────────

test("13. SEMANTIC GUARD: stored markets === raw markets filtered by recommendable", () => {
  /*
    The contract in one assertion. Whatever the projection does, it must equal
    the naive filter over the full market array — no extra narrowing, no
    reordering, no substitution. The downstream engine is deliberately NOT run
    here; proving it agrees is the next increment's job.
  */
  const markets = [
    market({ type: "a" }),
    market({ type: "b", recommendable: false }),
    market({ type: "c", odds: 1.01 }),
    market({ type: "d", family: "cards" }),
    market({ type: "e", recommendable: false }),
    market({ type: "f", tradable: false })
  ];
  const p = payload({ valueEngine: { markets } });
  assert.deepEqual(buildTicketCandidates(p).markets, markets.filter((m) => m.recommendable === true));
});

// ── column plumbing ─────────────────────────────────────────────────────────

test("14. deriveTicketCandidatesColumn yields exactly one spreadable key", () => {
  const patch = deriveTicketCandidatesColumn(payload());
  assert.deepEqual(Object.keys(patch), ["ticket_candidates"]);
  assert.deepEqual(patch.ticket_candidates, buildTicketCandidates(payload()));
  assert.equal(deriveTicketCandidatesColumn(null).ticket_candidates, null);
});

test("15. the select names the columns the reader needs, and no payload", () => {
  assert.deepEqual(TICKET_CANDIDATE_COLUMNS, [
    "fixture_id", "league_id", "kickoff_at", "league_name", "model_version", "ticket_candidates"
  ]);
  assert.ok(!TICKET_CANDIDATE_SELECT.includes("raw_payload"));
  assert.ok(!TICKET_CANDIDATE_SELECT.includes("hydration_payload"));
  assert.ok(!TICKET_CANDIDATE_SELECT.includes("*"));
});

test("16. rehydrate rebuilds the exact shape the engine reads", () => {
  const tc = buildTicketCandidates(payload());
  const r = rehydrateTicketCandidateRow({
    fixture_id: 1234, league_id: 39, kickoff_at: "2026-08-09T18:00:00Z",
    league_name: "Premier League", model_version: "v3-test", ticket_candidates: tc
  });
  assert.equal(r.id, 1234);
  assert.equal(r.leagueId, 39);
  assert.equal(r.kickoff, "2026-08-09T18:00:00Z");
  assert.equal(r.league, "Premier League");
  assert.equal(r.modelVersion, "v3-test");
  assert.equal(r.modelMeta.dataQuality, 0.9);
  assert.equal(r.recommended.confidence, 68.4);
  assert.deepEqual(r.valueEngine.markets, tc.markets);
});

test("16b. a row with no projection rehydrates to null — never a raw_payload fallback", () => {
  assert.equal(rehydrateTicketCandidateRow({ fixture_id: 1, ticket_candidates: null }), null);
  assert.equal(rehydrateTicketCandidateRow({ fixture_id: 1 }), null);
  assert.equal(rehydrateTicketCandidateRow({ fixture_id: 1, ticket_candidates: [] }), null);
  assert.equal(rehydrateTicketCandidateRow(null), null);
});
