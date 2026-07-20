import type { PredictionRow } from "../types";

export type GoalsOuPick = {
  pickKey: "over15" | "under15" | "over25" | "under25" | "over35" | "under35";
  line: number;
  side: "over" | "under";
  probability: number;
};

function parseLineThreshold(key: string): number | null {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

function sameOuPick(
  a: { side: "over" | "under"; line: number },
  b: { side: "over" | "under"; line: number }
): boolean {
  return a.side === b.side && Math.abs(a.line - b.line) < 1e-6;
}

/** Parse recommended labels like "Peste 2.5" / "Over 2.5" / "Sub 1.5". */
export function parseGoalsOuPick(pick: string | null | undefined): {
  side: "over" | "under";
  line: number;
} | null {
  const n = String(pick || "").trim().toLowerCase();
  if (!n) return null;
  const over = n.match(/^(?:peste|over)\s*(\d+(?:[.,]\d+)?)/);
  if (over) {
    const line = Number(over[1].replace(",", "."));
    return Number.isFinite(line) ? { side: "over", line } : null;
  }
  const under = n.match(/^(?:sub|under)\s*(\d+(?:[.,]\d+)?)/);
  if (under) {
    const line = Number(under[1].replace(",", "."));
    return Number.isFinite(line) ? { side: "under", line } : null;
  }
  return null;
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

function lineToTotalKey(line: number): string {
  const [a, b] = Number(line).toFixed(1).split(".");
  return `o${a}_${b}`;
}

/**
 * Prefer the book line when a quote exists within maxLineDelta of the model pick
 * (keeps side; refreshes probability at the snapped line when available).
 */
export function deriveAlignedOuPick(
  totalLines?: Record<string, number>,
  quote?: { pick?: string; line?: number | null; odd?: number | null } | null,
  maxLineDelta = 1.5
): { line: number; side: "over" | "under"; probability: number } | null {
  const best = deriveBestOverUnderPick(totalLines);
  if (!best) return null;
  const odd = Number(quote?.odd);
  const qLine = Number(quote?.line);
  if (!Number.isFinite(odd) || odd <= 1 || !Number.isFinite(qLine)) return best;
  if (Math.abs(qLine - best.line) > maxLineDelta + 1e-9) return best;

  const qPick = String(quote?.pick || "").toLowerCase();
  const qSide = qPick.includes("under") ? "under" : qPick.includes("over") ? "over" : best.side;
  const pOver = Number(totalLines?.[lineToTotalKey(qLine)]);
  if (Number.isFinite(pOver)) {
    return {
      line: qLine,
      side: qSide,
      probability: qSide === "over" ? pOver : 100 - pOver
    };
  }
  return { line: qLine, side: qSide, probability: best.probability };
}

export function listGoalsPickCandidates(row: PredictionRow): GoalsOuPick[] {
  const p = row.probs;
  if (!p) return [];
  return [
    { pickKey: "over15" as const, line: 1.5, side: "over" as const, probability: Number(p.pO15) },
    {
      pickKey: "under15" as const,
      line: 1.5,
      side: "under" as const,
      probability: Number(p.pU15 ?? 100 - Number(p.pO15))
    },
    { pickKey: "over25" as const, line: 2.5, side: "over" as const, probability: Number(p.pO25) },
    {
      pickKey: "under25" as const,
      line: 2.5,
      side: "under" as const,
      probability: Number(p.pU25 ?? 100 - Number(p.pO25))
    },
    {
      pickKey: "over35" as const,
      line: 3.5,
      side: "over" as const,
      probability: Number.isFinite(Number(p.pU35)) ? 100 - Number(p.pU35) : NaN
    },
    { pickKey: "under35" as const, line: 3.5, side: "under" as const, probability: Number(p.pU35) }
  ]
    .filter((c) => Number.isFinite(c.probability) && c.probability > 0)
    .sort((a, b) => b.probability - a.probability);
}

/** Best goals O/U among 1.5 / 2.5 / 3.5 from model probs. */
export function deriveBestGoalsPick(
  row: PredictionRow,
  options?: { exclude?: { side: "over" | "under"; line: number } | null }
): GoalsOuPick | null {
  const candidates = listGoalsPickCandidates(row);
  const exclude = options?.exclude || null;
  const filtered = exclude ? candidates.filter((c) => !sameOuPick(c, exclude)) : candidates;
  return filtered[0] || null;
}

/**
 * Goals row for the FocusCard: if recommended is already a goals O/U pick,
 * show the next-best goals line by probability.
 */
export function deriveCardGoalsPick(row: PredictionRow): GoalsOuPick | null {
  const recommendedGoals = parseGoalsOuPick(row.recommended?.pick);
  return deriveBestGoalsPick(row, { exclude: recommendedGoals });
}

/** Model EV% = (p * odd - 1) * 100; null when inputs are incomplete. */
export function modelValueEv(probabilityPct: number, odd: number | null | undefined): number | null {
  const p = Number(probabilityPct);
  const o = Number(odd);
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(o) || o <= 1) return null;
  return (p / 100) * o * 100 - 100;
}

/** Model EV% for a goals O/U pick vs quoted odds (null when odd missing). */
export function goalsPickValueEv(
  row: PredictionRow,
  side: "over" | "under",
  line: number,
  probability: number
): number | null {
  return modelValueEv(probability, goalsOddForLine(row, line, side));
}

/**
 * Bookmaker consensus odd for a goals line/side.
 * Never invents Under from Over — only real quote sides.
 */
export function goalsOddForLine(row: PredictionRow, line: number, side: "over" | "under"): number | null {
  const quote =
    line === 1.5
      ? row.marketOdds?.goals15
      : line === 2.5
        ? row.marketOdds?.goals25
        : line === 3.5
          ? row.marketOdds?.goals35
          : undefined;
  if (!quote) return null;
  if (side === "over") {
    const over = Number(quote.over ?? quote.odd);
    return Number.isFinite(over) && over > 1 ? over : null;
  }
  const under = Number(quote.under);
  return Number.isFinite(under) && under > 1 ? under : null;
}

export function recommendedOdd(row: PredictionRow): number | null {
  const explicit = Number(row.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const pick = (row.recommended?.pick || "").trim().toLowerCase();
  if (pick === "1" && Number.isFinite(Number(row.odds?.home))) return Number(row.odds?.home);
  if (pick === "x" && Number.isFinite(Number(row.odds?.draw))) return Number(row.odds?.draw);
  if (pick === "2" && Number.isFinite(Number(row.odds?.away))) return Number(row.odds?.away);
  if (pick === "gg" && Number.isFinite(Number(row.marketOdds?.btts?.odd))) {
    return Number(row.marketOdds?.btts?.odd);
  }
  const goals = parseGoalsOuPick(row.recommended?.pick);
  if (goals) return goalsOddForLine(row, goals.line, goals.side);
  return null;
}

/** EV% for the recommended pick only (not the separate value-bet market). */
export function recommendedPickValueEv(row: PredictionRow): number | null {
  const conf = Number(row.recommended?.confidence);
  return modelValueEv(conf, recommendedOdd(row));
}

/** Odd for corners/shots row when quote side matches and line is within tolerance. */
export function matchingMarketOdd(
  quote: { pick?: string; line?: number | null; odd?: number | null } | null | undefined,
  side: "over" | "under",
  line: number,
  maxLineDelta = 1.5
): number | null {
  if (!quote) return null;
  const qLine = Number(quote.line);
  if (Number.isFinite(qLine) && Math.abs(qLine - line) > maxLineDelta + 1e-9) return null;
  const qPick = String(quote.pick || "").toLowerCase();
  const qSide = qPick.includes("under") ? "under" : qPick.includes("over") ? "over" : null;
  if (qSide && qSide !== side) return null;
  const odd = Number(quote.odd);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}
