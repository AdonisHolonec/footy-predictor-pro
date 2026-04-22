import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { clampLambda } from "./math.js";

const TABLE = "team_market_rolling";
const CACHE_TTL_MS = 10 * 60 * 1000;
let cached = { fetchedAt: 0, byKey: new Map() };

/**
 * Găseşte valoarea numerică pentru un tip de statistică din payload-ul /fixtures/statistics.
 * API-Football returnează: `statistics: [{type: "Corner Kicks", value: 5}, ...]`.
 * Value poate fi număr, string cu "%" (ex. "45%" pentru posesie) sau null.
 */
function readStat(statistics, type) {
  if (!Array.isArray(statistics)) return null;
  const row = statistics.find((s) => String(s?.type).toLowerCase() === type.toLowerCase());
  if (!row) return null;
  const v = row.value;
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/%/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Extrage statisticile relevante pe o echipă dintr-un payload /fixtures/statistics.
 * Răspunsul API e un array cu 2 elemente (home / away), fiecare cu `team.id` şi `statistics`.
 *
 * @returns {Array<{teamId: number, corners: number|null, sot: number|null, shotsTotal: number|null}>}
 */
export function extractFixtureMarketStats(fixtureStatsPayload) {
  const resp = fixtureStatsPayload?.response;
  if (!Array.isArray(resp) || resp.length === 0) return [];
  return resp.map((block) => ({
    teamId: Number(block?.team?.id) || null,
    corners: readStat(block?.statistics, "Corner Kicks"),
    sot: readStat(block?.statistics, "Shots on Goal"),
    shotsTotal: readStat(block?.statistics, "Total Shots")
  }));
}

/**
 * Agregă o listă de fixturi (cu statistici atașate) în medii rolling pentru o echipă specifică.
 * Fiecare element `match` are forma:
 *   { fixtureId, date, isHome, teamStats: {corners, sot, shotsTotal}, opponentStats: {corners, sot, shotsTotal} }
 *
 * @returns {{ matches_sampled: number, corners_for_avg: number|null, corners_against_avg: number|null,
 *             corners_for_home_avg: number|null, corners_against_home_avg: number|null,
 *             corners_for_away_avg: number|null, corners_against_away_avg: number|null,
 *             sot_for_avg: number|null, sot_against_avg: number|null,
 *             shots_total_for_avg: number|null, shots_total_against_avg: number|null,
 *             last_fixture_id: number|null, last_fixture_date: string|null }}
 */
export function aggregateRollingForTeam(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      matches_sampled: 0,
      corners_for_avg: null,
      corners_against_avg: null,
      corners_for_home_avg: null,
      corners_against_home_avg: null,
      corners_for_away_avg: null,
      corners_against_away_avg: null,
      sot_for_avg: null,
      sot_against_avg: null,
      shots_total_for_avg: null,
      shots_total_against_avg: null,
      last_fixture_id: null,
      last_fixture_date: null
    };
  }

  const bag = {
    corners_for: [],
    corners_against: [],
    corners_for_home: [],
    corners_against_home: [],
    corners_for_away: [],
    corners_against_away: [],
    sot_for: [],
    sot_against: [],
    shots_total_for: [],
    shots_total_against: []
  };

  let lastFixtureId = null;
  let lastFixtureDate = null;

  for (const m of matches) {
    const teamStats = m?.teamStats || {};
    const oppStats = m?.opponentStats || {};
    const isHome = Boolean(m?.isHome);

    const push = (arr, v) => {
      if (v != null && Number.isFinite(Number(v))) arr.push(Number(v));
    };

    push(bag.corners_for, teamStats.corners);
    push(bag.corners_against, oppStats.corners);
    push(bag.sot_for, teamStats.sot);
    push(bag.sot_against, oppStats.sot);
    push(bag.shots_total_for, teamStats.shotsTotal);
    push(bag.shots_total_against, oppStats.shotsTotal);

    if (isHome) {
      push(bag.corners_for_home, teamStats.corners);
      push(bag.corners_against_home, oppStats.corners);
    } else {
      push(bag.corners_for_away, teamStats.corners);
      push(bag.corners_against_away, oppStats.corners);
    }

    const d = m?.date ? new Date(m.date).getTime() : 0;
    const lastD = lastFixtureDate ? new Date(lastFixtureDate).getTime() : 0;
    if (d > lastD) {
      lastFixtureDate = m.date;
      lastFixtureId = Number(m.fixtureId) || null;
    }
  }

  const avg = (arr) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const round = (n) => (n == null ? null : Number(n.toFixed(3)));

  return {
    matches_sampled: Math.max(
      bag.corners_for.length,
      bag.sot_for.length,
      bag.shots_total_for.length
    ),
    corners_for_avg: round(avg(bag.corners_for)),
    corners_against_avg: round(avg(bag.corners_against)),
    corners_for_home_avg: round(avg(bag.corners_for_home)),
    corners_against_home_avg: round(avg(bag.corners_against_home)),
    corners_for_away_avg: round(avg(bag.corners_for_away)),
    corners_against_away_avg: round(avg(bag.corners_against_away)),
    sot_for_avg: round(avg(bag.sot_for)),
    sot_against_avg: round(avg(bag.sot_against)),
    shots_total_for_avg: round(avg(bag.shots_total_for)),
    shots_total_against_avg: round(avg(bag.shots_total_against)),
    last_fixture_id: lastFixtureId,
    last_fixture_date: lastFixtureDate
  };
}

// -------------------- Supabase IO --------------------

function cacheKey(leagueId, season) {
  return `${leagueId}:${season}`;
}

/**
 * Încarcă rolling stats pentru o (ligă, sezon), cache-at 10 min.
 * @returns Map<teamId, row>
 */
export async function loadTeamMarketRolling(leagueId, season) {
  const key = cacheKey(leagueId, season);
  const now = Date.now();
  if (now - cached.fetchedAt < CACHE_TTL_MS && cached.byKey.has(key)) {
    return cached.byKey.get(key);
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) return new Map();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("league_id", Number(leagueId))
      .eq("season", Number(season));
    if (error) return new Map();
    const map = new Map();
    for (const row of data || []) {
      map.set(Number(row.team_id), row);
    }
    cached.byKey.set(key, map);
    cached.fetchedAt = now;
    return map;
  } catch {
    return new Map();
  }
}

export async function persistTeamMarketRolling(rows) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false, error: "Supabase nu este configurat" };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, count: 0 };
  const payload = rows.map((r) => ({
    ...r,
    updated_at: new Date().toISOString()
  }));
  const { error } = await supabase.from(TABLE).upsert(payload, {
    onConflict: "team_id,league_id,season"
  });
  if (error) return { ok: false, error: error.message };
  cached = { fetchedAt: 0, byKey: new Map() };
  return { ok: true, count: rows.length };
}

export function invalidateTeamMarketRollingCache() {
  cached = { fetchedAt: 0, byKey: new Map() };
}

// -------------------- λ derivation --------------------

/**
 * Dixon-Coles multiplicativ pentru cornere / şuturi la poartă.
 * baseAvgTotal = cornersAvgTotal sau sotAvgTotal (per MECI, nu per echipă).
 * Fiecare echipă are side-per-match: baseAvgTotal / 2 ≈ λ_side.
 *
 * λ_home = baseSide × (atk_H_market / baseSide) × (def_A_market / baseSide) × homeAdv^0.5
 * (homeAdv redus la 0.5 pentru cornere — venue effect mai slab decât la goluri)
 *
 * Dacă echipele n-au rolling stats → fallback la baseSide (predicţie = media ligii).
 */
export function deriveMarketLambdas({
  rollingHome,
  rollingAway,
  baseAvgTotal,
  marketKey = "corners",
  homeAdv = 1.06,
  awayAdv = 0.96
}) {
  const baseSide = Math.max(0.5, Number(baseAvgTotal) / 2);

  const fields = {
    corners: {
      for: "corners_for_avg",
      against: "corners_against_avg"
    },
    sot: {
      for: "sot_for_avg",
      against: "sot_against_avg"
    },
    shots_total: {
      for: "shots_total_for_avg",
      against: "shots_total_against_avg"
    }
  };
  const f = fields[marketKey] || fields.corners;

  const atkH = Number(rollingHome?.[f.for]);
  const defA = Number(rollingAway?.[f.against]);
  const atkA = Number(rollingAway?.[f.for]);
  const defH = Number(rollingHome?.[f.against]);

  const hasHome = Number.isFinite(atkH) && atkH > 0 && Number.isFinite(defH) && defH > 0;
  const hasAway = Number.isFinite(atkA) && atkA > 0 && Number.isFinite(defA) && defA > 0;
  // dacă amândouă sunt zero / null → fallback la baseSide pentru ambele
  if (!hasHome && !hasAway) {
    return {
      lambdaHome: baseSide * Math.pow(homeAdv, 0.5),
      lambdaAway: baseSide * Math.pow(awayAdv, 0.5),
      sampleHome: 0,
      sampleAway: 0,
      usedFallback: true
    };
  }

  const hAtk = hasHome ? atkH : baseSide;
  const aDef = hasAway ? defA : baseSide;
  const aAtk = hasAway ? atkA : baseSide;
  const hDef = hasHome ? defH : baseSide;

  const lambdaHome = clampNonNeg(
    baseSide * (hAtk / baseSide) * (aDef / baseSide) * Math.pow(homeAdv, 0.5)
  );
  const lambdaAway = clampNonNeg(
    baseSide * (aAtk / baseSide) * (hDef / baseSide) * Math.pow(awayAdv, 0.5)
  );

  return {
    lambdaHome: Number(lambdaHome.toFixed(3)),
    lambdaAway: Number(lambdaAway.toFixed(3)),
    sampleHome: Number(rollingHome?.matches_sampled) || 0,
    sampleAway: Number(rollingAway?.matches_sampled) || 0,
    usedFallback: !hasHome || !hasAway
  };
}

function clampNonNeg(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.1;
  // cap realist: un meci cu 15+ cornere la o singură echipă e extrem de rar; totuşi lăsăm până la ~14
  return Math.max(0.1, Math.min(14, v));
}

// re-export clampLambda pentru convenţie (nu e folosit aici dar util pentru testare)
export { clampLambda };
