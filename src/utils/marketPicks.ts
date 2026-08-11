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
 * Align the displayed pick to the bookmaker's line — but only when the probability can
 * follow it there.
 *
 * The server already resolves this (repriceCandidateLine) and publishes
 * `probabilityLine` / `probabilityPct`, which are used directly when present. The local
 * ladder path remains for rows persisted before this contract existed.
 *
 * The important change: when the book quotes a line the ladder cannot price, this used
 * to return the book's line carrying the *model* line's probability — the same
 * line-transfer bug the server had. It now falls back to the model's own line, which
 * carries no bookmaker odd, so the UI shows a read without an unobtainable price.
 */
export function deriveAlignedOuPick(
  totalLines?: Record<string, number>,
  quote?: {
    pick?: string;
    line?: number | null;
    odd?: number | null;
    probabilityLine?: number | null;
    probabilityPct?: number | null;
    tradable?: boolean;
  } | null,
  maxLineDelta = 1.5
): { line: number; side: "over" | "under"; probability: number } | null {
  const best = deriveBestOverUnderPick(totalLines);
  if (!best) return null;
  if (quote?.tradable === false) return best;

  const odd = Number(quote?.odd);
  const qLine = Number(quote?.line);
  if (!Number.isFinite(odd) || odd <= 1 || !Number.isFinite(qLine)) return best;
  if (Math.abs(qLine - best.line) > maxLineDelta + 1e-9) return best;

  const qPick = String(quote?.pick || "").toLowerCase();
  const qSide = qPick.includes("under") ? "under" : qPick.includes("over") ? "over" : best.side;

  // Server-resolved probability, already priced at the bookmaker's line.
  const serverLine = Number(quote?.probabilityLine);
  const serverProb = Number(quote?.probabilityPct);
  if (Number.isFinite(serverLine) && serverLine === qLine && Number.isFinite(serverProb)) {
    return { line: qLine, side: qSide, probability: serverProb };
  }

  const pOver = Number(totalLines?.[lineToTotalKey(qLine)]);
  if (Number.isFinite(pOver)) {
    return {
      line: qLine,
      side: qSide,
      probability: qSide === "over" ? pOver : 100 - pOver
    };
  }
  // No probability at the book's line: keep the model's line rather than moving the
  // line and leaving the probability behind.
  return best;
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

/** Parse Over/Under side from pick labels (EN/RO, with optional FH suffix). */
export function parseOuSide(pick: string | null | undefined): "over" | "under" | null {
  const s = String(pick || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  // Check under/sub first — never use naive includes("over") on "under".
  if (/(?:^|\s)(under|sub)\b/.test(s) || s.startsWith("under") || s.startsWith("sub")) return "under";
  if (/(?:^|\s)(over|peste)\b/.test(s) || s.startsWith("over") || s.startsWith("peste")) return "over";
  return null;
}

/**
 * Consensus odd for exactly this side and line — or null.
 *
 * The server resolves line, probability and price together (repriceCandidateLine) and
 * publishes `tradable`. This helper must not go looking for a "close enough" price: a
 * quote for another line is a price for another bet. Two escapes that used to live here
 * are gone — a cross-market bypass that skipped the line check entirely for
 * total-shots / team-SOT sources, and callers passing a 4.0-wide tolerance.
 *
 * `maxLineDelta` defaults to 0 (exact line only). It exists only so a caller can accept
 * the server's already-repriced line; never to reach a line the server did not price.
 */
export function matchingMarketOdd(
  quote: {
    pick?: string;
    line?: number | null;
    odd?: number | null;
    over?: number | null;
    under?: number | null;
    oddSource?: string | null;
    tradable?: boolean;
  } | null | undefined,
  side: "over" | "under",
  line: number,
  maxLineDelta = 0
): number | null {
  if (!quote) return null;
  // The server already decided this selection has no usable price.
  if (quote.tradable === false) return null;
  const qLine = Number(quote.line);
  if (Number.isFinite(qLine) && Math.abs(qLine - line) > maxLineDelta + 1e-9) {
    return null;
  }
  const qSide = parseOuSide(quote.pick);
  if (qSide && qSide !== side) {
    // Stored pick side conflicts — still allow explicit over/under fields.
    const sideOdd = side === "over" ? Number(quote.over) : Number(quote.under);
    if (Number.isFinite(sideOdd) && sideOdd > 1) return sideOdd;
    return null;
  }
  const sideOdd = side === "over" ? Number(quote.over) : Number(quote.under);
  if (Number.isFinite(sideOdd) && sideOdd > 1) return sideOdd;
  const odd = Number(quote.odd);
  return Number.isFinite(odd) && odd > 1 ? odd : null;
}

/**
 * Display odd for the shots card — the SOT quote for this exact side and line, or null.
 *
 * Previously this fell back twice: to `shotsOnTarget.odd` with no line check at all, and
 * then to the total-shots quote with a 4.0-wide tolerance. Total shots is a different
 * market from shots on target, and a line four shots away is a different bet, so both
 * fallbacks could show a price the user could not get. The server now marks those cases
 * `tradable: false`; there is nothing left to fall back to.
 */
export function shotsDisplayOdd(
  row: PredictionRow,
  side: "over" | "under",
  line: number
): number | null {
  return matchingMarketOdd(row.marketOdds?.shotsOnTarget, side, line);
}

/** HT goals total from marketResults or score.halftime. */
export function resolveFirstHalfGoalsActual(row: {
  marketResults?: { firstHalfGoals?: number | null } | null;
  score?: { halftime?: { home?: number | null; away?: number | null } | null } | null;
}): number | null {
  const rawMr = row.marketResults?.firstHalfGoals;
  // Do not use Number(null) — it is 0 and falsely settles Under lines.
  if (rawMr != null && Number.isFinite(Number(rawMr))) return Number(rawMr);
  const hRaw = row.score?.halftime?.home;
  const aRaw = row.score?.halftime?.away;
  if (hRaw == null || aRaw == null) return null;
  const h = Number(hRaw);
  const a = Number(aRaw);
  if (Number.isFinite(h) && Number.isFinite(a)) return h + a;
  return null;
}

/** Format book odd or honest empty label. */
export function formatBookOdd(
  n: number | null | undefined,
  emptyLabel = "—"
): string {
  if (n == null || !Number.isFinite(n) || n <= 1) return emptyLabel;
  return n.toFixed(2);
}
