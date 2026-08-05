import type { TranslateFn } from "../i18n";

/**
 * Normalized market family for a recommended pick — drives both the label
 * text and the contextual icon. Distinct from the raw `recommended.family`
 * string persisted by the server (see server-utils/value/valueMarkets.js
 * VALUE_MARKET_FAMILIES), which this module maps onto one of these keys.
 *
 * Source of truth for Special Bet diversity + UI labels:
 *   resolveMarketFamilyKey() in THIS file (client).
 *
 * Intentionally separate (do not merge blindly):
 *   - classifyMarketFamily() in server-utils/value/valueMarkets.js
 *     → builds ValueEngine / selectRecommendation candidates; returns
 *       display strings like "Over/Under" / "Corners", not MarketFamilyKey.
 *   - resolveRecommendedValidation() in server-utils/cardMarketSettlement.js
 *     → settlement grading only; reuses the same goals-line set heuristic
 *       but must not import React-side i18n utilities.
 */
export type MarketFamilyKey =
  | "1X2"
  | "DOUBLE_CHANCE"
  | "BTTS"
  | "GOALS"
  | "CORNERS"
  | "CARDS"
  | "SHOTS"
  | "CORRECT_SCORE"
  | "OTHER";

export type FormattedRecommendation = {
  label: string;
  familyKey: MarketFamilyKey;
};

/** Goals lines the model ever recommends at (1.5 / 2.5 / 3.5) — mirrors GOALS_OU_LINES in server-utils/cardMarketSettlement.js. */
const GOALS_LINES = new Set([1.5, 2.5, 3.5]);

/**
 * Map persisted server family strings onto MarketFamilyKey.
 * Case-insensitive; accepts legacy separators ("Over-Under", "over under").
 */
function normalizeServerFamily(family: string | null | undefined): MarketFamilyKey | null {
  const key = String(family || "")
    .trim()
    .toLowerCase()
    .replace(/[/_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!key) return null;
  switch (key) {
    case "1x2":
      return "1X2";
    case "double chance":
    case "dc":
      return "DOUBLE_CHANCE";
    case "btts":
      return "BTTS";
    case "over under":
      return "GOALS";
    case "corners":
    case "corner":
      return "CORNERS";
    case "cards":
    case "card":
      return "CARDS";
    case "shots":
    case "shot":
    case "shots on target":
      return "SHOTS";
    case "correct score":
      return "CORRECT_SCORE";
    default:
      return null;
  }
}

/** Extracts side/line from labels like "Peste 2.5", "Over 10.5", or "Cards Under 3.5". */
function parseOuPick(pick: string): { side: "over" | "under"; line: number } | null {
  const m = pick.match(/(peste|over|sub|under)\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const side: "over" | "under" = /^(peste|over)$/i.test(m[1]) ? "over" : "under";
  const line = Number(m[2].replace(",", "."));
  return Number.isFinite(line) ? { side, line } : null;
}

/**
 * Explicit market tokens in the pick label beat ambiguous server families
 * (e.g. "Over 10.5 Corners" must stay CORNERS even if family was "Over/Under").
 */
function inferFamilyFromPickTokens(pick: string): MarketFamilyKey | null {
  const p = pick.trim().toLowerCase();
  if (!p) return null;
  if (/\bcorners?\b|cornere/.test(p)) return "CORNERS";
  if (/\bcards?\b|cartona|booking/.test(p)) return "CARDS";
  if (/\bshots?\b|suturi|șuturi/.test(p)) return "SHOTS";
  return null;
}

/**
 * Best-effort family inference for rows persisted before `recommended.family`
 * existed. Only reached when the server didn't send a recognized family —
 * new predictions should always carry it (see Stage09Explainability.js).
 */
function inferFamilyFromPick(pick: string): MarketFamilyKey {
  const p = pick.trim().toLowerCase();
  if (p === "1" || p === "x" || p === "2") return "1X2";
  if (p === "1x" || p === "12" || p === "x2") return "DOUBLE_CHANCE";
  if (p === "gg" || p === "ngg") return "BTTS";
  const fromTokens = inferFamilyFromPickTokens(p);
  if (fromTokens) return fromTokens;
  if (/^\d+-\d+$/.test(p)) return "CORRECT_SCORE";
  const ou = parseOuPick(p);
  // Goals recommendations only ever use 1.5 / 2.5 / 3.5 — any other O/U line is Corners
  // (same rule as server-utils/cardMarketSettlement.js resolveRecommendedValidation).
  if (ou) return GOALS_LINES.has(ou.line) ? "GOALS" : "CORNERS";
  return "OTHER";
}

/**
 * Resolves the market family a recommended pick belongs to.
 * Prefer explicit pick-text tokens, then persisted family, then line-based inference.
 * Server "Over/Under" means goals only when the line is a goals line; high lines
 * (e.g. Under 10.5) are Corners so Special Bet diversity can exclude the corners slot.
 */
export function resolveMarketFamilyKey(
  pick: string | null | undefined,
  family?: string | null
): MarketFamilyKey {
  const raw = String(pick || "");
  const fromTokens = inferFamilyFromPickTokens(raw);
  if (fromTokens) return fromTokens;

  const normalized = normalizeServerFamily(family);
  if (normalized === "GOALS") {
    const ou = parseOuPick(raw);
    if (ou && !GOALS_LINES.has(ou.line)) return "CORNERS";
  }
  if (normalized) return normalized;
  return inferFamilyFromPick(raw);
}

/**
 * Single source of truth for turning a recommended pick + its market family
 * into an explicit, human-readable label (e.g. "Over 10.5 Corners" instead of
 * a bare "Over 10.5"). Every card, modal, and notification should call this
 * instead of rendering `recommended.pick` directly.
 */
export function formatRecommendedPick(
  pick: string | null | undefined,
  family: string | null | undefined,
  t: TranslateFn
): FormattedRecommendation {
  const raw = String(pick || "").trim();
  if (!raw) return { label: "—", familyKey: "OTHER" };

  const familyKey = resolveMarketFamilyKey(raw, family);
  const upper = raw.toUpperCase();

  switch (familyKey) {
    case "1X2": {
      if (upper === "1") return { label: t("recommendation.homeWin"), familyKey };
      if (upper === "2") return { label: t("recommendation.awayWin"), familyKey };
      return { label: t("recommendation.draw"), familyKey };
    }
    case "DOUBLE_CHANCE": {
      const code = upper === "1X" || upper === "12" || upper === "X2" ? upper : raw;
      return { label: `${t("recommendation.doubleChance")} ${code}`, familyKey };
    }
    case "BTTS": {
      return { label: t(upper === "NGG" ? "recommendation.bttsNo" : "recommendation.bttsYes"), familyKey };
    }
    case "GOALS":
    case "CORNERS":
    case "CARDS": {
      const ou = parseOuPick(raw);
      if (!ou) return { label: raw, familyKey };
      const sideLabel = t(ou.side === "over" ? "match.overLine" : "match.underLine", {
        line: ou.line.toFixed(1)
      });
      const marketWord =
        familyKey === "GOALS"
          ? t("card.marketGoals")
          : familyKey === "CORNERS"
            ? t("match.featCorners")
            : t("match.cards");
      return { label: `${sideLabel} ${marketWord}`, familyKey };
    }
    case "CORRECT_SCORE": {
      return { label: `${t("recommendation.correctScore")} ${raw}`, familyKey };
    }
    default:
      return { label: raw, familyKey: "OTHER" };
  }
}
