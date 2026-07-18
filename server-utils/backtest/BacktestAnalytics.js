/**
 * Advanced Backtest Analytics.
 *
 * Computes ROI, Yield, Profit, Loss, Average Odds/Confidence, Hit Rate, Expected Value,
 * Maximum Drawdown, Winning/Losing streaks from settled prediction history rows.
 *
 * Supports filters: days / season, league, competition, market, confidence, odds, home/away.
 * HARD RULE alignment with Value Engine: only stake value-bet rows with positive EV when
 * `requirePositiveEv` is true (default false for historical parity with existing snapshots).
 */

function round(n, digits = 4) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

/** Current football season start (Aug 1). If month < August, season started previous calendar year. */
export function seasonStartIso(now = new Date()) {
  const y = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based
  const startYear = month >= 7 ? y : y - 1;
  return new Date(Date.UTC(startYear, 7, 1, 0, 0, 0)).toISOString();
}

export function resolveWindowDays(period, daysHint) {
  const p = String(period || "").toLowerCase();
  if (p === "7d" || p === "7") return 7;
  if (p === "30d" || p === "30") return 30;
  if (p === "season") return null; // caller uses seasonStartIso
  const d = Number(daysHint);
  if (Number.isFinite(d)) return clamp(d, 7, 400);
  return 45;
}

export function getSelectedOdd(row, type) {
  if (type === "1") return Number(row.odds_home);
  if (type === "X") return Number(row.odds_draw);
  if (type === "2") return Number(row.odds_away);
  return null;
}

function normalizeMarket(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s || s === "ALL") return "all";
  if (s === "1" || s === "HOME" || s === "H") return "1";
  if (s === "X" || s === "DRAW" || s === "D") return "X";
  if (s === "2" || s === "AWAY" || s === "A") return "2";
  return s.toLowerCase();
}

/**
 * Extract a stakeable bet event from a predictions_history row.
 * Returns null when the row cannot contribute to PnL.
 */
export function extractBetEvent(row) {
  if (!row) return null;
  const payload = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const valueBet = payload.valueBet && typeof payload.valueBet === "object" ? payload.valueBet : {};
  const type = String(valueBet.type || "").trim();
  const stakePct = clamp(Number(valueBet.kelly || 0), 0, 3);
  const stake = stakePct / 100;
  const odd = getSelectedOdd(row, type);
  const ev = Number(valueBet.ev ?? valueBet.expectedValue);
  const confidence = Number(
    valueBet.confidence ??
      payload.recommended?.confidence ??
      row.recommended_confidence ??
      0
  );

  const vbOutcome = row.value_bet_validation ?? payload.value_bet_validation;
  const won = vbOutcome === "win" || (vbOutcome == null && row.validation === "win");
  const lost = vbOutcome === "loss" || (vbOutcome == null && row.validation === "loss");
  if (!won && !lost) return null;
  if (stake <= 0 || !Number.isFinite(odd) || odd <= 1) return null;

  const pnl = won ? stake * (odd - 1) : -stake;

  return {
    fixtureId: row.fixture_id ?? null,
    kickoffAt: row.kickoff_at || null,
    leagueId: Number(row.league_id) || 0,
    leagueName: String(row.league_name || ""),
    homeTeam: String(row.home_team || ""),
    awayTeam: String(row.away_team || ""),
    market: type || String(row.recommended_pick || ""),
    side: type === "1" ? "home" : type === "2" ? "away" : type === "X" ? "draw" : "other",
    odd: round(odd, 3),
    stake: round(stake, 6),
    stakePct: round(stakePct, 3),
    ev: Number.isFinite(ev) ? round(ev, 3) : null,
    confidence: Number.isFinite(confidence) ? round(confidence, 2) : null,
    won,
    pnl: round(pnl, 6),
    competition: String(row.league_name || "")
  };
}

export function parseFilters(query = {}) {
  const period = String(query.period || query.window || "").toLowerCase() || null;
  const days = resolveWindowDays(period, query.days);
  const leagueId = query.leagueId != null && query.leagueId !== "" ? Number(query.leagueId) : null;
  const competition = String(query.competition || query.league || "").trim();
  const market = normalizeMarket(query.market);
  const side = String(query.side || query.venue || "").toLowerCase(); // home | away | draw | all
  const minConfidence = query.minConfidence != null && query.minConfidence !== "" ? Number(query.minConfidence) : null;
  const maxConfidence = query.maxConfidence != null && query.maxConfidence !== "" ? Number(query.maxConfidence) : null;
  const minOdds = query.minOdds != null && query.minOdds !== "" ? Number(query.minOdds) : null;
  const maxOdds = query.maxOdds != null && query.maxOdds !== "" ? Number(query.maxOdds) : null;
  const requirePositiveEv = String(query.requirePositiveEv || "") === "1" || query.requirePositiveEv === true;

  return {
    period: period || (days === 7 ? "7d" : days === 30 ? "30d" : days == null ? "season" : `${days}d`),
    days,
    leagueId: Number.isFinite(leagueId) ? leagueId : null,
    competition: competition || null,
    market,
    side: ["home", "away", "draw"].includes(side) ? side : "all",
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : null,
    maxConfidence: Number.isFinite(maxConfidence) ? maxConfidence : null,
    minOdds: Number.isFinite(minOdds) ? minOdds : null,
    maxOdds: Number.isFinite(maxOdds) ? maxOdds : null,
    requirePositiveEv
  };
}

export function filterBetEvents(events, filters) {
  const f = filters || parseFilters({});
  return (events || []).filter((e) => {
    if (f.leagueId != null && e.leagueId !== f.leagueId) return false;
    if (f.competition) {
      const needle = f.competition.toLowerCase();
      if (!String(e.competition || e.leagueName || "").toLowerCase().includes(needle)) return false;
    }
    if (f.market && f.market !== "all") {
      if (String(e.market).toUpperCase() !== String(f.market).toUpperCase()) return false;
    }
    if (f.side === "home" && e.side !== "home") return false;
    if (f.side === "away" && e.side !== "away") return false;
    if (f.side === "draw" && e.side !== "draw") return false;
    if (f.minConfidence != null && (e.confidence == null || e.confidence < f.minConfidence)) return false;
    if (f.maxConfidence != null && (e.confidence == null || e.confidence > f.maxConfidence)) return false;
    if (f.minOdds != null && e.odd < f.minOdds) return false;
    if (f.maxOdds != null && e.odd > f.maxOdds) return false;
    if (f.requirePositiveEv && !(e.ev != null && e.ev > 0)) return false;
    return true;
  });
}

/**
 * Core metrics + equity curve + streaks from an ordered list of bet events.
 */
export function computeBacktestMetrics(events) {
  const list = Array.isArray(events) ? events : [];
  let wins = 0;
  let losses = 0;
  let stakeSum = 0;
  let pnlUnits = 0;
  let profit = 0;
  let lossAbs = 0;
  let oddsSum = 0;
  let confSum = 0;
  let confCount = 0;
  let evSum = 0;
  let evCount = 0;
  let maxDrawdown = 0;
  let peak = 0;
  let equity = 0;

  let winStreak = 0;
  let lossStreak = 0;
  let maxWinStreak = 0;
  let maxLossStreak = 0;

  const equityCurve = [];
  const dailyMap = new Map();

  for (const e of list) {
    stakeSum += e.stake;
    oddsSum += e.odd;
    if (e.confidence != null && Number.isFinite(e.confidence)) {
      confSum += e.confidence;
      confCount += 1;
    }
    if (e.ev != null && Number.isFinite(e.ev)) {
      evSum += e.ev;
      evCount += 1;
    }

    if (e.won) {
      wins += 1;
      profit += e.pnl;
      winStreak += 1;
      lossStreak = 0;
      maxWinStreak = Math.max(maxWinStreak, winStreak);
    } else {
      losses += 1;
      lossAbs += Math.abs(e.pnl);
      lossStreak += 1;
      winStreak = 0;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    }

    pnlUnits += e.pnl;
    equity = pnlUnits;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);

    const day = e.kickoffAt ? String(e.kickoffAt).slice(0, 10) : "unknown";
    if (!dailyMap.has(day)) dailyMap.set(day, { date: day, pnl: 0, settled: 0, wins: 0, losses: 0, stake: 0 });
    const d = dailyMap.get(day);
    d.pnl += e.pnl;
    d.settled += 1;
    d.stake += e.stake;
    if (e.won) d.wins += 1;
    else d.losses += 1;

    equityCurve.push({
      i: equityCurve.length + 1,
      date: day,
      equity: round(equity, 6),
      pnl: round(e.pnl, 6),
      drawdown: round(peak - equity, 6)
    });
  }

  const settled = wins + losses;
  const hitRate = settled ? (wins / settled) * 100 : 0;
  const roi = stakeSum > 0 ? (pnlUnits / stakeSum) * 100 : 0;
  const yieldPct = roi; // betting yield ≡ ROI on turnover (total stake)
  const avgOdds = settled ? oddsSum / settled : 0;
  const avgConfidence = confCount ? confSum / confCount : 0;
  const expectedValue = evCount ? evSum / evCount : 0;

  let running = 0;
  const daily = Array.from(dailyMap.values())
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((d) => {
      running += d.pnl;
      return {
        date: d.date,
        pnl: round(d.pnl, 6),
        equity: round(running, 6),
        settled: d.settled,
        wins: d.wins,
        losses: d.losses,
        stake: round(d.stake, 6),
        hitRate: d.settled ? round((d.wins / d.settled) * 100, 2) : 0
      };
    });

  const byMarket = summarizeBy(list, (e) => e.market || "?");
  const byLeague = summarizeBy(list, (e) => e.leagueName || String(e.leagueId) || "?");
  const bySide = summarizeBy(list, (e) => e.side || "?");

  return {
    settled,
    wins,
    losses,
    hitRate: round(hitRate, 4),
    roi: round(roi, 4),
    yield: round(yieldPct, 4),
    profit: round(profit, 6),
    loss: round(lossAbs, 6),
    pnlUnits: round(pnlUnits, 6),
    totalStake: round(stakeSum, 6),
    averageOdds: round(avgOdds, 3),
    averageConfidence: round(avgConfidence, 2),
    expectedValue: round(expectedValue, 4),
    maxDrawdown: round(maxDrawdown, 6),
    winningStreak: maxWinStreak,
    losingStreak: maxLossStreak,
    equityCurve,
    daily,
    byMarket,
    byLeague,
    bySide
  };
}

function summarizeBy(list, keyFn) {
  const map = new Map();
  for (const e of list) {
    const key = String(keyFn(e) || "?");
    if (!map.has(key)) map.set(key, { key, settled: 0, wins: 0, losses: 0, pnl: 0, stake: 0, oddsSum: 0 });
    const o = map.get(key);
    o.settled += 1;
    o.stake += e.stake;
    o.oddsSum += e.odd;
    o.pnl += e.pnl;
    if (e.won) o.wins += 1;
    else o.losses += 1;
  }
  return Array.from(map.values())
    .map((o) => ({
      key: o.key,
      settled: o.settled,
      wins: o.wins,
      losses: o.losses,
      hitRate: o.settled ? round((o.wins / o.settled) * 100, 2) : 0,
      roi: o.stake > 0 ? round((o.pnl / o.stake) * 100, 2) : 0,
      pnl: round(o.pnl, 6),
      averageOdds: o.settled ? round(o.oddsSum / o.settled, 3) : 0
    }))
    .sort((a, b) => b.settled - a.settled);
}

function sumPnlSince(daily, daysBack, now = new Date()) {
  const cutoff = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let sum = 0;
  for (const d of daily || []) {
    if (String(d.date) >= cutoff) sum += Number(d.pnl) || 0;
  }
  return round(sum, 6);
}

function lastDayPnl(daily) {
  if (!daily || !daily.length) return 0;
  return round(Number(daily[daily.length - 1].pnl) || 0, 6);
}

function confidenceDistribution(events) {
  const buckets = [
    { key: "0-40", min: 0, max: 40, n: 0, wins: 0 },
    { key: "40-50", min: 40, max: 50, n: 0, wins: 0 },
    { key: "50-60", min: 50, max: 60, n: 0, wins: 0 },
    { key: "60-70", min: 60, max: 70, n: 0, wins: 0 },
    { key: "70-80", min: 70, max: 80, n: 0, wins: 0 },
    { key: "80-100", min: 80, max: 101, n: 0, wins: 0 }
  ];
  for (const e of events || []) {
    const c = Number(e.confidence);
    if (!Number.isFinite(c)) continue;
    const b = buckets.find((x) => c >= x.min && c < x.max);
    if (!b) continue;
    b.n += 1;
    if (e.won) b.wins += 1;
  }
  return buckets.map((b) => ({
    bucket: b.key,
    count: b.n,
    hitRate: b.n ? round((b.wins / b.n) * 100, 2) : 0
  }));
}

function leagueMarketHeatmap(events, maxLeagues = 8) {
  const leagueCounts = new Map();
  for (const e of events || []) {
    const lg = e.leagueName || String(e.leagueId) || "?";
    leagueCounts.set(lg, (leagueCounts.get(lg) || 0) + 1);
  }
  const topLeagues = Array.from(leagueCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxLeagues)
    .map(([name]) => name);
  const markets = ["1", "X", "2"];
  const cells = [];
  for (const league of topLeagues) {
    for (const market of markets) {
      const subset = (events || []).filter(
        (e) => (e.leagueName || String(e.leagueId) || "?") === league && String(e.market) === market
      );
      const wins = subset.filter((e) => e.won).length;
      const n = subset.length;
      cells.push({
        league,
        market,
        settled: n,
        hitRate: n ? round((wins / n) * 100, 1) : null,
        pnl: round(subset.reduce((s, e) => s + e.pnl, 0), 4)
      });
    }
  }
  return { leagues: topLeagues, markets, cells };
}

function radarProfile(metrics) {
  const m = metrics || {};
  const clamp01 = (x) => Math.max(0, Math.min(100, x));
  return [
    { metric: "Accuracy", value: clamp01(Number(m.hitRate) || 0) },
    { metric: "ROI", value: clamp01(50 + (Number(m.roi) || 0)) },
    { metric: "Yield", value: clamp01(50 + (Number(m.yield) || 0)) },
    { metric: "EV", value: clamp01(50 + (Number(m.expectedValue) || 0) * 2) },
    { metric: "Stability", value: clamp01(100 - (Number(m.maxDrawdown) || 0) * 40) },
    { metric: "Confidence", value: clamp01(Number(m.averageConfidence) || 0) }
  ];
}

function predictionDistribution(events) {
  const map = new Map();
  for (const e of events || []) {
    const key = String(e.market || e.side || "other");
    map.set(key, (map.get(key) || 0) + 1);
  }
  const total = events?.length || 0;
  return [...map.entries()]
    .map(([key, count]) => ({
      key,
      count,
      pct: total ? round((count / total) * 100, 1) : 0
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

/**
 * Dashboard-ready aggregates (widgets + chart series) derived from metrics/events.
 */
export function buildDashboardBundle(metrics, events) {
  const byLeague = metrics.byLeague || [];
  const byMarket = metrics.byMarket || [];
  const ranked = [...byLeague].filter((l) => l.settled >= 2).sort((a, b) => b.roi - a.roi);
  const bestLeagues = ranked.slice(0, 5);
  const worstLeagues = [...ranked].sort((a, b) => a.roi - b.roi).slice(0, 5);
  const marketsRanked = [...byMarket].filter((m) => m.settled >= 2).sort((a, b) => b.roi - a.roi);
  const bestMarkets = marketsRanked.slice(0, 5);
  const worstMarkets = [...marketsRanked].sort((a, b) => a.roi - b.roi).slice(0, 5);
  const daily = metrics.daily || [];

  return {
    predictionAccuracy: round(metrics.hitRate, 2),
    hitRate: round(metrics.hitRate, 2),
    roi: round(metrics.roi, 2),
    yield: round(metrics.yield, 2),
    averageOdds: round(metrics.averageOdds, 3),
    expectedValue: round(metrics.expectedValue, 4),
    settled: metrics.settled || 0,
    dailyProfit: lastDayPnl(daily),
    weeklyProfit: sumPnlSince(daily, 7),
    monthlyProfit: sumPnlSince(daily, 30),
    leaguePerformance: byLeague.slice(0, 12),
    marketPerformance: byMarket.slice(0, 12),
    confidenceDistribution: confidenceDistribution(events),
    predictionDistribution: predictionDistribution(events),
    accuracyByLeague: byLeague.map((l) => ({ key: l.key, hitRate: l.hitRate, settled: l.settled })),
    accuracyByMarket: byMarket.map((m) => ({
      key: m.key,
      hitRate: m.hitRate,
      settled: m.settled
    })),
    bestLeagues,
    worstLeagues,
    bestMarkets,
    worstMarkets,
    heatmap: leagueMarketHeatmap(events),
    radar: radarProfile(metrics),
    profitLine: daily.map((d) => ({ date: d.date, equity: d.equity, pnl: d.pnl, hitRate: d.hitRate }))
  };
}

/**
 * Build full analytics report from raw history rows + filter query.
 */
export function buildBacktestReport(rows, query = {}) {
  const filters = parseFilters(query);
  const events = [];
  for (const row of rows || []) {
    const ev = extractBetEvent(row);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => String(a.kickoffAt || "").localeCompare(String(b.kickoffAt || "")));
  const filtered = filterBetEvents(events, filters);
  const metrics = computeBacktestMetrics(filtered);
  const dashboard = buildDashboardBundle(metrics, filtered);

  const leagues = uniqueSorted(events.map((e) => ({ id: e.leagueId, name: e.leagueName })).filter((l) => l.id || l.name));
  const competitions = uniqueSortedStrings(events.map((e) => e.competition).filter(Boolean));
  const markets = uniqueSortedStrings(events.map((e) => e.market).filter(Boolean));

  return {
    filters,
    metrics,
    dashboard,
    bets: filtered.map((e) => ({
      fixtureId: e.fixtureId,
      kickoffAt: e.kickoffAt,
      leagueId: e.leagueId,
      leagueName: e.leagueName,
      homeTeam: e.homeTeam,
      awayTeam: e.awayTeam,
      market: e.market,
      side: e.side,
      odd: e.odd,
      stake: e.stake,
      confidence: e.confidence,
      ev: e.ev,
      won: e.won,
      pnl: e.pnl
    })),
    facets: { leagues, competitions, markets },
    totalsUnfiltered: {
      settled: events.length,
      filtered: filtered.length
    }
  };
}

function uniqueSorted(items) {
  const seen = new Map();
  for (const it of items) {
    const key = `${it.id}|${it.name}`;
    if (!seen.has(key)) seen.set(key, it);
  }
  return Array.from(seen.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function uniqueSortedStrings(arr) {
  return Array.from(new Set(arr.map((s) => String(s)))).sort((a, b) => a.localeCompare(b));
}

export function betsToCsv(bets) {
  const header = [
    "fixtureId",
    "kickoffAt",
    "leagueId",
    "leagueName",
    "homeTeam",
    "awayTeam",
    "market",
    "side",
    "odd",
    "stake",
    "confidence",
    "ev",
    "won",
    "pnl"
  ];
  const escape = (v) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const b of bets || []) {
    lines.push(
      [
        b.fixtureId,
        b.kickoffAt,
        b.leagueId,
        b.leagueName,
        b.homeTeam,
        b.awayTeam,
        b.market,
        b.side,
        b.odd,
        b.stake,
        b.confidence,
        b.ev,
        b.won,
        b.pnl
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export default {
  seasonStartIso,
  resolveWindowDays,
  getSelectedOdd,
  extractBetEvent,
  parseFilters,
  filterBetEvents,
  computeBacktestMetrics,
  buildDashboardBundle,
  buildBacktestReport,
  betsToCsv
};
