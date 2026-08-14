import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateRefereeCards,
  refereeMinSamples,
  computeRefereeStatsFromHistory
} from "../server-utils/context/refereeStatsFromHistory.js";
import { cardsFromCounts } from "../server-utils/fixtureCardTotals.js";
import { calculate as refereeEngineCalculate } from "../server-utils/PredictionEngine/RefereeEngine.js";
import { calculate as refereeContextCalculate } from "../server-utils/context/modules/RefereeContext.js";

/** History rows as PostgREST returns them: JSON `->>` selections arrive as text. */
const rows = (...totals) => totals.map((t) => ({ cardsTotal: t == null ? null : String(t) }));

// -------------------- A. valid statistics --------------------

test("[A] referee cu statistici valide: 4,3,5,2 → avgCards 3.5, sampleSize 4", () => {
  const cards = aggregateRefereeCards(rows(4, 3, 5, 2));
  assert.equal(cards.avgCards, 3.5);
  assert.equal(cards.sampleSize, 4);
  assert.equal(cards.minCards, 2);
  assert.equal(cards.maxCards, 5);
  assert.equal(cards.medianCards, 3.5);
  assert.equal(cards.sufficient, true);
});

// -------------------- B. UNKNOWN --------------------

test("[B] UNKNOWN: 4,null,5,null,3 → sampleSize 3, media doar pe 4,5,3", () => {
  const cards = aggregateRefereeCards(rows(4, null, 5, null, 3));
  assert.equal(cards.sampleSize, 3);
  assert.equal(cards.unknownCount, 2);
  assert.equal(cards.avgCards, 4, "(4+5+3)/3");
  // Dacă null-urile ar deveni 0, media ar fi (4+0+5+0+3)/5 = 2.4.
  assert.notEqual(cards.avgCards, 2.4);
});

test("[B] absent, string gol şi valoare ne-numerică sunt toate UNKNOWN", () => {
  const cards = aggregateRefereeCards([
    { cardsTotal: "4" },
    { cardsTotal: null },
    { cardsTotal: "" },
    { cardsTotal: "n/a" },
    {},
    { cardsTotal: "6" },
    { cardsTotal: "5" }
  ]);
  assert.equal(cards.sampleSize, 3);
  assert.equal(cards.unknownCount, 4);
  assert.equal(cards.avgCards, 5, "(4+6+5)/3 — cele 4 forme de UNKNOWN nu contribuie");
});

// -------------------- C/D. red null, zero valid --------------------

test("[C] yellow=2 red=null → cardsTotal 2, observaţie validă în statistica arbitrului", () => {
  // Lanţul complet: aceeaşi funcţie care decide known/unknown la settlement şi în rolling.
  const observed = cardsFromCounts(2, null);
  assert.equal(observed.count, 2);
  const cards = aggregateRefereeCards(rows(observed.count, 3, 4));
  assert.equal(cards.sampleSize, 3);
  assert.equal(cards.avgCards, 3);
});

test("[D] yellow=0 red=0 → cardsTotal 0 intră în sample ca observaţie validă", () => {
  const observed = cardsFromCounts(0, 0);
  assert.equal(observed.count, 0);
  const cards = aggregateRefereeCards(rows(observed.count, 3, 3));
  assert.equal(cards.sampleSize, 3, "un 0 real NU este UNKNOWN");
  assert.equal(cards.unknownCount, 0);
  assert.equal(cards.avgCards, 2, "(0+3+3)/3");
  assert.equal(cards.minCards, 0);
});

// -------------------- E. cardsTotal vs cardsPoints --------------------

test("[E] yellow=3 red=1 → cardsTotal 4 şi cardsPoints 5, valori distincte", () => {
  const observed = cardsFromCounts(3, 1);
  assert.equal(observed.count, 4);
  assert.equal(observed.points, 5);

  const cards = aggregateRefereeCards([
    { cardsTotal: "4", cardsPoints: "5" },
    { cardsTotal: "4", cardsPoints: "5" },
    { cardsTotal: "4", cardsPoints: "5" }
  ]);
  assert.equal(cards.avgCards, 4);
  assert.equal(cards.cardsPointsAvg, 5);
  assert.notEqual(cards.avgCards, cards.cardsPointsAvg);
  assert.equal(cards.unit, "cardsTotal", "unitatea principală rămâne cardsTotal");
});

test("[E] un cardsPoints lipsă nu scoate meciul din sample-ul cardsTotal", () => {
  const cards = aggregateRefereeCards([
    { cardsTotal: "4", cardsPoints: "5" },
    { cardsTotal: "2", cardsPoints: null },
    { cardsTotal: "3", cardsPoints: "3" }
  ]);
  assert.equal(cards.sampleSize, 3);
  assert.equal(cards.cardsPointsSampleSize, 2);
  assert.equal(cards.avgCards, 3);
  assert.equal(cards.cardsPointsAvg, 4);
});

// -------------------- F. sample count --------------------

test("[F] sampleSize numără DOAR fixture-urile cu cardsTotal valid", () => {
  const cards = aggregateRefereeCards(rows(1, null, null, null, 2));
  assert.equal(cards.sampleSize, 2);
  assert.equal(cards.unknownCount, 3);
});

// -------------------- G. referee isolation --------------------

test("[G] datele a doi arbitri nu se influenţează reciproc", () => {
  const a = aggregateRefereeCards(rows(6, 6, 6));
  const b = aggregateRefereeCards(rows(1, 1, 1));
  assert.equal(a.avgCards, 6);
  assert.equal(b.avgCards, 1);
  // Recalculat după b: agregarea este pură, fără stare partajată.
  assert.deepEqual(aggregateRefereeCards(rows(6, 6, 6)), a);
});

// -------------------- H. ordering determinism --------------------

test("[H] aceleaşi observaţii în ordine diferită dau statistici identice", () => {
  const asc = aggregateRefereeCards(rows(1, 2, 3, 4, 10));
  const desc = aggregateRefereeCards(rows(10, 4, 3, 2, 1));
  const shuffled = aggregateRefereeCards(rows(3, 10, 1, 4, 2));
  assert.deepEqual(desc, asc);
  assert.deepEqual(shuffled, asc);
  assert.equal(asc.medianCards, 3);
});

// -------------------- I. no referee --------------------

test("[I] fixture fără identitate de arbitru nu produce statistică", async () => {
  assert.equal(await computeRefereeStatsFromHistory(""), null);
  assert.equal(await computeRefereeStatsFromHistory("   "), null);
  assert.equal(await computeRefereeStatsFromHistory(null), null);
  assert.equal(await computeRefereeStatsFromHistory(undefined), null);
});

// -------------------- J. insufficient history --------------------

test("[J] sub pragul existent: avgCards rămâne null, dar sample-ul este vizibil", () => {
  const cards = aggregateRefereeCards(rows(4, 6));
  assert.equal(cards.sufficient, false);
  assert.equal(cards.avgCards, null, "nu inventăm o medie din 2 meciuri");
  assert.equal(cards.cardsPointsAvg, null);
  // Datele brute rămân inspectabile — asta e tot rostul incrementului.
  assert.equal(cards.sampleSize, 2);
  assert.equal(cards.minCards, 4);
  assert.equal(cards.maxCards, 6);
  assert.equal(cards.medianCards, 5);
});

test("[J] pragul folosit este cel existent pentru referee history, nu unul nou", () => {
  assert.equal(refereeMinSamples(), 3, "REFEREE_STATS_MIN_SAMPLES default");
  assert.equal(aggregateRefereeCards(rows(4, 4, 4)).minSamplesRequired, 3);
  assert.equal(aggregateRefereeCards(rows(4, 4)).sufficient, false);
  assert.equal(aggregateRefereeCards(rows(4, 4, 4)).sufficient, true);
});

test("[J] zero observaţii nu produce nici medie, nici extreme", () => {
  const cards = aggregateRefereeCards([]);
  assert.equal(cards.sampleSize, 0);
  assert.equal(cards.avgCards, null);
  assert.equal(cards.minCards, null);
  assert.equal(cards.maxCards, null);
  assert.equal(cards.medianCards, null);
  assert.equal(cards.sufficient, false);
});

// -------------------- L. dead-code verification --------------------

test("[L] avgCards este acum calculabil din istoric — nu mai este permanent null", () => {
  // Înainte de acest increment nicio intrare nu putea produce o medie de cartonaşe.
  const cards = aggregateRefereeCards(rows(5, 5, 5, 5));
  assert.notEqual(cards.avgCards, null);
  assert.equal(cards.avgCards, 5);
  assert.equal(cards.source, "predictions_history.marketResults.cardsTotal");
});

// -------------------- M. no prediction mutation --------------------

test("[M] statistica nouă NU schimbă cardsBoost din RefereeEngine", () => {
  // Forma pe care computeRefereeStatsFromHistory o întoarce acum: `cards` populat,
  // `avgCards` încă null. RefereeEngine trebuie să se comporte exact ca înainte.
  const ctx = {
    refereeName: "Test Ref",
    leagueParams: { cards: 4.2, leagueAvg: 1.35 },
    refereeStats: {
      avgGoals: 2.7,
      avgCards: null,
      homeWinBias: 0.05,
      sampleSize: 4,
      cards: aggregateRefereeCards(rows(6, 6, 6, 6))
    }
  };
  const withCards = refereeEngineCalculate(ctx);
  const legacy = refereeEngineCalculate({
    ...ctx,
    refereeStats: { avgGoals: 2.7, avgCards: null, homeWinBias: 0.05, sampleSize: 4 }
  });
  assert.deepEqual(withCards, legacy, "prezenţa lui `cards` nu trebuie să mişte nimic");
  // Şi confirmă fallback-ul documentat: cardsBoost === boost-ul derivat din goluri.
  assert.equal(withCards.details.cardsBoost, withCards.details.home);
  // Artefact PREEXISTENT, documentat aici, NEreparat în acest increment (RefereeEngine
  // este out of scope): linia 36 din RefereeEngine.js scrie
  //   avgCards: Number.isFinite(Number(stats.avgCards)) ? Number(stats.avgCards) : undefined
  // iar Number(null) === 0 este finit — deci explainability raportează "0 cartonaşe" în loc
  // de "necunoscut". Nu atinge λ (deriveCardsLambda cere > 0), dar este aceeaşi familie de
  // bug ca #65 şi trebuie curăţat când se face legătura în Increment E.
  assert.equal(withCards.details.avgCards, 0, "artefact preexistent Number(null) → 0");
});

test("[M] statistica nouă NU activează termenul `pace` din RefereeContext", () => {
  const base = {
    refereeName: "Test Ref",
    leagueParams: { cards: 4.2 },
    refereeStats: { avgGoals: 2.7, avgCards: null, homeWinBias: 0.05 }
  };
  const legacy = refereeContextCalculate(base);
  const withCards = refereeContextCalculate({
    ...base,
    refereeStats: { ...base.refereeStats, cards: aggregateRefereeCards(rows(6, 6, 6, 6)) }
  });
  assert.equal(withCards.pace, legacy.pace);
  assert.equal(withCards.tilt, legacy.tilt);
});
