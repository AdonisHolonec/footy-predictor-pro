/**
 * Rebuild Elo ratings per league from API-Football historical fixtures.
 *
 * Rulează:
 *   BACKFILL_SEASONS=2023,2024 LEAGUE_IDS=39,140,135,78,61 \
 *     node --env-file=.env.local scripts/rebuildElo.js
 *
 * Costă fiecare request API-Football — rulează OPT-IN, cu listă de ligi scurtă.
 * După ce rulează o dată, cron-ul `api/cron/elo-update` poate actualiza incremental.
 */
import { updateEloPair, persistEloMap, DEFAULT_ELO } from "../server-utils/teamElo.js";

// Dual-provider detect: APISPORTS_KEY (direct) prioritar faţă de X_RAPIDAPI_KEY (legacy).
function resolveUpstream() {
  const explicit = process.env.UPSTREAM_BASE_URL;
  const apiSportsKey = process.env.APISPORTS_KEY;
  const rapidKey = process.env.X_RAPIDAPI_KEY;
  if (apiSportsKey) {
    return {
      provider: "apisports",
      baseUrl: explicit || "https://v3.football.api-sports.io",
      headers: { "x-apisports-key": apiSportsKey }
    };
  }
  if (rapidKey) {
    return {
      provider: "rapidapi",
      baseUrl: explicit || "https://api-football-v1.p.rapidapi.com/v3",
      headers: {
        "X-RapidAPI-Key": rapidKey,
        "X-RapidAPI-Host": process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com"
      }
    };
  }
  return null;
}
const UPSTREAM = resolveUpstream();

async function fetchFixturesForLeagueSeason(leagueId, season) {
  const u = new URL(UPSTREAM.baseUrl + "/fixtures");
  u.searchParams.set("league", String(leagueId));
  u.searchParams.set("season", String(season));
  u.searchParams.set("status", "FT-AET-PEN");
  const res = await fetch(u.toString(), { headers: UPSTREAM.headers });
  const json = await res.json();
  return json?.response || [];
}

function extractResult(fx) {
  const hId = fx?.teams?.home?.id;
  const aId = fx?.teams?.away?.id;
  const hg = fx?.goals?.home;
  const ag = fx?.goals?.away;
  const when = fx?.fixture?.date;
  if (!hId || !aId || typeof hg !== "number" || typeof ag !== "number") return null;
  return { homeId: Number(hId), awayId: Number(aId), homeGoals: hg, awayGoals: ag, when };
}

async function rebuildForLeague(leagueId, seasons) {
  const state = new Map();
  let processed = 0;
  const get = (id) => {
    if (!state.has(id)) state.set(id, { elo: DEFAULT_ELO, matchesPlayed: 0, lastMatchAt: null });
    return state.get(id);
  };

  for (const season of seasons) {
    console.log(`  season ${season}`);
    const fixtures = await fetchFixturesForLeagueSeason(leagueId, season);
    // chronological
    fixtures.sort((a, b) => new Date(a?.fixture?.date || 0) - new Date(b?.fixture?.date || 0));
    for (const fx of fixtures) {
      const r = extractResult(fx);
      if (!r) continue;
      const h = get(r.homeId);
      const a = get(r.awayId);
      const updated = updateEloPair(h.elo, a.elo, r.homeGoals, r.awayGoals);
      h.elo = updated.eloHome;
      a.elo = updated.eloAway;
      h.matchesPlayed += 1;
      a.matchesPlayed += 1;
      h.lastMatchAt = r.when;
      a.lastMatchAt = r.when;
      processed += 1;
    }
  }

  console.log(`  processed ${processed} matches, ${state.size} teams`);
  const result = await persistEloMap(leagueId, state);
  if (!result.ok) {
    console.error("  persist failed:", result.error);
  } else {
    console.log(`  persisted ${result.count} rows`);
  }
}

async function run() {
  if (!UPSTREAM) {
    console.error("Missing API key. Set APISPORTS_KEY (direct api-sports.io) or X_RAPIDAPI_KEY.");
    process.exit(1);
  }
  console.log(`Provider: ${UPSTREAM.provider} (${UPSTREAM.baseUrl})`);
  const leagueIds = String(process.env.LEAGUE_IDS || "39,140,135,78,61")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);
  const seasons = String(process.env.BACKFILL_SEASONS || "2023,2024")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

  console.log(`Rebuild Elo :: leagues=${leagueIds.join(",")} seasons=${seasons.join(",")}`);
  for (const lid of leagueIds) {
    console.log(`League ${lid}`);
    try {
      await rebuildForLeague(lid, seasons);
    } catch (e) {
      console.error(`  failed L${lid}:`, e?.message || e);
    }
  }
  console.log("Done.");
}

run().catch((err) => {
  console.error("rebuildElo crashed:", err?.message || err);
  process.exit(1);
});
