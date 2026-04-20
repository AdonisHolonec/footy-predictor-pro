/**
 * One-time backfill pentru team_market_rolling (cornere + SoT + şuturi totale).
 *
 * Rulează:
 *   LEAGUE_IDS=39,140,135,78,61,2,3,848,88,283 \
 *   SEASON=2024 \
 *   ROLLING_WINDOW=15 \
 *   node --env-file=.env.local scripts/rebuildTeamMarketRolling.js
 *
 * Pentru fiecare ligă + sezon:
 *   1. Ia toate meciurile terminate (/fixtures?league=X&season=Y&status=FT-AET-PEN)
 *   2. Pentru fiecare meci, apelează /fixtures/statistics (cache 90 zile — imuabil)
 *   3. Per echipă: ia ultimele N meciuri, calculează medii rolling
 *   4. Upsert în team_market_rolling
 *
 * Cost estimat: ~100 echipe × ~15 meciuri = 1500 call-uri /fixtures/statistics,
 * dar majoritatea devin cache hits dacă re-rulezi pentru alt window.
 */
import { createClient } from "@supabase/supabase-js";
import {
  extractFixtureMarketStats,
  aggregateRollingForTeam,
  persistTeamMarketRolling
} from "../server-utils/teamMarketRolling.js";
import { TOP_LEAGUE_IDS } from "../server-utils/modelConstants.js";

const BASE = process.env.UPSTREAM_BASE_URL || "https://api-football-v1.p.rapidapi.com/v3";
const KEY = process.env.X_RAPIDAPI_KEY;
const HOST = process.env.X_RAPIDAPI_HOST || "api-football-v1.p.rapidapi.com";

async function apiGet(endpoint, paramsObj) {
  const u = new URL(BASE + endpoint);
  Object.entries(paramsObj || {}).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const res = await fetch(u.toString(), {
    headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST }
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${u.pathname}`);
  return await res.json();
}

async function fetchFixturesForLeagueSeason(leagueId, season) {
  const u = new URL(BASE + "/fixtures");
  u.searchParams.set("league", String(leagueId));
  u.searchParams.set("season", String(season));
  u.searchParams.set("status", "FT-AET-PEN");
  const res = await fetch(u.toString(), {
    headers: { "X-RapidAPI-Key": KEY, "X-RapidAPI-Host": HOST }
  });
  const json = await res.json();
  return json?.response || [];
}

async function fetchFixtureStatistics(fixtureId) {
  try {
    return await apiGet("/fixtures/statistics", { fixture: fixtureId });
  } catch (e) {
    console.error(`    stat fetch failed fixture=${fixtureId}: ${e.message}`);
    return null;
  }
}

async function backfillLeagueSeason(leagueId, season, windowSize) {
  console.log(`\n>>> League ${leagueId} season ${season} window=${windowSize}`);

  const fixtures = await fetchFixturesForLeagueSeason(leagueId, season);
  console.log(`  ${fixtures.length} meciuri terminate încărcate`);

  if (fixtures.length === 0) return { teams: 0, apiCalls: 0 };

  // sortăm cronologic
  fixtures.sort((a, b) => new Date(a?.fixture?.date || 0) - new Date(b?.fixture?.date || 0));

  // grupăm fixture-urile per echipă (într-un meci o echipă apare fie home, fie away)
  const byTeam = new Map(); // teamId → list of { fixtureId, date, isHome, opponentId }
  for (const fx of fixtures) {
    const fixtureId = Number(fx?.fixture?.id);
    const date = fx?.fixture?.date;
    const hId = Number(fx?.teams?.home?.id);
    const aId = Number(fx?.teams?.away?.id);
    if (!fixtureId || !hId || !aId) continue;
    if (!byTeam.has(hId)) byTeam.set(hId, []);
    if (!byTeam.has(aId)) byTeam.set(aId, []);
    byTeam.get(hId).push({ fixtureId, date, isHome: true, opponentId: aId });
    byTeam.get(aId).push({ fixtureId, date, isHome: false, opponentId: hId });
  }

  console.log(`  ${byTeam.size} echipe distincte`);

  // colectăm toate fixture IDs unice pe care trebuie să le interogăm
  const fixtureIdsNeeded = new Set();
  for (const [, matches] of byTeam.entries()) {
    const lastN = matches.slice(-windowSize);
    for (const m of lastN) fixtureIdsNeeded.add(m.fixtureId);
  }
  console.log(`  ${fixtureIdsNeeded.size} fixture statistics de încărcat`);

  // fetch statistics per fixture (serial pentru a nu bombarda API-ul)
  const statsById = new Map();
  let calls = 0;
  for (const fixtureId of fixtureIdsNeeded) {
    const payload = await fetchFixtureStatistics(fixtureId);
    calls += 1;
    if (payload) {
      const extracted = extractFixtureMarketStats(payload);
      const mapByTeam = new Map();
      for (const row of extracted) if (row.teamId) mapByTeam.set(row.teamId, row);
      statsById.set(fixtureId, mapByTeam);
    }
    if (calls % 50 === 0) console.log(`    progress: ${calls}/${fixtureIdsNeeded.size}`);
  }

  // agregăm per echipă
  const rows = [];
  for (const [teamId, matches] of byTeam.entries()) {
    const lastN = matches.slice(-windowSize);
    const enriched = lastN
      .map((m) => {
        const byT = statsById.get(m.fixtureId);
        if (!byT) return null;
        const teamStats = byT.get(teamId);
        const oppStats = byT.get(m.opponentId);
        if (!teamStats || !oppStats) return null;
        return {
          fixtureId: m.fixtureId,
          date: m.date,
          isHome: m.isHome,
          teamStats,
          opponentStats: oppStats
        };
      })
      .filter(Boolean);

    const agg = aggregateRollingForTeam(enriched);
    if (agg.matches_sampled === 0) continue;

    rows.push({
      team_id: teamId,
      league_id: Number(leagueId),
      season: Number(season),
      ...agg
    });
  }

  const result = await persistTeamMarketRolling(rows);
  if (!result.ok) console.error(`  persist error: ${result.error}`);
  else console.log(`  persisted ${result.count} rows`);

  return { teams: rows.length, apiCalls: calls };
}

async function run() {
  if (!KEY) {
    console.error("Missing X_RAPIDAPI_KEY");
    process.exit(1);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  // hint Supabase admin (exportat din teamMarketRolling.js prin getSupabaseAdmin → supabaseAdmin.js care citeşte env)

  const leagueIds = String(process.env.LEAGUE_IDS || TOP_LEAGUE_IDS.join(","))
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

  const season = Number(process.env.SEASON || new Date().getFullYear());
  const windowSize = Math.max(5, Math.min(Number(process.env.ROLLING_WINDOW || 15), 30));

  console.log(`Rebuild team market rolling :: leagues=[${leagueIds.join(",")}] season=${season} window=${windowSize}`);

  let totalTeams = 0;
  let totalCalls = 0;
  for (const lid of leagueIds) {
    try {
      const r = await backfillLeagueSeason(lid, season, windowSize);
      totalTeams += r.teams;
      totalCalls += r.apiCalls;
    } catch (e) {
      console.error(`  league ${lid} failed: ${e.message}`);
    }
  }

  console.log(`\nDone. ${totalTeams} echipe persistate, ~${totalCalls} apeluri /fixtures/statistics.`);
}

run().catch((err) => {
  console.error("rebuildTeamMarketRolling crashed:", err?.message || err);
  process.exit(1);
});
