/**
 * Egress payload projection — the raw_payload paths PR.
 *
 * Three layers of protection:
 *
 *   1. Mechanism: payloadPathSelect / rehydratePayloadPaths behave exactly like
 *      the block variant they extend (null contract, new-object contract).
 *   2. Wire shape: every select constant the optimized readers use names
 *      raw_payload ONLY through `->` subpaths — the full column can never come
 *      back silently.
 *   3. Projection equivalence: for each optimized consumer chain, running the
 *      REAL consumer on a full-document row and on a projected+rehydrated row
 *      produces deep-equal output. The projection is simulated with jsonb `->`
 *      semantics (missing key -> null, JSON round-trip), which is what
 *      PostgREST does on the wire.
 *
 * If a consumer starts reading a new payload key, the equivalence tests here
 * fail before production silently reads `undefined` — this file is the pin the
 * payloadPaths.js "RULE" comments point at.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  payloadPathSelect,
  selectWithPayloadPaths,
  rehydratePayloadPaths,
  rehydratePayloadPathRows
} from "../server-utils/history/payloadProjection.js";
import { ANALYTICS_PAYLOAD_PATHS, TIP_PAYLOAD_PATHS } from "../server-utils/backtest/payloadPaths.js";
import { buildBacktestReport, extractBetEvent } from "../server-utils/backtest/BacktestAnalytics.js";
import { resolvePublishedTip } from "../server-utils/backtest/TipEvent.js";
import { projectMetaRows } from "../server-utils/metaLearning/MetaSelectionProjector.js";
import {
  ANALYTICS_HISTORY_SELECT,
  SNAPSHOT_HISTORY_SELECT,
  TIP_HISTORY_SELECT
} from "../api/backtest.js";
import {
  ALERTS_PAYLOAD_PATHS,
  ALERTS_HISTORY_SELECT,
  reasonCodesFromRow
} from "../api/alerts.js";
import { META_HISTORY_PAYLOAD_PATHS } from "../server-utils/metaLearning/runMetaLearningRefresh.js";

/**
 * Simulate what PostgREST returns for `alias:raw_payload->a->b`: walk with
 * jsonb `->` semantics (missing key or non-object -> null), then JSON
 * round-trip the whole row exactly like the wire does.
 */
function simulateProjectedRow(fullRow, spec) {
  const out = {};
  for (const [key, value] of Object.entries(fullRow)) {
    if (key !== "raw_payload") out[key] = value;
  }
  for (const [alias, path] of Object.entries(spec)) {
    let v = fullRow.raw_payload;
    for (const segment of path) {
      v = v != null && typeof v === "object" && !Array.isArray(v) ? v[segment] : null;
      if (v === undefined) v = null;
    }
    out[alias] = v === undefined ? null : v;
  }
  return JSON.parse(JSON.stringify(out));
}

const projectAndRehydrate = (fullRow, spec) =>
  rehydratePayloadPaths(simulateProjectedRow(fullRow, spec), spec);

/** A select string may mention raw_payload only as a `raw_payload->` subpath. */
function assertNoFullPayload(select, label) {
  const bare = select.match(/raw_payload(?!->)/g);
  assert.equal(bare, null, `${label} must not transport the full raw_payload column: ${select}`);
}

// ---------------------------------------------------------------------------
// 1. Mechanism
// ---------------------------------------------------------------------------

test("payloadPathSelect builds aliased subpath fragments", () => {
  const spec = { a: ["x"], deep: ["y", "z"] };
  assert.equal(payloadPathSelect(spec), "a:raw_payload->x, deep:raw_payload->y->z");
  assert.equal(payloadPathSelect({}), "");
  assert.equal(selectWithPayloadPaths("c1, c2", spec), "c1, c2, a:raw_payload->x, deep:raw_payload->y->z");
  assert.equal(selectWithPayloadPaths("c1", {}), "c1");
});

test("rehydratePayloadPaths rebuilds nesting, drops aliases, keeps scalars, skips nulls", () => {
  const spec = { vb: ["valueBet"], deep: ["modelMeta", "driftPenalty"], gone: ["missing", "key"] };
  const row = { fixture_id: 7, vb: { type: "1" }, deep: 24, gone: null };
  const out = rehydratePayloadPaths(row, spec);
  assert.deepEqual(out, {
    fixture_id: 7,
    raw_payload: { valueBet: { type: "1" }, modelMeta: { driftPenalty: 24 } }
  });
  // aliases never leak onto the row alongside raw_payload
  assert.ok(!("vb" in out) && !("deep" in out) && !("gone" in out));
  // input row is not mutated
  assert.deepEqual(row, { fixture_id: 7, vb: { type: "1" }, deep: 24, gone: null });
});

test("rehydratePayloadPathRows tolerates non-arrays and empty rows", () => {
  assert.deepEqual(rehydratePayloadPathRows(null, { a: ["x"] }), []);
  assert.deepEqual(rehydratePayloadPathRows([{}], { a: ["x"] }), [{ raw_payload: {} }]);
});

test("two paths sharing a parent merge under one object", () => {
  const spec = { p1: ["modelMeta", "driftPenalty"], p2: ["modelMeta", "dataQuality"] };
  const out = rehydratePayloadPaths({ p1: 10, p2: 0.4 }, spec);
  assert.deepEqual(out.raw_payload, { modelMeta: { driftPenalty: 10, dataQuality: 0.4 } });
});

// ---------------------------------------------------------------------------
// 2. Wire shape — the egress-safety assertions
// ---------------------------------------------------------------------------

test("every optimized select transports raw_payload only via -> subpaths", () => {
  assertNoFullPayload(ANALYTICS_HISTORY_SELECT, "ANALYTICS_HISTORY_SELECT");
  assertNoFullPayload(SNAPSHOT_HISTORY_SELECT, "SNAPSHOT_HISTORY_SELECT");
  assertNoFullPayload(TIP_HISTORY_SELECT, "TIP_HISTORY_SELECT");
  assertNoFullPayload(ALERTS_HISTORY_SELECT, "ALERTS_HISTORY_SELECT");
  assertNoFullPayload(
    selectWithPayloadPaths("fixture_id", META_HISTORY_PAYLOAD_PATHS),
    "META_HISTORY_PAYLOAD_PATHS"
  );
});

test("optimized selects keep their load-bearing promoted columns", () => {
  for (const select of [ANALYTICS_HISTORY_SELECT, SNAPSHOT_HISTORY_SELECT, TIP_HISTORY_SELECT]) {
    // 066: analytics eligibility must stay on the wire.
    assert.ok(select.includes("recommended_market_valid"), select);
  }
  assert.ok(TIP_HISTORY_SELECT.includes("model_version"));
  assert.ok(ALERTS_HISTORY_SELECT.startsWith("kickoff_at"));
});

test("valueEngine is never selected as a whole block (267.7 KB/row)", () => {
  for (const select of [
    ANALYTICS_HISTORY_SELECT,
    SNAPSHOT_HISTORY_SELECT,
    TIP_HISTORY_SELECT,
    ALERTS_HISTORY_SELECT
  ]) {
    assert.ok(!/raw_payload->valueEngine(?!->)/.test(select), select);
  }
});

// ---------------------------------------------------------------------------
// 3. Projection equivalence on realistic rows
// ---------------------------------------------------------------------------

/** Junk blocks stand in for the ~300 KB the projection must be able to drop. */
const HEAVY_JUNK = {
  markets: [
    { type: "Over 2.5", probability: 61.2 },
    { type: "GG", probability: 55.1 }
  ],
  momentum: { series: [1, 2, 3] },
  lambdas: { home: 1.42, away: 1.11 },
  auditLog: { reasonCodes: ["drift_penalty"], steps: ["s1", "s2"] },
  valueEngine: {
    bestMarket: { type: "x2", odds: 2.05, expectedValue: 0.11 },
    odds: 2.05,
    type: "x2",
    expectedValue: 0.11,
    confidencePct: 58,
    markets: [{ type: "1", ev: -0.2 }],
    positiveMarkets: [{ type: "x2", ev: 0.11 }],
    negativeMarkets: [{ type: "1", ev: -0.2 }]
  }
};

function makeHistoryRow(overrides = {}, payloadOverrides = {}) {
  return {
    fixture_id: 1001,
    league_id: 39,
    league_name: "Premier League",
    home_team: "Home FC",
    away_team: "Away FC",
    kickoff_at: "2026-08-20T19:00:00+00:00",
    model_version: "v3-dc-bp-shin-2026-04",
    validation: "win",
    value_bet_validation: "loss",
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    odds_home: 2.1,
    odds_draw: 3.3,
    odds_away: 3.6,
    closing_odds_home: 2.0,
    closing_odds_draw: 3.4,
    closing_odds_away: 3.8,
    recommended_pick: "1",
    recommended_odd: 2.1,
    recommended_confidence: 61,
    recommended_market_valid: true,
    raw_payload: {
      ...HEAVY_JUNK,
      recommended: { pick: "1", odd: 2.1, confidence: 61, family: "1x2" },
      probs: { p1: 55.2, pX: 24.1, p2: 20.7, pGG: 51.0, pO25: 54.4 },
      score: { home: 2, away: 1 },
      confidence: 61,
      kickoffAt: "2026-08-20T19:00:00+00:00",
      modelMeta: {
        modelVersion: "v3-dc-bp-shin-2026-04",
        driftPenalty: 26,
        dataQuality: 0.41,
        reasonCodes: ["low_data_quality"]
      },
      evaluation: { modelProbs: { 1: 55.2, x2: 44.8 }, calibratedProbs: { 1: 53.9 } },
      valueBet: {
        type: "x2",
        prob: 44.8,
        odds: 2.05,
        kellyPct: 3.1,
        expectedValue: 0.08,
        confidence: 58,
        reasons: ["ev_positive"]
      },
      closingOdds: { home: 2.0, draw: 3.4, away: 3.8, dcx2: 1.78 },
      marketOdds: { closing: { X2: 1.79 }, opening: { X2: 1.9 } },
      ...payloadOverrides
    },
    ...overrides
  };
}

const ROW_VARIANTS = [
  makeHistoryRow(),
  // value-bet-only settle path, no closing odds anywhere
  makeHistoryRow(
    {
      validation: "loss",
      value_bet_validation: "win",
      closing_odds_home: null,
      closing_odds_draw: null,
      closing_odds_away: null
    },
    { closingOdds: null, marketOdds: null }
  ),
  // invalid recommended slot (066 exclusion) + missing blocks
  makeHistoryRow({ recommended_market_valid: false }, { valueBet: null, evaluation: null }),
  // payload present but unremarkable
  makeHistoryRow({}, {}),
  // whole document absent
  { ...makeHistoryRow(), raw_payload: null },
  // pending row: outcome resolved from score, prob from confidence fallback
  makeHistoryRow({ validation: "pending", value_bet_validation: null }, { probs: null })
];

test("analytics: buildBacktestReport is identical on full vs projected rows", () => {
  const full = buildBacktestReport(ROW_VARIANTS, {});
  const projected = buildBacktestReport(
    ROW_VARIANTS.map((row) => projectAndRehydrate(row, ANALYTICS_PAYLOAD_PATHS)),
    {}
  );
  assert.deepEqual(projected, full);
});

test("analytics: extractBetEvent is identical per row on full vs projected", () => {
  for (const row of ROW_VARIANTS) {
    const full = extractBetEvent(row);
    const projected = extractBetEvent(projectAndRehydrate(row, ANALYTICS_PAYLOAD_PATHS));
    assert.deepEqual(projected, full);
  }
});

test("tip track: resolvePublishedTip is identical on full vs projected rows", () => {
  for (const row of ROW_VARIANTS) {
    const full = resolvePublishedTip(row);
    const projected = resolvePublishedTip(projectAndRehydrate(row, TIP_PAYLOAD_PATHS));
    assert.deepEqual(projected, full);
  }
});

test("alerts: reason codes and modelMeta scalars are identical on full vs projected", () => {
  for (const row of ROW_VARIANTS) {
    const projected = projectAndRehydrate(row, ALERTS_PAYLOAD_PATHS);
    assert.deepEqual(reasonCodesFromRow(projected), reasonCodesFromRow(row));
    const fullMeta = row.raw_payload?.modelMeta || {};
    const projMeta = projected.raw_payload?.modelMeta || {};
    assert.deepEqual(
      { drift: projMeta.driftPenalty ?? null, quality: projMeta.dataQuality ?? null },
      { drift: fullMeta.driftPenalty ?? null, quality: fullMeta.dataQuality ?? null }
    );
  }
});

test("meta-learning: projectMetaRows is identical on full vs projected rows", () => {
  const providerIdByKey = new Map([
    ["predictor_v3", 1],
    ["api_football", 2]
  ]);
  const args = { benchmarkRows: [], modelVersion: "v3-dc-bp-shin-2026-04", providerIdByKey };
  const full = projectMetaRows({ historyRows: ROW_VARIANTS, ...args });
  const projected = projectMetaRows({
    historyRows: ROW_VARIANTS.map((row) => projectAndRehydrate(row, META_HISTORY_PAYLOAD_PATHS)),
    ...args
  });
  // computed_at is wall-clock at call time (1 ms apart between the two runs is
  // a flake, not a projection difference) — normalize it before comparing.
  const stripClock = (result) =>
    JSON.parse(
      JSON.stringify(result, (key, value) => (key === "computed_at" ? "<clock>" : value))
    );
  assert.deepEqual(stripClock(projected), stripClock(full));
});
