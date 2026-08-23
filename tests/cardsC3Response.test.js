/**
 * Cards C3 — response-side contract: the Cards block is computed by default (kill-switch
 * only), the Cards quote is a sided peer of corners when a block exists, referee
 * discipline reaches the row as context and only when sufficiently sampled, and the
 * access tier is what decides visibility.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveSideMarketQuotes } from "../server-utils/pipeline/modelFusion/resolveSideMarketQuotes.js";
import { toRefereeCardsContext } from "../server-utils/context/refereeStatsFromHistory.js";
import { maskPredictionForTier } from "../server-utils/accessTier.js";
import { SETTLEABLE_VALUE_FAMILIES } from "../server-utils/value/valueMarkets.js";
import { SETTLEABLE_MARKET_FAMILIES } from "../server-utils/globalSpecialBetEngine.js";

const oddsPayload = (bets) => ({ response: [{ bookmakers: [{ name: "BetA", bets }] }] });
const CARDS_BLOCK = {
  total: { o3_5: 78, o4_5: 68, o5_5: 45 },
  home: {},
  away: {},
  lambdaHome: 2.3,
  lambdaAway: 2.2,
  lambdaTotal: 4.5,
  expectedTotal: 4.5
};

test("1. with a Cards block the quote is sided, at the model line, priced at the book line", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      { name: "Cards Over/Under", values: [{ value: "Over 4.5", odd: "1.65" }, { value: "Under 4.5", odd: "2.20" }] },
      { name: "Corners Over/Under", values: [{ value: "Over 8.5", odd: "1.90" }, { value: "Under 8.5", odd: "1.85" }] }
    ])
  };
  const out = resolveSideMarketQuotes({ oddsReq, cornersBlock: { total: { o8_5: 62 } }, shotsOnTargetBlock: null, shotsTotalBlock: null, firstHalfProbs: null, cardsBlock: CARDS_BLOCK });
  const q = out.marketOdds.cards;
  assert.equal(q.requestedLine, 3.5, "the model's best line (78%) is what was asked for, not VALUE_CARDS_LINE");
  // book has only 4.5 → repriced within maxLineDelta 1 and relabelled at the book's line
  assert.equal(q.pick, "Over 4.5");
  assert.equal(q.line, 4.5);
  assert.equal(q.odd, 1.65, "the Over odd, never the Under one");
  assert.equal(q.tradable, true);
  assert.equal(q.probabilityLine, 4.5);
  assert.equal(q.period, "full_match");
  assert.equal(q.scope, "match");
  assert.ok(!/Over\/Under/.test(q.pick), "no sideless legacy label");
  // corners untouched by the cards wiring
  assert.equal(out.marketOdds.corners.pick, "Over 8.5");
  assert.equal(out.marketOdds.corners.odd, 1.9);
});

test("1b. without a Cards block the legacy sideless quote at VALUE_CARDS_LINE is kept (rows whose λ was rejected)", () => {
  const oddsReq = { ok: true, data: oddsPayload([{ name: "Cards Over/Under", values: [{ value: "Over 3.5", odd: "1.80" }, { value: "Under 3.5", odd: "1.95" }] }]) };
  const out = resolveSideMarketQuotes({ oddsReq, cornersBlock: null, shotsOnTargetBlock: null, shotsTotalBlock: null, firstHalfProbs: null });
  assert.equal(out.marketOdds.cards.pick, "Cards Over/Under");
  assert.equal(out.marketOdds.cards.line, 3.5);
});

test("1c. a Cards block without any cards market in the book yields a non-tradable, priceless quote — never an invented odd", () => {
  const oddsReq = { ok: true, data: oddsPayload([{ name: "Corners Over/Under", values: [{ value: "Over 8.5", odd: "1.90" }] }]) };
  const out = resolveSideMarketQuotes({ oddsReq, cornersBlock: null, shotsOnTargetBlock: null, shotsTotalBlock: null, firstHalfProbs: null, cardsBlock: CARDS_BLOCK });
  const q = out.marketOdds.cards;
  assert.equal(q.tradable, false);
  assert.equal(q.odd, null);
  assert.equal(q.pick, "Over 3.5", "the model's read is still shown, unpriced");
});

test("2/3. the Cards block is computed by default; PREDICT_ENABLE_CARDS=0 is an explicit kill-switch", () => {
  const src = readFileSync(new URL("../server-utils/pipeline/stages/Stage05Simulation.js", import.meta.url), "utf8");
  assert.match(src, /PREDICT_ENABLE_CARDS \|\| ""\)\.trim\(\) !== "0"/, "gate is opt-out, not opt-in");
  assert.doesNotMatch(src, /PREDICT_ENABLE_CARDS \|\| ""\)\.trim\(\) === "1"/);
});

test("12/13. visibility follows the access tier: probs.cards survives on Ultra only; refereeCards is context for all", () => {
  const row = { probs: { p1: 40, corners: { total: {} }, cards: CARDS_BLOCK }, refereeCards: { avgCards: 5.1, sampleSize: 17, unit: "cardsTotal" }, valueBet: {}, modelMeta: {} };
  assert.equal(maskPredictionForTier(row, "free").probs.cards, undefined);
  assert.equal(maskPredictionForTier(row, "premium").probs.cards, undefined);
  assert.deepEqual(maskPredictionForTier(row, "ultra").probs.cards, CARDS_BLOCK);
  for (const tier of ["free", "premium", "ultra"]) {
    assert.deepEqual(maskPredictionForTier(row, tier).refereeCards, row.refereeCards);
  }
});

test("14/15. referee discipline context: value only when the sample is sufficient, otherwise null", () => {
  assert.deepEqual(toRefereeCardsContext({ cards: { avgCards: 5.06, sampleSize: 17, sufficient: true } }), { avgCards: 5.06, sampleSize: 17, unit: "cardsTotal" });
  assert.equal(toRefereeCardsContext({ cards: { avgCards: 5.06, sampleSize: 2, sufficient: false } }), null);
  assert.equal(toRefereeCardsContext({ cards: { avgCards: null, sampleSize: 17, sufficient: true } }), null);
  assert.equal(toRefereeCardsContext({ avgGoals: 2.7 }), null);
  assert.equal(toRefereeCardsContext(null), null);
  assert.equal(toRefereeCardsContext({ cards: { avgCards: 0, sampleSize: 0, sufficient: true } }), null, "zero sample is not a profile");
});

test("5. Cards is a market panel, not a Recommended: the decision gate and the GSB family set are unchanged", () => {
  assert.equal(SETTLEABLE_VALUE_FAMILIES.Cards, false);
  assert.equal(SETTLEABLE_MARKET_FAMILIES.has("cards"), false);
});
