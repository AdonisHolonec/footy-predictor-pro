import test from "node:test";
import assert from "node:assert/strict";

import { collectTeamRollingMatches } from "../api/cron/warm-predict.js";
import { aggregateRollingForTeam, MIN_MARKET_SAMPLES } from "../server-utils/teamMarketRolling.js";

const TEAM = 100;
const OPP = 200;

/** Provider-shaped fixture for TEAM vs OPP. */
const fixture = (id, isHome = true) => ({
  fixture: { id, date: `2025-08-${String(id).padStart(2, "0")}T15:00:00Z` },
  teams: { home: { id: isHome ? TEAM : OPP }, away: { id: isHome ? OPP : TEAM } }
});

/** A /fixtures/statistics payload with real values for both sides. */
const statsPayload = (yellow = 2) => ({
  response: [
    {
      team: { id: TEAM },
      statistics: [
        { type: "Corner Kicks", value: 5 },
        { type: "Shots on Goal", value: 4 },
        { type: "Total Shots", value: 12 },
        { type: "Yellow Cards", value: yellow },
        { type: "Red Cards", value: null }
      ]
    },
    {
      team: { id: OPP },
      statistics: [
        { type: "Corner Kicks", value: 4 },
        { type: "Shots on Goal", value: 3 },
        { type: "Total Shots", value: 10 },
        { type: "Yellow Cards", value: 3 },
        { type: "Red Cards", value: null }
      ]
    }
  ]
});

/** Fetcher that misses cache by default (every call costs budget) and counts invocations. */
function makeFetcher({ cachedIds = new Set(), failIds = new Set() } = {}) {
  const calls = [];
  return {
    calls,
    fetchStats: async (fixtureId) => {
      calls.push(fixtureId);
      if (failIds.has(fixtureId)) return { ok: false, fromCache: cachedIds.has(fixtureId) };
      return { ok: true, data: statsPayload(), fromCache: cachedIds.has(fixtureId) };
    }
  };
}

const window15 = Array.from({ length: 15 }, (_, i) => fixture(i + 1, i % 2 === 0));

// -------------------- 1. buget suficient --------------------

test("[1] buget suficient → echipa completa, exista candidat de persistare", async () => {
  const { fetchStats, calls } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 15,
    fetchStats
  });
  assert.equal(r.complete, true);
  assert.equal(r.matches.length, 15);
  assert.equal(r.processed, 15);
  assert.equal(r.requested, 15);
  assert.equal(r.budget, 0);
  assert.equal(r.reason, null);
  assert.equal(calls.length, 15);

  const agg = aggregateRollingForTeam(r.matches);
  assert.equal(agg.matches_sampled, 15);
  assert.ok(agg.matches_sampled >= MIN_MARKET_SAMPLES);
});

// -------------------- 2-5. buget insuficient --------------------

test("[2] buget zero inainte de prima statistica → echipa NU este persistata", async () => {
  const { fetchStats, calls } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 0,
    fetchStats
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.matches, [], "zero meciuri → nu exista ce agrega");
  assert.equal(r.processed, 0);
  assert.equal(calls.length, 0, "niciun apel API irosit");
  assert.equal(r.reason, "budget_exhausted_mid_team");
});

for (const spent of [1, 2, 14]) {
  test(`[3-5] buget epuizat dupa ${spent} fixture-uri → echipa NU este persistata`, async () => {
    const { fetchStats } = makeFetcher();
    const r = await collectTeamRollingMatches({
      teamId: TEAM,
      teamFixtures: window15,
      budget: spent,
      fetchStats
    });
    assert.equal(r.complete, false);
    assert.deepEqual(r.matches, [], `${spent} meciuri colectate nu trebuie sa devina un agregat`);
    assert.equal(r.processed, spent, "apelurile facute sunt raportate onest");
    assert.equal(r.requested, 15);
    assert.equal(r.reason, "budget_exhausted_mid_team");
  });
}

// -------------------- 6. echipa urmatoare --------------------

test("[6] o echipa urmatoare poate fi procesata daca a ramas buget", async () => {
  const { fetchStats } = makeFetcher();
  const teamA = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15.slice(0, 5),
    budget: 12,
    fetchStats
  });
  assert.equal(teamA.complete, true);
  assert.equal(teamA.budget, 7);

  const teamB = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15.slice(0, 5),
    budget: teamA.budget,
    fetchStats
  });
  assert.equal(teamB.complete, true, "bugetul ramas ajunge pentru inca o echipa");
  assert.equal(teamB.budget, 2);
});

// -------------------- 7. niciun rolling sub prag din trunchiere --------------------

test("[7] truncherea nu poate produce un rolling sub MIN_MARKET_SAMPLES", async () => {
  for (let budget = 0; budget < 15; budget += 1) {
    const { fetchStats } = makeFetcher();
    const r = await collectTeamRollingMatches({
      teamId: TEAM,
      teamFixtures: window15,
      budget,
      fetchStats
    });
    assert.equal(r.complete, false, `budget=${budget}`);
    assert.equal(r.matches.length, 0, `budget=${budget} a produs ${r.matches.length} meciuri`);
    const wouldHaveBeen = aggregateRollingForTeam(r.matches);
    assert.equal(wouldHaveBeen.matches_sampled, 0, "nimic de persistat");
  }
});

// -------------------- 8. regresie: snapshot-ul existent nu este inlocuit --------------------

test("[8] un rolling existent NU este inlocuit de un agregat partial", async () => {
  const existing = { team_id: TEAM, matches_sampled: 15, corners_for_avg: 5.4, cards_for_avg: 2.2 };
  const { fetchStats } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 3,
    fetchStats
  });

  // Reproduce decizia apelantului: incomplet → continue, deci niciun rand candidat.
  const updatedRows = [];
  if (r.complete && r.matches.length) {
    const agg = aggregateRollingForTeam(r.matches);
    if (agg.matches_sampled > 0) updatedRows.push({ team_id: TEAM, ...agg });
  }
  assert.equal(updatedRows.length, 0, "nimic nu ajunge la persistTeamMarketRolling");
  assert.equal(existing.matches_sampled, 15, "snapshot-ul anterior ramane neatins");
  assert.equal(existing.corners_for_avg, 5.4);
});

// -------------------- 9. granita exacta --------------------

test("[9] buget epuizat EXACT dupa ultimul fixture → echipa este completa", async () => {
  const { fetchStats } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 15,
    fetchStats
  });
  assert.equal(r.budget, 0, "bugetul s-a consumat complet");
  assert.equal(r.complete, true, "dar bucla s-a terminat pentru ca nu mai erau fixture-uri");
  assert.equal(r.matches.length, 15);
});

test("[9] buget cu exact 1 mai putin decat necesar → incomplet", async () => {
  const { fetchStats } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 14,
    fetchStats
  });
  assert.equal(r.complete, false);
  assert.equal(r.matches.length, 0);
});

// -------------------- scenariul din brief (sectiunea 6) --------------------

test("[brief] 15 fixture-uri necesare, buget 3 → SKIPPED, persist = false", async () => {
  const { fetchStats } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 3,
    fetchStats
  });
  assert.equal(r.complete, false);
  assert.equal(r.matches.length, 0);

  const agg = aggregateRollingForTeam(r.matches);
  for (const k of [
    "cards_for_avg",
    "cards_against_avg",
    "corners_for_avg",
    "corners_against_avg",
    "sot_for_avg",
    "sot_against_avg",
    "shots_total_for_avg",
    "shots_total_against_avg"
  ]) {
    assert.equal(agg[k], null, `${k} nu trebuie calculat din 3 meciuri`);
  }
});

// -------------------- cache nu consuma buget --------------------

test("[cache] fixture-urile din cache nu consuma buget si nu blocheaza echipa", async () => {
  const cachedIds = new Set(window15.map((f) => f.fixture.id));
  const { fetchStats } = makeFetcher({ cachedIds });
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 1,
    fetchStats
  });
  assert.equal(r.complete, true, "totul din cache → un singur buget ajunge");
  assert.equal(r.budget, 1, "bugetul ramane neatins");
  assert.equal(r.matches.length, 15);
});

// -------------------- robustete --------------------

test("[robustete] un fixture cu statistici indisponibile nu rupe colectarea", async () => {
  const { fetchStats } = makeFetcher({ failIds: new Set([3]) });
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: window15,
    budget: 15,
    fetchStats
  });
  assert.equal(r.complete, true, "un esec punctual nu inseamna trunchiere de buget");
  assert.equal(r.matches.length, 14);
  assert.equal(r.processed, 15);
});

test("[robustete] lista goala de fixture-uri → complet, fara meciuri", async () => {
  const { fetchStats, calls } = makeFetcher();
  const r = await collectTeamRollingMatches({
    teamId: TEAM,
    teamFixtures: [],
    budget: 10,
    fetchStats
  });
  assert.equal(r.complete, true, "nu e o trunchiere de buget — pur si simplu nu are meciuri");
  assert.equal(r.matches.length, 0);
  assert.equal(r.budget, 10);
  assert.equal(calls.length, 0);
});
