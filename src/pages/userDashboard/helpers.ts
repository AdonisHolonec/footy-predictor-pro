import type { MarketPref } from "../../hooks/useUiPrefs";
import type { PredictionRow } from "../../types";
import { normalizeSelectedDates } from "../../utils/appUtils";

/**
 * Pure helpers moved verbatim out of UserDashboard.tsx (Sprint 6 of the audit
 * remediation program). No React, no state — the component keeps the wiring,
 * this module keeps the arithmetic.
 */

/** True when cached rows are older than the UI expects, or under-masked for the user's effective tier. */
export function hasLegacyPredictionShape(rows: PredictionRow[], accessTier?: string): boolean {
  const tier = String(accessTier || "free").toLowerCase();
  return rows.some((row) => {
    if (row?.insufficientData) return false;
    const probs = row?.probs;
    // Paid tiers must not keep free/premium-masked localStorage rows (common on mobile).
    if (tier === "ultra") {
      return !probs?.corners || !probs?.shotsOnTarget;
    }
    if (tier === "premium") {
      return !probs?.corners;
    }
    // Free: only treat truly ancient shapes (no modelVersion) as stale.
    if (row?.modelVersion) return false;
    const hasExactConfidence =
      row?.recommended?.confidence != null && Number.isFinite(Number(row?.recommended?.confidence));
    if (hasExactConfidence) {
      return !probs?.firstHalf || !probs?.corners || !probs?.shotsOnTarget;
    }
    return !probs?.firstHalf && !probs?.corners && !probs?.shotsOnTarget && !probs?.shotsTotal;
  });
}

export function isFinalStatus(status?: string) {
  return ["FT", "AET", "PEN"].includes(String(status || "").toUpperCase());
}

export function hasDerivateMarkets(row: PredictionRow) {
  return Boolean(row.probs?.corners || row.probs?.shotsOnTarget || row.probs?.shotsTotal || row.probs?.firstHalf);
}

export function tierPredictWindowDays(tier?: string) {
  if (tier === "ultra") return 3; // today +2
  if (tier === "premium") return 2; // today +1
  return 1; // free
}

export function addIsoDay(dateIso: string, plusDays: number) {
  const [y, m, d] = String(dateIso).split("-").map((v) => Number(v));
  const utc = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  utc.setUTCDate(utc.getUTCDate() + plusDays);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function buildTierDates(baseDate: string, tier?: string) {
  const span = tierPredictWindowDays(tier);
  const out: string[] = [];
  for (let i = 0; i < span; i += 1) out.push(addIsoDay(baseDate, i));
  return normalizeSelectedDates(out);
}

export function clampTierDates(baseDate: string, tier: string | undefined, dates: string[]) {
  const allowed = new Set(buildTierDates(baseDate, tier));
  const filtered = normalizeSelectedDates((dates || []).filter((d) => allowed.has(d)));
  return filtered.length ? filtered : [baseDate];
}

/** True when `row` has an actionable (non-toss) tier for at least one of the onboarding-picked markets. */
export function matchesPreferredMarkets(row: PredictionRow, preferredMarkets: MarketPref[]) {
  if (!preferredMarkets.length) return true;
  const tiers = row.predictions?.marketTiers;
  return preferredMarkets.some((market) => {
    const tier =
      market === "oneXTwo" ? tiers?.oneXtwo?.tier : market === "overUnder" ? tiers?.over25?.tier : tiers?.gg?.tier;
    return Boolean(tier) && tier !== "toss";
  });
}
