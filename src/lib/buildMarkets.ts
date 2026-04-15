// src/lib/buildMarkets.ts
import { OddsMarket, addProbsToMarket } from "@/lib/oddsMath";

export type MarketsBundle = {
  btts?: OddsMarket;
  over25?: OddsMarket;
  doubleChance?: OddsMarket;
  goalsHT?: OddsMarket;
  corners?: OddsMarket;
  cards?: OddsMarket;
  correctScoreTop?: OddsMarket;
};

function toNum(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "string") return parseFloat(x.replace(",", "."));
  return NaN;
}
const ci = (s?: string) => (s || "").toLowerCase();
const contains = (h: string, n: string) => ci(h).includes(ci(n));

function marketFromPairs(name: string, pairs: Array<{ label: string; odd?: number }>, note?: string): OddsMarket | undefined {
  const values = pairs
    .map(p => ({ value: p.label, odd: toNum(p.odd) }))
    .filter(v => isFinite(v.odd) && v.odd > 1);
  if (!values.length) return undefined;
  return addProbsToMarket({ name, values, note });
}

function pickBookmaker(oddsResponse: any, preferName = "Bet365") {
  const bms: any[] = oddsResponse?.bookmakers || [];
  if (!Array.isArray(bms) || bms.length === 0) return undefined;
  const exact = bms.find((b) => ci(b.name) === ci(preferName));
  if (exact) return exact;
  const containsWanted = bms.find((b) => contains(b.name, preferName));
  if (containsWanted) return containsWanted;
  return bms[0];
}
function findBet(bookmaker: any, ...nameContains: string[]) {
  const bets: any[] = bookmaker?.bets || [];
  return bets.find((bet) => nameContains.some((n) => contains(bet?.name, n)));
}
function findValue(values: any[], labelContains: string) {
  if (!Array.isArray(values)) return undefined;
  return values.find((v) => contains(v?.value, labelContains));
}
function pickOverUnderLine(bet: any, preferredLines: number[]) {
  const values: any[] = bet?.values || [];
  for (const t of preferredLines) {
    const over = values.find((v) => contains(v.value, `over ${t}`));
    const under = values.find((v) => contains(v.value, `under ${t}`));
    if (over && under) return { total: t, over, under };
  }
  return undefined;
}

export function buildMarketsFromApiFootballOdds(oddsResponse: any, preferBookmaker = "Bet365", correctScoreTopK = 5): MarketsBundle {
  const bookmaker = pickBookmaker(oddsResponse, preferBookmaker);
  const out: MarketsBundle = {};
  if (!bookmaker) return out;

  // GG/NG
  {
    const bet = findBet(bookmaker, "both teams to score", "btts");
    const yes = findValue(bet?.values, "yes");
    const no = findValue(bet?.values, "no");
    out.btts = marketFromPairs("GG/NG", [
      { label: "GG (Yes)", odd: toNum(yes?.odd) },
      { label: "NG (No)", odd: toNum(no?.odd) },
    ]);
  }

  // Peste/Sub 2.5
  {
    const bet = findBet(bookmaker, "goals over/under");
    const over25 = findValue(bet?.values, "over 2.5");
    const under25 = findValue(bet?.values, "under 2.5");
    out.over25 = marketFromPairs("Peste 2.5", [
      { label: "Over 2.5 (Over)", odd: toNum(over25?.odd) },
      { label: "Sub 2.5 (Under)", odd: toNum(under25?.odd) },
    ]);
  }

  // Șansă dublă
  {
    const bet = findBet(bookmaker, "double chance");
    const x1 = findValue(bet?.values, "1x") || findValue(bet?.values, "home/draw");
    const x2 = findValue(bet?.values, "x2") || findValue(bet?.values, "draw/away");
    const _12 = findValue(bet?.values, "12") || findValue(bet?.values, "home/away");
    out.doubleChance = marketFromPairs("Șansă dublă", [
      { label: "1X (Home/Draw)", odd: toNum(x1?.odd) },
      { label: "12 (Home/Away)", odd: toNum(_12?.odd) },
      { label: "X2 (Draw/Away)", odd: toNum(x2?.odd) },
    ]);
  }

  // Goluri 1st Half
  {
    const bet = findBet(bookmaker, "goals over/under - first half", "first half goals", "goals over/under first half");
    const over05 = findValue(bet?.values, "over 0.5");
    const over15 = findValue(bet?.values, "over 1.5");
    out.goalsHT = marketFromPairs("Goluri 1st Half", [
      { label: "Over 0.5", odd: toNum(over05?.odd) },
      { label: "Over 1.5", odd: toNum(over15?.odd) },
    ]);
  }

  // Cornere — linii comune: 9.5 → 10.5 → 8.5 → 11.5
  {
    const bet = findBet(bookmaker, "corners over/under", "corners");
    if (bet) {
      const pick = pickOverUnderLine(bet, [9.5, 10.5, 8.5, 11.5]);
      if (pick) {
        out.corners = marketFromPairs(
          "Total Cornere",
          [
            { label: `Over (linia principală)`, odd: toNum(pick.over?.odd) },
            { label: `Under (linia principală)`, odd: toNum(pick.under?.odd) },
          ],
          `Linie: ${pick.total}`
        );
      }
    }
  }

  // Cartonașe — linii comune: 4.5 → 5.5 → 3.5 → 6.5
  {
    const bet = findBet(bookmaker, "cards over/under", "bookings over/under", "cards", "bookings");
    if (bet) {
      const pick = pickOverUnderLine(bet, [4.5, 5.5, 3.5, 6.5]);
      if (pick) {
        out.cards = marketFromPairs(
          "Total Cartonașe",
          [
            { label: `Over (linia principală)`, odd: toNum(pick.over?.odd) },
            { label: `Under (linia principală)`, odd: toNum(pick.under?.odd) },
          ],
          `Linie: ${pick.total}`
        );
      }
    }
  }

  // Scor corect — top K după probabilitate normalizată
  {
    const bet = findBet(bookmaker, "correct score");
    const vals: Array<{ label: string; odd?: number }> = [];
    if (Array.isArray(bet?.values)) {
      for (const v of bet.values) {
        const label = String(v.value || "");
        if (/^\d+\s*:\s*\d+$/.test(label)) {
          vals.push({ label: label.replace(/\s+/g, ""), odd: toNum(v.odd) });
        }
      }
    }
    const market = marketFromPairs("Scor corect (top)", vals);
    if (market) {
      market.values.sort((a, b) => (b.normProb ?? 0) - (a.normProb ?? 0));
      market.values = market.values.slice(0, Math.max(1, correctScoreTopK));
      out.correctScoreTop = market;
    }
  }

  return out;
}
