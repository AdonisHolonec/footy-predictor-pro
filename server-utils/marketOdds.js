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

/**
 * Score how well an API market name matches candidate labels.
 * Skips player / single-team props. Optional kind narrows shots SOT vs total.
 */
function scoreMarketName(apiName, candidates, kind = "generic") {
  const n = normalizeMarketName(apiName);
  if (!n) return 0;
  if (/\bplayer\b/.test(n)) return 0;
  if (/\bhome team\b/.test(n) || /\baway team\b/.test(n)) return 0;

  if (kind === "shots_on_target") {
    if (!/(on target|on goal|shots on|sot)/.test(n)) return 0;
  }
  if (kind === "shots_total") {
    if (/(on target|on goal)/.test(n)) return 0;
    if (!/\bshots?\b/.test(n)) return 0;
  }
  if (kind === "corners") {
    if (!/\bcorners?\b/.test(n)) return 0;
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
 * @param {{ maxLineDelta?: number, kind?: string }} [options]
 *   maxLineDelta — allow nearest line within this distance (default 0 = exact only)
 *   kind — "shots_on_target" | "shots_total" | "corners" | "generic"
 */
export function consensusOverUnderOddsAtLine(oddsApiResponse, marketNames, targetLine, options = {}) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;
  const requestedLine = Number(targetLine);
  if (!Number.isFinite(requestedLine)) return null;
  const maxLineDelta = Number(options?.maxLineDelta);
  const delta = Number.isFinite(maxLineDelta) && maxLineDelta >= 0 ? maxLineDelta : 0;
  const kind = String(options?.kind || "generic");

  /** @type {Map<number, { over: number[], under: number[], names: string[] }>} */
  const byLine = new Map();

  for (const b of bookmakers) {
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
