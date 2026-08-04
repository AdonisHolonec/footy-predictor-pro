import type { TranslateFn } from "../i18n";

/**
 * Normalized market family for a recommended pick — drives both the label
 * text and the contextual icon. Distinct from the raw `recommended.family`
 * string persisted by the server (see server-utils/value/valueMarkets.js
 * VALUE_MARKET_FAMILIES), which this module maps onto one of these keys.
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

function normalizeServerFamily(family: string | null | undefined): MarketFamilyKey | null {
  switch (family) {
    case "1X2":
      return "1X2";
    case "Double Chance":
      return "DOUBLE_CHANCE";
    case "BTTS":
      return "BTTS";
    case "Over/Under":
      return "GOALS";
    case "Corners":
      return "CORNERS";
    case "Cards":
      return "CARDS";
    case "Correct Score":
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
 * Best-effort family inference for rows persisted before `recommended.family`
 * existed. Only reached when the server didn't send a recognized family —
 * new predictions should always carry it (see Stage09Explainability.js).
 */
function inferFamilyFromPick(pick: string): MarketFamilyKey {
  const p = pick.trim().toLowerCase();
  if (p === "1" || p === "x" || p === "2") return "1X2";
  if (p === "1x" || p === "12" || p === "x2") return "DOUBLE_CHANCE";
  if (p === "gg" || p === "ngg") return "BTTS";
  if (p.includes("card")) return "CARDS";
  if (/^\d+-\d+$/.test(p)) return "CORRECT_SCORE";
  const ou = parseOuPick(p);
  if (ou) return GOALS_LINES.has(ou.line) ? "GOALS" : "CORNERS";
  return "OTHER";
}

/** Resolves the market family a recommended pick belongs to, preferring the persisted metadata over string-guessing. */
export function resolveMarketFamilyKey(
  pick: string | null | undefined,
  family?: string | null
): MarketFamilyKey {
  const normalized = normalizeServerFamily(family);
  if (normalized) return normalized;
  return inferFamilyFromPick(String(pick || ""));
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
