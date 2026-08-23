/**
 * Pure market/score helpers — moved verbatim from MatchModal.tsx (Sprint 7). Behavior unchanged.
 */

import type { MarketTier, MarketTierInfo, MatchScore, PredictionRow } from "../../types";

export function tierToneClass(tier: MarketTier | undefined): string {
  switch (tier) {
    case "strong":
      return "border-fp-success/35 bg-fp-success/8 text-[var(--fp-success)]";
    case "lean":
      return "border-fp-accent/35 bg-fp-accent/8 text-[var(--fp-accent)]";
    case "toss":
      return "border-fp-warning/30 bg-fp-warning/8 text-[var(--fp-warning)]";
    case "lean_off":
      return "border-fp-danger/25 bg-fp-danger/5 text-fp-danger/90";
    case "strong_off":
      return "border-fp-danger/40 bg-fp-danger/10 text-[var(--fp-danger)]";
    default:
      return "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]";
  }
}

export function tierBadgeLabel(tier: MarketTier | undefined, tr: (key: string) => string): string {
  switch (tier) {
    case "strong":
      return tr("match.tierStrong");
    case "lean":
      return tr("match.tierLean");
    case "toss":
      return tr("match.tierToss");
    case "lean_off":
      return tr("match.tierLeanOff");
    case "strong_off":
      return tr("match.tierStrongOff");
    default:
      return "";
  }
}

/** Derive a fallback MarketTierInfo din probabilităţile brute (pentru istoricul vechi fără `marketTiers`). */
export function fallbackTierFromProb(pickLabel: string, probForPick: number | null): MarketTierInfo | undefined {
  if (probForPick == null || !Number.isFinite(probForPick)) return undefined;
  const p = Math.max(0, Math.min(100, probForPick));
  let tier: MarketTier;
  if (p >= 65) tier = "strong";
  else if (p >= 55) tier = "lean";
  else if (p >= 45) tier = "toss";
  else if (p >= 35) tier = "lean_off";
  else tier = "strong_off";
  return { pick: pickLabel, prob: Number(p.toFixed(1)), tier };
}

/** Etichetă prietenoasă pentru un key de linie stil "o8_5" → "Over 8.5". */
export function formatLineKey(key: string): string {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return key;
  return `Over ${m[1]}.${m[2]}`;
}

export function parseLineThreshold(key: string): number | null {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

export function deriveBestOverUnderPick(
  totalLines?: Record<string, number>
): { pick: string; probability: number; line: number } | null {
  if (!totalLines) return null;
  const entries = Object.entries(totalLines).filter(([, v]) => Number.isFinite(Number(v)));
  if (!entries.length) return null;
  let best: { pick: string; probability: number; line: number } | null = null;
  for (const [key, rawProb] of entries) {
    const line = parseLineThreshold(key);
    if (line == null) continue;
    const pOver = Math.max(0, Math.min(100, Number(rawProb)));
    const overCandidate = { pick: `Over ${line.toFixed(1)}`, probability: pOver, line };
    const underCandidate = { pick: `Under ${line.toFixed(1)}`, probability: 100 - pOver, line };
    const chosen = overCandidate.probability >= underCandidate.probability ? overCandidate : underCandidate;
    if (!best || chosen.probability > best.probability) best = chosen;
  }
  return best;
}

export function deriveRecommendedOdd(match: PredictionRow): number | null {
  const explicit = Number(match.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const pick = String(match.recommended?.pick || "").trim().toLowerCase();
  if (!pick) return null;
  if (pick === "1") return Number.isFinite(Number(match.odds?.home)) ? Number(match.odds?.home) : null;
  if (pick === "x") return Number.isFinite(Number(match.odds?.draw)) ? Number(match.odds?.draw) : null;
  if (pick === "2") return Number.isFinite(Number(match.odds?.away)) ? Number(match.odds?.away) : null;
  if (pick === "gg") return Number.isFinite(Number(match.marketOdds?.btts?.odd)) ? Number(match.marketOdds?.btts?.odd) : null;
  const ou = pick.match(/^(peste|sub)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
  if (ou) {
    const line = ou[2].replace(",", ".");
    const quote =
      line === "1.5" ? match.marketOdds?.goals15 : line === "2.5" ? match.marketOdds?.goals25 : match.marketOdds?.goals35;
    const overOdd = Number(quote?.odd);
    if (!Number.isFinite(overOdd) || overOdd <= 1) return null;
    if (ou[1] === "peste") return overOdd;
    const underOdd = overOdd / (overOdd - 1);
    return Number.isFinite(underOdd) ? underOdd : null;
  }
  return null;
}

export function marketResultBadge(
  predicted: string,
  probability: number,
  verdict: boolean | null,
  odd?: number | null,
  source?: string | null,
  tone: "corners" | "shots" | "cards" | "ht" | "neutral" = "neutral",
  noBookOddLabel = "No book odd"
) {
  const base =
    "inline-flex max-w-full flex-wrap items-center rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]";
  const oddText =
    Number.isFinite(Number(odd)) && Number(odd) > 1
      ? ` · ${Number(odd).toFixed(2)}`
      : ` · ${noBookOddLabel}`;
  const srcText = source ? ` · ${source}` : "";
  const pred = `${predicted} · ${Math.round(probability)}%${oddText}${srcText}`;
  const isHot = probability >= 85;
  const toneClass =
    tone === "corners"
      ? "border-fp-accent/45 bg-[var(--fp-accent-muted)] text-[var(--fp-text)]"
      : tone === "shots"
        ? "border-violet-500/40 bg-violet-500/10 text-[var(--fp-text)]"
        : tone === "cards"
          ? "border-amber-500/45 bg-amber-500/10 text-[var(--fp-text)]"
          : tone === "ht"
            ? "border-fp-warning/45 bg-fp-warning/10 text-[var(--fp-text)]"
            : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text)]";
  const pulseClass = isHot ? " animate-pulse motion-reduce:animate-none ring-1 ring-white/35" : "";
  if (verdict === true) {
    return (
      <span
        className={`${base} border-fp-success/60 bg-fp-success/20 text-[var(--fp-success)]${pulseClass}`}
      >
        {pred} · WIN
      </span>
    );
  }
  if (verdict === false) {
    return (
      <span
        className={`${base} border-fp-danger/60 bg-fp-danger/20 text-[var(--fp-danger)]${pulseClass}`}
      >
        {pred} · LOSE
      </span>
    );
  }
  return <span className={`${base} ${toneClass}${pulseClass}`}>{pred} · OPEN</span>;
}

/**
 * Randează un bloc Poisson (cornere / şuturi la poartă / total şuturi) cu:
 * - header cu λ & total aşteptat
 * - linii Over pe total, cu probabilităţi (verde la peste 60%, amber 40-60, gri sub)
 * - linii Over pe echipă (home vs away), dacă există
 */

export function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(status || "");
}

/**
 * Grades ONLY the fixed-family rows of the predictions table (1X2, BTTS, goals Over 2.5),
 * where the market is known by construction and the final score settles it.
 *
 * MUST NOT be used for `recommended.pick`: that pick's family is not knowable client-side,
 * and grading it here is what produced the P0 where a Corners "Over 7.5" was settled against
 * goals scored. The recommended verdict comes from the server via cardMarketValidations.
 */
export function evaluateScoreDerivedPick(pick: string, score?: MatchScore): boolean | null {
  if (!pick || !score) return null;
  if (score.home === null || score.away === null) return null;
  const home = score.home;
  const away = score.away;
  const total = home + away;
  const normalized = pick.trim().toLowerCase();

  if (normalized === "1") return home > away;
  if (normalized === "2") return away > home;
  if (normalized === "x") return home === away;
  if (normalized === "gg") return home > 0 && away > 0;
  if (normalized === "ngg") return home === 0 || away === 0;

  const overMatch = normalized.match(/peste\s*(\d+(?:[.,]\d+)?)/);
  if (overMatch) return total > Number(overMatch[1].replace(",", "."));
  const underMatch = normalized.match(/sub\s*(\d+(?:[.,]\d+)?)/);
  if (underMatch) return total < Number(underMatch[1].replace(",", "."));
  return null;
}

export function finalScoreBadgeClass(result: boolean | null) {
  if (result === true) return "text-[var(--fp-success)] border-fp-success/35 bg-fp-success/10";
  if (result === false) return "text-[var(--fp-danger)] border-fp-danger/30 bg-fp-danger/10";
  return "text-[var(--fp-text-muted)] border-[var(--fp-border)] bg-[var(--fp-bg-muted)]";
}

export function finalScoreLabel(result: boolean | null) {
  if (result === true) return "WIN";
  if (result === false) return "LOSE";
  return "FINAL";
}

export function formatLambda(n: number | undefined) {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

