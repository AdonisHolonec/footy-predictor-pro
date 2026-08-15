import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { clampLambda } from "./math.js";
import { cardsFromCounts } from "./fixtureCardTotals.js";

const TABLE = "team_market_rolling";
const CACHE_TTL_MS = 10 * 60 * 1000;
let cached = { fetchedAt: 0, byKey: new Map() };

/**
 * Minim de meciuri cu date REALE (nu blocuri structurale cu valori null) pentru ca
 * rolling-ul unei echipe să fie folosit în locul prior-ului de ligă, per familie de
 * piaţă. Aliniat cu LIVE_ROLLING_MIN_SAMPLE din predictHelpers (care importă de aici).
 */
export const MIN_MARKET_SAMPLES = 4;

/**
 * Sample-ul real pentru o familie de piaţă. Rândurile agregate in-memory au
 * samples_by_market per familie; rândurile persistate (team_market_rolling) nu au
 * coloana → cădem pe matches_sampled, cea mai bună informaţie disponibilă acolo.
 */
function marketSampleCount(row, marketKey) {
  const s = Number(row?.samples_by_market?.[marketKey]);
  if (Number.isFinite(s)) return s;
  return Number(row?.matches_sampled) || 0;
}

/**
 * Găseşte valoarea numerică pentru un tip de statistică din payload-ul /fixtures/statistics.
 * API-Football returnează: `statistics: [{type: "Corner Kicks", value: 5}, ...]`.
 * Value poate fi număr, string cu "%" (ex. "45%" pentru posesie) sau null.
 *
 * MISSING ≠ ZERO: providerul trimite blocuri de statistici complete ca structură dar cu
 * toate valorile null pentru meciuri neacoperite (tipic calificări UEFA). Un null tratat
 * ca 0 otrăveşte mediile rolling şi produce λ degenerat. Doar un 0 explicit (număr sau
 * "0") este producţie reală zero; null / undefined / "" înseamnă lipsă de date → null.
 */
function readStat(statistics, type) {
  if (!Array.isArray(statistics)) return null;
  const row = statistics.find((s) => String(s?.type).toLowerCase() === type.toLowerCase());
  if (!row) return null;
  const v = row.value;
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/%/g, "").trim();
    if (cleaned === "") return null;
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
    shotsTotal: readStat(block?.statistics, "Total Shots"),
    // Extra signals for the rolling xG model (present on richer API plans).
    shotsInsideBox: readStat(block?.statistics, "Shots insidebox"),
    shotsOutsideBox: readStat(block?.statistics, "Shots outsidebox"),
    possession: readStat(block?.statistics, "Ball Possession"),
    xg: readStat(block?.statistics, "expected_goals"),
    yellowCards: readStat(block?.statistics, "Yellow Cards"),
    redCards: readStat(block?.statistics, "Red Cards")
  }));
}

/**
 * Agregă o listă de fixturi (cu statistici atașate) în medii rolling pentru o echipă specifică.
 * Fiecare element `match` are forma:
 *   { fixtureId, date, isHome,
 *     teamStats: {corners, sot, shotsTotal, yellowCards, redCards},
 *     opponentStats: {corners, sot, shotsTotal, yellowCards, redCards} }
 *
 * Cards: `cards_*_avg` sunt în NUMĂR BRUT de cartonaşe (cardsTotal = yellow + red), aceeaşi
 * unitate pe care settlement-ul o înregistrează ca marketResults.cardsTotal. Convenţia
 * ponderată (red*2 + yellow) trăieşte separat în `cards_points_*_avg`, in-memory.
 *
 * @returns {{ matches_sampled: number,
 *             samples_by_market: { corners: number, cards: number, cards_home: number,
 *                                  cards_away: number, sot: number, shots_total: number },
 *             corners_for_avg: number|null, corners_against_avg: number|null,
 *             corners_for_home_avg: number|null, corners_against_home_avg: number|null,
 *             corners_for_away_avg: number|null, corners_against_away_avg: number|null,
 *             sot_for_avg: number|null, sot_against_avg: number|null,
 *             shots_total_for_avg: number|null, shots_total_against_avg: number|null,
 *             cards_for_avg: number|null, cards_against_avg: number|null,
 *             cards_for_home_avg: number|null, cards_against_home_avg: number|null,
 *             cards_for_away_avg: number|null, cards_against_away_avg: number|null,
 *             cards_points_for_avg: number|null, cards_points_against_avg: number|null,
 *             cards_points_for_home_avg: number|null, cards_points_against_home_avg: number|null,
 *             cards_points_for_away_avg: number|null, cards_points_against_away_avg: number|null,
 *             last_fixture_id: number|null, last_fixture_date: string|null }}
 */
export function aggregateRollingForTeam(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      matches_sampled: 0,
      samples_by_market: { corners: 0, cards: 0, cards_home: 0, cards_away: 0, sot: 0, shots_total: 0 },
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
      cards_for_avg: null,
      cards_against_avg: null,
      cards_for_home_avg: null,
      cards_against_home_avg: null,
      cards_for_away_avg: null,
      cards_against_away_avg: null,
      cards_points_for_avg: null,
      cards_points_against_avg: null,
      cards_points_for_home_avg: null,
      cards_points_against_home_avg: null,
      cards_points_for_away_avg: null,
      cards_points_against_away_avg: null,
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
    shots_total_against: [],
    cards_for: [],
    cards_against: [],
    cards_for_home: [],
    cards_against_home: [],
    cards_for_away: [],
    cards_against_away: [],
    cards_points_for: [],
    cards_points_against: [],
    cards_points_for_home: [],
    cards_points_against_home: [],
    cards_points_for_away: [],
    cards_points_against_away: []
  };

  let lastFixtureId = null;
  let lastFixtureDate = null;

  // UNIT: the cards rolling is built on cardsTotal — the RAW CARD COUNT (yellow + red) —
  // the same unit the settlement path records as marketResults.cardsTotal. The weighted
  // "points" convention (red*2 + yellow) is computed alongside it, into separate
  // cards_points_* fields, and never mixed in: which of the two the bookmaker's line
  // actually refers to is an open question, answered empirically later, and a rolling
  // average is worthless if you cannot say what it counts.
  //
  // The known/unknown decision is delegated to cardsFromCounts so it is made in exactly
  // one place, shared with the settlement path. It has to happen BEFORE any Number()
  // coercion: this guard used to read `Number(stats?.yellowCards)` first, and because
  // `Number(null) === 0` is finite, a statistics block with every value null — the
  // payload API-Football returns for uncovered fixtures, the same one that poisoned the
  // corners averages in #65 — passed the guard as a phantom 0-card match and dragged the
  // rolling average toward zero. The `push` helper below cannot catch it either: by then
  // the value is a legitimate-looking 0, not a null. Corners never had this hole because
  // readStat hands them a real null straight through.
  const cardsOf = (stats) => cardsFromCounts(stats?.yellowCards, stats?.redCards);

  for (const m of matches) {
    const teamStats = m?.teamStats || {};
    const oppStats = m?.opponentStats || {};
    const isHome = Boolean(m?.isHome);

    const push = (arr, v) => {
      if (v != null && Number.isFinite(Number(v))) arr.push(Number(v));
    };

    // One resolution per side per match: an UNKNOWN side yields null for BOTH units, so
    // count and points can never disagree about which matches were observed.
    const teamCards = cardsOf(teamStats);
    const oppCards = cardsOf(oppStats);

    push(bag.corners_for, teamStats.corners);
    push(bag.corners_against, oppStats.corners);
    push(bag.sot_for, teamStats.sot);
    push(bag.sot_against, oppStats.sot);
    push(bag.shots_total_for, teamStats.shotsTotal);
    push(bag.shots_total_against, oppStats.shotsTotal);
    push(bag.cards_for, teamCards?.count ?? null);
    push(bag.cards_against, oppCards?.count ?? null);
    push(bag.cards_points_for, teamCards?.points ?? null);
    push(bag.cards_points_against, oppCards?.points ?? null);

    if (isHome) {
      push(bag.corners_for_home, teamStats.corners);
      push(bag.corners_against_home, oppStats.corners);
      push(bag.cards_for_home, teamCards?.count ?? null);
      push(bag.cards_against_home, oppCards?.count ?? null);
      push(bag.cards_points_for_home, teamCards?.points ?? null);
      push(bag.cards_points_against_home, oppCards?.points ?? null);
    } else {
      push(bag.corners_for_away, teamStats.corners);
      push(bag.corners_against_away, oppStats.corners);
      push(bag.cards_for_away, teamCards?.count ?? null);
      push(bag.cards_against_away, oppCards?.count ?? null);
      push(bag.cards_points_for_away, teamCards?.points ?? null);
      push(bag.cards_points_against_away, oppCards?.points ?? null);
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
      bag.shots_total_for.length,
      bag.cards_for.length
    ),
    // Sample real per familie de piaţă (meciuri cu date observate pe AMBELE laturi
    // for/against). Un meci cu statistici structurale dar valori null nu contează —
    // readStat îl lasă null, push-ul îl sare. Câmp exclusiv in-memory: NU este o
    // coloană în team_market_rolling; persistTeamMarketRolling îl elimină la upsert.
    samples_by_market: {
      corners: Math.min(bag.corners_for.length, bag.corners_against.length),
      cards: Math.min(bag.cards_for.length, bag.cards_against.length),
      // Venue-split card samples. A team's cards average can rest almost entirely on one
      // venue (an away-heavy window in a cup run, say), and the pooled `cards` count hides
      // that — so the venue averages carry their own sample counts, and whoever consumes
      // cards_for_home_avg can see how many matches it actually rests on. No sample GATE
      // is applied here: this increment produces the evidence, it does not set thresholds.
      cards_home: Math.min(bag.cards_for_home.length, bag.cards_against_home.length),
      cards_away: Math.min(bag.cards_for_away.length, bag.cards_against_away.length),
      sot: Math.min(bag.sot_for.length, bag.sot_against.length),
      shots_total: Math.min(bag.shots_total_for.length, bag.shots_total_against.length)
    },
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
    cards_for_avg: round(avg(bag.cards_for)),
    cards_against_avg: round(avg(bag.cards_against)),
    cards_for_home_avg: round(avg(bag.cards_for_home)),
    cards_against_home_avg: round(avg(bag.cards_against_home)),
    cards_for_away_avg: round(avg(bag.cards_for_away)),
    cards_against_away_avg: round(avg(bag.cards_against_away)),
    // Weighted-points twin of the six cards_* averages above, over exactly the same
    // observations. In-memory only — team_market_rolling has no columns for these, and
    // persistTeamMarketRolling strips them, the same way it strips samples_by_market.
    // Kept so the count-vs-points question can be answered from one rebuild instead of two.
    cards_points_for_avg: round(avg(bag.cards_points_for)),
    cards_points_against_avg: round(avg(bag.cards_points_against)),
    cards_points_for_home_avg: round(avg(bag.cards_points_for_home)),
    cards_points_against_home_avg: round(avg(bag.cards_points_against_home)),
    cards_points_for_away_avg: round(avg(bag.cards_points_for_away)),
    cards_points_against_away_avg: round(avg(bag.cards_points_against_away)),
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
  // Câmpuri exclusiv in-memory (nu există coloane în schema team_market_rolling) — le
  // eliminăm ca upsert-ul să nu eşueze pe coloană necunoscută. samples_by_market e
  // diagnostic; cards_points_* sunt unitatea alternativă păstrată pentru analiza care va
  // decide empiric unitatea corectă, şi ar avea nevoie de propria migrare ca să persiste.
  const payload = rows.map(
    ({
      samples_by_market: _samples,
      cards_points_for_avg: _cpFor,
      cards_points_against_avg: _cpAgainst,
      cards_points_for_home_avg: _cpForHome,
      cards_points_against_home_avg: _cpAgainstHome,
      cards_points_for_away_avg: _cpForAway,
      cards_points_against_away_avg: _cpAgainstAway,
      ...cols
    }) => ({
      ...cols,
      updated_at: new Date().toISOString()
    })
  );
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
    cards: {
      for: "cards_for_avg",
      against: "cards_against_avg"
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
  const resolvedKey = fields[marketKey] ? marketKey : "corners";
  const f = fields[resolvedKey];

  const atkH = Number(rollingHome?.[f.for]);
  const defA = Number(rollingAway?.[f.against]);
  const atkA = Number(rollingAway?.[f.for]);
  const defH = Number(rollingHome?.[f.against]);

  const sampleHome = marketSampleCount(rollingHome, resolvedKey);
  const sampleAway = marketSampleCount(rollingAway, resolvedKey);

  const fallbackResult = (reason) => ({
    lambdaHome: baseSide * Math.pow(homeAdv, 0.5),
    lambdaAway: baseSide * Math.pow(awayAdv, 0.5),
    sampleHome,
    sampleAway,
    usedFallback: true,
    fallbackReason: reason
  });

  // O latură e folosibilă doar cu medii finite pozitive ŞI un sample real suficient
  // pe această familie de piaţă — sub prag, mediile sunt zgomot (1-3 meciuri) sau
  // provin din date contaminate şi prior-ul ligii este estimatorul mai bun.
  const hasHome =
    Number.isFinite(atkH) && atkH > 0 && Number.isFinite(defH) && defH > 0 &&
    sampleHome >= MIN_MARKET_SAMPLES;
  const hasAway =
    Number.isFinite(atkA) && atkA > 0 && Number.isFinite(defA) && defA > 0 &&
    sampleAway >= MIN_MARKET_SAMPLES;
  // dacă amândouă sunt zero / null / sub-eşantionate → fallback la baseSide pentru ambele
  if (!hasHome && !hasAway) {
    return fallbackResult("insufficient_data");
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

  // Safety net: fallback-ul complet produce λTotal ≈ baseAvgTotal, deci un λTotal sub
  // baseSide (= jumătate din baseline-ul propriu al ligii) nu poate proveni decât din
  // rolling degenerat (ex. medii otrăvite de meciuri null persistate înainte de fix).
  // Pragul scalează cu baseline-ul fiecărei ligi — nu e o constantă arbitrară.
  if (lambdaHome + lambdaAway < baseSide) {
    return fallbackResult("sanity_gate");
  }

  return {
    lambdaHome: Number(lambdaHome.toFixed(3)),
    lambdaAway: Number(lambdaAway.toFixed(3)),
    sampleHome,
    sampleAway,
    usedFallback: !hasHome || !hasAway,
    fallbackReason: !hasHome || !hasAway ? "partial_data" : null
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
