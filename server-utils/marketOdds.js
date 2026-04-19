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
