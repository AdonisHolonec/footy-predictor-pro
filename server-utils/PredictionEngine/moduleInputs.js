/**
 * Optional module input collector (plumbing only — NO prediction math here).
 *
 * Assembles the PredictionContext fields that the optional PredictionEngine
 * modules consume (odds, h2h, injuries, lineups, recent matches, rest dates,
 * weather). Each source is fetched via the existing `getWithCache` from real
 * API-Football endpoints and shaped into exactly what the module `calculate()`
 * functions already expect. Everything is env-gated and fails safe to
 * undefined so a missing/blocked source simply leaves that module neutral.
 *
 * Toggles (all default ON so the engine is fully activated; override per-op):
 *   PREDICT_ENRICH_ENABLED   master switch (default "1")
 *   PREDICT_ENRICH_ODDS      OddsEngine input (default "1")
 *   PREDICT_ENRICH_H2H       H2HEngine input (default "1")
 *   PREDICT_ENRICH_H2H_LAST  number of past meetings (default 6)
 *   PREDICT_ENRICH_INJURIES  InjuriesEngine input (default "1")
 *   PREDICT_ENRICH_LINEUPS   LineupEngine input (default "1")
 *   PREDICT_ENRICH_RECENT    RecentMatches + RestDays input (default "1")
 *   PREDICT_ENRICH_RECENT_LAST  recent fixtures per team (default 5)
 *   PREDICT_ENRICH_WEATHER   WeatherEngine input from fixture payload (default "1")
 */

import { getWithCache } from "../fetcher.js";
import { consensusMatchWinnerOdds } from "../marketOdds.js";
import { logWarn } from "../observability/logger.js";

const FINISHED = new Set(["FT", "AET", "PEN"]);

function flag(name, fallback = "1") {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const v = raw === undefined || raw === "" ? fallback : String(raw);
  return v === "1" || v.toLowerCase() === "true";
}

function envInt(name, fallback) {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** OddsEngine ← consensus 1X2 decimal odds from already-prefetched odds payload. */
function buildOdds(oddsData) {
  if (!flag("PREDICT_ENRICH_ODDS")) return undefined;
  try {
    const consensus = consensusMatchWinnerOdds(oddsData);
    if (!consensus) return undefined;
    const home = Number(consensus.home);
    const draw = Number(consensus.draw);
    const away = Number(consensus.away);
    if (!(home > 1 && draw > 1 && away > 1)) return undefined;
    return { home, draw, away, bookmakersUsed: consensus.bookmakersUsed };
  } catch {
    return undefined;
  }
}

/** H2HEngine ← past meetings between the two teams. */
async function buildH2H(homeTeamId, awayTeamId) {
  if (!flag("PREDICT_ENRICH_H2H") || !homeTeamId || !awayTeamId) return undefined;
  const last = envInt("PREDICT_ENRICH_H2H_LAST", 6);
  try {
    const req = await getWithCache(
      "/fixtures/headtohead",
      { h2h: `${homeTeamId}-${awayTeamId}`, last },
      6 * 60 * 60
    );
    if (!req.ok) return undefined;
    const rows = Array.isArray(req.data?.response) ? req.data.response : [];
    const fixtures = rows
      .filter((f) => FINISHED.has(String(f?.fixture?.status?.short || "")))
      .map((f) => ({
        goals: { home: f?.goals?.home, away: f?.goals?.away },
        teams: { home: { id: f?.teams?.home?.id }, away: { id: f?.teams?.away?.id } }
      }));
    return fixtures.length ? fixtures : undefined;
  } catch (err) {
    logWarn("enrich.h2h_failed", { error: err?.message });
    return undefined;
  }
}

/** InjuriesEngine ← per-fixture injury list shaped to { teamId }. */
async function buildInjuries(fixtureId) {
  if (!flag("PREDICT_ENRICH_INJURIES") || !fixtureId) return undefined;
  try {
    const req = await getWithCache("/injuries", { fixture: fixtureId }, 3 * 60 * 60);
    if (!req.ok) return undefined;
    const rows = Array.isArray(req.data?.response) ? req.data.response : [];
    const list = rows
      .map((r) => ({ teamId: r?.team?.id != null ? String(r.team.id) : null }))
      .filter((r) => r.teamId);
    return list.length ? list : undefined;
  } catch (err) {
    logWarn("enrich.injuries_failed", { error: err?.message });
    return undefined;
  }
}

/** LineupEngine ← confirmed XI per side shaped to { confirmed, formation, missingKeyPlayers }. */
async function buildLineups(fixtureId, homeTeamId, awayTeamId) {
  if (!flag("PREDICT_ENRICH_LINEUPS") || !fixtureId) return {};
  try {
    const req = await getWithCache("/fixtures/lineups", { fixture: fixtureId }, 30 * 60);
    if (!req.ok) return {};
    const rows = Array.isArray(req.data?.response) ? req.data.response : [];
    const byTeam = new Map();
    for (const r of rows) {
      const tid = r?.team?.id != null ? String(r.team.id) : null;
      if (!tid) continue;
      const startXI = Array.isArray(r?.startXI) ? r.startXI : [];
      byTeam.set(tid, {
        confirmed: startXI.length >= 11,
        formation: r?.formation || null,
        missingKeyPlayers: 0
      });
    }
    return {
      homeLineup: byTeam.get(String(homeTeamId)),
      awayLineup: byTeam.get(String(awayTeamId))
    };
  } catch (err) {
    logWarn("enrich.lineups_failed", { error: err?.message });
    return {};
  }
}

/** RecentMatches + RestDays ← last finished fixtures per team. */
async function buildTeamRecent(teamId, leagueId, season) {
  if (!flag("PREDICT_ENRICH_RECENT") || !teamId) return { matches: undefined, lastDate: undefined };
  const last = envInt("PREDICT_ENRICH_RECENT_LAST", 5);
  try {
    const params = { team: teamId, last };
    if (leagueId != null) params.league = Number(leagueId);
    if (season != null) params.season = Number(season);
    const req = await getWithCache("/fixtures", params, 6 * 60 * 60);
    if (!req.ok) return { matches: undefined, lastDate: undefined };
    const rows = Array.isArray(req.data?.response) ? req.data.response : [];
    const finished = rows
      .filter((f) => FINISHED.has(String(f?.fixture?.status?.short || "")))
      .sort((a, b) => new Date(b?.fixture?.date || 0) - new Date(a?.fixture?.date || 0));
    if (!finished.length) return { matches: undefined, lastDate: undefined };

    const matches = finished.map((f) => {
      const isHome = String(f?.teams?.home?.id) === String(teamId);
      const goalsFor = isHome ? Number(f?.goals?.home) : Number(f?.goals?.away);
      return { goalsFor: Number.isFinite(goalsFor) ? goalsFor : 0 };
    });
    return { matches, lastDate: finished[0]?.fixture?.date || undefined };
  } catch (err) {
    logWarn("enrich.recent_failed", { error: err?.message });
    return { matches: undefined, lastDate: undefined };
  }
}

/** WeatherEngine ← weather block from the fixture payload when the provider includes it. */
function buildWeather(fx) {
  if (!flag("PREDICT_ENRICH_WEATHER")) return undefined;
  const w = fx?.fixture?.weather || fx?.weather;
  if (!w || typeof w !== "object") return undefined;
  const tempC = Number(w.tempC ?? w.temperature ?? w.temp);
  const windKmh = Number(w.windKmh ?? w.wind);
  const precipMm = Number(w.precipMm ?? w.precip ?? w.rain);
  if (![tempC, windKmh, precipMm].some((n) => Number.isFinite(n))) return undefined;
  return {
    tempC: Number.isFinite(tempC) ? tempC : null,
    windKmh: Number.isFinite(windKmh) ? windKmh : null,
    precipMm: Number.isFinite(precipMm) ? precipMm : null,
    condition: w.condition || w.description || null
  };
}

/**
 * Collect all optional module inputs for one fixture. Returns an object to be
 * spread directly into engineCtx. Never throws.
 *
 * @param {object} p
 * @param {number|string} p.fixtureId
 * @param {number|string|null} p.homeTeamId
 * @param {number|string|null} p.awayTeamId
 * @param {number|string} p.leagueId
 * @param {number} p.season
 * @param {string} [p.fixtureDate]
 * @param {object} [p.oddsData]  prefetched odds payload for this fixture
 * @param {object} [p.fx]        raw fixture object (for weather)
 */
export async function collectModuleInputs(p = {}) {
  if (!flag("PREDICT_ENRICH_ENABLED")) return {};
  const { fixtureId, homeTeamId, awayTeamId, leagueId, season, oddsData, fx } = p;

  const [h2hFixtures, injuries, lineups, homeRecent, awayRecent] = await Promise.all([
    buildH2H(homeTeamId, awayTeamId),
    buildInjuries(fixtureId),
    buildLineups(fixtureId, homeTeamId, awayTeamId),
    buildTeamRecent(homeTeamId, leagueId, season),
    buildTeamRecent(awayTeamId, leagueId, season)
  ]);

  return {
    odds: buildOdds(oddsData),
    h2hFixtures,
    injuries,
    homeLineup: lineups.homeLineup,
    awayLineup: lineups.awayLineup,
    homeRecentMatches: homeRecent.matches,
    awayRecentMatches: awayRecent.matches,
    homeLastMatchDate: homeRecent.lastDate,
    awayLastMatchDate: awayRecent.lastDate,
    weather: buildWeather(fx)
  };
}

export default collectModuleInputs;
