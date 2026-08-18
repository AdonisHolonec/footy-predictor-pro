/**
 * The public history aggregate used to select the raw_payload COLUMN — ~134KB
 * per row — to produce a ~130 byte win/loss summary, which crossed Postgres'
 * statement_timeout and made GET /api/history?days=30 fail intermittently.
 *
 * It now projects only the nine payload keys the settlement helpers read. These
 * tests pin the thing that actually matters: the narrowed projection must
 * produce byte-identical statistics to the wholesale read.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  AGGREGATE_PAYLOAD_KEYS,
  AGGREGATE_STATS_SELECT,
  rehydrateAggregateRow
} from "../server-utils/predictionsHistory.js";
import { aggregateCardMarketStats } from "../server-utils/cardMarketSettlement.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Stand-in for the ~134KB of fixture detail the aggregate never reads. */
const BALLAST = {
  h2h: Array.from({ length: 40 }, (_, i) => ({ id: i, home: 1, away: 2 })),
  lineups: { home: ["a", "b", "c"], away: ["d", "e", "f"] },
  momentumTimeline: Array.from({ length: 90 }, (_, i) => ({ minute: i, value: i % 7 })),
  teamStats: { home: { xg: 1.7, form: "WWDLW" }, away: { xg: 0.9, form: "LDLLW" } },
  narrative: "x".repeat(2000),
  weather: { tempC: 21, wind: 4 },
  referee: { name: "Synthetic Ref", cardsAvg: 4.2 }
};

/** Rows shaped exactly as `select ..., raw_payload` returned them. */
const FULL_ROWS = [
  {
    // Stored validations, one still pending, match final + totals present:
    // exercises the re-settle branch (marketResults, cardMarkets, score, status).
    validation: "win",
    match_status: "FT",
    score_home: 3,
    score_away: 1,
    recommended_pick: "over 2.5",
    raw_payload: {
      ...BALLAST,
      status: "FT",
      score: { home: 3, away: 1 },
      validation: "win",
      cardMarkets: {
        recommended: { pick: "over 2.5", family: "goals" },
        goals: { pick: "over 1.5", side: "over", line: 1.5 },
        corners: { pick: "over 8.5", side: "over", line: 8.5 },
        shots: null
      },
      cardMarketValidations: { recommended: "win", goals: "win", corners: "pending", shots: null },
      marketResults: { cornersTotal: 11, shotsOnTargetTotal: 8 },
      recommended: { pick: "over 2.5", family: "goals" }
    }
  },
  {
    // Legacy row: no stored validations, so picks are DERIVED from probs +
    // marketOdds inside deriveCardMarketPicks(payload).
    validation: null,
    match_status: "FT",
    score_home: 0,
    score_away: 0,
    recommended_pick: "under 2.5",
    raw_payload: {
      ...BALLAST,
      status: "FT",
      score: { home: 0, away: 0 },
      recommended: { pick: "under 2.5", family: "goals" },
      probs: {
        pO15: 55,
        pU15: 45,
        pO25: 38,
        pU25: 62,
        pU35: 80,
        corners: { total: 9.4 },
        shotsOnTarget: { total: 7.1 }
      },
      marketOdds: { corners: { line: 9.5 }, shotsOnTarget: { line: 7.5 } }
    }
  },
  {
    // Legacy fallback: nothing derivable, graded from the row's validation column.
    validation: "loss",
    match_status: "FT",
    score_home: 1,
    score_away: 2,
    recommended_pick: "",
    raw_payload: { ...BALLAST, status: "FT", score: { home: 1, away: 2 } }
  },
  {
    // raw_payload absent entirely — the helpers fall back to row columns.
    validation: "win",
    match_status: "FT",
    score_home: 2,
    score_away: 0,
    recommended_pick: "over 1.5",
    raw_payload: null
  },
  {
    // Still pending: must count as neither a win nor a loss.
    validation: "pending",
    match_status: "NS",
    score_home: null,
    score_away: null,
    recommended_pick: "over 2.5",
    raw_payload: {
      ...BALLAST,
      status: "NS",
      cardMarketValidations: { recommended: "pending", goals: "pending", corners: null, shots: null }
    }
  }
];

/** Exactly what PostgREST returns for `pl_<key>:raw_payload-><key>`. */
function projectAsPostgrest(row) {
  const projected = {
    validation: row.validation,
    match_status: row.match_status,
    score_home: row.score_home,
    score_away: row.score_away,
    recommended_pick: row.recommended_pick
  };
  for (const key of AGGREGATE_PAYLOAD_KEYS) {
    // `->` on a NULL column, or on a missing key, yields null.
    projected[`pl_${key}`] = row.raw_payload ? (row.raw_payload[key] ?? null) : null;
  }
  return projected;
}

test("projected + rehydrated rows produce IDENTICAL stats to the wholesale raw_payload read", () => {
  const before = aggregateCardMarketStats(FULL_ROWS);
  const after = aggregateCardMarketStats(FULL_ROWS.map(projectAsPostgrest).map(rehydrateAggregateRow));
  assert.deepEqual(after, before);
  // Guard against a vacuous pass: the fixture must actually settle something.
  assert.ok(before.settled > 0, "fixture should produce settled markets");
});

test("every row individually agrees — no single payload shape regresses", () => {
  for (const [index, row] of FULL_ROWS.entries()) {
    const before = aggregateCardMarketStats([row]);
    const after = aggregateCardMarketStats([rehydrateAggregateRow(projectAsPostgrest(row))]);
    assert.deepEqual(after, before, `row ${index} diverged`);
  }
});

test("payload ballast the aggregate never reads cannot change the result", () => {
  // The whole point of the fix: dropping ~134KB of unread fixture detail is lossless.
  const stripped = FULL_ROWS.map((row) => {
    if (!row.raw_payload) return row;
    const kept = {};
    for (const key of AGGREGATE_PAYLOAD_KEYS) {
      if (row.raw_payload[key] !== undefined) kept[key] = row.raw_payload[key];
    }
    return { ...row, raw_payload: kept };
  });
  assert.deepEqual(aggregateCardMarketStats(stripped), aggregateCardMarketStats(FULL_ROWS));
});

test("empty history stays an empty, zeroed aggregate", () => {
  const empty = { wins: 0, losses: 0, settled: 0, winRate: 0 };
  assert.deepEqual(aggregateCardMarketStats([]), empty);
  assert.deepEqual(aggregateCardMarketStats([].map(rehydrateAggregateRow)), empty);
});

test("rehydrateAggregateRow restores the row shape the settlement helpers expect", () => {
  const row = rehydrateAggregateRow({
    validation: "win",
    match_status: "FT",
    score_home: 2,
    score_away: 1,
    recommended_pick: "over 2.5",
    pl_status: "FT",
    pl_score: { home: 2, away: 1 },
    pl_cardMarketValidations: { recommended: "win", goals: null, corners: null, shots: null }
  });
  assert.equal(row.match_status, "FT");
  assert.equal(row.score_home, 2);
  assert.equal(row.recommended_pick, "over 2.5");
  assert.deepEqual(row.raw_payload.score, { home: 2, away: 1 });
  assert.equal(row.raw_payload.status, "FT");
  assert.deepEqual(row.raw_payload.cardMarketValidations, {
    recommended: "win",
    goals: null,
    corners: null,
    shots: null
  });
});

test("null / missing projections degrade exactly like an absent raw_payload", () => {
  const row = rehydrateAggregateRow({ validation: null, match_status: null, pl_status: null, pl_score: null });
  assert.deepEqual(row.raw_payload, {}, "null projections must not become null-valued keys");
  assert.equal(row.score_home, null);
  assert.equal(row.recommended_pick, null);
  // Non-object input must not throw — PostgREST can hand back anything on error paths.
  assert.deepEqual(rehydrateAggregateRow(null).raw_payload, {});
  assert.deepEqual(rehydrateAggregateRow(undefined).raw_payload, {});
});

test("the projection covers every payload key the settlement helpers actually read", () => {
  // Traced in Phase 1: resolveCardMarketValidations + deriveCardMarketPicks.
  const required = [
    "cardMarketValidations",
    "cardMarkets",
    "marketOdds",
    "marketResults",
    "probs",
    "recommended",
    "score",
    "status",
    "validation"
  ];
  for (const key of required) {
    assert.ok(AGGREGATE_PAYLOAD_KEYS.includes(key), `missing payload projection: ${key}`);
    assert.ok(
      AGGREGATE_STATS_SELECT.includes(`raw_payload->${key}`),
      `select must project raw_payload->${key}`
    );
  }
});

test("the select keeps the scalar columns the helpers read off the row", () => {
  for (const column of ["validation", "match_status", "score_home", "score_away", "recommended_pick"]) {
    assert.ok(AGGREGATE_STATS_SELECT.includes(column), `select must keep column: ${column}`);
  }
});

test("REGRESSION GUARD: the aggregate must never select the raw_payload column wholesale", () => {
  // A bare `raw_payload` in the select list is the exact defect this PR removed:
  // it reinstates the ~134KB-per-row read and the statement timeout with it.
  const bare = /(^|[,\s(])raw_payload(?!\s*->)(?=\s*[,"'\s)]|$)/;
  assert.ok(!bare.test(AGGREGATE_STATS_SELECT), "AGGREGATE_STATS_SELECT reintroduced a wholesale raw_payload read");

  const source = readFileSync(join(HERE, "..", "server-utils", "predictionsHistory.js"), "utf8");
  const start = source.indexOf("export async function readPredictionsHistoryAggregateStats");
  assert.ok(start > -1, "aggregate function not found");
  const body = source.slice(start, source.indexOf("\n}", start));
  assert.ok(
    !/\.select\([^)]*\braw_payload\b(?!\s*->)/.test(body),
    "readPredictionsHistoryAggregateStats must not select the raw_payload column directly"
  );
});
