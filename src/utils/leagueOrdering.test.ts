import { describe, expect, it } from "vitest";
import { INTERNATIONAL_CLUB_COMPETITION_IDS, LEAGUE_COUNTRY_PRIORITY, LEAGUE_TIER_BY_ID } from "../constants/leagueTierConfig";
import { classifyLeague, sortLeagues } from "./leagueOrdering";

/** Provider ids as they appear in the current catalog (see leagueTierConfig). */
const L = {
  premier: { id: 39, name: "Premier League", country: "England" },
  laLiga: { id: 140, name: "La Liga", country: "Spain" },
  bundesliga: { id: 78, name: "Bundesliga", country: "Germany" },
  serieA: { id: 135, name: "Serie A", country: "Italy" },
  ligue1: { id: 61, name: "Ligue 1", country: "France" },
  ligaI: { id: 283, name: "Liga I", country: "Romania" },
  championship: { id: 40, name: "Championship", country: "England" },
  segunda: { id: 141, name: "Segunda División", country: "Spain" },
  bundesliga2: { id: 79, name: "2. Bundesliga", country: "Germany" },
  serieB: { id: 136, name: "Serie B", country: "Italy" },
  ligue2: { id: 62, name: "Ligue 2", country: "France" },
  ligaII: { id: 284, name: "Liga II", country: "Romania" },
  leagueOne: { id: 41, name: "League One", country: "England" },
  liga3: { id: 80, name: "3. Liga", country: "Germany" },
  serieCA: { id: 138, name: "Serie C - Girone A", country: "Italy" },
  ligaIII1: { id: 784, name: "Liga III - Serie 1", country: "Romania" },
  leagueTwo: { id: 42, name: "League Two", country: "England" },
  nationalLeague: { id: 43, name: "National League", country: "England" },
  ucl: { id: 2, name: "UEFA Champions League", country: "World" },
  uel: { id: 3, name: "UEFA Europa League", country: "World" },
  nationsLeague: { id: 5, name: "UEFA Nations League", country: "World" },
  zambia: { id: 351, name: "Super League", country: "Zambia" },
  faCup: { id: 45, name: "FA Cup", country: "England" },
  primavera: { id: 705, name: "Campionato Primavera - 1", country: "Italy" }
};
const ALL = Object.values(L);
const ids = (xs: Array<{ id: number }>) => xs.map((x) => x.id);
const shuffle = <T,>(xs: T[]) => [...xs].sort(() => 0.5 - ((xs.length * 7919) % 13) / 13);

describe("leagueTierConfig · integrity", () => {
  it("every tier entry names a country that has a priority slot, and tiers are small positive integers", () => {
    for (const [id, entry] of Object.entries(LEAGUE_TIER_BY_ID)) {
      expect(LEAGUE_COUNTRY_PRIORITY, `country of ${id}`).toContain(entry.country);
      expect(Number.isInteger(entry.tier) && entry.tier >= 1 && entry.tier <= 5, `tier of ${id}`).toBe(true);
    }
  });
  it("each classified country has exactly one tier-1 league", () => {
    const top = new Map<string, number[]>();
    for (const [id, e] of Object.entries(LEAGUE_TIER_BY_ID)) if (e.tier === 1) top.set(e.country, [...(top.get(e.country) || []), Number(id)]);
    for (const [country, list] of top) expect(list, country).toHaveLength(1);
  });
  it("international club competitions never carry a domestic tier", () => {
    for (const id of INTERNATIONAL_CLUB_COMPETITION_IDS) expect(LEAGUE_TIER_BY_ID[id]).toBeUndefined();
  });
  it("classifies by id only: a cup, a youth league and a national-team competition are unknown", () => {
    expect(classifyLeague(45)).toEqual({ kind: "unknown" });
    expect(classifyLeague(705)).toEqual({ kind: "unknown" });
    expect(classifyLeague(5)).toEqual({ kind: "unknown" });
    expect(classifyLeague(2)).toEqual({ kind: "international", rank: 0 });
    expect(classifyLeague(40)).toEqual({ kind: "domestic", tier: 2, countryRank: 0 });
  });
});

describe("sortLeagues · global division ordering", () => {
  it("favorites always come first, even a tier-3 favorite above every non-favorite tier-1 league", () => {
    const out = ids(sortLeagues(shuffle(ALL), [L.serieCA.id, L.championship.id]));
    expect(out.slice(0, 2)).toEqual([L.championship.id, L.serieCA.id]);
    expect(out[2]).toBe(L.premier.id);
  });

  it("all tier 1, then all tier 2, then tier 3, tier 4, tier 5 — never grouped by country", () => {
    const out = ids(sortLeagues(shuffle(ALL), []));
    const tierOf = (id: number) => { const c = classifyLeague(id); return c.kind === "domestic" ? c.tier : 99; };
    const domestic = out.filter((id) => tierOf(id) !== 99).map(tierOf);
    expect(domestic).toEqual([...domestic].sort((a, b) => a - b));
    expect(out.indexOf(L.ligaII.id)).toBeGreaterThan(out.indexOf(L.ligaI.id));
    expect(out.indexOf(L.championship.id)).toBeGreaterThan(out.indexOf(L.ligaI.id)); // tier 2 England after tier 1 Romania
    expect(out.indexOf(L.leagueOne.id)).toBeGreaterThan(out.indexOf(L.ligaII.id)); // tier 3 after every tier 2
    expect(out.indexOf(L.leagueTwo.id)).toBeGreaterThan(out.indexOf(L.ligaIII1.id)); // tier 4 after every tier 3
    expect(out.indexOf(L.nationalLeague.id)).toBeGreaterThan(out.indexOf(L.leagueTwo.id)); // tier 5 after tier 4
  });

  it("orders the principal markets deliberately inside a tier: England, Spain, Italy, Germany, France, … Romania", () => {
    const out = ids(sortLeagues(shuffle(ALL), []));
    expect(out.slice(0, 6)).toEqual([L.premier.id, L.laLiga.id, L.serieA.id, L.bundesliga.id, L.ligue1.id, L.ligaI.id]);
    const t2 = [L.championship.id, L.segunda.id, L.serieB.id, L.bundesliga2.id, L.ligue2.id, L.ligaII.id];
    expect(out.slice(6, 12)).toEqual(t2);
  });

  it("international club competitions follow every domestic tier and precede the unclassified block", () => {
    const out = ids(sortLeagues(shuffle(ALL), []));
    const lastDomestic = out.indexOf(L.nationalLeague.id);
    expect(out.indexOf(L.ucl.id)).toBeGreaterThan(lastDomestic);
    expect(out.indexOf(L.uel.id)).toBe(out.indexOf(L.ucl.id) + 1);
    expect(out.indexOf(L.nationsLeague.id)).toBeGreaterThan(out.indexOf(L.uel.id));
  });

  it("unclassified leagues sit at the bottom in a deterministic alphabetical order, id as the last tie-breaker", () => {
    const out = sortLeagues(shuffle(ALL), []);
    const tail = out.filter((l) => classifyLeague(l.id).kind === "unknown").map((l) => l.name);
    expect(tail).toEqual(["Campionato Primavera - 1", "FA Cup", "Super League", "UEFA Nations League"]);
    const twins = sortLeagues([{ id: 9002, name: "Same" }, { id: 9001, name: "Same" }, { id: 9000, name: "same" }], []);
    expect(ids(twins)).toEqual([9000, 9001, 9002]);
  });

  it("is a pure function: same input → identical output, input untouched, no duplicates introduced", () => {
    const input = shuffle(ALL);
    const snapshot = ids(input);
    const a = ids(sortLeagues(input, [L.zambia.id]));
    const b = ids(sortLeagues([...input].reverse(), [L.zambia.id]));
    expect(a).toEqual(b);
    expect(ids(input)).toEqual(snapshot);
    expect(new Set(a).size).toBe(a.length);
  });

  it("ignores match counts and any other field than id/name", () => {
    const withCounts = ALL.map((l, i) => ({ ...l, matches: (ALL.length - i) * 3 }));
    expect(ids(sortLeagues(withCounts, []))).toEqual(ids(sortLeagues(ALL, [])));
  });
});
