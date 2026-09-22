import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCompetition,
  classifyFixtureCompetition,
  isGatedCompetition,
  isNationalCompetitionGateEnabled,
  parseExtraGatedLeagueIds,
  NATIONAL_COMPETITION_CATALOG,
  UNSUPPORTED_NATIONAL_COMPETITION
} from "../../server-utils/competition/competitionCatalog.js";

function withEnv(name, value, fn) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

test("UEFA Nations League (id 5) is an unsupported national competition", () => {
  const c = classifyCompetition({ leagueId: 5, leagueName: "UEFA Nations League", leagueType: "Cup", country: "World" });
  assert.equal(c.entityType, "NATIONAL_TEAM");
  assert.equal(c.competitionType, "NATIONS_LEAGUE");
  assert.equal(c.supported, false);
  assert.equal(c.reason, UNSUPPORTED_NATIONAL_COMPETITION);
  assert.equal(c.source, "catalog");
  assert.equal(c.leagueId, 5);
  assert.deepEqual(c.provider, { type: "Cup", country: "World", name: "UEFA Nations League" });
});

test("the catalog holds exactly the verified ids and no accidental changes", () => {
  assert.deepEqual(Object.keys(NATIONAL_COMPETITION_CATALOG).sort(), ["1", "10", "32", "4", "5", "960"]);
  assert.equal(NATIONAL_COMPETITION_CATALOG["5"].competitionType, "NATIONS_LEAGUE");
  assert.equal(NATIONAL_COMPETITION_CATALOG["960"].competitionType, "EURO_QUALIFICATION");
  for (const entry of Object.values(NATIONAL_COMPETITION_CATALOG)) assert.equal(entry.supported, false);
});

test("Euro qualification (id 960) is an unsupported national competition with the same semantics as league 5", () => {
  const c = classifyCompetition({ leagueId: 960, leagueName: "Euro Championship - Qualification", leagueType: "Cup", country: "World" });
  assert.equal(c.entityType, "NATIONAL_TEAM");
  assert.equal(c.competitionType, "EURO_QUALIFICATION");
  assert.equal(c.supported, false);
  assert.equal(c.reason, UNSUPPORTED_NATIONAL_COMPETITION);
  assert.equal(c.source, "catalog");
  assert.equal(isGatedCompetition(c), true);
  const nl = classifyCompetition({ leagueId: 5 });
  assert.deepEqual({ entityType: c.entityType, supported: c.supported, reason: c.reason, source: c.source }, { entityType: nl.entityType, supported: nl.supported, reason: nl.reason, source: nl.source });
});

test("every catalog entry classifies as an unsupported national competition", () => {
  for (const id of Object.keys(NATIONAL_COMPETITION_CATALOG)) {
    const c = classifyCompetition({ leagueId: id });
    assert.equal(c.entityType, "NATIONAL_TEAM", `id ${id}`);
    assert.equal(c.supported, false, `id ${id}`);
    assert.equal(c.reason, UNSUPPORTED_NATIONAL_COMPETITION, `id ${id}`);
  }
});

test("a club competition is supported and untouched by the catalog", () => {
  const c = classifyCompetition({ leagueId: "39", leagueName: "Premier League", leagueType: "League", country: "England" });
  assert.equal(c.entityType, "CLUB");
  assert.equal(c.competitionType, "CLUB_COMPETITION");
  assert.equal(c.supported, true);
  assert.equal(c.reason, null);
  assert.equal(c.source, "default");
});

test("World + Cup provider markers alone never classify as national (Champions League id 2)", () => {
  const c = classifyCompetition({ leagueId: 2, leagueName: "UEFA Champions League", leagueType: "Cup", country: "World" });
  assert.equal(c.entityType, "CLUB");
  assert.equal(c.supported, true);
  assert.equal(isGatedCompetition(c), false);
});

test("an invalid or missing league id is supported and carries leagueId null", () => {
  for (const bad of [undefined, null, "", "abc", 0, -5, 39.7]) {
    const c = classifyCompetition({ leagueId: bad });
    assert.equal(c.supported, true, String(bad));
    assert.equal(c.leagueId, null, String(bad));
  }
});

test("classifyFixtureCompetition reads the fixture league block and falls back to the loop league id", () => {
  const fromFixture = classifyFixtureCompetition({ league: { id: 5, name: "UEFA Nations League", type: "Cup", country: "World" } }, 39);
  assert.equal(fromFixture.leagueId, 5);
  assert.equal(fromFixture.supported, false);
  const fromFallback = classifyFixtureCompetition({ league: {} }, "5");
  assert.equal(fromFallback.leagueId, 5);
  assert.equal(fromFallback.supported, false);
});

test("PREDICT_NATIONAL_COMPETITION_GATE=0 disables the decision but not the classification", () => {
  withEnv("PREDICT_NATIONAL_COMPETITION_GATE", "0", () => {
    const c = classifyCompetition({ leagueId: 5 });
    assert.equal(isNationalCompetitionGateEnabled(), false);
    assert.equal(c.supported, false);
    assert.equal(isGatedCompetition(c), false);
  });
  withEnv("PREDICT_NATIONAL_COMPETITION_GATE", undefined, () => {
    assert.equal(isNationalCompetitionGateEnabled(), true);
    assert.equal(isGatedCompetition(classifyCompetition({ leagueId: 5 })), true);
  });
});

test("extra env league ids gate at runtime; malformed segments are dropped", () => {
  assert.deepEqual(parseExtraGatedLeagueIds(" 34, ,0,-1,39.7,abc,32,34"), [34, 32, 34]);
  withEnv("PREDICT_NATIONAL_COMPETITION_EXTRA_LEAGUE_IDS", "34", () => {
    const c = classifyCompetition({ leagueId: 34 });
    assert.equal(c.entityType, "NATIONAL_TEAM");
    assert.equal(c.supported, false);
    assert.equal(c.source, "env");
    assert.equal(isGatedCompetition(c), true);
  });
  withEnv("PREDICT_NATIONAL_COMPETITION_EXTRA_LEAGUE_IDS", undefined, () => {
    assert.equal(classifyCompetition({ leagueId: 34 }).supported, true);
  });
});
