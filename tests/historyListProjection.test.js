import test from "node:test";
import assert from "node:assert/strict";

import { shouldServeLightList } from "../api/history.js";
import {
  HISTORY_LIST_PAYLOAD_KEYS,
  HISTORY_LIST_SELECT,
  mapDbRowToHistoryEntry,
  mapDbRowToHistoryListEntry,
  rehydrateListRow
} from "../server-utils/predictionsHistory.js";
import { filterByMinDisplayOdds } from "../server-utils/predictionDisplayGate.js";
import { aggregateCardMarketStats } from "../server-utils/cardMarketSettlement.js";

/**
 * The History read cutover.
 *
 * `?view=list` no longer reads `raw_payload` in any form — not the column, not
 * a `->key` extraction. Everything it returns comes from real columns: the
 * seven from migration 055, the four from 056, and the card markets Phase 4H
 * materialised on the 324 rows that predated creation-time attachment.
 *
 * /api/history is still also a prediction source, so the DEFAULT stays full and
 * only the explicit `view=list` token opts in. These tests pin that boundary,
 * the zero-payload contract, and the two things that would drift silently if
 * the contract regressed: the win/loss aggregate and the display-odds gate.
 */

/** Real columns the list projects. */
const REQUIRED_COLUMNS = [
  "fixture_id", "league_id", "league_name", "kickoff_at", "home_team", "away_team",
  "score_home", "score_away", "validation", "match_status", "recommended_pick",
  "recommended_confidence", "saved_at", "model_version",
  "recommended_odd", "logo_home", "logo_away", "card_markets",
  "card_market_validations", "corners_total", "shots_on_target_total",
  "recommended_family", "recommended_period", "recommended_scope", "recommended_book_line"
];

/** The heavy objects that must only ever come back from ?fixtureId=N. */
const HEAVY_KEYS = [
  "monteCarlo", "predictionLaboratory", "featureImportance", "confidenceEngine",
  "predictionContributions", "explanation", "evaluation", "leagueProfile",
  "teamContext", "modelMeta", "valueEngine", "momentum", "liveEvents",
  "luckStats", "odds", "probs", "marketOdds", "lambdas"
];

const CARD_MARKETS = {
  recommended: { pick: "Over 2.5", family: "Over/Under" },
  goals: { pick: "over 1.5", side: "over", line: 1.5, probability: 88.4 },
  corners: { pick: "under 9.5", side: "under", line: 9.5, probability: 71.2 },
  shots: { pick: "over 7.5", side: "over", line: 7.5, probability: 64.1 }
};
const CARD_VALIDATIONS = { recommended: "win", goals: "win", corners: "loss", shots: "win" };

/** A row as PostgREST returns it for the column-only projection. */
function columnRow(overrides = {}) {
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
    recommended_odd: 1.85,
    logo_home: "h.png",
    logo_away: "a.png",
    card_markets: CARD_MARKETS,
    card_market_validations: CARD_VALIDATIONS,
    corners_total: 9,
    shots_on_target_total: 8,
    recommended_family: "Over/Under",
    recommended_period: "full_match",
    recommended_scope: "match",
    recommended_book_line: 2.5,
    ...overrides
  };
}

/**
 * The same fixture as a FULL db row, so the two mappers can be compared. The
 * payload deliberately carries a heavy tail plus every key the old projection
 * used to extract.
 */
function fullDbRow(overrides = {}) {
  const col = columnRow(overrides);
  const heavy = {};
  for (const k of HEAVY_KEYS) heavy[k] = { padding: "x".repeat(2000) };
  return {
    ...col,
    raw_payload: {
      teams: { home: col.home_team, away: col.away_team },
      kickoff: col.kickoff_at,
      league: col.league_name,
      leagueId: col.league_id,
      logos: { home: col.logo_home, away: col.logo_away, league: "l.png" },
      modelVersion: col.model_version,
      recommended: {
        pick: col.recommended_pick,
        confidence: col.recommended_confidence,
        odd: col.recommended_odd,
        family: col.recommended_family,
        period: col.recommended_period,
        scope: col.recommended_scope,
        bookLine: col.recommended_book_line
      },
      marketResults: { cornersTotal: col.corners_total, shotsOnTargetTotal: col.shots_on_target_total },
      cardMarkets: col.card_markets,
      cardMarketValidations: col.card_market_validations,
      score: { home: col.score_home, away: col.score_away },
      status: col.match_status,
      validation: col.validation,
      ...heavy
    }
  };
}

/* ── the projection ───────────────────────────────────────────────────────── */

test("the list projection reads no raw_payload in any form", () => {
  assert.ok(!/raw_payload/.test(HISTORY_LIST_SELECT), "the projection still touches the document");
  const columns = HISTORY_LIST_SELECT.split(",").map((c) => c.trim());
  assert.ok(!columns.includes("*"), "the projection is a wildcard");
  assert.equal(HISTORY_LIST_PAYLOAD_KEYS.length, 0, "payload keys are still projected");
});

test("the list projection carries every column the list and aggregate read", () => {
  const columns = HISTORY_LIST_SELECT.split(",").map((c) => c.trim());
  for (const col of REQUIRED_COLUMNS) {
    assert.ok(columns.includes(col), `projection is missing column "${col}"`);
  }
  assert.equal(columns.length, REQUIRED_COLUMNS.length, "the projection grew unexpectedly");
});

/* ── the mapper ───────────────────────────────────────────────────────────── */

test("the light row exposes every field HistorySection and its derivations read", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow()));
  for (const field of ["id", "leagueId", "league", "teams", "kickoff", "status", "score",
    "recommended", "savedAt", "validation", "cardMarkets", "cardMarketValidations",
    "modelVersion", "logos"]) {
    assert.ok(field in light, `light row is missing "${field}"`);
  }
  assert.equal(light.id, 4242);
  assert.deepEqual(light.teams, { home: "FCSB", away: "CFR" });
  assert.deepEqual(light.score, { home: 2, away: 1 });
  assert.deepEqual(light.logos, { home: "h.png", away: "a.png" });
  assert.equal(light.kickoff, "2026-08-01T18:00:00.000Z");
  assert.equal(light.status, "FT");
});

test("the light row carries no raw_payload and no analytical field", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow()));
  assert.equal(light.raw_payload, undefined, "the light row still exposes raw_payload");
  for (const key of HEAVY_KEYS) {
    assert.equal(light[key], undefined, `light row still exposes "${key}"`);
  }
  assert.ok(!JSON.stringify(light).includes("xxxxxxxxxx"), "heavy padding reached the light row");
});

test("the light mapper cannot fall back to the document", () => {
  // Handed a row that has a fat raw_payload AND null columns, it must produce
  // the null-column answer. A `...payload` spread or an `?? payload.x` fallback
  // would quietly re-widen the contract the moment a key came back.
  const poisoned = {
    ...columnRow({ league_name: null, home_team: null, away_team: null, logo_home: null, logo_away: null }),
    raw_payload: {
      league: "SHOULD NOT APPEAR",
      teams: { home: "SHOULD NOT APPEAR", away: "SHOULD NOT APPEAR" },
      logos: { home: "SHOULD NOT APPEAR", away: "SHOULD NOT APPEAR" },
      monteCarlo: { padding: "x".repeat(2000) }
    }
  };
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(poisoned));
  assert.ok(!JSON.stringify(light).includes("SHOULD NOT APPEAR"), "the mapper read the document");
  assert.equal(light.league, "Necunoscut");
  assert.deepEqual(light.teams, { home: "Gazde", away: "Oaspeți" });
  assert.equal(light.logos, null);
});

test("the mapper reads no display field out of raw_payload", () => {
  /*
    rehydrateListRow already strips the document, so composing the two hides a
    mapper that peeks. This hands the MAPPER a row carrying a payload directly,
    which is what a changed adapter or a future refactor would do.

    The tripwire allows exactly the three keys the adapter puts there for
    resolveCardMarketValidations — that helper is settlement code this phase
    must not touch, and it legitimately reads them. Every OTHER key throws, so
    a single `source.raw_payload?.league` fails loudly instead of silently
    re-widening the contract.
  */
  const ALLOWED = new Set(["cardMarkets", "cardMarketValidations", "marketResults"]);
  const read = [];
  const tripwire = new Proxy(
    {
      cardMarkets: CARD_MARKETS,
      cardMarketValidations: CARD_VALIDATIONS,
      marketResults: { cornersTotal: 9, shotsOnTargetTotal: 8 }
    },
    {
      get(target, prop) {
        if (typeof prop === "symbol") return Reflect.get(target, prop);
        read.push(prop);
        if (!ALLOWED.has(prop)) {
          throw new Error(`the light mapper read a display field out of raw_payload.${String(prop)}`);
        }
        return Reflect.get(target, prop);
      }
    }
  );

  const withDocument = {
    ...columnRow({ league_name: null, home_team: null, away_team: null, logo_home: null, logo_away: null }),
    raw_payload: tripwire
  };
  const light = mapDbRowToHistoryListEntry(withDocument);

  // The null-column answers, not document ones.
  assert.equal(light.league, "Necunoscut");
  assert.deepEqual(light.teams, { home: "Gazde", away: "Oaspeți" });
  assert.equal(light.logos, null);
  assert.ok(read.length > 0, "the tripwire was never exercised");
});

test("the light row matches the full mapper on every field the list renders", () => {
  const row = fullDbRow();
  const full = mapDbRowToHistoryEntry(row);
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow()));

  for (const field of ["id", "leagueId", "league", "kickoff", "status", "savedAt", "validation", "modelVersion"]) {
    assert.deepEqual(light[field], full[field], `field "${field}" diverged from the full mapper`);
  }
  assert.deepEqual(light.teams, full.teams);
  assert.deepEqual(light.score, full.score);
  assert.deepEqual(light.cardMarkets, full.cardMarkets);
  assert.deepEqual(light.cardMarketValidations, full.cardMarketValidations);
  assert.deepEqual(light.recommended, full.recommended);
  // logos.league is the one documented loss: 055 promoted home/away only, and
  // no History consumer reads the league crest.
  assert.deepEqual(light.logos, { home: full.logos.home, away: full.logos.away });
});

test("recommended is assembled from columns, omitting absent metadata", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow()));
  assert.deepEqual(light.recommended, {
    pick: "Over 2.5", confidence: 0.71, odd: 1.85,
    family: "Over/Under", period: "full_match", scope: "match", bookLine: 2.5
  });

  // A legacy row predating the Market Identity Contract: the keys must be
  // ABSENT, not present-and-null, or formatRecommendedPick would render an
  // invented suffix for a row the server never classified.
  const legacy = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow({
    recommended_family: null, recommended_period: null, recommended_scope: null, recommended_book_line: null
  })));
  assert.deepEqual(legacy.recommended, { pick: "Over 2.5", confidence: 0.71, odd: 1.85 });
  for (const key of ["family", "period", "scope", "bookLine"]) {
    assert.ok(!(key in legacy.recommended), `"${key}" should be absent, not null`);
  }
});

/* ── card markets ─────────────────────────────────────────────────────────── */

test("card markets come from the promoted columns", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow()));
  assert.deepEqual(light.cardMarkets, CARD_MARKETS);
  assert.deepEqual(light.cardMarketValidations, CARD_VALIDATIONS);
});

test("the market-presence flags replace the probs object exactly", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow()));
  assert.equal(light.hasCornersMarket, true);
  assert.equal(light.hasShotsMarket, true);
  assert.equal(light.probs, undefined, "the light row still ships probs");

  const noMarkets = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow({
    card_markets: { recommended: { pick: "1" }, goals: null, corners: null, shots: null }
  })));
  assert.equal(noMarkets.hasCornersMarket, false);
  assert.equal(noMarkets.hasShotsMarket, false);
});

test("absent market totals stay absent rather than becoming zero", () => {
  // Number(null) is 0, and a fixture whose corners statistic never arrived must
  // not settle "Over 7.5" as a confident loss against data that does not exist.
  const rebuilt = rehydrateListRow(columnRow({ corners_total: null, shots_on_target_total: null }));
  assert.ok(!("marketResults" in rebuilt.raw_payload), "an empty marketResults was invented");

  const partial = rehydrateListRow(columnRow({ corners_total: 9, shots_on_target_total: null }));
  assert.deepEqual(partial.raw_payload.marketResults, { cornersTotal: 9, shotsOnTargetTotal: null });
});

/* ── the aggregate ────────────────────────────────────────────────────────── */

test("the aggregate is identical between the full and columns-only shapes", () => {
  const rows = [
    { full: fullDbRow(), col: columnRow() },
    {
      full: fullDbRow({ fixture_id: 4243, validation: "loss", score_home: 0, score_away: 3 }),
      col: columnRow({ fixture_id: 4243, validation: "loss", score_home: 0, score_away: 3 })
    },
    {
      full: fullDbRow({ fixture_id: 4244, validation: "pending", match_status: "NS", score_home: null, score_away: null }),
      col: columnRow({ fixture_id: 4244, validation: "pending", match_status: "NS", score_home: null, score_away: null })
    }
  ];
  const fromFull = aggregateCardMarketStats(rows.map((r) => r.full));
  const fromColumns = aggregateCardMarketStats(rows.map((r) => rehydrateListRow(r.col)));
  assert.deepEqual(fromColumns, fromFull, "columns-only rows produced different statistics");
  assert.ok(fromFull.settled > 0, "the fixture settled nothing, so the comparison proves nothing");
});

test("the aggregate still counts every card market, not just recommended", () => {
  // The Phase 4H materialisation exists so goals/corners/shots keep counting.
  // If the columns-only row collapsed to one outcome per fixture this would drop.
  const stats = aggregateCardMarketStats([rehydrateListRow(columnRow())]);
  assert.equal(stats.wins, 3, "goals/shots/recommended wins were lost");
  assert.equal(stats.losses, 1, "the corners loss was lost");
  assert.equal(stats.settled, 4);
});

/* ── the display-odds gate ────────────────────────────────────────────────── */

test("filterByMinDisplayOdds behaves identically on the light row", () => {
  const entry = (odd) => mapDbRowToHistoryListEntry(rehydrateListRow(columnRow({ recommended_odd: odd })));

  // >= 1.25 passes.
  assert.equal(filterByMinDisplayOdds([entry(1.85)]).length, 1, "a normal odd was filtered out");
  assert.equal(filterByMinDisplayOdds([entry(1.25)]).length, 1, "the boundary odd was filtered out");
  // < 1.25 is dropped.
  assert.equal(filterByMinDisplayOdds([entry(1.24)]).length, 0, "a sub-threshold odd survived");
  // 0 is a real stored value on 7 production rows and must not read as absent.
  assert.equal(filterByMinDisplayOdds([entry(0)]).length, 0, "a zero odd was treated as passing");
});

test("a NULL recommended_odd is absence, never zero", () => {
  const light = mapDbRowToHistoryListEntry(rehydrateListRow(columnRow({ recommended_odd: null })));
  assert.ok(!("odd" in light.recommended), "NULL became a present odd");
  assert.notEqual(light.recommended.odd, 0, "NULL was coerced to zero");
  // Whatever the gate does with an absent odd, it must do the same as it always
  // has — compared against the full mapper on a payload with no odd.
  const base = fullDbRow();
  const fullNoOdd = mapDbRowToHistoryEntry({
    ...base,
    raw_payload: { ...base.raw_payload, recommended: { pick: "Over 2.5", confidence: 0.71 } }
  });
  assert.equal(
    filterByMinDisplayOdds([light]).length,
    filterByMinDisplayOdds([fullNoOdd]).length,
    "the light row and the full row disagree on an absent odd"
  );
});

/* ── the caller boundary ──────────────────────────────────────────────────── */

test("only the exact token `list` opts in", () => {
  assert.equal(shouldServeLightList({ view: "list" }), true);
  // Every existing caller shape must stay on the FULL path.
  assert.equal(shouldServeLightList({}), false);
  assert.equal(shouldServeLightList(undefined), false);
  assert.equal(shouldServeLightList({ view: "" }), false);
  // The hydration request: days=14&limit=1000&mine=1, no view.
  assert.equal(shouldServeLightList({ days: "14", limit: "1000", mine: "1" }), false);
  // The dashboard list request.
  assert.equal(shouldServeLightList({ days: "30", limit: "2000", mine: "1", view: "list" }), true);
  assert.equal(shouldServeLightList({ view: "special-bets" }), false);
  assert.equal(shouldServeLightList({ view: "List" }), false);
});

test("the full mapper is untouched and still carries the whole document", () => {
  // Hydration and ?fixtureId=N both go through this one. If it ever started
  // slimming, prediction cards would degrade and hasLegacyPredictionShape could
  // re-trigger the fetch that produced the row.
  const full = mapDbRowToHistoryEntry(fullDbRow());
  for (const key of HEAVY_KEYS) {
    assert.ok(full[key], `the full mapper dropped "${key}"`);
  }
  assert.ok(full.probs, "the full mapper dropped probs");
  assert.ok(full.marketOdds, "the full mapper dropped marketOdds");
});

test("an empty result stays an empty list", () => {
  assert.deepEqual([].map(rehydrateListRow).map(mapDbRowToHistoryListEntry), []);
  assert.deepEqual(filterByMinDisplayOdds([]), []);
});

test("a malformed row does not throw", () => {
  for (const bad of [null, undefined, {}]) {
    const light = mapDbRowToHistoryListEntry(rehydrateListRow(bad));
    assert.equal(light.id, null);
    assert.deepEqual(light.teams, { home: "Gazde", away: "Oaspeți" });
    assert.deepEqual(light.recommended, { pick: "", confidence: 0 });
  }
});

test("the installed postgrest client really projects over the RPC", async () => {
  // readPredictionsHistoryListForUser depends on `?select=` applying to a
  // set-returning function. The RPC is `returns setof predictions_history` and
  // is deliberately NOT changed, so if this stopped working the user-scoped
  // list would silently fetch whole rows — raw_payload and all — again.
  const { PostgrestClient } = await import("@supabase/postgrest-js");
  const client = new PostgrestClient("http://example.invalid");
  const query = client
    .rpc("predictions_history_for_user", { p_user_id: "u", p_days: 30, p_limit: 2000 })
    .select(HISTORY_LIST_SELECT);

  const url = decodeURIComponent(String(query.url));
  assert.ok(url.includes("/rpc/predictions_history_for_user"), "not an RPC call");
  assert.ok(url.includes("select="), "the projection was dropped from the RPC request");
  assert.ok(url.includes("card_markets"), "the card-market column is missing from the RPC request");
  assert.ok(!url.includes("select=*"), "the RPC still asks for every column");
  assert.ok(!/raw_payload/.test(url), "the RPC request still names raw_payload");
});
