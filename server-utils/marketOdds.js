import { removeBookmakerMargin } from "./advancedMath.js";

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n) && n > 1).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Median odds across bookmakers for Match Winner (1X2). More stable than first bookmaker only.
 * @returns {{ home: number, draw: number, away: number, bookmakersUsed: number, bookmakerNames: string[] } | null}
 */
export function consensusMatchWinnerOdds(oddsApiResponse) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;

  const hList = [];
  const dList = [];
  const aList = [];
  const names = [];

  for (const b of bookmakers) {
    const market = b.bets?.find((x) => x.name === "Match Winner");
    if (!market?.values) continue;
    const h = parseFloat(market.values.find((v) => v.value === "Home")?.odd);
    const d = parseFloat(market.values.find((v) => v.value === "Draw")?.odd);
    const a = parseFloat(market.values.find((v) => v.value === "Away")?.odd);
    if (Number.isFinite(h) && h > 1 && Number.isFinite(d) && d > 1 && Number.isFinite(a) && a > 1) {
      hList.push(h);
      dList.push(d);
      aList.push(a);
      names.push(b.name || "?");
    }
  }

  if (hList.length === 0) return null;

  const mh = median(hList);
  const md = median(dList);
  const ma = median(aList);
  if (mh == null || md == null || ma == null) return null;

  return {
    home: mh,
    draw: md,
    away: ma,
    bookmakersUsed: hList.length,
    bookmakerNames: names.slice(0, 8)
  };
}

// Full-time correct-score market — API-Football's bookmaker feed names this bet
// "Correct Score" for some bookmakers and "Exact Score" for others, and formats
// the scoreline label with "-" or ":" depending on which name is used (confirmed
// via live odds inspection across two leagues, Sprint 5/6 — every "Exact Score"
// bookmaker observed used ":", every "Correct Score" bookmaker used "-").
// Deliberately excludes "Correct Score - First Half" / "Correct Score - Second
// Half", which are different (partial-match) markets.
const CORRECT_SCORE_BET_NAMES = ["Correct Score", "Exact Score"];

/**
 * Median Correct Score odds across bookmakers, keyed by "home-away" scoreline
 * (e.g. "2-1") regardless of whether the source label used "-" or ":". Non-numeric
 * scoreline labels some bookmakers include (e.g. "Other", "4+") are skipped —
 * only exact "\d+[-:]\d+" values are usable here.
 * @returns {{ scores: Record<string, number>, bookmakersUsed: number, bookmakerNames: string[] } | null}
 */
export function consensusCorrectScoreOdds(oddsApiResponse) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;

  const oddsByScore = new Map();
  const names = [];

  for (const b of bookmakers) {
    const market = b.bets?.find((x) => CORRECT_SCORE_BET_NAMES.includes(x.name));
    if (!market?.values) continue;
    let usedThisBookmaker = false;
    for (const v of market.values) {
      const m = /^(\d+)[-:](\d+)$/.exec(String(v?.value ?? "").trim());
      if (!m) continue;
      const odd = parseFloat(v.odd);
      if (!Number.isFinite(odd) || odd <= 1) continue;
      const key = `${m[1]}-${m[2]}`;
      if (!oddsByScore.has(key)) oddsByScore.set(key, []);
      oddsByScore.get(key).push(odd);
      usedThisBookmaker = true;
    }
    if (usedThisBookmaker) names.push(b.name || "?");
  }

  if (oddsByScore.size === 0) return null;

  const scores = {};
  for (const [key, list] of oddsByScore) {
    const m = median(list);
    if (m != null) scores[key] = m;
  }
  if (Object.keys(scores).length === 0) return null;

  return {
    scores,
    bookmakersUsed: names.length,
    bookmakerNames: names.slice(0, 8)
  };
}

export function impliedProbsFromConsensus(consensus) {
  if (!consensus) return null;
  return removeBookmakerMargin(consensus.home, consensus.draw, consensus.away);
}

/**
 * Median BTTS odds across bookmakers (Yes/No).
 */
export function consensusBttsOdds(oddsApiResponse) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;

  const yes = [];
  const no = [];
  const names = [];

  for (const b of bookmakers) {
    const market = b.bets?.find((x) => String(x?.name || "").toLowerCase().includes("both teams score"));
    if (!market?.values || !Array.isArray(market.values)) continue;
    const y = Number.parseFloat(String(market.values.find((v) => String(v?.value || "").toLowerCase() === "yes")?.odd ?? ""));
    const n = Number.parseFloat(String(market.values.find((v) => String(v?.value || "").toLowerCase() === "no")?.odd ?? ""));
    if (Number.isFinite(y) && y > 1) yes.push(y);
    if (Number.isFinite(n) && n > 1) no.push(n);
    if ((Number.isFinite(y) && y > 1) || (Number.isFinite(n) && n > 1)) names.push(b.name || "?");
  }

  const medYes = median(yes);
  const medNo = median(no);
  if (medYes == null && medNo == null) return null;
  return {
    yes: medYes,
    no: medNo,
    bookmakersUsed: Math.max(yes.length, no.length),
    bookmakerNames: names.slice(0, 8)
  };
}

function parseLineFromValueLabel(label) {
  const s = String(label || "");
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function valueKind(label) {
  const s = String(label || "").toLowerCase();
  if (s.includes("over")) return "over";
  if (s.includes("under")) return "under";
  return null;
}

function normalizeMarketName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bookmakers that more often list specialty shot markets — tried first. */
export const PREFERRED_SHOTS_BOOKMAKERS = [
  "bet365",
  "unibet",
  "pinnacle",
  "william hill",
  "1xbet",
  "bwin",
  "betfair",
  "marathonbet"
];

export const SHOTS_SOT_MARKET_NAMES = [
  "Shots On Target - Over/Under",
  "Shots on Target Over/Under",
  "Shots on Goal Over/Under",
  "Total Shots on Target Over/Under",
  "Total Shots On Target",
  "Shots On Target",
  "Shots on Goal",
  "Total Shots on Goal",
  "Match Shots on Target",
  "Total Match Shots on Target",
  "Shots On Target Over Under"
];

export const SHOTS_TOTAL_MARKET_NAMES = [
  "Total Shots Over/Under",
  "Shots Over/Under",
  "Total Shots",
  "Match Shots Over/Under",
  "Shots",
  "Total Match Shots",
  "Match Total Shots",
  "Shots Over Under"
];

export const SHOTS_SOT_HOME_MARKET_NAMES = [
  "Home Team Total Shots On Target",
  "Home Team Shots On Target",
  "Home Shots On Target",
  "Home Total Shots On Target",
  "Team Shots On Target Home"
];

export const SHOTS_SOT_AWAY_MARKET_NAMES = [
  "Away Team Total Shots On Target",
  "Away Team Shots On Target",
  "Away Shots On Target",
  "Away Total Shots On Target",
  "Team Shots On Target Away"
];

export const FIRST_HALF_GOALS_MARKET_NAMES = [
  "First Half Goals",
  "1st Half Goals Over/Under",
  "Goals Over/Under First Half",
  "First Half Goals Over/Under",
  "Total Goals First Half",
  "Total Goals - First Half",
  "Goals First Half",
  "1st Half Goals",
  "First Half Total Goals",
  "HT Goals Over/Under",
  "Half Time Goals Over/Under"
];

function isPreferredBookmaker(name, preferredList) {
  if (!preferredList?.length) return false;
  const n = String(name || "").toLowerCase();
  return preferredList.some((p) => n.includes(String(p).toLowerCase()));
}

/**
 * Score how well an API market name matches candidate labels.
 * Skips player props. Team props only for *_home / *_away kinds.
 */
function scoreMarketName(apiName, candidates, kind = "generic") {
  const n = normalizeMarketName(apiName);
  if (!n) return 0;
  if (/\bplayer\b/.test(n)) return 0;

  const teamKind = kind === "shots_on_target_home" || kind === "shots_on_target_away";
  if (!teamKind && (/\bhome team\b/.test(n) || /\baway team\b/.test(n))) return 0;

  if (kind === "shots_on_target" || kind === "shots_on_target_home" || kind === "shots_on_target_away") {
    if (!/(on target|on goal|shots on|\bsot\b)/.test(n)) return 0;
  }
  if (kind === "shots_on_target_home") {
    if (!/\bhome\b/.test(n)) return 0;
    if (/\baway\b/.test(n)) return 0;
  }
  if (kind === "shots_on_target_away") {
    if (!/\baway\b/.test(n)) return 0;
    if (/\bhome\b/.test(n)) return 0;
  }
  if (kind === "shots_total") {
    if (/(on target|on goal)/.test(n)) return 0;
    if (!/\bshots?\b/.test(n)) return 0;
    if (/\bhome\b/.test(n) || /\baway\b/.test(n)) return 0;
  }
  if (kind === "corners") {
    if (!/\bcorners?\b/.test(n)) return 0;
  }
  if (kind === "first_half_goals") {
    if (/\bsecond\b/.test(n) || /\b2nd\b/.test(n)) return 0;
    if (!/(first half|1st half|\bht\b|half time|halftime)/.test(n)) return 0;
    if (!/\bgoals?\b/.test(n)) return 0;
  }

  let best = 0;
  for (const raw of candidates || []) {
    const c = normalizeMarketName(raw);
    if (!c) continue;
    if (n === c) {
      best = Math.max(best, 100);
      continue;
    }
    if (n.includes(c) || c.includes(n)) {
      best = Math.max(best, 80 + Math.min(c.length, 20) / 40);
      continue;
    }
    const words = c.split(" ").filter((w) => w.length > 2 && !["the", "and", "for"].includes(w));
    if (words.length >= 2 && words.every((w) => n.includes(w))) {
      best = Math.max(best, 60 + words.length);
    }
  }
  return best;
}

function pickBestMarket(bets, candidates, kind = "generic") {
  let best = null;
  let bestScore = 0;
  for (const bet of bets || []) {
    const score = scoreMarketName(bet?.name, candidates, kind);
    if (score > bestScore) {
      bestScore = score;
      best = bet;
    }
  }
  return bestScore >= 60 ? best : null;
}

/**
 * Median odds for Over/Under at a specific line from candidate market names.
 * Returns null when no usable bookmaker quotes exist.
 */
/**
 * Median Double Chance odds (Home/Draw, Home/Away, Draw/Away).
 */
export function consensusDoubleChanceOdds(oddsApiResponse) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;

  const hd = [];
  const ha = [];
  const da = [];
  const names = [];

  const matchBucket = (label) => {
    const s = String(label || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (s === "1x" || s.includes("home/draw") || s.includes("home or draw")) return "hd";
    if (s === "12" || s.includes("home/away") || s.includes("home or away")) return "ha";
    if (s === "x2" || s.includes("draw/away") || s.includes("draw or away")) return "da";
    if (s.startsWith("home") && s.includes("draw")) return "hd";
    if (s.startsWith("home") && s.includes("away")) return "ha";
    if (s.startsWith("draw") && s.includes("away")) return "da";
    return null;
  };

  for (const b of bookmakers) {
    const market = b.bets?.find((x) => String(x?.name || "").toLowerCase() === "double chance");
    if (!market?.values || !Array.isArray(market.values)) continue;
    let got = false;
    for (const v of market.values) {
      const bucket = matchBucket(v?.value);
      const odd = Number.parseFloat(String(v?.odd ?? ""));
      if (!bucket || !Number.isFinite(odd) || odd <= 1) continue;
      if (bucket === "hd") hd.push(odd);
      if (bucket === "ha") ha.push(odd);
      if (bucket === "da") da.push(odd);
      got = true;
    }
    if (got) names.push(b.name || "?");
  }

  const medHd = median(hd);
  const medHa = median(ha);
  const medDa = median(da);
  if (medHd == null && medHa == null && medDa == null) return null;
  return {
    homeDraw: medHd,
    homeAway: medHa,
    drawAway: medDa,
    bookmakersUsed: Math.max(hd.length, ha.length, da.length),
    bookmakerNames: names.slice(0, 8)
  };
}

/**
 * Median odds for Over/Under near a target line.
 * @param {object} oddsApiResponse
 * @param {string[]} marketNames candidate market labels
 * @param {number} targetLine
 * @param {{ maxLineDelta?: number, kind?: string, preferredBookmakers?: string[] }} [options]
 *   maxLineDelta — allow nearest line within this distance (default 0 = exact only)
 *   kind — "shots_on_target" | "shots_on_target_home" | "shots_on_target_away" | "shots_total" | "corners" | "first_half_goals" | "generic"
 *   preferredBookmakers — if any preferred book has quotes, median only those
 */
export function consensusOverUnderOddsAtLine(oddsApiResponse, marketNames, targetLine, options = {}) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;
  const requestedLine = Number(targetLine);
  if (!Number.isFinite(requestedLine)) return null;
  const maxLineDelta = Number(options?.maxLineDelta);
  const delta = Number.isFinite(maxLineDelta) && maxLineDelta >= 0 ? maxLineDelta : 0;
  const kind = String(options?.kind || "generic");
  const preferred = Array.isArray(options?.preferredBookmakers) ? options.preferredBookmakers : [];

  const collect = (books) => {
    /** @type {Map<number, { over: number[], under: number[], names: string[] }>} */
    const byLine = new Map();
    for (const b of books) {
      const bets = Array.isArray(b?.bets) ? b.bets : [];
      const market = pickBestMarket(bets, marketNames, kind);
      if (!market?.values || !Array.isArray(market.values)) continue;

      /** @type {Map<number, { over?: number, under?: number }>} */
      const bookLines = new Map();
      for (const v of market.values) {
        const parsed = parseLineFromValueLabel(v?.value);
        if (parsed == null) continue;
        const kindOu = valueKind(v?.value);
        if (!kindOu) continue;
        const odd = Number.parseFloat(String(v?.odd ?? ""));
        if (!Number.isFinite(odd) || odd <= 1) continue;
        const slot = bookLines.get(parsed) || {};
        slot[kindOu] = odd;
        bookLines.set(parsed, slot);
      }

      for (const [lineKey, slot] of bookLines.entries()) {
        if (Math.abs(lineKey - requestedLine) > delta + 1e-9) continue;
        let bucket = byLine.get(lineKey);
        if (!bucket) {
          bucket = { over: [], under: [], names: [] };
          byLine.set(lineKey, bucket);
        }
        if (Number.isFinite(slot.over)) bucket.over.push(slot.over);
        if (Number.isFinite(slot.under)) bucket.under.push(slot.under);
        if (Number.isFinite(slot.over) || Number.isFinite(slot.under)) {
          bucket.names.push(b.name || "?");
        }
      }
    }
    return byLine;
  };

  let byLine = new Map();
  if (preferred.length) {
    const prefBooks = bookmakers.filter((b) => isPreferredBookmaker(b?.name, preferred));
    if (prefBooks.length) byLine = collect(prefBooks);
  }
  if (!byLine.size) byLine = collect(bookmakers);

  if (!byLine.size) return null;

  // Prefer exact line, else nearest with quotes; tie-break more bookmakers.
  let chosenLine = null;
  let chosenBucket = null;
  let bestDist = Infinity;
  for (const [lineKey, bucket] of byLine.entries()) {
    if (!bucket.over.length && !bucket.under.length) continue;
    const dist = Math.abs(lineKey - requestedLine);
    if (chosenLine == null) {
      chosenLine = lineKey;
      chosenBucket = bucket;
      bestDist = dist;
      continue;
    }
    const chosenExact = bestDist < 0.001;
    const candExact = dist < 0.001;
    if (candExact && !chosenExact) {
      chosenLine = lineKey;
      chosenBucket = bucket;
      bestDist = dist;
      continue;
    }
    if (candExact === chosenExact) {
      if (dist < bestDist - 1e-9) {
        chosenLine = lineKey;
        chosenBucket = bucket;
        bestDist = dist;
      } else if (Math.abs(dist - bestDist) < 1e-9) {
        const curBooks = Math.max(bucket.over.length, bucket.under.length);
        const prevBooks = Math.max(chosenBucket.over.length, chosenBucket.under.length);
        if (curBooks > prevBooks) {
          chosenLine = lineKey;
          chosenBucket = bucket;
        }
      }
    }
  }

  if (chosenLine == null || !chosenBucket) return null;
  const medOver = median(chosenBucket.over);
  const medUnder = median(chosenBucket.under);
  if (medOver == null && medUnder == null) return null;
  return {
    line: chosenLine,
    requestedLine,
    lineExact: Math.abs(chosenLine - requestedLine) < 0.001,
    over: medOver,
    under: medUnder,
    bookmakersUsed: Math.max(chosenBucket.over.length, chosenBucket.under.length),
    bookmakerNames: chosenBucket.names.slice(0, 8)
  };
}

/**
 * Best available shots quote for the card SOT row.
 * Order: match SOT → match total shots → home team SOT → away team SOT.
 */
export function resolveShotsOnTargetMarketQuote(
  oddsApiResponse,
  {
    matchLine,
    homeLine = null,
    awayLine = null,
    preferredBookmakers = PREFERRED_SHOTS_BOOKMAKERS
  } = {}
) {
  const line = Number(matchLine);
  if (!Number.isFinite(line)) return null;
  const pref = { preferredBookmakers };

  const sot = consensusOverUnderOddsAtLine(oddsApiResponse, SHOTS_SOT_MARKET_NAMES, line, {
    maxLineDelta: 1.5,
    kind: "shots_on_target",
    ...pref
  });
  if (sot) return { ...sot, sourceKind: "sot" };

  const total = consensusOverUnderOddsAtLine(oddsApiResponse, SHOTS_TOTAL_MARKET_NAMES, line, {
    maxLineDelta: 2,
    kind: "shots_total",
    ...pref
  });
  if (total) return { ...total, sourceKind: "shots_total" };

  const hLine = Number(homeLine);
  if (Number.isFinite(hLine)) {
    const home = consensusOverUnderOddsAtLine(oddsApiResponse, SHOTS_SOT_HOME_MARKET_NAMES, hLine, {
      maxLineDelta: 1.5,
      kind: "shots_on_target_home",
      ...pref
    });
    if (home) return { ...home, sourceKind: "team_home" };
  }

  const aLine = Number(awayLine);
  if (Number.isFinite(aLine)) {
    const away = consensusOverUnderOddsAtLine(oddsApiResponse, SHOTS_SOT_AWAY_MARKET_NAMES, aLine, {
      maxLineDelta: 1.5,
      kind: "shots_on_target_away",
      ...pref
    });
    if (away) return { ...away, sourceKind: "team_away" };
  }

  return null;
}
