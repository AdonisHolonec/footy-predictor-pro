import { describe, expect, it } from "vitest";
import type { PredictionRow } from "../types";
import {
  PREDICTION_STORAGE_FIELDS,
  VALUE_ENGINE_STORAGE_FIELDS,
  projectPredictionForStorage
} from "./predictionListProjection";
import {
  PREDICTION_LIST_FIELDS,
  PREDICTION_LIST_VALUE_ENGINE_FIELDS,
  projectPredictionListRow
} from "../../server-utils/predictionListProjection.js";

/**
 * The two prediction contracts must not drift.
 *
 * The client narrows a row on its way into localStorage; the server narrows the
 * same row on its way onto the wire for `view=prediction-list`. They describe
 * one thing — what the prediction board needs — but live on opposite sides of a
 * boundary the client never crosses: nothing in `src/` imports `server-utils/`,
 * and every cross-boundary rule in this repository is a mirrored constant with a
 * comment asking the reader to remember.
 *
 * A comment is not a guarantee. This is the guarantee: the only file that
 * imports both, so a field added to one list and forgotten in the other fails
 * here instead of silently shipping a row the board cannot render.
 *
 * If the two ever legitimately diverge, this test is the place to say so
 * explicitly — not the place to delete.
 */

const CARD_MARKET = { type: "Cards Over 3.5", family: "Cards", probability: 62 };

function row(): PredictionRow {
  return {
    id: 1,
    leagueId: 283,
    league: "Liga I",
    teams: { home: "A", away: "B" },
    logos: { home: "h", away: "a" },
    kickoff: "2026-08-18T18:00:00+00:00",
    status: "NS",
    score: { home: null, away: null },
    validation: "pending",
    savedAt: "2026-08-18T09:00:00+00:00",
    modelVersion: "v3",
    recommended: { pick: "Over 2.5", confidence: 70, odd: 1.9 },
    probs: { corners: { total: 9.5 }, shotsOnTarget: { total: 8.5 } },
    predictions: { cards: "Over 3.5" },
    cardMarkets: {},
    cardMarketValidations: {},
    marketResults: {},
    marketOdds: { cards: { line: 3.5 } },
    confidenceEngine: { overall: 70 },
    explanation: { why: [] },
    featureImportance: {},
    teamContext: {},
    momentum: null,
    valueBet: { detected: true, ev: 0.1 },
    referee: "R",
    monteCarlo: { big: "x".repeat(300) },
    modelMeta: { big: "y".repeat(300) },
    valueEngine: {
      expectedValue: 0.14,
      edge: 0.06,
      signal: "positive",
      detected: true,
      recommendable: true,
      negativeEV: false,
      positiveEV: true,
      kellyPct: 3.2,
      valueScore: 71,
      type: "Over 2.5",
      family: "Over/Under",
      bestMarket: { type: "Over 2.5", family: "Over/Under", odds: 1.9 },
      positiveEvCount: 1,
      negativeEvCount: 2,
      familiesSupported: ["Over/Under"],
      familiesPresent: ["Over/Under"],
      markets: [{ type: "Over 2.5", family: "Over/Under" }, { ...CARD_MARKET }]
    }
  } as unknown as PredictionRow;
}

describe("client and server prediction contracts", () => {
  it("declare the same row fields, in the same order", () => {
    expect([...PREDICTION_LIST_FIELDS]).toEqual([...PREDICTION_STORAGE_FIELDS]);
  });

  it("declare the same valueEngine fields, in the same order", () => {
    expect([...PREDICTION_LIST_VALUE_ENGINE_FIELDS]).toEqual([...VALUE_ENGINE_STORAGE_FIELDS]);
  });

  it("produce an identical row from identical input", () => {
    const source = row();
    const client = projectPredictionForStorage(source);
    const server = projectPredictionListRow(source);
    expect(server).toEqual(client);
  });

  it("agree on which valueEngine markets survive", () => {
    const source = row();
    const client = projectPredictionForStorage(source).valueEngine as unknown as Record<string, unknown>;
    const server = projectPredictionListRow(source).valueEngine as Record<string, unknown>;
    expect(server.markets).toEqual(client.markets);
    expect(server.markets).toEqual([CARD_MARKET]);
  });

  it("both leave the source row untouched", () => {
    const source = row();
    const before = JSON.stringify(source);
    projectPredictionForStorage(source);
    projectPredictionListRow(source);
    expect(JSON.stringify(source)).toBe(before);
  });
});
