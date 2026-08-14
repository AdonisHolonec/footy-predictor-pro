import test from "node:test";
import assert from "node:assert/strict";

import { selectLeagueRollingFixtures } from "../api/cron/warm-predict.js";
import { buildSeasonTransitionWindow } from "../server-utils/rolling/seasonTransitionWindow.js";

const LEAGUE = 283; // Romania SuperLiga
const CUP = 284; // Cupa Romaniei
const EURO = 3; // Europa League
const SECOND_DIV = 284999; // Liga II

/** Provider-shaped fixture. `day` orders them; higher = more recent. */
const fx = (id, day, leagueId, status = "FT") => ({
  fixture: {
    id,
    date: `2026-08-${String(day).padStart(2, "0")}T15:00:00Z`,
    status: { short: status }
  },
  league: { id: leagueId, season: 2026 },
  teams: { home: { id: 100 }, away: { id: 200 } }
});
const ids = (list) => list.map((f) => f.fixture.id);

// -------------------- 1-2. amestec de competitii --------------------

test("[1] 10 fixture-uri (7 liga + 3 cupa) → rolling foloseste doar cele 7 de liga", () => {
  const all = [
    ...Array.from({ length: 7 }, (_, i) => fx(100 + i, i + 1, LEAGUE)),
    ...Array.from({ length: 3 }, (_, i) => fx(200 + i, i + 8, CUP))
  ];
  const kept = selectLeagueRollingFixtures(all, LEAGUE);
  assert.equal(kept.length, 7);
  assert.ok(kept.every((f) => f.league.id === LEAGUE));
  assert.ok(!ids(kept).some((id) => id >= 200), "niciun meci de cupa nu a trecut");
});

test("[2] 15 fixture-uri (10 liga + 5 europene) → rolling foloseste cele 10 de liga", () => {
  const all = [
    ...Array.from({ length: 10 }, (_, i) => fx(100 + i, i + 1, LEAGUE)),
    ...Array.from({ length: 5 }, (_, i) => fx(300 + i, i + 11, EURO))
  ];
  const kept = selectLeagueRollingFixtures(all, LEAGUE);
  assert.equal(kept.length, 10);
  assert.ok(kept.every((f) => f.league.id === LEAGUE));
});

// -------------------- 3. recenta nu bate competitia --------------------

test("[3] un meci de cupa MAI RECENT nu inlocuieste un meci de liga", () => {
  const all = [...Array.from({ length: 10 }, (_, i) => fx(100 + i, i + 1, LEAGUE)), fx(999, 28, CUP)];
  const kept = selectLeagueRollingFixtures(all, LEAGUE);
  const w = buildSeasonTransitionWindow(kept, [], { target: 10 });
  assert.equal(w.matches.length, 10);
  assert.ok(!ids(w.matches).includes(999), "meciul de cupa a intrat in fereastra");
  assert.equal(w.matches[0].fixture.id, 109, "primul e cel mai recent meci DE LIGA");
});

// -------------------- 4-5. accept / reject explicit --------------------

test("[4] sezon curent: league 283 ACCEPT, league 999 REJECT", () => {
  const all = [fx(1, 1, 283), fx(2, 2, 999)];
  assert.deepEqual(ids(selectLeagueRollingFixtures(all, 283)), [1]);
  assert.deepEqual(ids(selectLeagueRollingFixtures(all, 999)), [2]);
});

test("[5] sezon anterior: aceeasi regula, aceeasi functie", () => {
  const prev = [
    { ...fx(10, 1, 283), league: { id: 283, season: 2025 } },
    { ...fx(11, 2, 999), league: { id: 999, season: 2025 } }
  ];
  assert.deepEqual(ids(selectLeagueRollingFixtures(prev, 283)), [10]);
});

test("[4/5] comparatia este numerica — string-urile provider nu pica silentios", () => {
  const all = [{ ...fx(1, 1, LEAGUE), league: { id: "283", season: 2026 } }];
  assert.equal(selectLeagueRollingFixtures(all, 283).length, 1, "'283' trebuie sa fie egal cu 283");
  assert.equal(selectLeagueRollingFixtures(all, "283").length, 1);
});

// -------------------- 6-7. OFF si ON --------------------

test("[6] Season Transition OFF: lista este deja league-scoped", () => {
  const all = [...Array.from({ length: 6 }, (_, i) => fx(100 + i, i + 1, LEAGUE)), fx(500, 9, EURO)];
  const currentInLeague = selectLeagueRollingFixtures(all, LEAGUE);
  const windowOff = {
    matches: currentInLeague,
    fromCurrent: currentInLeague.length,
    fromPrevious: 0,
    source: "current_only"
  };
  assert.equal(windowOff.matches.length, 6);
  assert.ok(windowOff.matches.every((f) => f.league.id === LEAGUE));
  assert.ok(!ids(windowOff.matches).includes(500));
});

test("[7] Season Transition ON: ambele sezoane sunt league-scoped", () => {
  const cur = [...Array.from({ length: 4 }, (_, i) => fx(100 + i, i + 1, LEAGUE)), fx(500, 9, EURO)];
  const prev = [
    ...Array.from({ length: 8 }, (_, i) => ({
      ...fx(700 + i, i + 1, LEAGUE),
      league: { id: LEAGUE, season: 2025 }
    })),
    { ...fx(800, 20, CUP), league: { id: CUP, season: 2025 } }
  ];
  const w = buildSeasonTransitionWindow(
    selectLeagueRollingFixtures(cur, LEAGUE),
    selectLeagueRollingFixtures(prev, LEAGUE),
    { target: 10 }
  );
  assert.equal(w.fromCurrent, 4);
  assert.equal(w.fromPrevious, 6);
  assert.ok(w.matches.every((f) => f.league.id === LEAGUE), "o competitie straina a intrat");
  assert.ok(!ids(w.matches).includes(500), "meci european in fereastra");
  assert.ok(!ids(w.matches).includes(800), "meci de cupa in fereastra");
});

// -------------------- 8. promovare --------------------

test("[8] echipa promovata: divizia secunda din sezonul anterior este exclusa", () => {
  const cur = Array.from({ length: 4 }, (_, i) => fx(100 + i, i + 1, LEAGUE));
  const prev = Array.from({ length: 30 }, (_, i) => ({
    ...fx(900 + i, (i % 28) + 1, SECOND_DIV),
    league: { id: SECOND_DIV, season: 2025 }
  }));
  const w = buildSeasonTransitionWindow(
    selectLeagueRollingFixtures(cur, LEAGUE),
    selectLeagueRollingFixtures(prev, LEAGUE),
    { target: 10 }
  );
  assert.equal(w.fromCurrent, 4);
  assert.equal(w.fromPrevious, 0, "niciun meci din liga a doua");
  assert.equal(w.matches.length, 4, "fereastra ramane scurta, nimic fabricat");
  assert.equal(w.source, "current_only");
});

// -------------------- 9. cupe europene --------------------

test("[9] meciurile europene nu intra in rolling-ul unei ligi domestice", () => {
  const all = [
    fx(1, 1, LEAGUE),
    fx(2, 2, 2), // Champions League
    fx(3, 3, 3), // Europa League
    fx(4, 4, 848), // Conference League
    fx(5, 5, LEAGUE)
  ];
  assert.deepEqual(ids(selectLeagueRollingFixtures(all, LEAGUE)), [1, 5]);
});

// -------------------- status + robustete --------------------

test("statusurile neterminate raman excluse, ca inainte", () => {
  const all = [
    fx(1, 1, LEAGUE, "FT"),
    fx(2, 2, LEAGUE, "NS"),
    fx(3, 3, LEAGUE, "PST"),
    fx(4, 4, LEAGUE, "AET")
  ];
  assert.deepEqual(ids(selectLeagueRollingFixtures(all, LEAGUE)), [1, 4]);
});

test("intrari invalide → lista goala, fara exceptie", () => {
  assert.deepEqual(selectLeagueRollingFixtures(null, LEAGUE), []);
  assert.deepEqual(selectLeagueRollingFixtures(undefined, LEAGUE), []);
  assert.deepEqual(selectLeagueRollingFixtures([fx(1, 1, LEAGUE)], null), []);
  assert.deepEqual(selectLeagueRollingFixtures([fx(1, 1, LEAGUE)], "abc"), []);
  assert.deepEqual(selectLeagueRollingFixtures([{}, { league: {} }], LEAGUE), []);
});

test("nu muta lista de intrare", () => {
  const all = [fx(3, 3, LEAGUE), fx(1, 1, LEAGUE), fx(2, 2, CUP)];
  const before = ids(all);
  selectLeagueRollingFixtures(all, LEAGUE);
  assert.deepEqual(ids(all), before);
  assert.equal(all.length, 3);
});

// -------------------- separarea conceptelor --------------------

test("team fixture history si league-scoped rolling history raman concepte distincte", () => {
  const teamFixtureHistory = [fx(1, 1, LEAGUE), fx(2, 2, CUP), fx(3, 3, EURO)];
  const rollingHistory = selectLeagueRollingFixtures(teamFixtureHistory, LEAGUE);
  assert.equal(teamFixtureHistory.length, 3, "istoricul brut ramane neatins");
  assert.equal(rollingHistory.length, 1, "doar lista de rolling este filtrata");
});
