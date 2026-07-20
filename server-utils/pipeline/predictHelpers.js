/**
 * Shared helpers moved from api/predict.js (behavior-identical).
 * @module server-utils/pipeline/predictHelpers
 */

import { getWithCache } from "../fetcher.js";
import { extractFixtureMarketStats, aggregateRollingForTeam } from "../teamMarketRolling.js";
import { computeRollingXg } from "../xg/RollingXgModel.js";
import { extractAdvancedGoalsAverages, normalizeTeamStatisticsPayload, poissonOverLine } from "../math.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "../supabaseAdmin.js";

/** Season inference used by predict/warm (European season boundary July). */
function inferSeason(dateISO) {
  const [y, m] = String(dateISO || "").split("-").map(Number);
  if (!y || !m) return new Date().getFullYear() - 1;
  return m >= 7 ? y : y - 1;
}

/** Prefer API-Football season stamped on fixtures for that league. */
function resolveLeagueSeasonFromFixtures(leagueFixtures, fallbackSeason) {
  for (const fx of leagueFixtures || []) {
    const s = Number(fx?.league?.season);
    if (Number.isFinite(s) && s >= 2000) return s;
  }
  const fb = Number(fallbackSeason);
  if (Number.isFinite(fb) && fb >= 2000) return fb;
  return inferSeason(new Date().toISOString().slice(0, 10));
}

/** UEFA club competitions — cup /teams/statistics often empty in qualifying. */
const UEFA_CLUB_LEAGUE_IDS = new Set([2, 3, 848]);

/**
 * Pick a club's primary domestic league from /leagues?team=&season=.
 * Prefers type=League, non-World country; skips the fixture competition itself.
 */
function pickDomesticLeagueId(leaguesPayload, { preferNotLeagueId, seasonNum } = {}) {
  const rows = Array.isArray(leaguesPayload?.response) ? leaguesPayload.response : [];
  const skip = Number(preferNotLeagueId);
  let best = null;
  let bestScore = -1;
  for (const entry of rows) {
    const league = entry?.league || {};
    const country = entry?.country || {};
    const id = Number(league.id);
    if (!Number.isFinite(id) || id === skip) continue;
    if (UEFA_CLUB_LEAGUE_IDS.has(id)) continue;
    const type = String(league.type || "");
    const countryName = String(country.name || "");
    let score = 0;
    if (type === "League") score += 100;
    else if (type === "Cup") score += 15;
    else score += 5;
    if (countryName && countryName !== "World") score += 50;
    const seasons = Array.isArray(entry?.seasons) ? entry.seasons : [];
    const seasonRow =
      seasons.find((s) => Number(s?.year) === Number(seasonNum)) ||
      seasons.find((s) => s?.current) ||
      null;
    if (seasonRow?.coverage?.fixtures?.statistics_fixtures) score += 20;
    if (seasonRow?.coverage?.standings) score += 10;
    if (seasonRow?.coverage?.fixtures?.statistics_players) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return bestScore >= 50 ? best : null;
}

async function resolveTeamDomesticLeagueId(teamId, season, preferNotLeagueId, ttlSeconds = 86400) {
  const tid = String(teamId || "").trim();
  const seasonNum = Number(season);
  if (!tid || !Number.isFinite(seasonNum)) return null;

  const trySeason = async (s) => {
    const req = await getWithCache("/leagues", { team: tid, season: s }, ttlSeconds);
    if (!req.ok || !req.data) return null;
    return pickDomesticLeagueId(req.data, { preferNotLeagueId, seasonNum: s });
  };

  const current = await trySeason(seasonNum);
  if (current) return current;
  const prev = seasonNum - 1;
  if (prev >= 2000) return trySeason(prev);
  return null;
}

/**
 * Build usable goal averages + a minimal /teams/statistics-shaped payload from
 * recent finished fixtures (any competition). Last resort for UEFA qualifying clubs.
 */
function buildStatsFromFinishedFixtures(fixtures, teamId) {
  const tid = Number(teamId);
  if (!Number.isFinite(tid)) return null;
  let gfH = 0;
  let gaH = 0;
  let nH = 0;
  let gfA = 0;
  let gaA = 0;
  let nA = 0;
  const formChars = [];
  const list = Array.isArray(fixtures) ? fixtures : [];
  for (const fx of list) {
    const short = String(fx?.fixture?.status?.short || "");
    if (!["FT", "AET", "PEN"].includes(short)) continue;
    const homeId = Number(fx?.teams?.home?.id);
    const awayId = Number(fx?.teams?.away?.id);
    const gh = Number(fx?.goals?.home);
    const ga = Number(fx?.goals?.away);
    if (!Number.isFinite(gh) || !Number.isFinite(ga)) continue;
    const isHome = homeId === tid;
    const isAway = awayId === tid;
    if (!isHome && !isAway) continue;
    if (isHome) {
      gfH += gh;
      gaH += ga;
      nH += 1;
      formChars.push(gh > ga ? "W" : gh < ga ? "L" : "D");
    } else {
      gfA += ga;
      gaA += gh;
      nA += 1;
      formChars.push(ga > gh ? "W" : ga < gh ? "L" : "D");
    }
  }
  const played = nH + nA;
  if (played < 3) return null;
  const gfTotal = (gfH + gfA) / played;
  const gaTotal = (gaH + gaA) / played;
  const gfHome = nH > 0 ? gfH / nH : gfTotal;
  const gaHome = nH > 0 ? gaH / nH : gaTotal;
  const gfAway = nA > 0 ? gfA / nA : gfTotal;
  const gaAway = nA > 0 ? gaA / nA : gaTotal;
  if (gfTotal === 0 && gaTotal === 0) return null;
  const stats = {
    gfHome,
    gaHome,
    gfAway,
    gaAway,
    played,
    playedHome: nH,
    playedAway: nA
  };
  const avg = (n) => Number(n.toFixed(2));
  const norm = {
    response: {
      form: formChars.slice(0, 10).join(""),
      fixtures: {
        played: { home: nH, away: nA, total: played }
      },
      goals: {
        for: {
          average: { home: avg(gfHome), away: avg(gfAway), total: avg(gfTotal) }
        },
        against: {
          average: { home: avg(gaHome), away: avg(gaAway), total: avg(gaTotal) }
        }
      }
    }
  };
  return { stats, norm };
}

async function fetchTeamStatisticsFromRecentFixtures(teamId, ttlSeconds = 21600) {
  const tid = String(teamId || "").trim();
  if (!tid) return null;
  // No status filter: API last=N mixes NS/FT; we keep only finished below.
  const req = await getWithCache("/fixtures", { team: tid, last: 20 }, ttlSeconds);
  if (!req.ok || !req.data) return null;
  const built = buildStatsFromFinishedFixtures(req.data?.response || [], tid);
  if (!built) return null;
  return {
    ok: true,
    norm: built.norm,
    stats: built.stats,
    seasonUsed: null,
    source: "recent_fixtures",
    fromCache: Boolean(req.fromCache),
    statsLeagueId: null
  };
}

/**
 * Fetch /teams/statistics with progressive fallbacks:
 * 1) fixture league + season
 * 2) fixture league + season-1 (UEFA / early phase)
 * 3) team's domestic league (+ season-1) when cup stats are empty
 * 4) last finished fixtures across competitions (qualifying clubs with no cup history)
 */
async function fetchTeamStatisticsWithSeasonFallback({
  leagueId,
  season,
  teamId,
  ttlSeconds = 86400,
  allowDomesticFallback = true,
  allowRecentFixturesFallback = true
}) {
  const lid = Number(leagueId);
  const tid = String(teamId || "").trim();
  const seasonNum = Number(season);
  if (!Number.isFinite(lid) || !tid || !Number.isFinite(seasonNum)) {
    return { ok: false, norm: null, stats: null, seasonUsed: seasonNum, source: null };
  }

  const tryLeagueSeason = async (statsLeagueId, s, source) => {
    const req = await getWithCache(
      "/teams/statistics",
      { league: statsLeagueId, season: s, team: tid },
      ttlSeconds
    );
    if (!req.ok || !req.data) return null;
    const norm = normalizeTeamStatisticsPayload(req.data);
    if (!norm) return null;
    const stats = extractAdvancedGoalsAverages(norm);
    if (!stats) return null;
    return {
      ok: true,
      norm,
      stats,
      seasonUsed: s,
      source,
      fromCache: Boolean(req.fromCache),
      statsLeagueId
    };
  };

  const current = await tryLeagueSeason(lid, seasonNum, "current");
  if (current) return current;

  const prevSeason = seasonNum - 1;
  if (prevSeason >= 2000) {
    const prev = await tryLeagueSeason(lid, prevSeason, "previous_season");
    if (prev) return prev;
  }

  if (allowDomesticFallback) {
    const domesticId = await resolveTeamDomesticLeagueId(tid, seasonNum, lid, ttlSeconds);
    if (domesticId && domesticId !== lid) {
      const domCurrent = await tryLeagueSeason(domesticId, seasonNum, "domestic_current");
      if (domCurrent) return domCurrent;
      if (prevSeason >= 2000) {
        const domPrev = await tryLeagueSeason(domesticId, prevSeason, "domestic_previous_season");
        if (domPrev) return domPrev;
      }
    }
  }

  if (allowRecentFixturesFallback) {
    const fromFx = await fetchTeamStatisticsFromRecentFixtures(tid, Math.min(ttlSeconds, 21600));
    if (fromFx) return fromFx;
  }

  return { ok: false, norm: null, stats: null, seasonUsed: seasonNum, source: null };
}

/**
 * Load standings for league season; fill missing teams from season-1
 * (UEFA cups often have empty tables early in the campaign).
 */
async function loadStandingsMapWithSeasonFallback(leagueId, season, ttlSeconds = 86400) {
  const seasonNum = Number(season);
  const lid = Number(leagueId);
  const standingsReq = await getWithCache("/standings", { league: lid, season: seasonNum }, ttlSeconds);
  const standingsRows = standingsReq.ok ? standingsRowsFromApi(standingsReq.data) : [];
  const standingsMap = new Map();
  for (const r of standingsRows) {
    if (r?.team?.id) standingsMap.set(String(r.team.id), r);
  }

  let prevSeasonUsed = null;
  const prevSeason = seasonNum - 1;
  if (prevSeason >= 2000) {
    const prevReq = await getWithCache("/standings", { league: lid, season: prevSeason }, ttlSeconds);
    if (prevReq.ok) {
      const prevRows = standingsRowsFromApi(prevReq.data);
      let filled = 0;
      for (const r of prevRows) {
        const id = r?.team?.id != null ? String(r.team.id) : null;
        if (!id || standingsMap.has(id)) continue;
        standingsMap.set(id, r);
        standingsRows.push(r);
        filled += 1;
      }
      if (filled > 0) prevSeasonUsed = prevSeason;
    }
  }

  return {
    standingsRows,
    standingsMap,
    seasonUsed: seasonNum,
    prevSeasonUsed,
    fromCache: Boolean(standingsReq.fromCache)
  };
}

function isGoodNum(val) {
  return typeof val === "number" && !isNaN(val) && val > 0;
}

/** Avoid IEEE noise in JSON/UI for λ and goal-rate scalars. */
function roundDisplayRate(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return x;
  return Number(x.toFixed(3));
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

/**
 * Pentru o piaţă Poisson agregată (cornere total, şuturi la poartă total), construieşte
 * blocul de probabilităţi Over X.5 în format procentaj + probabilitatea scorului cel mai probabil.
 */
function buildPoissonMarketBlock({ lambdaHome, lambdaAway, lines, teamLines = [] }) {
  const lhT = Number(lambdaHome) || 0;
  const laT = Number(lambdaAway) || 0;
  const lambdaTotal = lhT + laT;
  const total = {};
  for (const line of lines) {
    const key = `o${String(line).replace(".", "_")}`;
    total[key] = Number((poissonOverLine(line, lambdaTotal) * 100).toFixed(1));
  }
  // scor modal Poisson (cel mai probabil număr pe echipă)
  const pickMode = (lam) => {
    const floor = Math.floor(lam);
    return Math.max(floor, 0);
  };
  const home = {};
  const away = {};
  for (const line of teamLines) {
    const key = `o${String(line).replace(".", "_")}`;
    home[key] = Number((poissonOverLine(line, lhT) * 100).toFixed(1));
    away[key] = Number((poissonOverLine(line, laT) * 100).toFixed(1));
  }
  return {
    lambdaHome: Number(lhT.toFixed(2)),
    lambdaAway: Number(laT.toFixed(2)),
    lambdaTotal: Number(lambdaTotal.toFixed(2)),
    expectedTotal: Number(lambdaTotal.toFixed(2)),
    mostProbableTotal: Math.max(0, Math.round(lambdaTotal)),
    mostProbableHome: pickMode(lhT),
    mostProbableAway: pickMode(laT),
    total,
    home,
    away
  };
}

const LIVE_ROLLING_MIN_SAMPLE = 4;
const LIVE_ROLLING_FIXTURES = 8;
const LIVE_ROLLING_MAX_UNCACHED_STATS_CALLS = 18;

function hasUsableRolling(row) {
  return Boolean(row && Number(row.matches_sampled || 0) >= LIVE_ROLLING_MIN_SAMPLE);
}

async function buildLiveRollingForTeam({
  leagueId,
  season,
  teamId,
  statsBudgetRef
}) {
  const histReq = await getWithCache(
    "/fixtures",
    { team: teamId, league: leagueId, season, last: LIVE_ROLLING_FIXTURES },
    6 * 60 * 60
  );
  if (!histReq.ok) return null;
  const fixtures = (histReq.data?.response || []).filter((fx) =>
    ["FT", "AET", "PEN"].includes(String(fx?.fixture?.status?.short || ""))
  );
  if (!fixtures.length) return null;

  const enriched = [];
  for (const fx of fixtures) {
    const fixtureId = Number(fx?.fixture?.id);
    if (!Number.isFinite(fixtureId)) continue;
    const statReq = await getWithCache("/fixtures/statistics", { fixture: fixtureId }, 30 * 24 * 60 * 60);
    if (!statReq.fromCache) {
      statsBudgetRef.remaining -= 1;
      if (statsBudgetRef.remaining < 0) break;
    }
    if (!statReq.ok) continue;
    const stats = extractFixtureMarketStats(statReq.data);
    const byTeam = new Map();
    for (const s of stats) {
      if (s?.teamId) byTeam.set(Number(s.teamId), s);
    }
    const teamStats = byTeam.get(Number(teamId));
    const homeId = Number(fx?.teams?.home?.id);
    const awayId = Number(fx?.teams?.away?.id);
    const isHome = homeId === Number(teamId);
    const oppId = isHome ? awayId : homeId;
    const oppStats = byTeam.get(oppId);
    if (!teamStats || !oppStats) continue;
    enriched.push({
      fixtureId,
      date: fx?.fixture?.date,
      isHome,
      teamStats,
      opponentStats: oppStats
    });
  }
  if (!enriched.length) return null;
  const agg = aggregateRollingForTeam(enriched);
  if (!agg?.matches_sampled) return null;
  // Attach real rolling xG (shots / SoT / big-chance / possession / recent xG),
  // in-memory only — never persisted by this path.
  const xg = computeRollingXg(enriched);
  return { ...agg, ...xg };
}

/**
 * Clasificare încredere pentru o piaţă binară (YES/NO) sau pentru pick-ul top al unei pieţe multi-way.
 *   strong        → ≥ 65% (semnal clar)
 *   lean          → 55%..65% (direcţie moderată)
 *   toss          → 45%..55% (practic 50/50 — UI trebuie să marcheze explicit)
 *   lean_off      → 35%..45% (cealaltă parte e mai probabilă, dar nesigur)
 *   strong_off    → ≤ 35%
 */
function marketTier(pYesPct) {
  const p = Number(pYesPct) || 0;
  if (p >= 65) return "strong";
  if (p >= 55) return "lean";
  if (p >= 45) return "toss";
  if (p >= 35) return "lean_off";
  return "strong_off";
}

/**
 * Probabilităţi a priori (baseline global) pentru fiecare piaţă. Folosite la scorul lift-adjusted
 * al top pick-ului: un pick la exact baseline NU e informativ (pierde în faţa altei pieţe cu edge real).
 * Valorile sunt medii realiste pe fotbal european top-5 + competiţii UEFA.
 */
const MARKET_BASELINES = {
  "1": 45,
  X: 25,
  "2": 30,
  "Peste 1.5": 75,
  "Sub 1.5": 25,
  "Peste 2.5": 53,
  "Sub 2.5": 47,
  "Peste 3.5": 30,
  "Sub 3.5": 70,
  GG: 52,
  NGG: 48
};

/**
 * Alege cel mai bun pick recomandabil dintr-un pool complet de pieţe.
 *
 * Scor = probabilitate × (1 + lift/60), cu `lift = probabilitate - baseline`.
 * Exemplu: Peste 1.5 @83% (baseline 75%) → lift +8 → score = 83 × 1.133 ≈ 94.
 *          GG @65% (baseline 52%) → lift +13 → score = 65 × 1.217 ≈ 79.
 *          Sub 3.5 @58% (baseline 70%) → lift -12 → score = 58 × 0.80 ≈ 46.4.
 *
 * Această formulă premiază pick-urile unde modelul vede clar peste baseline-ul generic al pieţei,
 * dar refuză piețele banal-sigure (ex. Peste 1.5 la exact 75%).
 *
 * Minim acceptabil: probabilitate ≥ 50% (nu recomandăm niciodată un pick la coin-flip).
 */
function selectTopPick(probs, p1Pct, pXPct, p2Pct) {
  const pO15 = Number(probs.pO15) || 0;
  const pU15 = Math.max(0, 100 - pO15);
  const pO25 = Number(probs.pO25) || 0;
  const pU25 = Math.max(0, 100 - pO25);
  const pU35 = Number(probs.pU35) || 0;
  const pO35 = Math.max(0, 100 - pU35);
  const pGG = Number(probs.pGG) || 0;
  const pNGG = Math.max(0, 100 - pGG);

  const candidates = [
    { pick: "1", prob: p1Pct },
    { pick: "X", prob: pXPct },
    { pick: "2", prob: p2Pct },
    { pick: "Peste 1.5", prob: pO15 },
    { pick: "Sub 1.5", prob: pU15 },
    { pick: "Peste 2.5", prob: pO25 },
    { pick: "Sub 2.5", prob: pU25 },
    { pick: "Peste 3.5", prob: pO35 },
    { pick: "Sub 3.5", prob: pU35 },
    { pick: "GG", prob: pGG },
    { pick: "NGG", prob: pNGG }
  ];

  const scored = candidates
    .filter((c) => c.prob >= 50)
    .map((c) => {
      const baseline = MARKET_BASELINES[c.pick] || 50;
      const lift = c.prob - baseline;
      const score = c.prob * (1 + lift / 60);
      return { ...c, baseline, lift: Number(lift.toFixed(1)), score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // fallback: argmax al 1X2 (niciun pick > 50% — pick nesigur)
    const winner =
      p1Pct >= pXPct && p1Pct >= p2Pct ? "1" : p2Pct > p1Pct && p2Pct > pXPct ? "2" : "X";
    const prob = winner === "1" ? p1Pct : winner === "2" ? p2Pct : pXPct;
    return { pick: winner, prob, lift: 0, alternates: [] };
  }

  const best = scored[0];
  return {
    pick: best.pick,
    prob: best.prob,
    lift: best.lift,
    alternates: scored.slice(1, 4).map((c) => ({ pick: c.pick, prob: c.prob, lift: c.lift }))
  };
}

/**
 * Extrage toate rândurile de clasament din răspunsul API-Football (structuri multiple:
 * standings[] de array-uri, listă plată, sau obiecte cu .table).
 */
function standingsRowsFromApi(apiData) {
  const raw = apiData?.response;
  if (raw == null) return [];
  const blocks = Array.isArray(raw) ? raw : [raw];
  const collected = [];
  for (const block of blocks) {
    const league = block?.league ?? block;
    const st = league?.standings;
    if (!Array.isArray(st) || st.length === 0) continue;
    const head = st[0];
    if (Array.isArray(head)) {
      for (const inner of st) {
        if (Array.isArray(inner)) {
          for (const row of inner) {
            if (row?.team?.id) collected.push(row);
          }
        }
      }
      continue;
    }
    if (head?.team?.id) {
      for (const row of st) {
        if (row?.team?.id) collected.push(row);
      }
      continue;
    }
    if (head && typeof head === "object" && Array.isArray(head.table)) {
      for (const grp of st) {
        const tbl = grp?.table;
        if (Array.isArray(tbl)) {
          for (const row of tbl) {
            if (row?.team?.id) collected.push(row);
          }
        }
      }
    }
  }
  const byTeam = new Map();
  for (const row of collected) {
    const id = row?.team?.id;
    if (id != null) byTeam.set(Number(id), row);
  }
  return Array.from(byTeam.values());
}

function coerceFormFromTeamStats(norm) {
  if (!norm?.response) return null;
  const r = norm.response;
  if (typeof r.form === "string" && r.form.trim()) return r.form;
  return null;
}

function normalizeFormString(form) {
  if (!form || typeof form !== "string") return null;
  const s = form.toUpperCase().replace(/[^WDL]/g, "");
  return s.length ? s : null;
}

function sliceFormDisplay(form, maxLen = 10) {
  const s = normalizeFormString(form);
  return s ? s.slice(-maxLen) : null;
}

function standingsTeamSnapshot(row) {
  if (!row?.team?.id) return null;
  const all = row.all || {};
  const played = Number(all.played ?? row.played);
  const pts = Number(row.points);
  const rankRaw = row.rank != null ? row.rank : row.position;
  const rank = Number(rankRaw);
  const gf = Number(all.goals?.for ?? row.goals?.for) || 0;
  const ga = Number(all.goals?.against ?? row.goals?.against) || 0;
  const gdRaw = row.goalsDiff != null ? Number(row.goalsDiff) : gf - ga;
  return {
    teamId: row.team.id,
    rank: Number.isFinite(rank) ? rank : null,
    points: Number.isFinite(pts) ? pts : null,
    played: Number.isFinite(played) ? played : null,
    form: sliceFormDisplay(row.form, 10),
    goalsFor: gf,
    goalsAgainst: ga,
    goalsDiff: Number.isFinite(gdRaw) ? gdRaw : null
  };
}

function buildTeamContext({ homeIdStr, awayIdStr, standingsMap, formHome, formAway }) {
  const homeRow = homeIdStr ? standingsMap.get(homeIdStr) : null;
  const awayRow = awayIdStr ? standingsMap.get(awayIdStr) : null;
  let home = homeRow ? standingsTeamSnapshot(homeRow) : null;
  let away = awayRow ? standingsTeamSnapshot(awayRow) : null;
  const fh = sliceFormDisplay(formHome, 10);
  const fa = sliceFormDisplay(formAway, 10);
  if (fh) home = { ...(home || { teamId: homeIdStr ? Number(homeIdStr) : undefined }), form: fh };
  if (fa) away = { ...(away || { teamId: awayIdStr ? Number(awayIdStr) : undefined }), form: fa };
  if (!home && !away) return undefined;
  return { home: home || undefined, away: away || undefined };
}

function buildLeagueStandingsTable(standingsRows) {
  if (!Array.isArray(standingsRows) || standingsRows.length === 0) return undefined;
  const rows = standingsRows
    .map((row) => {
      const s = standingsTeamSnapshot(row);
      if (!s?.teamId) return null;
      return {
        rank: s.rank,
        teamId: s.teamId,
        teamName: row.team?.name || "",
        logo: row.team?.logo || undefined,
        played: s.played,
        points: s.points,
        goalsFor: s.goalsFor,
        goalsAgainst: s.goalsAgainst,
        goalsDiff: s.goalsDiff,
        form: s.form
      };
    })
    .filter(Boolean);
  rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  return rows.length ? rows : undefined;
}

function extendProbsWithMarkets(p) {
  const p1 = clampPct(p.p1);
  const pX = clampPct(p.pX);
  const p2 = clampPct(p.p2);
  const pO15 = clampPct(p.pO15);
  const pGG = clampPct(p.pGG);
  const pO25 = clampPct(p.pO25);
  return {
    ...p,
    p1,
    pX,
    p2,
    pDC1X: clampPct(p1 + pX),
    pDC12: clampPct(p1 + p2),
    pDCX2: clampPct(pX + p2),
    pU15: clampPct(100 - pO15),
    pNGG: clampPct(100 - pGG),
    pU25: clampPct(100 - pO25)
  };
}

function dataQualityScore({ method, hasOdds, hasLuckStats, hasTeamIds }) {
  let score = 0.35;
  if (hasTeamIds) score += 0.15;
  if (hasOdds) score += 0.2;
  if (hasLuckStats) score += 0.2;
  if (method === "strength-ratings" || method === "standings") score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function parseLineThreshold(key) {
  const m = String(key || "").match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  const n = Number(`${m[1]}.${m[2]}`);
  return Number.isFinite(n) ? n : null;
}

function deriveBestOverUnderPick(totalLines = {}) {
  const entries = Object.entries(totalLines || {}).filter(([, v]) => Number.isFinite(Number(v)));
  if (!entries.length) return null;
  let best = null;
  for (const [k, val] of entries) {
    const line = parseLineThreshold(k);
    if (line == null) continue;
    const pOver = Math.max(0, Math.min(100, Number(val)));
    const over = { pick: `Over ${line.toFixed(1)}`, line, probability: pOver };
    const under = { pick: `Under ${line.toFixed(1)}`, line, probability: 100 - pOver };
    const chosen = over.probability >= under.probability ? over : under;
    if (!best || chosen.probability > best.probability) best = chosen;
  }
  return best;
}

function blendByPenalty(base, multiplier = 1) {
  return clampPct(base * Math.max(0.7, Math.min(1.05, multiplier)));
}

function resolveConfidenceBucket(confidencePct) {
  const c = Number(confidencePct) || 0;
  if (c >= 78) return { label: "elite", multiplier: 1.15 };
  if (c >= 70) return { label: "high", multiplier: 1.0 };
  if (c >= 62) return { label: "medium", multiplier: 0.82 };
  if (c >= 54) return { label: "guarded", multiplier: 0.58 };
  return { label: "low", multiplier: 0.25 };
}

function applyStakePolicyV2({ stakePct, confidencePct, dataQuality, leagueStakeCap, cooldownCap }) {
  const bucket = resolveConfidenceBucket(confidencePct);
  const qualityMul = dataQuality >= 0.75 ? 1 : dataQuality >= 0.62 ? 0.88 : 0.7;
  const dynamicCap = Math.min(leagueStakeCap, cooldownCap);
  const adjusted = (Number(stakePct) || 0) * bucket.multiplier * qualityMul;
  const capped = Math.max(0, Math.min(adjusted, dynamicCap));
  return {
    stakePct: Number(capped.toFixed(2)),
    bucket: bucket.label,
    bucketMultiplier: Number(bucket.multiplier.toFixed(2)),
    qualityMultiplier: Number(qualityMul.toFixed(2)),
    dynamicCap: Number(dynamicCap.toFixed(2))
  };
}

function estimateRollingDrawdown(rows) {
  let pnl = 0;
  let peak = 0;
  let maxDd = 0;
  for (const row of rows) {
    const payload = row.raw_payload || {};
    const val = payload.valueBet || {};
    const stake = Math.max(0, Math.min((Number(val.kelly) || 0) / 100, 0.03));
    const odd = val.type === "1" ? Number(row.odds_home) : val.type === "X" ? Number(row.odds_draw) : Number(row.odds_away);
    if (!stake || !isFinite(odd) || odd <= 1) continue;
    const vbOutcome = row.value_bet_validation ?? payload.value_bet_validation;
    const won = vbOutcome === "win" || (vbOutcome == null && row.validation === "win");
    const lost = vbOutcome === "loss" || (vbOutcome == null && row.validation === "loss");
    if (won) pnl += stake * (odd - 1);
    else if (lost) pnl -= stake;
    peak = Math.max(peak, pnl);
    maxDd = Math.max(maxDd, peak - pnl);
  }
  return maxDd;
}

async function loadRiskContext() {
  const ctx = { avgDist: null, cooldownCap: 3 };
  const supabaseConfig = assertSupabaseConfigured();
  if (!supabaseConfig.ok) return ctx;
  const supabase = getSupabaseAdmin();
  if (!supabase) return ctx;

  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("predictions_history")
      .select("raw_payload, validation, odds_home, odds_draw, odds_away, value_bet_validation")
      .gte("kickoff_at", cutoff)
      .limit(400);

    const rows = data || [];
    const withProbs = rows.map((r) => r.raw_payload?.probs).filter((p) => p && isFinite(p.p1) && isFinite(p.pX) && isFinite(p.p2));

    if (withProbs.length > 0) {
      const mean = withProbs.reduce(
        (acc, p) => {
          acc.p1 += Number(p.p1);
          acc.pX += Number(p.pX);
          acc.p2 += Number(p.p2);
          return acc;
        },
        { p1: 0, pX: 0, p2: 0 }
      );
      ctx.avgDist = {
        p1: mean.p1 / withProbs.length,
        pX: mean.pX / withProbs.length,
        p2: mean.p2 / withProbs.length
      };
    }

    const settled = rows.filter((r) => r.validation === "win" || r.validation === "loss");
    const dd = estimateRollingDrawdown(settled);
    if (dd >= 3) ctx.cooldownCap = 1.5;
    else if (dd >= 2) ctx.cooldownCap = 2.0;
  } catch {
    // silent fallback
  }

  return ctx;
}


export {
  inferSeason,
  resolveLeagueSeasonFromFixtures,
  pickDomesticLeagueId,
  buildStatsFromFinishedFixtures,
  fetchTeamStatisticsWithSeasonFallback,
  loadStandingsMapWithSeasonFallback,
  isGoodNum,
  roundDisplayRate,
  clampPct,
  buildPoissonMarketBlock,
  LIVE_ROLLING_MIN_SAMPLE,
  LIVE_ROLLING_FIXTURES,
  LIVE_ROLLING_MAX_UNCACHED_STATS_CALLS,
  hasUsableRolling,
  buildLiveRollingForTeam,
  marketTier,
  selectTopPick,
  standingsRowsFromApi,
  coerceFormFromTeamStats,
  normalizeFormString,
  sliceFormDisplay,
  standingsTeamSnapshot,
  buildTeamContext,
  buildLeagueStandingsTable,
  extendProbsWithMarkets,
  dataQualityScore,
  parseLineThreshold,
  deriveBestOverUnderPick,
  blendByPenalty,
  resolveConfidenceBucket,
  applyStakePolicyV2,
  estimateRollingDrawdown,
  loadRiskContext
};
