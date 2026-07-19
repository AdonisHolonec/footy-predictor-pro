import type { PredictionRow } from "../types";

function parseLineThreshold(key: string): number | null {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

/** Best Over/Under from Poisson total lines (keys like o9_5 → 9.5). */
export function deriveBestOverUnderPick(
  totalLines?: Record<string, number>
): { line: number; side: "over" | "under"; probability: number } | null {
  if (!totalLines) return null;
  let best: { line: number; side: "over" | "under"; probability: number } | null = null;
  for (const [key, raw] of Object.entries(totalLines)) {
    const line = parseLineThreshold(key);
    const pOver = Number(raw);
    if (line == null || !Number.isFinite(pOver)) continue;
    const over = { line, side: "over" as const, probability: pOver };
    const under = { line, side: "under" as const, probability: 100 - pOver };
    const current = over.probability >= under.probability ? over : under;
    if (!best || current.probability > best.probability) best = current;
  }
  return best;
}

/** Best goals O/U among 1.5 / 2.5 / 3.5 from model probs. */
export function deriveBestGoalsPick(row: PredictionRow): {
  pickKey: "over15" | "under15" | "over25" | "under25" | "over35" | "under35";
  line: number;
  side: "over" | "under";
  probability: number;
} | null {
  const p = row.probs;
  if (!p) return null;
  const candidates = [
    { pickKey: "over15" as const, line: 1.5, side: "over" as const, probability: Number(p.pO15) },
    { pickKey: "under15" as const, line: 1.5, side: "under" as const, probability: Number(p.pU15 ?? 100 - Number(p.pO15)) },
    { pickKey: "over25" as const, line: 2.5, side: "over" as const, probability: Number(p.pO25) },
    { pickKey: "under25" as const, line: 2.5, side: "under" as const, probability: Number(p.pU25 ?? 100 - Number(p.pO25)) },
    { pickKey: "over35" as const, line: 3.5, side: "over" as const, probability: Number.isFinite(Number(p.pU35)) ? 100 - Number(p.pU35) : NaN },
    { pickKey: "under35" as const, line: 3.5, side: "under" as const, probability: Number(p.pU35) }
  ].filter((c) => Number.isFinite(c.probability) && c.probability > 0);

  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.probability > a.probability ? b : a));
}

export function goalsOddForLine(row: PredictionRow, line: number, side: "over" | "under"): number | null {
  const quote =
    line === 1.5 ? row.marketOdds?.goals15 : line === 2.5 ? row.marketOdds?.goals25 : row.marketOdds?.goals35;
  const overOdd = Number(quote?.odd);
  if (!Number.isFinite(overOdd) || overOdd <= 1) return null;
  if (side === "over") return overOdd;
  const underOdd = overOdd / (overOdd - 1);
  return Number.isFinite(underOdd) ? underOdd : null;
}

export function recommendedOdd(row: PredictionRow): number | null {
  const explicit = Number(row.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const pick = (row.recommended?.pick || "").trim().toLowerCase();
  if (pick === "1" && Number.isFinite(Number(row.odds?.home))) return Number(row.odds?.home);
  if (pick === "x" && Number.isFinite(Number(row.odds?.draw))) return Number(row.odds?.draw);
  if (pick === "2" && Number.isFinite(Number(row.odds?.away))) return Number(row.odds?.away);
  return null;
}
