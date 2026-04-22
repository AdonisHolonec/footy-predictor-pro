import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Goal-based Elo ratings pentru fotbal, stil FiveThirtyEight / ClubElo.
 * K dinamic după margine (Hill 2004): K_effective = K * ln(|goalDiff|+1) * (margin_factor)
 * Home advantage implicit în expected score via `homeAdvElo`.
 */

const DEFAULT_ELO = 1500;
const DEFAULT_K = 20;
const DEFAULT_HOME_ADV_ELO = 80;

let cachedElo = { fetchedAt: 0, byTeam: new Map() };
const CACHE_TTL_MS = 10 * 60 * 1000;

/** P(home wins) from Elo ratings + home advantage. */
export function eloExpectedHomeScore(eloHome, eloAway, homeAdvElo = DEFAULT_HOME_ADV_ELO) {
  const diff = eloAway - (eloHome + homeAdvElo);
  return 1 / (1 + Math.pow(10, diff / 400));
}

/** Incremental update K-factor amplified by goal margin. */
export function eloKFactor(goalDiff, baseK = DEFAULT_K) {
  const gd = Math.abs(Number(goalDiff) || 0);
  if (gd <= 1) return baseK;
  if (gd === 2) return baseK * 1.5;
  return baseK * (1.75 + (gd - 3) / 8);
}

/**
 * Update pair ratings after a single match result.
 * Returns new ratings for both teams.
 */
export function updateEloPair(eloHome, eloAway, homeGoals, awayGoals, opts = {}) {
  const k = Number(opts.k ?? DEFAULT_K);
  const homeAdv = Number(opts.homeAdvElo ?? DEFAULT_HOME_ADV_ELO);
  const expectedHome = eloExpectedHomeScore(eloHome, eloAway, homeAdv);
  const actualHome = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
  const goalDiff = homeGoals - awayGoals;
  const kEff = eloKFactor(goalDiff, k);
  const delta = kEff * (actualHome - expectedHome);
  return {
    eloHome: eloHome + delta,
    eloAway: eloAway - delta
  };
}

/**
 * Dintr-o pereche de rating-uri → triplet [p1, pX, p2].
 * Draws modelate separat: P(draw) aprox. de o funcţie quadratică a diferenţei (maxim la spread=0).
 */
export function eloProbabilities(eloHome, eloAway, opts = {}) {
  const homeAdv = Number(opts.homeAdvElo ?? DEFAULT_HOME_ADV_ELO);
  const maxDraw = Math.min(0.33, Math.max(0.18, Number(opts.maxDraw ?? 0.28)));
  const spread = (eloHome + homeAdv) - eloAway;
  // p(home wins) fără draws (Elo pur)
  const pHomeNoDraw = 1 / (1 + Math.pow(10, -spread / 400));
  // fracţiune alocată draw-ului: maxim la spread=0, scade pe măsură ce |spread| creşte
  const drawFrac = maxDraw * Math.exp(-Math.pow(spread / 350, 2));
  const p1 = pHomeNoDraw * (1 - drawFrac);
  const p2 = (1 - pHomeNoDraw) * (1 - drawFrac);
  const pX = drawFrac;
  const s = p1 + pX + p2;
  return { p1: p1 / s, pX: pX / s, p2: p2 / s, spread };
}

/** Load Elo records for a specific league; caches for `CACHE_TTL_MS`. */
export async function loadLeagueElo(leagueId) {
  const key = String(leagueId);
  const now = Date.now();
  if (now - cachedElo.fetchedAt < CACHE_TTL_MS && cachedElo.byTeam.has(key)) {
    return cachedElo.byTeam.get(key);
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) return new Map();
  try {
    const { data, error } = await supabase
      .from("team_elo")
      .select("team_id, elo, matches_played, last_match_at")
      .eq("league_id", Number(leagueId));
    if (error) return new Map();
    const map = new Map();
    for (const row of data || []) {
      map.set(Number(row.team_id), {
        elo: Number(row.elo) || DEFAULT_ELO,
        matchesPlayed: Number(row.matches_played) || 0,
        lastMatchAt: row.last_match_at || null
      });
    }
    cachedElo.byTeam.set(key, map);
    cachedElo.fetchedAt = now;
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Lookup pair cu fallback la default (echipă nouă, promovată, etc.).
 * Returnează şi flag confidence scăzut dacă oricare echipă are < 10 meciuri.
 */
export async function lookupEloPair(leagueId, homeTeamId, awayTeamId) {
  const league = await loadLeagueElo(leagueId);
  const h = league.get(Number(homeTeamId));
  const a = league.get(Number(awayTeamId));
  const eloHome = h?.elo ?? DEFAULT_ELO;
  const eloAway = a?.elo ?? DEFAULT_ELO;
  const thin =
    !h || !a || (h.matchesPlayed || 0) < 10 || (a.matchesPlayed || 0) < 10;
  return {
    eloHome,
    eloAway,
    thin,
    homeMatches: h?.matchesPlayed || 0,
    awayMatches: a?.matchesPlayed || 0
  };
}

/** Batch upsert after rebuilding Elo in memory. */
export async function persistEloMap(leagueId, teamMap) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "Supabase nu este configurat" };
  const rows = [];
  for (const [teamId, info] of teamMap.entries()) {
    rows.push({
      team_id: Number(teamId),
      league_id: Number(leagueId),
      elo: Number(info.elo.toFixed(3)),
      matches_played: info.matchesPlayed || 0,
      last_match_at: info.lastMatchAt || null,
      updated_at: new Date().toISOString()
    });
  }
  if (rows.length === 0) return { ok: true, count: 0 };
  const { error } = await supabase
    .from("team_elo")
    .upsert(rows, { onConflict: "team_id,league_id" });
  if (error) return { ok: false, error: error.message };
  cachedElo = { fetchedAt: 0, byTeam: new Map() };
  return { ok: true, count: rows.length };
}

export function invalidateEloCache() {
  cachedElo = { fetchedAt: 0, byTeam: new Map() };
}

export { DEFAULT_ELO, DEFAULT_K, DEFAULT_HOME_ADV_ELO };
