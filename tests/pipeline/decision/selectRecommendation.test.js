import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRecommendation } from "../../../server-utils/pipeline/decision/selectRecommendation.js";

/**
 * Recommended is the highest calibrated probability among candidates that are tradable,
 * clear MIN_DISPLAY_ODDS (1.25) and clear the 50% probability floor. Nothing commercial
 * participates in the ranking.
 *
 * The suite that used to live here asserted the opposite for three cases — that market
 * diversity could win a near-tie, that Over 1.5 was soft-penalised, and that Goals 2.5
 * was preferred over a higher-probability Over 1.5. Those tests were deleted on purpose,
 * together with the composite score they protected. See selectRecommendation.js.
 */

// Baseline: every market present, all odds >= 1.25, no candidate dominating by construction.
function baseParams(overrides = {}) {
  return {
    marketProbsAligned: { pGG: 55, pNGG: 45, pO15: 80, pU15: 20, pO25: 55, pU25: 45, pO35: 30, pU35: 70 },
    p1Adj: 40,
    pXAdj: 25,
    p2Adj: 35,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: { home: 2.1, draw: 3.2, away: 3.4, bookmakersUsed: 6 },
    bttsQuote: { yes: 1.9, no: 1.85, bookmakersUsed: 5 },
    goals15Quote: { over: 1.3, under: 3.2, bookmakersUsed: 5 },
    goals25Quote: { over: 1.8, under: 1.95, bookmakersUsed: 5 },
    goals35Quote: { over: 3.1, under: 1.35, bookmakersUsed: 5 },
    doubleChanceQuote: { homeDraw: 1.3, homeAway: 1.25, drawAway: 1.5, bookmakersUsed: 5 },
    cornersSelections: null,
    cardsSelections: null,
    shotsTotalSelections: null,
    shotsOnTargetSelections: null,
    ...overrides
  };
}

/** A repriceCandidateLine()-shaped selection, already priced at the book's own line. */
function selection({ side, line, probabilityPct, odd, requestedLine = line, repriced = false }) {
  return {
    side,
    requestedLine,
    bookLine: line,
    lineExact: requestedLine === line,
    probabilityLine: line,
    probabilityPct,
    odd,
    bookmakersUsed: 4,
    tradable: true,
    repriced,
    reason: null
  };
}

/* ------------------------------------------------------------------ ranking */

test("Recommended is the highest calibrated probability among eligible tradable candidates", () => {
  const out = selectRecommendation(baseParams({ debug: true }));
  const ranked = out.diagnostics.ranked;
  assert.equal(out.topSelection.prob, ranked[0].confidencePct);
  assert.equal(ranked[0].confidencePct, Math.max(...ranked.map((c) => c.confidencePct)));
  assert.equal(out.topPick, ranked[0].type);
});

test("Alternative are the next highest probabilities, in probability order", () => {
  const out = selectRecommendation(baseParams({ debug: true }));
  const alts = out.topSelection.alternates;
  assert.ok(alts.length > 1);
  for (let i = 1; i < alts.length; i += 1) {
    assert.ok(alts[i - 1].prob >= alts[i].prob, "alternates must be probability-ordered");
  }
  assert.ok(out.topSelection.prob >= alts[0].prob, "Recommended outranks every alternate");
});

test("a huge-EV lower-probability candidate cannot outrank higher-probability ones (55% @2.90 vs 71% @1.42)", () => {
  // The exact audit case. Under the old composite score "1" scored 65.95 against
  // "Peste 1.5" at 52.53 and won on a +59.5% EV term.
  const out = selectRecommendation(
    baseParams({
      p1Adj: 55,
      pXAdj: 22,
      p2Adj: 23,
      odds: { home: 2.9, draw: 3.4, away: 3.2, bookmakersUsed: 6 },
      marketProbsAligned: { pGG: 51, pNGG: 49, pO15: 71, pU15: 29, pO25: 45, pU25: 55, pO35: 22, pU35: 78 },
      goals15Quote: { over: 1.42, under: 2.85, bookmakersUsed: 6 },
      goals25Quote: { over: 2.05, under: 1.78, bookmakersUsed: 6 },
      goals35Quote: { over: 4.1, under: 1.35, bookmakersUsed: 6 },
      bttsQuote: { yes: 1.9, no: 1.88, bookmakersUsed: 6 },
      doubleChanceQuote: null,
      debug: true
    })
  );
  const ranked = out.diagnostics.ranked;
  assert.equal(out.topSelection.prob, Math.max(...ranked.map((c) => c.confidencePct)));
  const one = ranked.find((c) => c.type === "1");
  assert.ok(one, "the high-EV candidate is still in the pool");
  assert.ok(ranked.indexOf(one) > 0, "a +59.5% EV selection at 55% must not outrank higher probabilities");
  const overOneFive = ranked.find((c) => c.type === "Peste 1.5");
  assert.ok(ranked.indexOf(overOneFive) < ranked.indexOf(one), "71% must rank above 55%");
});

test("EV cannot promote a lower-probability candidate head-to-head", () => {
  // GG 71% @1.42 (EV +0.8%) vs "1" 55% @2.90 (EV +59.5%). Probability wins.
  const out = selectRecommendation(
    baseParams({
      p1Adj: 55,
      pXAdj: 22,
      p2Adj: 23,
      odds: { home: 2.9, draw: 3.4, away: 3.2, bookmakersUsed: 6 },
      marketProbsAligned: { pGG: 71, pNGG: 29, pO15: 40, pU15: 60, pO25: 30, pU25: 45, pO35: 10, pU35: 49 },
      goals15Quote: null,
      goals25Quote: null,
      goals35Quote: null,
      doubleChanceQuote: null,
      bttsQuote: { yes: 1.42, no: 2.9, bookmakersUsed: 6 },
      debug: true
    })
  );
  assert.equal(out.topPick, "GG");
  assert.equal(out.topSelection.prob, 71);
});

test("a sub-50% candidate can never become Recommended, whatever its EV", () => {
  // Every candidate below the floor. The old odds_only tier ranked these by score and
  // handed the win to 38% @3.20. There is no such tier now.
  const out = selectRecommendation(
    baseParams({
      p1Adj: 45,
      pXAdj: 27,
      p2Adj: 38,
      odds: { home: 1.95, draw: 3.6, away: 3.2, bookmakersUsed: 6 },
      marketProbsAligned: { pGG: 49, pNGG: 45, pO15: 48, pU15: 44, pO25: 44, pU25: 47, pO35: 21, pU35: 46 },
      goals15Quote: null,
      goals25Quote: { over: 2.05, under: 1.85, bookmakersUsed: 6 },
      goals35Quote: null,
      doubleChanceQuote: null,
      bttsQuote: { yes: 1.92, no: 1.86, bookmakersUsed: 6 },
      debug: true
    })
  );
  assert.equal(out.diagnostics.ranked.length, 0, "nothing below the floor may be eligible");
  assert.equal(out.diagnostics.fallbackTier, "argmax_1x2");
  assert.equal(out.topPick, "1", "falls back to argmax of the model's own 1X2, not to a scored pick");
});

test("MIN_DISPLAY_ODDS is a hard gate: the top-probability pick is dropped when priced below 1.25", () => {
  // Documents the product decision. 90% @1.10 is not selectable, so a lower-probability
  // candidate legitimately wins: the odds floor is a tradability gate, not a ranking term.
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: { pGG: 55, pNGG: 45, pO15: 90, pU15: 10, pO25: 55, pU25: 45, pO35: 30, pU35: 70 },
      goals15Quote: { over: 1.1, under: 6.5, bookmakersUsed: 5 },
      debug: true
    })
  );
  assert.notEqual(out.topPick, "Peste 1.5");
  assert.ok(!out.diagnostics.ranked.some((c) => c.type === "Peste 1.5"));
  assert.equal(out.diagnostics.rejected.find((r) => r.type === "Peste 1.5").reason, "below_min_odds");
});

test("selection is deterministic and probability-ordered across repeated calls", () => {
  const runs = Array.from({ length: 5 }, () => selectRecommendation(baseParams({ debug: true })));
  const first = JSON.stringify(runs[0].diagnostics.ranked);
  for (const r of runs) {
    assert.equal(JSON.stringify(r.diagnostics.ranked), first);
    for (let i = 1; i < r.diagnostics.ranked.length; i += 1) {
      assert.ok(r.diagnostics.ranked[i - 1].confidencePct >= r.diagnostics.ranked[i].confidencePct);
    }
  }
});

/* -------------------------------------------------------- lined side markets */

test("every offered line competes on its own probability — the highest wins at the shortest price", () => {
  // Originally written on Cards (Under 3.5 / 4.5 / 5.5). Cards is now held out of the pool
  // by the settleability gate, so the same guarantee is asserted on Corners, which is
  // settleable. Under 8.5 @2.70 has by far the best EV; Under 10.5 @1.35 the best chance.
  const out = selectRecommendation(
    baseParams({
      goals15Quote: null,
      goals25Quote: null,
      goals35Quote: null,
      bttsQuote: null,
      doubleChanceQuote: null,
      odds: null,
      cornersSelections: [
        selection({ side: "under", line: 8.5, probabilityPct: 37, odd: 2.7 }),
        selection({ side: "under", line: 9.5, probabilityPct: 72, odd: 1.65 }),
        selection({ side: "under", line: 10.5, probabilityPct: 86, odd: 1.35 })
      ],
      debug: true
    })
  );
  assert.equal(out.topPick, "Under 10.5");
  assert.equal(out.topSelection.prob, 86);
  assert.equal(out.recommendedQuote.odd, 1.35);
  assert.deepEqual(
    out.topSelection.alternates.map((a) => a.pick),
    ["Under 9.5"]
  );
  // Under 8.5 is below the 50% floor, so it is not an alternative either.
  assert.equal(
    out.diagnostics.rejected.find((r) => r.type === "Under 8.5").reason,
    "below_min_probability"
  );
});

test("a repriced corners line carries the book line in the pick, the odd and the probability", () => {
  const out = selectRecommendation(
    baseParams({
      goals15Quote: null,
      goals25Quote: null,
      goals35Quote: null,
      bttsQuote: null,
      doubleChanceQuote: null,
      odds: null,
      cornersSelections: [
        selection({ side: "over", line: 10.5, probabilityPct: 54, odd: 1.95, requestedLine: 9.5, repriced: "ladder" })
      ],
      debug: true
    })
  );
  assert.equal(out.topPick, "Over 10.5");
  assert.equal(out.topSelection.family, "Corners");
  assert.equal(out.topSelection.prob, 54);
  assert.equal(out.recommendedQuote.odd, 1.95);
  assert.equal(out.recommendedQuote.bookLine, 10.5);
  assert.equal(out.recommendedQuote.probabilityLine, 10.5);
  assert.equal(out.recommendedQuote.lineExact, false);
  assert.equal(out.recommendedQuote.repriced, "ladder");
  assert.equal(out.recommendedQuote.tradable, true);
});

test("non-tradable selections never enter the pool", () => {
  const out = selectRecommendation(
    baseParams({
      cornersSelections: [
        { ...selection({ side: "over", line: 10.5, probabilityPct: 99, odd: 1.95 }), tradable: false }
      ],
      debug: true
    })
  );
  assert.ok(!out.diagnostics.ranked.some((c) => c.family === "Corners"));
  assert.notEqual(out.topSelection.prob, 99);
});

test("every tradable ranked candidate satisfies probabilityLine === bookLine", () => {
  const out = selectRecommendation(
    baseParams({
      cornersSelections: [
        selection({ side: "over", line: 10.5, probabilityPct: 54, odd: 1.95, requestedLine: 9.5, repriced: "ladder" }),
        selection({ side: "under", line: 8.5, probabilityPct: 61, odd: 1.7 })
      ],
      cardsSelections: [selection({ side: "under", line: 4.5, probabilityPct: 72, odd: 1.65 })],
      debug: true
    })
  );
  for (const c of out.diagnostics.ranked) {
    if (c.bookLine == null) continue;
    assert.equal(c.probabilityLine, c.bookLine, `${c.type} must be priced at its own book line`);
  }
});

test("Recommended can be a Shots on Target selection when it has the highest probability", () => {
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: { pO15: 68, pU15: 32, pO25: 44, pU25: 56, pO35: 20, pU35: 80 },
      p1Adj: 44,
      pXAdj: 28,
      p2Adj: 28,
      goals35Quote: { over: 4.1, under: 1.26, bookmakersUsed: 5 },
      // Model wanted 6.5; the book only offers 8.5, so the selection lives at 8.5.
      shotsOnTargetSelections: [
        selection({ side: "over", line: 8.5, probabilityPct: 88, odd: 1.75, requestedLine: 6.5, repriced: "ladder" })
      ],
      debug: true
    })
  );
  assert.equal(out.topPick, "SOT Over 8.5");
  assert.equal(out.topSelection.family, "Shots on Target");
  assert.equal(out.topSelection.prob, 88);
  assert.equal(out.recommendedQuote.odd, 1.75);
  assert.equal(out.recommendedQuote.bookLine, 8.5);
  assert.equal(out.recommendedQuote.probabilityLine, 8.5);
  assert.equal(out.recommendedQuote.tradable, true);
});

test("Recommended can be a Shots total selection when it has the highest probability", () => {
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: { pO15: 68, pU15: 32, pO25: 44, pU25: 56, pO35: 20, pU35: 70 },
      p1Adj: 44,
      pXAdj: 28,
      p2Adj: 28,
      goals35Quote: { over: 4.1, under: 1.26, bookmakersUsed: 5 },
      shotsTotalSelections: [
        selection({ side: "over", line: 18.5, probabilityPct: 84, odd: 1.4, requestedLine: 20.5, repriced: "analytic" })
      ],
      debug: true
    })
  );
  assert.equal(out.topPick, "Shots Over 18.5");
  assert.equal(out.topSelection.family, "Shots");
  assert.equal(out.topSelection.prob, 84);
  assert.equal(out.recommendedQuote.repriced, "analytic");
});

test("a missing probability never becomes a phantom 100% candidate via the complement", () => {
  // pct01(null) used to return 0, so an absent pO35 made `1 - po` emit Sub 3.5 at 100%.
  const out = selectRecommendation(
    baseParams({
      marketProbsAligned: { pO15: 95, pU15: 5 },
      debug: true
    })
  );
  assert.ok(
    out.diagnostics.ranked.every((c) => c.confidencePct <= 100 && c.confidencePct !== 100),
    "no candidate may be manufactured at 100%"
  );
  assert.ok(!out.diagnostics.ranked.some((c) => c.type === "Sub 3.5"));
  assert.equal(out.topPick, "Peste 1.5");
});

test("Recommended can come from any settleable family: Goals, Corners, Shots and SOT", () => {
  // Cards is deliberately absent — it is covered by the settleability-gate tests below.
  const families = new Map([
    ["Over/Under", { marketProbsAligned: { pO15: 95, pU15: 5 }, goals15Quote: { over: 1.3, under: 6, bookmakersUsed: 5 } }],
    ["Corners", { cornersSelections: [selection({ side: "over", line: 8.5, probabilityPct: 95, odd: 1.4 })] }],
    ["Shots", { shotsTotalSelections: [selection({ side: "over", line: 18.5, probabilityPct: 95, odd: 1.4 })] }],
    [
      "Shots on Target",
      { shotsOnTargetSelections: [selection({ side: "over", line: 6.5, probabilityPct: 95, odd: 1.4 })] }
    ]
  ]);
  for (const [family, override] of families) {
    const out = selectRecommendation(baseParams({ ...override, debug: true }));
    assert.equal(out.topSelection.family, family, `${family} must be able to win Recommended`);
    assert.equal(out.topSelection.prob, 95);
  }
});

test("Best Value is decided separately from Recommended", async () => {
  const { buildProfessionalValueEngine } = await import("../../../server-utils/value/ValueEngine.js");
  // Corners rather than Cards: both lines must be settleable for either engine to see them.
  const shared = {
    cornersSelections: [
      selection({ side: "under", line: 8.5, probabilityPct: 55, odd: 2.7 }),
      selection({ side: "under", line: 10.5, probabilityPct: 84, odd: 1.35 })
    ]
  };
  const rec = selectRecommendation(
    baseParams({
      ...shared,
      odds: null,
      bttsQuote: null,
      doubleChanceQuote: null,
      goals15Quote: null,
      goals25Quote: null,
      goals35Quote: null,
      debug: true
    })
  );
  const ve = buildProfessionalValueEngine({ probs: {}, ...shared });

  // Recommended takes the safest: 84% @1.35 (EV +13.4%).
  assert.equal(rec.topPick, "Under 10.5");
  // Best Value takes the priciest edge: 55% @2.70 (EV +48.5%).
  assert.equal(ve.bestMarket.type, "Under 8.5");
  assert.ok(ve.bestMarket.expectedValue > 0);
  assert.notEqual(rec.topPick, ve.bestMarket.type, "the two concepts stay independent");
});

/* ----------------------------------------------------- settleability gate */

test("Cards cannot be Recommended while its settlement is unsupported", () => {
  const out = selectRecommendation(
    baseParams({
      odds: null,
      bttsQuote: null,
      doubleChanceQuote: null,
      goals15Quote: null,
      goals25Quote: null,
      goals35Quote: null,
      // Tradable, repriced at the book's own line, and by far the likeliest — but the app
      // has no cards total, so it could never be graded.
      cardsSelections: [selection({ side: "under", line: 5.5, probabilityPct: 96, odd: 1.3 })],
      debug: true
    })
  );
  assert.ok(!out.diagnostics.ranked.some((c) => c.family === "Cards"));
  assert.equal(out.diagnostics.rejected.find((r) => r.family === "Cards").reason, "not_settleable");
  assert.notEqual(out.topPick, "Cards Under 5.5");
  assert.equal(out.diagnostics.fallbackTier, "argmax_1x2", "nothing else was eligible here");
});

test("a lower-probability settleable candidate beats a higher-probability unsettleable one", () => {
  const out = selectRecommendation(
    baseParams({
      odds: null,
      bttsQuote: null,
      doubleChanceQuote: null,
      goals15Quote: null,
      goals25Quote: null,
      goals35Quote: null,
      cardsSelections: [selection({ side: "under", line: 5.5, probabilityPct: 96, odd: 1.3 })],
      cornersSelections: [selection({ side: "over", line: 8.5, probabilityPct: 61, odd: 1.7 })],
      debug: true
    })
  );
  // 61% Corners wins over 96% Cards — not because of any ranking term, but because the
  // Cards candidate never entered the pool.
  assert.equal(out.topPick, "Over 8.5");
  assert.equal(out.topSelection.family, "Corners");
  assert.equal(out.topSelection.prob, 61);
  assert.deepEqual(
    out.diagnostics.ranked.map((c) => c.family),
    ["Corners"]
  );
});

test("Cards is excluded from Alternative as well as Recommended", () => {
  const out = selectRecommendation(
    baseParams({
      cardsSelections: [selection({ side: "under", line: 5.5, probabilityPct: 96, odd: 1.3 })],
      debug: true
    })
  );
  assert.ok(!out.topSelection.alternates.some((a) => a.family === "Cards"));
  assert.ok(!out.diagnostics.ranked.some((c) => c.family === "Cards"));
});

test("Shots and SOT stay in the pool — both are settleable", () => {
  for (const [key, family, label] of [
    ["shotsTotalSelections", "Shots", "Shots Over 18.5"],
    ["shotsOnTargetSelections", "Shots on Target", "SOT Over 18.5"]
  ]) {
    const out = selectRecommendation(
      baseParams({
        odds: null,
        bttsQuote: null,
        doubleChanceQuote: null,
        goals15Quote: null,
        goals25Quote: null,
        goals35Quote: null,
        [key]: [selection({ side: "over", line: 18.5, probabilityPct: 79, odd: 1.5 })],
        debug: true
      })
    );
    assert.equal(out.topSelection.family, family);
    assert.equal(out.topPick, label);
    assert.equal(out.topSelection.prob, 79);
    assert.ok(!out.diagnostics.rejected.some((r) => r.reason === "not_settleable"));
  }
});

test("the settleability gate is eligibility only — it never reorders the eligible pool", () => {
  const a = selectRecommendation(baseParams({ debug: true })).diagnostics.ranked;
  const b = selectRecommendation(
    baseParams({
      cardsSelections: [selection({ side: "under", line: 5.5, probabilityPct: 96, odd: 1.3 })],
      debug: true
    })
  ).diagnostics.ranked;
  assert.deepEqual(
    b.map((c) => [c.type, c.confidencePct]),
    a.map((c) => [c.type, c.confidencePct]),
    "adding an unsettleable candidate must not perturb the ranking of the others"
  );
});

test("Best Value also refuses an unsettleable candidate", async () => {
  const { buildProfessionalValueEngine } = await import("../../../server-utils/value/ValueEngine.js");
  // Cards carries a far better edge than Corners here, so only the gate can exclude it.
  const cardsSelections = [selection({ side: "under", line: 3.5, probabilityPct: 70, odd: 3.2 })];
  const cornersSelections = [selection({ side: "over", line: 8.5, probabilityPct: 61, odd: 1.9 })];

  const ve = buildProfessionalValueEngine({ probs: {}, cardsSelections, cornersSelections });
  assert.ok(ve.bestMarket, "a settleable value bet is still found");
  assert.equal(ve.bestMarket.family, "Corners");

  // With only the unsettleable family available there is no best market at all.
  const cardsOnly = buildProfessionalValueEngine({ probs: {}, cardsSelections });
  assert.equal(cardsOnly.bestMarket, null);
  assert.equal(cardsOnly.detected, false);
});

test("flipping a family to settleable readmits it with no ranking change", async () => {
  const { SETTLEABLE_VALUE_FAMILIES, buildValueCandidates } = await import(
    "../../../server-utils/value/valueMarkets.js"
  );
  // Documents the intended follow-up: the registry is the only switch. Cards candidates are
  // built exactly like every other family and already carry the full line contract; only
  // `settleable` keeps them out.
  assert.equal(SETTLEABLE_VALUE_FAMILIES.Cards, false);
  const built = buildValueCandidates({
    probs: {},
    cardsSelections: [selection({ side: "under", line: 5.5, probabilityPct: 96, odd: 1.3 })]
  });
  assert.equal(built.length, 1);
  assert.equal(built[0].family, "Cards");
  assert.equal(built[0].settleable, false, "the flag is what excludes it, nothing else");
  assert.equal(built[0].tradable, true, "it is otherwise a perfectly valid candidate");
  assert.equal(built[0].confidencePct, 96);
  assert.equal(built[0].probabilityLine, built[0].bookLine);
});

/* ------------------------------------------------------------------- shapes */

test("diagnostics are development-only and describe the probability rule", () => {
  assert.equal(selectRecommendation(baseParams()).diagnostics, null);
  const on = selectRecommendation(baseParams({ debug: true }));
  assert.equal(on.diagnostics.rule, "argmax_calibrated_probability");
  assert.equal(on.diagnostics.gates.minProbabilityPct, 50);
  assert.equal(on.diagnostics.gates.minDisplayOdds, 1.25);
  assert.equal(on.diagnostics.gates.requiresTradable, true);
});

test("public output shape is preserved for downstream stages", () => {
  const out = selectRecommendation(baseParams());
  assert.deepEqual(Object.keys(out).sort(), [
    "diagnostics",
    "maxConf",
    "recommendedQuote",
    "topPick",
    "topSelection"
  ]);
  for (const k of ["pick", "prob", "lift", "alternates", "family"]) {
    assert.ok(k in out.topSelection, `topSelection.${k} must survive`);
  }
  for (const k of [
    "odd",
    "source",
    "bookmakersUsed",
    "line",
    "bookLine",
    "lineExact",
    "probabilityLine",
    "tradable",
    "repriced"
  ]) {
    assert.ok(k in out.recommendedQuote, `recommendedQuote.${k} must be present`);
  }
  assert.equal(typeof out.maxConf, "number");
});

test("falls back to argmax 1X2 when nothing has usable odds", () => {
  const out = selectRecommendation({
    marketProbsAligned: {},
    p1Adj: 51,
    pXAdj: 24,
    p2Adj: 25,
    leagueMultiplier: 1,
    qualityPenalty: 1,
    odds: null,
    debug: true
  });
  assert.equal(out.topPick, "1");
  assert.equal(out.diagnostics.fallbackTier, "argmax_1x2");
  assert.equal(out.recommendedQuote.tradable, false);
  assert.equal(out.recommendedQuote.odd, null);
});
