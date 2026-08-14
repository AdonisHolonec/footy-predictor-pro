import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveCardsBaselineFromRolling,
  resolveCardsBaseline,
  BASELINE_SOURCES
} from "../server-utils/analysis/empiricalCardsBaseline.js";
import { MIN_CARDS_BASELINE_SAMPLE } from "../server-utils/analysis/cardsBaselineAnalysis.js";

/** A team_market_rolling row. `n` is team-observations (matches this team played). */
const row = (teamId, forAvg, n, { leagueId = 39, season = 2025, updatedAt = null } = {}) => ({
  team_id: teamId,
  league_id: leagueId,
  season,
  cards_for_avg: forAvg,
  cards_against_avg: forAvg,
  matches_sampled: n,
  samples_by_market: { cards: n, cards_home: Math.ceil(n / 2), cards_away: Math.floor(n / 2) },
  updated_at: updatedAt
});

/** A league of `teams` rows each with `n` matches — sample = teams*n/2 matches. */
const league = (teams, forAvg, n, opts) =>
  Array.from({ length: teams }, (_, i) => row(100 + i, forAvg, n, opts));

// -------------------- contract --------------------

test("contract: toate campurile cerute sunt prezente, cu unitatea explicita", () => {
  const b = deriveCardsBaselineFromRolling(league(20, 2.15, 10), { leagueId: 39, season: 2025 });
  for (const k of [
    "league_id",
    "season",
    "cards_total_mean",
    "sample_size",
    "std_dev",
    "source",
    "updated_at",
    "unit",
    "sufficient"
  ]) {
    assert.ok(k in b, `lipseste campul ${k}`);
  }
  assert.equal(b.unit, "cardsTotal");
  assert.equal(b.league_id, 39);
  assert.equal(b.season, 2025);
});

test("derivare: media pe meci = 2 x media ponderata a cards_for_avg", () => {
  const b = deriveCardsBaselineFromRolling(league(20, 2.15, 10), { leagueId: 39, season: 2025 });
  assert.equal(b.cards_total_mean, 4.3, "2 x 2.15");
  assert.equal(b.sample_size, 100, "20 echipe x 10 meciuri / 2 = 100 meciuri");
});

test("derivare: ponderarea respecta sample-ul fiecarei echipe", () => {
  const b = deriveCardsBaselineFromRolling([row(1, 3.0, 30), row(2, 1.0, 10)], {
    leagueId: 39,
    season: 2025,
    minSample: 1
  });
  assert.equal(b.cards_total_mean, 5, "2 x (3*30 + 1*10)/40 = 5");
  assert.notEqual(b.cards_total_mean, 4, "media ne-ponderata ar da 4");
});

test("derivare: accepta si un Map (forma pe care loadTeamMarketRolling o intoarce)", () => {
  const rows = league(20, 2.15, 10);
  const asMap = new Map(rows.map((r) => [r.team_id, r]));
  assert.deepEqual(
    deriveCardsBaselineFromRolling(asMap, { leagueId: 39, season: 2025 }),
    deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 })
  );
});

// -------------------- league / season isolation --------------------

test("season isolation: randurile din alt sezon sunt ignorate", () => {
  const rows = [...league(20, 2.15, 10, { season: 2025 }), ...league(20, 5.0, 10, { season: 2024 })];
  const b = deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 });
  assert.equal(b.cards_total_mean, 4.3, "sezonul 2024 nu contribuie");
  assert.equal(b.sample_size, 100);
});

test("league isolation: randurile din alta liga sunt ignorate", () => {
  const rows = [
    ...league(20, 2.15, 10, { leagueId: 39 }),
    ...league(20, 5.0, 10, { leagueId: 140 })
  ];
  assert.equal(deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 }).cards_total_mean, 4.3);
});

test("izolare: acelasi set de randuri produce baseline-uri diferite per liga", () => {
  const rows = [
    ...league(20, 2.0, 10, { leagueId: 39 }),
    ...league(20, 2.5, 10, { leagueId: 140 })
  ];
  assert.equal(deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 }).cards_total_mean, 4);
  assert.equal(deriveCardsBaselineFromRolling(rows, { leagueId: 140, season: 2025 }).cards_total_mean, 5);
});

// -------------------- UNKNOWN / null / zero / malformed --------------------

test("UNKNOWN: un rand cu cards_for_avg null nu intra in medie", () => {
  const rows = [
    ...league(10, 2.0, 10),
    ...league(10, null, 10).map((r) => ({ ...r, team_id: r.team_id + 50 }))
  ];
  const b = deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 });
  assert.equal(b.cards_total_mean, 4, "randurile null nu trag media spre 0");
  assert.equal(b.sample_size, 50, "si nici nu contribuie la sample");
});

test("UNKNOWN: sample 0 sau negativ este ignorat", () => {
  const rows = [row(1, 2.0, 10), row(2, 9.0, 0), row(3, 9.0, -5)];
  const b = deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.cards_total_mean, 4);
});

test("malformed: valori ne-numerice sunt respinse, nu coercite", () => {
  const rows = [row(1, 2.0, 10), row(2, "abc", 10), row(3, "", 10)];
  const b = deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.cards_total_mean, 4);
  assert.equal(b.sample_size, 5);
});

test("zero real: o liga fara cartonase produce 0, nu 'indisponibil'", () => {
  const b = deriveCardsBaselineFromRolling(league(20, 0, 10), { leagueId: 39, season: 2025 });
  assert.equal(b.cards_total_mean, 0);
  assert.equal(b.sample_size, 100);
  assert.equal(b.sufficient, true, "un 0 observat este o observatie, nu o absenta");
});

test("randuri absente: fara date → mean null, sample 0, insuficient", () => {
  const b = deriveCardsBaselineFromRolling([], { leagueId: 39, season: 2025 });
  assert.equal(b.cards_total_mean, null);
  assert.equal(b.sample_size, 0);
  assert.equal(b.sufficient, false);
  assert.equal(deriveCardsBaselineFromRolling(null, {}).cards_total_mean, null);
});

// -------------------- std_dev honesty --------------------

test("std_dev: raportat ca indisponibil pe calea rolling, nu inventat", () => {
  const b = deriveCardsBaselineFromRolling(league(20, 2.15, 10), { leagueId: 39, season: 2025 });
  assert.equal(b.std_dev, null);
  assert.equal(b.std_dev_available, false, "randurile rolling nu contin sume de patrate");
});

// -------------------- sample gate --------------------

test("sample gate: sub 40 de meciuri → insufficient", () => {
  const b = deriveCardsBaselineFromRolling(league(10, 2.15, 6), { leagueId: 39, season: 2025 });
  assert.equal(b.sample_size, 30);
  assert.equal(b.sufficient, false);
  assert.equal(b.cards_total_mean, 4.3, "media ramane vizibila chiar si sub prag");
});

test("sample gate: exact 40 → sufficient", () => {
  const b = deriveCardsBaselineFromRolling(league(10, 2.15, 8), { leagueId: 39, season: 2025 });
  assert.equal(b.sample_size, 40);
  assert.equal(b.sufficient, true);
});

test("sample gate: peste 40 → sufficient", () => {
  const b = deriveCardsBaselineFromRolling(league(20, 2.15, 15), { leagueId: 39, season: 2025 });
  assert.equal(b.sample_size, 150);
  assert.equal(b.sufficient, true);
});

test("sample gate: pragul folosit este cel din Increment E", () => {
  assert.equal(MIN_CARDS_BASELINE_SAMPLE, 40);
  const justUnder = deriveCardsBaselineFromRolling([row(1, 2.15, 39), row(2, 2.15, 39)], {
    leagueId: 39,
    season: 2025
  });
  assert.equal(justUnder.sample_size, 39);
  assert.equal(justUnder.sufficient, false);
});

// -------------------- fallback chain --------------------

const sufficientCurrent = deriveCardsBaselineFromRolling(league(20, 2.05, 10), {
  leagueId: 39,
  season: 2025
});
const insufficientCurrent = deriveCardsBaselineFromRolling(league(4, 2.05, 5), {
  leagueId: 39,
  season: 2025
});
const sufficientPrevious = deriveCardsBaselineFromRolling(league(20, 2.4, 10, { season: 2024 }), {
  leagueId: 39,
  season: 2024
});

test("fallback 1: sezonul curent cu sample suficient castiga", () => {
  const r = resolveCardsBaseline({
    current: sufficientCurrent,
    previous: sufficientPrevious,
    staticCards: 3.6,
    leagueId: 39,
    season: 2025
  });
  assert.equal(r.source, BASELINE_SOURCES.CURRENT);
  assert.equal(r.cards_total_mean, 4.1);
});

test("fallback 2: sezonul curent insuficient → sezonul precedent", () => {
  const r = resolveCardsBaseline({
    current: insufficientCurrent,
    previous: sufficientPrevious,
    staticCards: 3.6,
    leagueId: 39,
    season: 2025
  });
  assert.equal(r.source, BASELINE_SOURCES.PREVIOUS);
  assert.equal(r.cards_total_mean, 4.8);
  assert.equal(r.season, 2024, "baseline-ul descrie sezonul 2024");
  assert.equal(r.applied_to_season, 2025, "dar este folosit pentru 2025");
});

test("fallback 3: fara empiric utilizabil → config static", () => {
  const r = resolveCardsBaseline({
    current: insufficientCurrent,
    previous: null,
    staticCards: 3.6,
    leagueId: 39,
    season: 2025
  });
  assert.equal(r.source, BASELINE_SOURCES.STATIC);
  assert.equal(r.cards_total_mean, 3.6);
  assert.equal(r.sample_size, 0);
  assert.equal(r.sufficient, true);
});

test("fallback 4: nimic disponibil → unavailable, nu o valoare inventata", () => {
  const r = resolveCardsBaseline({
    current: null,
    previous: null,
    staticCards: null,
    leagueId: 39,
    season: 2025
  });
  assert.equal(r.source, BASELINE_SOURCES.UNAVAILABLE);
  assert.equal(r.cards_total_mean, null);
  assert.equal(r.sufficient, false);
});

test("fallback: un config static invalid nu este folosit", () => {
  for (const bad of [0, -1, null, "", "abc"]) {
    const r = resolveCardsBaseline({ current: null, previous: null, staticCards: bad });
    assert.equal(r.source, BASELINE_SOURCES.UNAVAILABLE, `staticCards=${JSON.stringify(bad)}`);
  }
});

test("fallback: un sezon precedent INSUFICIENT nu sare peste config-ul static", () => {
  const r = resolveCardsBaseline({
    current: insufficientCurrent,
    previous: deriveCardsBaselineFromRolling(league(2, 9.9, 4, { season: 2024 }), {
      leagueId: 39,
      season: 2024
    }),
    staticCards: 3.6,
    leagueId: 39,
    season: 2025
  });
  assert.equal(r.source, BASELINE_SOURCES.STATIC);
  assert.equal(r.cards_total_mean, 3.6);
});

// -------------------- determinism --------------------

test("determinism: ordinea randurilor nu schimba rezultatul", () => {
  const rows = [row(1, 1.8, 12), row(2, 2.4, 8), row(3, 2.0, 20)];
  const a = deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025, minSample: 1 });
  const b = deriveCardsBaselineFromRolling([...rows].reverse(), {
    leagueId: 39,
    season: 2025,
    minSample: 1
  });
  assert.deepEqual(b, a);
});

test("determinism: acelasi input → acelasi output la rulari repetate", () => {
  const rows = league(20, 2.15, 10);
  assert.deepEqual(
    deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 }),
    deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025 })
  );
});

test("duplicate: doua randuri pentru aceeasi echipa dubleaza sample-ul, nu media", () => {
  // Dedublarea apartine sursei randurilor: cheia primara (team_id, league_id, season)
  // garanteaza unicitatea in loadTeamMarketRolling. Testul fixeaza contractul.
  const dup = [row(1, 2.0, 10), row(1, 2.0, 10)];
  const b = deriveCardsBaselineFromRolling(dup, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.sample_size, 10, "10+10 team-observatii = 10 meciuri");
  assert.equal(b.cards_total_mean, 4, "media ramane corecta");
});

// -------------------- updated_at --------------------

test("updated_at: se raporteaza cel mai recent timestamp din randuri", () => {
  const rows = [
    row(1, 2.0, 10, { updatedAt: "2026-04-20T11:08:12.704+00:00" }),
    row(2, 2.0, 10, { updatedAt: "2026-08-13T09:00:00.000+00:00" }),
    row(3, 2.0, 10, { updatedAt: null })
  ];
  const b = deriveCardsBaselineFromRolling(rows, { leagueId: 39, season: 2025, minSample: 1 });
  assert.equal(b.updated_at, "2026-08-13T09:00:00.000+00:00");
});
