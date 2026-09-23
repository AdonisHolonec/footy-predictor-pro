import {
  INTERNATIONAL_CLUB_COMPETITION_IDS,
  LEAGUE_COUNTRY_PRIORITY,
  LEAGUE_TIER_BY_ID
} from "../constants/leagueTierConfig";

/** Where a league sits in the selector's global ordering. */
export type LeagueClassification =
  | { kind: "domestic"; tier: number; countryRank: number }
  | { kind: "international"; rank: number }
  | { kind: "unknown" };

type Sortable = { id: number; name: string; country?: string };

const UNRANKED_COUNTRY = LEAGUE_COUNTRY_PRIORITY.length;
const INTERNATIONAL_GROUP = 1_000;
const UNKNOWN_GROUP = 1_000_000;

/** Pure, id-based: names and countries never influence the class, only the tie-break. */
export function classifyLeague(id: number): LeagueClassification {
  const domestic = LEAGUE_TIER_BY_ID[Number(id)];
  if (domestic) {
    const rank = LEAGUE_COUNTRY_PRIORITY.indexOf(domestic.country);
    return { kind: "domestic", tier: domestic.tier, countryRank: rank === -1 ? UNRANKED_COUNTRY : rank };
  }
  const intl = INTERNATIONAL_CLUB_COMPETITION_IDS.indexOf(Number(id));
  if (intl !== -1) return { kind: "international", rank: intl };
  return { kind: "unknown" };
}

/** Lower sorts first. Domestic tiers 1..n, then international club competitions, then unknown. */
function groupOf(c: LeagueClassification): number {
  if (c.kind === "domestic") return c.tier;
  if (c.kind === "international") return INTERNATIONAL_GROUP;
  return UNKNOWN_GROUP;
}

function withinGroupRank(c: LeagueClassification): number {
  if (c.kind === "domestic") return c.countryRank;
  if (c.kind === "international") return c.rank;
  return 0;
}

/** Fixed locale so the order never depends on the viewer's browser language. */
function compareName(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/**
 * The one ordering used by the league selector.
 *
 * Priority: favorite (absolute) → domestic tier → country priority within the tier →
 * name → id. Match counts, fixture counts and input order play no part, so the same
 * catalog and the same favorites always produce the identical sequence. Input is not mutated.
 */
export function sortLeagues<T extends Sortable>(leagues: readonly T[], favoriteIds: Iterable<number>): T[] {
  const favorites = new Set(Array.from(favoriteIds, (id) => Number(id)));
  const keyed = leagues.map((league) => {
    const c = classifyLeague(league.id);
    return { league, fav: favorites.has(Number(league.id)) ? 0 : 1, group: groupOf(c), rank: withinGroupRank(c) };
  });
  keyed.sort(
    (a, b) =>
      a.fav - b.fav ||
      a.group - b.group ||
      a.rank - b.rank ||
      compareName(a.league.name, b.league.name) ||
      Number(a.league.id) - Number(b.league.id)
  );
  return keyed.map((k) => k.league);
}
