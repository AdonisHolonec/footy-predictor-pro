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

/**
 * Median odds for Over/Under at a specific line from candidate market names.
 * Returns null when no usable bookmaker quotes exist.
 */
export function consensusOverUnderOddsAtLine(oddsApiResponse, marketNames, targetLine) {
  const bookmakers = oddsApiResponse?.response?.[0]?.bookmakers;
  if (!Array.isArray(bookmakers) || bookmakers.length === 0) return null;
  const line = Number(targetLine);
  if (!Number.isFinite(line)) return null;

  const over = [];
  const under = [];
  const names = [];
  const lowerNames = (marketNames || []).map((n) => String(n || "").toLowerCase());

  for (const b of bookmakers) {
    const bets = Array.isArray(b?.bets) ? b.bets : [];
    const market = bets.find((x) => lowerNames.includes(String(x?.name || "").toLowerCase()));
    if (!market?.values || !Array.isArray(market.values)) continue;
    const selected = market.values.filter((v) => {
      const parsed = parseLineFromValueLabel(v?.value);
      return parsed != null && Math.abs(parsed - line) < 0.001;
    });
    if (!selected.length) continue;
    const ov = selected.find((v) => valueKind(v?.value) === "over");
    const un = selected.find((v) => valueKind(v?.value) === "under");
    const ovOdd = Number.parseFloat(String(ov?.odd ?? ""));
    const unOdd = Number.parseFloat(String(un?.odd ?? ""));
    if (Number.isFinite(ovOdd) && ovOdd > 1) over.push(ovOdd);
    if (Number.isFinite(unOdd) && unOdd > 1) under.push(unOdd);
    if ((Number.isFinite(ovOdd) && ovOdd > 1) || (Number.isFinite(unOdd) && unOdd > 1)) {
      names.push(b.name || "?");
    }
  }

  const medOver = median(over);
  const medUnder = median(under);
  if (medOver == null && medUnder == null) return null;
  return {
    line,
    over: medOver,
    under: medUnder,
    bookmakersUsed: Math.max(over.length, under.length),
    bookmakerNames: names.slice(0, 8)
  };
}
