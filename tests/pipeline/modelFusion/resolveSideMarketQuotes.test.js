import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSideMarketQuotes } from "../../../server-utils/pipeline/modelFusion/resolveSideMarketQuotes.js";

function oddsPayload(bets) {
  return { response: [{ bookmakers: [{ name: "BetA", bets }] }] };
}

test("resolveSideMarketQuotes returns all-null shape when oddsReq is not ok", () => {
  const out = resolveSideMarketQuotes({
    oddsReq: { ok: false, data: null },
    cornersBlock: { total: { o8_5: 62 } },
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    firstHalfProbs: null
  });
  assert.equal(out.marketOdds, undefined);
  assert.equal(out.goals15Quote, null);
  assert.equal(out.goals25Quote, null);
  assert.equal(out.goals35Quote, null);
  assert.equal(out.bttsQuote, null);
  assert.equal(out.doubleChanceQuote, null);
  assert.equal(out.cardsQuote, null);
  assert.equal(out.cornersPick, null);
});

test("resolveSideMarketQuotes picks Over/Under correctly and exact-matches the quoted line (selectOddByPick)", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      {
        name: "Corners Over/Under",
        values: [
          { value: "Over 8.5", odd: "1.90" },
          { value: "Under 8.5", odd: "1.85" }
        ]
      }
    ])
  };
  // Model favors Over 8.5 at 62% -> deriveBestOverUnderPick chooses "Over 8.5".
  const out = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: { total: { o8_5: 62 } },
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    firstHalfProbs: null
  });
  assert.equal(out.cornersPick.pick, "Over 8.5");
  assert.ok(out.marketOdds.corners);
  assert.equal(out.marketOdds.corners.pick, "Over 8.5");
  assert.equal(out.marketOdds.corners.odd, 1.9, "selectOddByPick must return the Over odd, not Under");
  assert.equal(out.marketOdds.corners.line, 8.5);
  assert.equal(out.marketOdds.corners.lineExact, true);
});

test("resolveSideMarketQuotes picks Under correctly when that side is favored", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      {
        name: "Corners Over/Under",
        values: [
          { value: "Over 8.5", odd: "1.90" },
          { value: "Under 8.5", odd: "1.85" }
        ]
      }
    ])
  };
  // 30% over -> Under 8.5 (70%) is favored.
  const out = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: { total: { o8_5: 30 } },
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    firstHalfProbs: null
  });
  assert.equal(out.cornersPick.pick, "Under 8.5");
  assert.equal(out.marketOdds.corners.pick, "Under 8.5");
  assert.equal(out.marketOdds.corners.odd, 1.85, "selectOddByPick must return the Under odd, not Over");
});

test("resolveSideMarketQuotes snaps to the nearest book line for a true SOT quote (buildOuQuotePayload line-snapping)", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      {
        name: "Shots On Target - Over/Under",
        values: [
          { value: "Over 7.5", odd: "1.90" },
          { value: "Under 7.5", odd: "1.85" }
        ]
      }
    ])
  };
  // Model's own line (8.5) isn't quoted; nearest book line is 7.5.
  const out = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: null,
    shotsOnTargetBlock: { total: { o8_5: 65 } },
    shotsTotalBlock: null,
    firstHalfProbs: null
  });
  assert.ok(out.marketOdds.shotsOnTarget);
  // True SOT quote (src === "sot") is allowed to snap to the book's line.
  assert.equal(out.marketOdds.shotsOnTarget.line, 7.5);
  assert.equal(out.marketOdds.shotsOnTarget.requestedLine, 8.5);
  assert.equal(out.marketOdds.shotsOnTarget.bookLine, 7.5);
});

test("resolveSideMarketQuotes does NOT snap the line for a cross-market shots-total fallback", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      {
        name: "Total Shots Over/Under",
        values: [
          { value: "Over 22.5", odd: "1.95" },
          { value: "Under 22.5", odd: "1.80" }
        ]
      }
    ])
  };
  const out = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: null,
    shotsOnTargetBlock: null,
    shotsTotalBlock: { total: { o24_5: 55 } },
    firstHalfProbs: null
  });
  assert.ok(out.marketOdds.shotsTotal);
  // src === "shots_total" -> allowSnap is false, keeps the model's own line even though
  // the book's nearest quote is at a different line.
  assert.equal(out.marketOdds.shotsTotal.line, 24.5);
  assert.equal(out.marketOdds.shotsTotal.requestedLine, 24.5);
  assert.ok(out.marketOdds.shotsTotal.bookmaker.includes("total shots"));
});

test("resolveSideMarketQuotes resolves goals lines, BTTS, double chance, and cards", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      {
        name: "Goals Over/Under",
        values: [
          { value: "Over 1.5", odd: "1.20" },
          { value: "Under 1.5", odd: "4.50" },
          { value: "Over 2.5", odd: "1.85" },
          { value: "Under 2.5", odd: "1.95" },
          { value: "Over 3.5", odd: "3.10" },
          { value: "Under 3.5", odd: "1.35" }
        ]
      },
      {
        name: "Both Teams Score",
        values: [
          { value: "Yes", odd: "1.75" },
          { value: "No", odd: "2.05" }
        ]
      },
      {
        name: "Double Chance",
        values: [
          { value: "Home/Draw", odd: "1.30" },
          { value: "Home/Away", odd: "1.10" },
          { value: "Draw/Away", odd: "1.60" }
        ]
      },
      {
        name: "Cards Over/Under",
        values: [
          { value: "Over 3.5", odd: "1.90" },
          { value: "Under 3.5", odd: "1.85" }
        ]
      }
    ])
  };
  const out = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: null,
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    firstHalfProbs: null
  });
  assert.equal(out.goals15Quote.over, 1.2);
  assert.equal(out.goals25Quote.over, 1.85);
  assert.equal(out.goals35Quote.over, 3.1);
  assert.equal(out.bttsQuote.yes, 1.75);
  assert.equal(out.doubleChanceQuote.homeDraw, 1.3);
  assert.equal(out.cardsQuote.over, 1.9);
  assert.equal(out.cardsQuote.line, 3.5);
  assert.equal(out.marketOdds.goals25.pick, "Over 2.5");
});

test("resolveSideMarketQuotes builds a first-half-goals quote from firstHalfProbs", () => {
  const oddsReq = {
    ok: true,
    data: oddsPayload([
      {
        name: "First Half Goals",
        values: [
          { value: "Over 1.5", odd: "3.20" },
          { value: "Under 1.5", odd: "1.30" }
        ]
      }
    ])
  };
  const out = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: null,
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    firstHalfProbs: { pO15: 65 }
  });
  assert.equal(out.marketOdds.firstHalfGoals.pick, "Over 1.5 FH");
  assert.equal(out.marketOdds.firstHalfGoals.odd, 3.2);

  const under = resolveSideMarketQuotes({
    oddsReq,
    cornersBlock: null,
    shotsOnTargetBlock: null,
    shotsTotalBlock: null,
    firstHalfProbs: { pO15: 20 }
  });
  assert.equal(under.marketOdds.firstHalfGoals.pick, "Under 1.5 FH");
  assert.equal(under.marketOdds.firstHalfGoals.odd, 1.3);
});
