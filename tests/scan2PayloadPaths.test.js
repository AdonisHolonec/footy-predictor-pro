/**
 * History sync scan 2 (`scan_resettle`) — raw_payload path projection.
 *
 * The 2026-09-08 15:20Z sync died on this select: full `raw_payload` on every
 * finished row with a NULL/pending value-bet validation, ~35 MB per 100-row
 * page, cancelled by PostgREST's 8 s statement_timeout (SQLSTATE 57014).
 *
 * Four layers, mirroring tests/egressPayloadPaths.test.js:
 *
 *   1. Spec: the seven leaf paths are exactly the `raw.*` reads of the loop.
 *   2. Wire: SCAN2_SELECT names raw_payload only through `->` subpaths, and
 *      api/history.js uses that constant — a literal full-column select can
 *      not creep back into scan 2.
 *   3. Shape: a projected page rehydrates to the nested object the decision
 *      has always read, and to nothing else.
 *   4. Equivalence: the REAL decision (`resolveResettleUpdate`, the loop body
 *      moved verbatim) produces deep-equal output on a full-document row and
 *      on a projected+rehydrated row — including the fallback chain
 *      `valueBet.type || valueEngine.bestMarket.type || valueEngine.type`,
 *      which is why the promoted `value_bet_type` column was NOT used.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  payloadPathSelect,
  selectWithPayloadPaths,
  rehydratePayloadPaths,
  rehydratePayloadPathRows
} from "../server-utils/history/payloadProjection.js";
import { SCAN2_PAYLOAD_PATHS, SCAN2_SCALAR_COLUMNS } from "../server-utils/history/scan2PayloadPaths.js";
import { SCAN2_SELECT, resolveResettleUpdate } from "../api/history.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * What PostgREST returns for `alias:raw_payload->a->b`: jsonb `->` semantics
 * (missing key, non-object parent, or stored null -> null) and a JSON
 * round-trip of the whole row, exactly like the wire.
 */
function simulateProjectedRow(fullRow, spec) {
  const out = {};
  for (const [key, value] of Object.entries(fullRow)) {
    if (key !== "raw_payload") out[key] = value;
  }
  for (const [alias, segments] of Object.entries(spec)) {
    let v = fullRow.raw_payload;
    for (const segment of segments) {
      v = v != null && typeof v === "object" && !Array.isArray(v) ? v[segment] : null;
      if (v === undefined) v = null;
    }
    out[alias] = v === undefined ? null : v;
  }
  return JSON.parse(JSON.stringify(out));
}

const projectAndRehydrate = (fullRow) =>
  rehydratePayloadPaths(simulateProjectedRow(fullRow, SCAN2_PAYLOAD_PATHS), SCAN2_PAYLOAD_PATHS);

/** Strip the per-call timestamp so two runs of the decision can be compared. */
function decisionOf(row) {
  const out = resolveResettleUpdate(row);
  if (out === null) return null;
  assert.match(out.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const { updated_at: _updatedAt, ...rest } = out;
  return rest;
}

/** ~300 KB of document the projection must be able to drop without changing anything. */
const HEAVY_JUNK = {
  predictions: { oneXtwo: "1", markets: Array.from({ length: 50 }, (_, i) => ({ i, p: i / 50 })) },
  modelMeta: { debug: { motivation: "x".repeat(2000) } },
  momentum: Array.from({ length: 200 }, (_, i) => ({ t: i, h: i % 3, a: i % 5 })),
  cardMarkets: { yellow: { line: 3.5 } },
  probs: { p1: 40, pX: 30, p2: 30 }
};

function makeRow(overrides = {}, payloadOverrides = {}) {
  return {
    fixture_id: 1635609,
    recommended_pick: "1",
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    validation: "win",
    value_bet_validation: null,
    raw_payload: {
      ...HEAVY_JUNK,
      valueBet: { type: "1", kelly: 1.9, ev: 12 },
      valueEngine: {
        bestMarket: { type: "1", odds: 2.1 },
        type: "1",
        markets: Array.from({ length: 80 }, (_, i) => ({ market: `m${i}`, odds: 1 + i / 10 }))
      },
      recommended: { pick: "1", family: "1X2", confidence: 61 },
      marketResults: { cornersTotal: 9, shotsOnTargetTotal: 8, shotsTotal: 24, cardsTotal: 4 },
      ...payloadOverrides
    },
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. Spec
// ---------------------------------------------------------------------------

test("the spec is exactly the seven leaf paths the scan-2 loop dereferences", () => {
  assert.deepEqual(SCAN2_PAYLOAD_PATHS, {
    vbType: ["valueBet", "type"],
    veBestMarketType: ["valueEngine", "bestMarket", "type"],
    veType: ["valueEngine", "type"],
    recFamily: ["recommended", "family"],
    mrCornersTotal: ["marketResults", "cornersTotal"],
    mrShotsOnTargetTotal: ["marketResults", "shotsOnTargetTotal"],
    mrShotsTotal: ["marketResults", "shotsTotal"]
  });
  assert.ok(Object.isFrozen(SCAN2_PAYLOAD_PATHS));
  for (const segments of Object.values(SCAN2_PAYLOAD_PATHS)) assert.ok(Object.isFrozen(segments));
});

test("the scalar columns are the ones the full-document select carried, minus the document", () => {
  assert.equal(
    SCAN2_SCALAR_COLUMNS,
    "fixture_id, recommended_pick, match_status, score_home, score_away, validation, value_bet_validation"
  );
});

// ---------------------------------------------------------------------------
// 2. Wire
// ---------------------------------------------------------------------------

test("SCAN2_SELECT transports every required path and never the full column", () => {
  assert.equal(SCAN2_SELECT, selectWithPayloadPaths(SCAN2_SCALAR_COLUMNS, SCAN2_PAYLOAD_PATHS));
  assert.ok(SCAN2_SELECT.startsWith(SCAN2_SCALAR_COLUMNS + ", "));
  for (const fragment of [
    "vbType:raw_payload->valueBet->type",
    "veBestMarketType:raw_payload->valueEngine->bestMarket->type",
    "veType:raw_payload->valueEngine->type",
    "recFamily:raw_payload->recommended->family",
    "mrCornersTotal:raw_payload->marketResults->cornersTotal",
    "mrShotsOnTargetTotal:raw_payload->marketResults->shotsOnTargetTotal",
    "mrShotsTotal:raw_payload->marketResults->shotsTotal"
  ]) {
    assert.ok(SCAN2_SELECT.includes(fragment), `missing ${fragment} in ${SCAN2_SELECT}`);
  }
  assert.equal(SCAN2_SELECT.match(/raw_payload(?!->)/g), null, "no bare raw_payload");
  assert.ok(!/raw_payload->valueEngine(?!->)/.test(SCAN2_SELECT), "valueEngine is 267.7 KB; never whole");
  assert.equal(SCAN2_SELECT.split("raw_payload->").length - 1, 7, "exactly seven projected paths");
  assert.equal(payloadPathSelect(SCAN2_PAYLOAD_PATHS).split(", ").length, 7);
});

test("api/history.js scan 2 selects SCAN2_SELECT and rehydrates before deciding", () => {
  const source = fs.readFileSync(path.join(HERE, "..", "api", "history.js"), "utf8");
  const start = source.indexOf('"scan2Ms", "scan_resettle"');
  assert.ok(start > 0, "scan 2 phase must exist");
  const end = source.indexOf("upsert2Ms", start);
  assert.ok(end > start, "scan 2 must be followed by the resettle upsert");
  // Comments explain the fix and may name the column; the assertion is about CODE.
  const scan2 = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(scan2.includes(".select(SCAN2_SELECT)"), "scan 2 must select the projected shape");
  assert.ok(!scan2.includes("raw_payload"), "no raw_payload literal may remain inside scan 2");
  assert.ok(
    scan2.includes("rehydratePayloadPathRows(page, SCAN2_PAYLOAD_PATHS)"),
    "the page must be folded back under raw_payload before the decision"
  );
  assert.ok(scan2.includes("resolveResettleUpdate(row)"), "the decision must be the exported one");
  // Filter and pagination are untouched.
  for (const clause of [
    '.gte("kickoff_at", cutoff)',
    '.in("match_status", ["FT", "AET", "PEN"])',
    '.or("value_bet_validation.is.null,value_bet_validation.eq.pending")',
    '.order("kickoff_at", { ascending: false })',
    '.order("fixture_id", { ascending: false })',
    ".range(offset, offset + scanChunkSize - 1)"
  ]) {
    assert.ok(scan2.includes(clause), `scan 2 must keep ${clause}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Shape
// ---------------------------------------------------------------------------

test("a projected page rehydrates to the nested shape the loop reads, and nothing else", () => {
  const full = makeRow();
  const wire = simulateProjectedRow(full, SCAN2_PAYLOAD_PATHS);
  assert.equal(wire.raw_payload, undefined, "the wire carries no document");
  assert.equal(wire.vbType, "1");
  assert.equal(wire.mrCornersTotal, 9);

  const [row] = rehydratePayloadPathRows([wire], SCAN2_PAYLOAD_PATHS);
  assert.deepEqual(row.raw_payload, {
    valueBet: { type: "1" },
    valueEngine: { bestMarket: { type: "1" }, type: "1" },
    recommended: { family: "1X2" },
    marketResults: { cornersTotal: 9, shotsOnTargetTotal: 8, shotsTotal: 24 }
  });
  for (const alias of Object.keys(SCAN2_PAYLOAD_PATHS)) {
    assert.ok(!(alias in row), `alias ${alias} must be folded away`);
  }
  for (const scalar of SCAN2_SCALAR_COLUMNS.split(", ")) {
    assert.equal(row[scalar], full[scalar], `scalar ${scalar} must survive`);
  }
  assert.equal(row.raw_payload.momentum, undefined, "junk is gone");
  assert.equal(row.raw_payload.valueEngine.markets, undefined, "the 267 KB block is gone");
});

test("missing, null and non-object parents rehydrate to absent keys, which the loop reads as undefined", () => {
  const cases = [
    makeRow({}, { valueBet: undefined, valueEngine: undefined, recommended: undefined, marketResults: undefined }),
    makeRow({}, { valueBet: null, valueEngine: null, recommended: null, marketResults: null }),
    makeRow({}, { valueBet: "1", valueEngine: ["x"], recommended: 7, marketResults: "9" }),
    makeRow(
      {},
      {
        valueBet: { type: null },
        valueEngine: { bestMarket: null, type: null },
        recommended: { family: null },
        marketResults: { cornersTotal: null }
      }
    ),
    makeRow({ raw_payload: null }),
    makeRow({ raw_payload: undefined })
  ];
  for (const full of cases) {
    const row = projectAndRehydrate(full);
    assert.deepEqual(row.raw_payload, {}, JSON.stringify(full.raw_payload));
    assert.equal(row.raw_payload.valueBet?.type, undefined);
    assert.equal(row.raw_payload.valueEngine?.bestMarket?.type, undefined);
    assert.equal(row.raw_payload.marketResults?.cornersTotal ?? null, null);
  }
});

// ---------------------------------------------------------------------------
// 4. Equivalence on the real decision
// ---------------------------------------------------------------------------

/** Each variant is a row scan 2 sees, named for the branch it exercises. */
const VARIANTS = [
  ["1X2 value bet, recommended already settled -> grades the value bet", makeRow()],
  [
    "FALLBACK: valueBet.type empty, bestMarket gradeable (Peste 3.5)",
    makeRow(
      { score_home: 3, score_away: 1, value_bet_type: null },
      { valueBet: { type: "", kelly: 2.1 }, valueEngine: { bestMarket: { type: "Peste 3.5" }, type: "Peste 3.5" } }
    )
  ],
  [
    "FALLBACK: valueBet absent, bestMarket absent, valueEngine.type gradeable (GG)",
    makeRow({ score_home: 1, score_away: 1 }, { valueBet: undefined, valueEngine: { type: "GG" } })
  ],
  [
    "FALLBACK: valueBet.type stored null, bestMarket 1X",
    makeRow({ score_home: 0, score_away: 0 }, { valueBet: { type: null }, valueEngine: { bestMarket: { type: "1X" } } })
  ],
  [
    "ungradeable market text (the whole current production set) -> untouched",
    makeRow({}, { valueBet: { type: "Shots Over 11.5" }, valueEngine: { bestMarket: { type: "Shots Over 11.5" } } })
  ],
  [
    "ungradeable first link must NOT fall through to a gradeable second link",
    makeRow({}, { valueBet: { type: "Correct Score 0-0" }, valueEngine: { bestMarket: { type: "1" } } })
  ],
  ["no score -> untouched", makeRow({ score_home: null })],
  ["not final -> untouched", makeRow({ match_status: "1H" })],
  ["already consistent -> untouched", makeRow({ value_bet_validation: "win", validation: "win" })],
  [
    "recommended pending on Corners, totals present -> graded from marketResults",
    makeRow({ validation: "pending", recommended_pick: "Over 7.5" }, { recommended: { family: "Corners" } })
  ],
  [
    "recommended pending on Corners, totals ABSENT -> stays pending, value bet still graded",
    makeRow(
      { validation: "pending", recommended_pick: "Over 7.5" },
      { recommended: { family: "Corners" }, marketResults: undefined }
    )
  ],
  [
    "recommended pending on Shots, only shotsTotal matters",
    makeRow(
      { validation: "pending", recommended_pick: "Shots Under 26.5" },
      { recommended: { family: "Shots" }, marketResults: { shotsTotal: 24 } }
    )
  ],
  ["recommended family missing -> null family, same as before", makeRow({ validation: "half_loss" }, { recommended: {} })],
  ["document is null", makeRow({ raw_payload: null })],
  ["valueEngine is a string, not an object", makeRow({}, { valueBet: { type: "" }, valueEngine: "broken" })],
  ["numeric type survives the JSON round-trip", makeRow({}, { valueBet: { type: 1 } })]
];

test("resolveResettleUpdate is identical on full vs projected rows, on every variant", () => {
  for (const [label, full] of VARIANTS) {
    const projected = projectAndRehydrate(full);
    assert.deepEqual(decisionOf(projected), decisionOf(full), label);
  }
});

test("pinned outcomes: the fallback chain grades exactly as before, on the projected shape", () => {
  const byLabel = new Map(VARIANTS);
  const expect = (label, want) => {
    const full = byLabel.get(label);
    assert.ok(full, `unknown variant ${label}`);
    assert.deepEqual(decisionOf(projectAndRehydrate(full)), want, label);
  };
  const graded = { fixture_id: 1635609, validation: "win", value_bet_validation: "win" };
  expect("1X2 value bet, recommended already settled -> grades the value bet", graded);
  expect("FALLBACK: valueBet.type empty, bestMarket gradeable (Peste 3.5)", graded);
  expect("FALLBACK: valueBet absent, bestMarket absent, valueEngine.type gradeable (GG)", graded);
  expect("FALLBACK: valueBet.type stored null, bestMarket 1X", graded);
  expect("ungradeable market text (the whole current production set) -> untouched", null);
  expect("ungradeable first link must NOT fall through to a gradeable second link", null);
  expect("no score -> untouched", null);
  expect("not final -> untouched", null);
  expect("already consistent -> untouched", null);
  expect("recommended pending on Corners, totals present -> graded from marketResults", graded);
  expect("recommended pending on Corners, totals ABSENT -> stays pending, value bet still graded", {
    fixture_id: 1635609,
    validation: "pending",
    value_bet_validation: "win"
  });
  expect("document is null", null);
  expect("valueEngine is a string, not an object", null);
});

test("REGRESSION: the promoted value_bet_type column is irrelevant; the document chain decides", () => {
  /*
    Production 2026-09-09: 34 rows carry valueBet.type = "" with a gradeable
    valueEngine.bestMarket.type, 12 of them written after the dual-write went
    live. Their value_bet_type column is NULL by design (060: "" -> NULL). Had
    scan 2 switched to the column, these rows would never be graded. The row
    below is that shape, with the column present and NULL, and it must grade.
  */
  const full = makeRow(
    { score_home: 2, score_away: 2, value_bet_type: null, value_bet_validation: null },
    { valueBet: { type: "", kelly: 1.4 }, valueEngine: { bestMarket: { type: "X" }, type: "X" } }
  );
  const wire = simulateProjectedRow(full, SCAN2_PAYLOAD_PATHS);
  assert.equal(wire.vbType, "", "the empty string travels as-is, not as null");
  assert.equal(wire.value_bet_type, null, "the column is on the row and says nothing");
  const [row] = rehydratePayloadPathRows([wire], SCAN2_PAYLOAD_PATHS);
  assert.deepEqual(decisionOf(row), { fixture_id: 1635609, validation: "win", value_bet_validation: "win" });
  assert.deepEqual(decisionOf(row), decisionOf(full));

  // And a column SET to something gradeable must not rescue an ungradeable document.
  const stale = makeRow(
    { value_bet_type: "1" },
    { valueBet: { type: "SOT Over 8.5" }, valueEngine: { bestMarket: { type: "SOT Over 8.5" } } }
  );
  assert.equal(decisionOf(projectAndRehydrate(stale)), null);
});

test("a page of mixed rows yields the same update list, in order, as the full-document page", () => {
  const page = VARIANTS.map(([, row], i) => ({ ...row, fixture_id: 1000 + i }));
  const fromFull = page.map(decisionOf).filter(Boolean);
  const fromWire = rehydratePayloadPathRows(
    page.map((r) => simulateProjectedRow(r, SCAN2_PAYLOAD_PATHS)),
    SCAN2_PAYLOAD_PATHS
  )
    .map(decisionOf)
    .filter(Boolean);
  assert.deepEqual(fromWire, fromFull);
  assert.ok(fromFull.length >= 6, "the variants must exercise the update path");
});
