import type { TranslateFn } from "../../i18n/types";
import type { PredictionRow } from "../../types";

export function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(status || "");
}

/** "67'" or, during stoppage time, "45+2'" — never estimated, only from upstream minute/extra. */
export function formatLiveMinute(minute?: number | null, extra?: number | null): string | null {
  if (minute == null || !Number.isFinite(Number(minute))) return null;
  const m = Number(minute);
  return extra != null && Number.isFinite(Number(extra)) && Number(extra) > 0 ? `${m}+${Number(extra)}'` : `${m}'`;
}

export function deriveRecommendedOdd(row: PredictionRow): number | null {
  const explicit = Number(row.recommended?.odd);
  if (Number.isFinite(explicit) && explicit > 1) return explicit;
  const pick = (row.recommended?.pick || "").trim().toLowerCase();
  if (!pick) return null;
  if (pick === "1") return Number.isFinite(Number(row.odds?.home)) ? Number(row.odds?.home) : null;
  if (pick === "x") return Number.isFinite(Number(row.odds?.draw)) ? Number(row.odds?.draw) : null;
  if (pick === "2") return Number.isFinite(Number(row.odds?.away)) ? Number(row.odds?.away) : null;
  if (pick === "gg") return Number.isFinite(Number(row.marketOdds?.btts?.odd)) ? Number(row.marketOdds?.btts?.odd) : null;
  if (pick === "ngg") {
    const yesOdd = Number(row.marketOdds?.btts?.odd);
    if (Number.isFinite(yesOdd) && yesOdd > 1) {
      const noOdd = (yesOdd / (yesOdd - 1)) || null;
      return Number.isFinite(Number(noOdd)) ? Number(noOdd) : null;
    }
    return null;
  }
  const ou = pick.match(/^(peste|sub)\s*(1[.,]5|2[.,]5|3[.,]5)$/);
  if (ou) {
    const line = ou[2].replace(",", ".");
    const quote =
      line === "1.5" ? row.marketOdds?.goals15 : line === "2.5" ? row.marketOdds?.goals25 : row.marketOdds?.goals35;
    if (!quote) return null;
    const overOdd = Number(quote.odd);
    if (!Number.isFinite(overOdd) || overOdd <= 1) return null;
    if (ou[1] === "peste") return overOdd;
    const underOdd = (overOdd / (overOdd - 1)) || null;
    return Number.isFinite(Number(underOdd)) ? Number(underOdd) : null;
  }
  return null;
}

function parseLineThreshold(key: string): number | null {
  const m = key.match(/^o(\d+)_(\d+)$/);
  if (!m) return null;
  return Number(`${m[1]}.${m[2]}`);
}

export function deriveBestOverUnderPick(
  totalLines?: Record<string, number>
): { pick: string; probability: number; side: "over" | "under"; line: number } | null {
  if (!totalLines) return null;
  let best: { pick: string; probability: number; side: "over" | "under"; line: number } | null = null;
  for (const [key, raw] of Object.entries(totalLines)) {
    const line = parseLineThreshold(key);
    const pOver = Number(raw);
    if (line == null || !Number.isFinite(pOver)) continue;
    const over = { pick: `Over ${line.toFixed(1)}`, probability: pOver, side: "over" as const, line };
    const under = {
      pick: `Under ${line.toFixed(1)}`,
      probability: 100 - pOver,
      side: "under" as const,
      line
    };
    const current = over.probability >= under.probability ? over : under;
    if (!best || current.probability > best.probability) best = current;
  }
  return best;
}

export function statusChip(
  row: PredictionRow,
  confPct: number,
  hasFinalScore: boolean,
  finalPickResult: boolean | null,
  isLive: boolean,
  t: TranslateFn
): { label: string; className: string } {
  if (isLive) {
    return {
      label: t("card.live").toUpperCase(),
      className: "border-fp-danger/35 bg-fp-danger/10 text-[var(--fp-danger)]"
    };
  }
  if (hasFinalScore) {
    if (finalPickResult === true) {
      return { label: t("card.chipWin"), className: "border-fp-success/35 bg-fp-success/10 text-[var(--fp-success)]" };
    }
    if (finalPickResult === false) {
      return { label: t("card.chipLose"), className: "border-fp-danger/30 bg-fp-danger/10 text-[var(--fp-danger)]" };
    }
    return { label: t("card.chipFinal"), className: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]" };
  }
  if (row.valueBet?.detected) {
    return { label: t("card.chipValue"), className: "border-fp-warning/35 bg-fp-warning/10 text-[var(--fp-warning)]" };
  }
  if (confPct >= 70) {
    return { label: t("card.chipLowRisk"), className: "border-fp-success/25 bg-fp-success/8 text-[var(--fp-success)]" };
  }
  return { label: t("card.chipOpen"), className: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]" };
}

/**
 * Mic badge ce arată nivelul modelului aplicat:
 * - "ML": a fost folosit stacker-ul (multinomial LR)
 * - "CAL": probabilităţi post-calibrare isotonică
 * - "DC" (fallback): doar Poisson + Dixon-Coles (fără învățare pe istoric)
 */
export function modelTierBadge(row: PredictionRow): { label: string; title: string; className: string } | null {
  const meta = row.modelMeta;
  if (!meta) return null;
  if (meta.stackerApplied) {
    return {
      label: "ML",
      title: `Stacker ML activ${meta.stackerSampleSize ? ` · n=${meta.stackerSampleSize}` : ""}`,
      className: "border-fp-success/45 bg-fp-success/10 text-[var(--fp-success)]"
    };
  }
  if (meta.calibrationApplied) {
    return {
      label: "CAL",
      title: `Isotonic calibration aplicată${meta.calibrationSampleSize ? ` · n=${meta.calibrationSampleSize}` : ""}`,
      className: "border-fp-accent/45 bg-fp-accent/10 text-[var(--fp-accent)]"
    };
  }
  return {
    label: "DC",
    title: "Poisson + Dixon-Coles (fără calibrare pe istoric încă)",
    className: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
  };
}
