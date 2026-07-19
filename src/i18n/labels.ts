import type { TranslateFn } from "./types";

/** Map API/engine English category labels to locale keys. */
export function translateConfidenceCategory(t: TranslateFn, category?: string | null): string {
  switch (category) {
    case "Very High":
      return t("panels.catVeryHigh");
    case "High":
      return t("panels.catHigh");
    case "Medium":
      return t("panels.catMedium");
    case "Low":
      return t("panels.catLow");
    case "Very Low":
      return t("panels.catVeryLow");
    default:
      return category || t("panels.catMedium");
  }
}

const DIM_KEYS: Record<string, string> = {
  attack: "panels.dimAttack",
  defense: "panels.dimDefense",
  form: "panels.dimForm",
  recentMatches: "panels.dimRecentMatches",
  standings: "panels.dimStandings",
  referee: "panels.dimReferee",
  injuries: "panels.dimInjuries",
  lineups: "panels.dimLineups",
  restDays: "panels.dimRestDays",
  homeAdvantage: "panels.dimHomeAdvantage",
  oddsConsensus: "panels.dimOddsConsensus",
  h2h: "panels.dimH2h"
};

export function translateDimensionLabel(t: TranslateFn, key: string): string {
  const i18nKey = DIM_KEYS[key];
  return i18nKey ? t(i18nKey) : key;
}
