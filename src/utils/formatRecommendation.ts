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
  /**
   * Same label with the VERBOSE period name ("Full Match" instead of "FT") —
   * for aria-labels/tooltips, so compact visual labels never cost accessibility.
   * Equals `label` when the pick carries no period.
   */
  ariaLabel: string;
};

/**
 * Structural metadata for a recommended pick, straight from the server's Market
 * Identity Contract (recommended.period / scope / bookLine). The UI renders it —
 * it never invents a period or re-derives a line from the label string.
 */
export type RecommendedLabelMeta = {
  period?: string | null;
  scope?: string | null;
  bookLine?: number | null;
  line?: number | null;
};

/**
 * Lossless line label: 10 → "10", 10.25 → "10.25", 10.5 → "10.5".
 * `toFixed(1)` displayed the real bookmaker line 10.25 as the nonexistent "10.3".
 */
export function formatLineLabel(line: number | null | undefined): string {
  const n = Number(line);
  if (!Number.isFinite(n)) return String(line ?? "");
  return String(n);
}

/**
 * Compact UI abbreviation for a known period — product rule: FT / FH / SH / ET.
 * Presentation only: the internal descriptors (full_match / first_half /
 * second_half / extra_time…) are the Market Identity Contract and are never
 * touched here. Unknown periods get NO invented abbreviation — callers fall
 * back to no suffix at all, exactly as before.
 * FH is the Market-Identity abbreviation; legacy "HT" wording elsewhere in the
 * app is deliberately left alone (no global terminology refactor here).
 */
export function formatMarketPeriodShort(period: string | null | undefined): string | null {
  if (period === "full_match") return "FT";
  if (period === "first_half") return "FH";
  if (period === "second_half") return "SH";
  if (period === "extra_time") return "ET";
  return null;
}

/** Verbose i18n name for a known period; null when absent/unknown (never invented). */
function periodSuffix(period: string | null | undefined, t: TranslateFn): string | null {
  if (period === "full_match") return t("match.periodFullMatch");
  if (period === "first_half") return t("match.periodFirstHalf");
  if (period === "second_half") return t("match.periodSecondHalf");
  if (period === "extra_time") return t("match.periodExtraTime");
  return null;
}

/**
 * Compact scope label — single source of truth for scope display. Product rule:
 * `match` gets no suffix; `home`/`away` keep the full i18n words ("Home"/"Gazde",
 * "Away"/"Oaspeți") — NEVER single letters (no invented "H"/"A"). Unknown scopes
 * get nothing, so a value outside the contract is never mislabeled.
 */
export function formatMarketScopeShort(scope: string | null | undefined, t: TranslateFn): string | null {
  if (scope === "home") return t("match.scopeHome");
  if (scope === "away") return t("match.scopeAway");
  return null;
}

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
  // "SOT Over 8.5" is the server's own shots-on-target label — explicit, like "Shots".
  if (/\bshots?\b|\bsot\b|suturi|șuturi/.test(p)) return "SHOTS";
  return null;
}

/**
 * Two distinct markets share the SHOTS family key: total shots (server family
 * "Shots", label prefix "Shots") and shots on target (family "Shots on Target",
 * label prefix "SOT"). They settle against different statistics, so the label
 * must say which one it is — the audit of fixture 1557383 found "Shots Over 10.5"
 * (a total-shots pick) being read against the shots-on-target panel.
 */
function isShotsOnTargetPick(pick: string, family: string | null | undefined): boolean {
  const fam = String(family || "")
    .trim()
    .toLowerCase()
    .replace(/[/_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (fam === "shots on target") return true;
  return /\bsot\b|on target|la poart/i.test(pick);
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
  t: TranslateFn,
  meta?: RecommendedLabelMeta | null
): FormattedRecommendation {
  const raw = String(pick || "").trim();
  if (!raw) return { label: "—", ariaLabel: "—", familyKey: "OTHER" };

  const familyKey = resolveMarketFamilyKey(raw, family);
  const upper = raw.toUpperCase();
  // Structural period suffix — appended only when the server sent one. Legacy
  // rows without the Market Identity Contract render exactly as before.
  // Visual: compact FT/FH/ET; periods without a defined abbreviation
  // (second_half) keep their verbose label. Aria: always verbose.
  const verboseSuffix = periodSuffix(meta?.period, t);
  const shortSuffix = formatMarketPeriodShort(meta?.period) ?? verboseSuffix;
  const withPeriod = (label: string) => (shortSuffix ? `${label} · ${shortSuffix}` : label);
  const withVerbosePeriod = (label: string) =>
    verboseSuffix ? `${label} · ${verboseSuffix}` : withPeriod(label);
  // `verboseBase` lets a market with a compact display name ("GG", "DC 1X",
  // "CS 2-1") keep its full name in aria ("Ambele marchează (GG)", …).
  const periodized = (label: string, verboseBase: string = label): FormattedRecommendation => ({
    label: withPeriod(label),
    ariaLabel: withVerbosePeriod(verboseBase),
    familyKey
  });
  const plain = (label: string, key: MarketFamilyKey = familyKey): FormattedRecommendation => ({
    label,
    ariaLabel: label,
    familyKey: key
  });

  switch (familyKey) {
    case "1X2": {
      if (upper === "1") return plain(t("recommendation.homeWin"));
      if (upper === "2") return plain(t("recommendation.awayWin"));
      return plain(t("recommendation.draw"));
    }
    case "DOUBLE_CHANCE": {
      const code = upper === "1X" || upper === "12" || upper === "X2" ? upper : raw;
      // Compact "DC 1X" — the "dc" alias already exists server-side (GSB families,
      // normalizeServerFamily). Aria keeps the full "Double chance 1X".
      return periodized(`DC ${code}`, `${t("recommendation.doubleChance")} ${code}`);
    }
    case "BTTS": {
      // Locale-native compact forms, reusing the app's own conventions:
      // RO "GG"/"NGG", EN "BTTS"/"No BTTS". Aria keeps the full sentence.
      const isNo = upper === "NGG";
      return periodized(
        t(isNo ? "recommendation.bttsNoShort" : "recommendation.bttsYesShort"),
        t(isNo ? "recommendation.bttsNo" : "recommendation.bttsYes")
      );
    }
    case "GOALS":
    case "CORNERS":
    case "CARDS": {
      const ou = parseOuPick(raw);
      if (!ou) return periodized(raw);
      // Prefer the structural line (server bookLine) over the one re-parsed from
      // the label; format losslessly either way (10.25 must never render "10.3").
      const structuralLine = Number(meta?.bookLine ?? meta?.line);
      const line = Number.isFinite(structuralLine) ? structuralLine : ou.line;
      const sideLabel = t(ou.side === "over" ? "match.overLine" : "match.underLine", {
        line: formatLineLabel(line)
      });
      const scope = formatMarketScopeShort(meta?.scope, t);
      const marketWord =
        familyKey === "GOALS"
          ? t("card.marketGoals")
          : familyKey === "CORNERS"
            ? t("match.featCorners")
            : t("match.cards");
      const scopedMarket = scope ? `${scope} ${marketWord}` : marketWord;
      return periodized(`${sideLabel} ${scopedMarket}`);
    }
    case "SHOTS": {
      const ou = parseOuPick(raw);
      if (!ou) return periodized(raw);
      const structuralLine = Number(meta?.bookLine ?? meta?.line);
      const line = Number.isFinite(structuralLine) ? structuralLine : ou.line;
      const sideLabel = t(ou.side === "over" ? "match.overLine" : "match.underLine", {
        line: formatLineLabel(line)
      });
      const scope = formatMarketScopeShort(meta?.scope, t);
      // Same wording the Match Detail panels already use for the two shots markets
      // ("Total shots" / "Shots on target"), so list, card and detail agree.
      const marketWord = isShotsOnTargetPick(raw, family)
        ? t("match.shotsSub")
        : t("match.shotsTotalTitle");
      const scopedMarket = scope ? `${scope} ${marketWord}` : marketWord;
      return periodized(`${sideLabel} ${scopedMarket}`);
    }
    case "CORRECT_SCORE": {
      // Compact "CS 2-1"; aria keeps the full "Correct score 2-1".
      return periodized(`CS ${raw}`, `${t("recommendation.correctScore")} ${raw}`);
    }
    default:
      return periodized(raw);
  }
}
