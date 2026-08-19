import test from "node:test";
import assert from "node:assert/strict";

import { shouldServeLightList } from "../api/history.js";
import {
  AGGREGATE_PAYLOAD_KEYS,
  HISTORY_LIST_PAYLOAD_KEYS,
  HISTORY_LIST_SELECT,
  mapDbRowToHistoryEntry,
  mapDbRowToHistoryListEntry,
  rehydrateListRow
} from "../server-utils/predictionsHistory.js";

/**
 * The opt-in light History list.
 *
 * /api/history is not only the History list — it is also a prediction source,
 * so the default stays FULL and only `?view=list` is light. These tests pin the
 * three things that would break silently: that the projection never asks for
 * the whole document, that the light mapper produces the same public row shape
 * as the full one, and that the analytical payload really is gone.
 */

/** The keys the aggregate reads, plus what the list itself renders. */
const REQUIRED_SCALARS = [
  "fixture_id",
  "league_id",
  "league_name",
  "kickoff_at",
  "home_team",
  "away_team",
  "score_home",
  "score_away",
  "validation",
  "match_status",
  "recommended_pick",
  "recommended_confidence",
  "saved_at",
  "model_version"
];

/** The heavy objects that must only ever come back from ?fixtureId=N. */
const HEAVY_KEYS = [
  "monteCarlo",
  "featureImportance",
  "predictionContributions",
  "explanation",
  "evaluation",
  "leagueProfile",
  "teamContext",
  "modelMeta",
  "valueEngine",
  "momentum",
  "liveEvents",
  "luckStats"
];

/** A full DB row as it exists today: small display keys plus a large tail. */
function fullDbRow(overrides = {}) {
  const heavy = {};
  for (const k of HEAVY_KEYS) heavy[k] = { padding: "x".repeat(2000) };
  return {
    fixture_id: 4242,
    league_id: 283,
    league_name: "Liga I",
    kickoff_at: "2026-08-01T18:00:00.000Z",
    home_team: "FCSB",
    away_team: "CFR",
    score_home: 2,
    score_away: 1,
    validation: "win",
    match_status: "FT",
    recommended_pick: "Over 2.5",
    recommended_confidence: 0.71,
    saved_at: "2026-08-01T21:00:00.000Z",
    model_version: "v3.2",
    raw_payload: {
      teams: { home: "FCSB", away: "CFR" },
      kickoff: "2026-08-01T18:00:00.000Z",
      league: "Liga I",
      leagueId: 283,
      logos: { home: "h.png", away: "a.png" },
      modelVersion: "v3.2",
      recommended: { pick: "Over 2.5", confidence: 0.71, odd: 1.85, family: "goals" },
      probs: { corners: 0.5, shotsOnTarget: 0.4 },
      marketOdds: { over25: 1.85 },
      marketResults: { cardsTotal: 4 },
      cardMarkets: { corners: "Over 8.5" },
      cardMarketValidations: { corners: "win" },
      score: { home: 2, away: 1 },
      status: "FT",
      validation: "win",
      ...heavy
    },
    ...overrides
  };
}

/** What PostgREST returns for `pl_<key>:raw_payload-><key>`. */
function projectedRow(row = fullDbRow()) {
  const out = {};
  for (const col of REQUIRED_SCALARS) out[col] = row[col];
  for (const key of HISTORY_LIST_PAYLOAD_KEYS) out[`pl_${key}`] = row.raw_payload[key] ?? null;
  return out;
}

test("the light projection never asks for the raw_payload column", () => {
  const columns = HISTORY_LIST_SELECT.split(",").map((c) => c.trim());
  assert.ok(!columns.includes("raw_payload"), "the whole JSONB document is still selected");
  assert.ok(!columns.includes("*"), "the projection is still a wildcard");
});

test("the light projection carries every scalar the list and aggregate read", () => {
  const columns = HISTORY_LIST_SELECT.split(",").map((c) => c.trim());
  for (const col of REQUIRED_SCALARS) {
    assert.ok(columns.includes(col), `projection is missing scalar column "${col}"`);
  }
});

test("the light projection carries every aggregate payload key as a JSON path", () => {
  // The aggregate contract is the one that must not regress: the list response
  // still returns `stats`, computed from these keys.
  for (const key of AGGREGATE_PAYLOAD_KEYS) {
    assert.ok(
      HISTORY_LIST_SELECT.includes(`pl_${key}:raw_payload->${key}`),
      `projection is missing aggregate key "${key}"`
    );
  }
  // logos is the one genuinely visual payload key the list renders.
  assert.ok(HISTORY_LIST_SELECT.includes("pl_logos:raw_payload->logos"), "logos is not projected");
});

test("the prefix keeps column and payload names from colliding", () => {
  // `validation`, `score` and `status` exist BOTH as columns and payload keys.
  for (const name of ["validation", "score", "status"]) {
    const bare = HISTORY_LIST_SELECT.split(",").map((c) => c.trim()).filter((c) => c === name);
    assert.equal(bare.length <= 1, true, `"${name}" appears ambiguously in the projection`);
    assert.ok(HISTORY_LIST_SELECT.includes(`pl_${name}:raw_payload->${name}`), `pl_${name} missing`);
  }
});

test("the light mapper produces the same public row shape as the full mapper", () => {
  const row = fullDbRow();
  const full = mapDbRowToHistoryEntry(row);
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(projectedRow(row)));

  // Every field the History list and its derivations read.
  for (const field of ["id", "leagueId", "league", "kickoff", "status", "savedAt", "validation", "modelVersion"]) {
    assert.deepEqual(light[field], full[field], `field "${field}" diverged from the full mapper`);
  }
  assert.deepEqual(light.teams, full.teams);
  assert.deepEqual(light.score, full.score);
  assert.deepEqual(light.recommended, full.recommended);
  assert.deepEqual(light.cardMarkets, full.cardMarkets);
  assert.deepEqual(light.cardMarketValidations, full.cardMarketValidations);
  assert.deepEqual(light.logos, full.logos);
});

test("the light mapper does not carry the analytical payload", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(projectedRow()));
  for (const key of HEAVY_KEYS) {
    assert.equal(light[key], undefined, `light row still exposes "${key}"`);
  }
  // A spread would have re-widened the contract; enumerated output cannot.
  const serialized = JSON.stringify(light);
  assert.ok(!serialized.includes("xxxxxxxxxx"), "heavy padding survived into the light row");
});

test("the light mapper keeps recommended.odd so the display gate still works", () => {
  // filterByMinDisplayOdds reads recommended.odd; losing it would silently let
  // sub-1.25 picks back into the list.
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(projectedRow()));
  assert.equal(light.recommended.odd, 1.85);
});

test("the light mapper falls back to scalar columns when payload keys are absent", () => {
  // Older rows predate parts of the payload; the full mapper falls back to
  // columns and the light one must do the same, in the same order.
  const bare = { ...projectedRow() };
  for (const key of HISTORY_LIST_PAYLOAD_KEYS) bare[`pl_${key}`] = null;
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(bare));

  assert.equal(light.id, 4242);
  assert.equal(light.league, "Liga I");
  assert.deepEqual(light.teams, { home: "FCSB", away: "CFR" });
  assert.equal(light.kickoff, "2026-08-01T18:00:00.000Z");
  assert.equal(light.status, "FT");
  assert.deepEqual(light.recommended, { pick: "Over 2.5", confidence: 0.71 });
  assert.equal(light.logos, null);
});

test("rehydrateListRow rebuilds the row shape the settlement helpers expect", () => {
  const row = fullDbRow();
  const rebuilt = rehydrateListRow(projectedRow(row));
  // The helpers reach into row.raw_payload; they must not be able to tell.
  for (const key of AGGREGATE_PAYLOAD_KEYS) {
    assert.deepEqual(rebuilt.raw_payload[key], row.raw_payload[key], `raw_payload.${key} not restored`);
  }
  assert.equal(rebuilt.validation, "win");
  assert.equal(rebuilt.match_status, "FT");
  // ...but the heavy tail is genuinely gone.
  for (const key of HEAVY_KEYS) assert.equal(rebuilt.raw_payload[key], undefined);
});

test("only the exact token `list` opts in", () => {
  assert.equal(shouldServeLightList({ view: "list" }), true);
  // The default must stay full for every existing caller shape.
  assert.equal(shouldServeLightList({}), false);
  assert.equal(shouldServeLightList(undefined), false);
  assert.equal(shouldServeLightList({ view: "" }), false);
  assert.equal(shouldServeLightList({ days: "30", limit: "2000", mine: "1" }), false);
  // view is a pre-existing parameter and its other value must be unaffected.
  assert.equal(shouldServeLightList({ view: "special-bets" }), false);
  assert.equal(shouldServeLightList({ view: "List" }), false);
});

test("the aggregate produces identical stats from light rows and full rows", async () => {
  // The list response still carries `stats`. If the projection dropped a key the
  // aggregate reads, the win/loss counters would drift silently — no error, just
  // wrong numbers on the dashboard.
  const { aggregateCardMarketStats } = await import("../server-utils/cardMarketSettlement.js");

  const rows = [
    fullDbRow(),
    fullDbRow({ fixture_id: 4243, validation: "loss", score_home: 0, score_away: 3 }),
    fullDbRow({ fixture_id: 4244, validation: "pending", match_status: "NS", score_home: null, score_away: null })
  ];
  const fromFull = aggregateCardMarketStats(rows);
  const fromLight = aggregateCardMarketStats(rows.map((r) => rehydrateListRow(projectedRow(r))));

  assert.deepEqual(fromLight, fromFull, "light rows produced different aggregate statistics");
});

test("the installed postgrest client really projects over the RPC", async () => {
  // readPredictionsHistoryListForUser depends on `?select=` applying to a
  // set-returning function. The RPC is `returns setof predictions_history` and is
  // deliberately NOT changed, so if this ever stopped working the user-scoped
  // list would silently fetch whole rows again.
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const client = new PostgrestClient("http://example.invalid");
  const query = client
    .rpc("predictions_history_for_user", { p_user_id: "u", p_days: 30, p_limit: 2000 })
    .select(HISTORY_LIST_SELECT);

  const url = decodeURIComponent(String(query.url));
  assert.ok(url.includes("/rpc/predictions_history_for_user"), "not an RPC call");
  assert.ok(url.includes("select="), "the projection was dropped from the RPC request");
  assert.ok(url.includes("pl_logos:raw_payload->logos"), "JSON path projection missing on the RPC");
  assert.ok(!url.includes("select=*"), "the RPC still asks for every column");
});
