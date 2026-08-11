/**
 * Presentation helpers for the Global Special Bet card.
 *
 * Strictly display-only. Nothing here ranks, prices, grades or aggregates: the
 * server owns every one of those and the client would only be a second opinion.
 * What lives here is formatting, status vocabulary and label lookup — the parts
 * that must be testable without React and without a network.
 */

import type { MarketFamilyKey } from "./formatRecommendation";
import type {
  GlobalSpecialBet,
  GlobalSpecialBetSelection,
  GlobalSpecialBetStatus
} from "../types/globalSpecialBet";

/** Rows the app already holds; enough to name a fixture the snapshot only numbers. */
type LabelSource = {
  id: number | string;
  league?: string;
  teams?: { home?: string; away?: string };
};

export type FixtureLabel = {
  /** "Arsenal – Chelsea" when known, otherwise null so callers can fall back. */
  title: string | null;
  league: string | null;
};

const STATUS_TONE: Record<GlobalSpecialBetStatus, "success" | "danger" | "warning" | "neutral"> = {
  won: "success",
  lost: "danger",
  pending: "warning",
  void: "neutral"
};

const STATUS_KEY: Record<GlobalSpecialBetStatus, string> = {
  won: "gsb.statusWon",
  lost: "gsb.statusLost",
  pending: "gsb.statusPending",
  void: "gsb.statusVoid"
};

/** The four statuses the API can return. Anything else is data we do not model. */
export function isGlobalSpecialBetStatus(value: unknown): value is GlobalSpecialBetStatus {
  return value === "pending" || value === "won" || value === "lost" || value === "void";
}

export function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  return isGlobalSpecialBetStatus(status) ? STATUS_TONE[status] : "neutral";
}

export function statusLabelKey(status: string): string {
  return isGlobalSpecialBetStatus(status) ? STATUS_KEY[status] : "gsb.statusPending";
}

/**
 * Format a numeric API field, or return null when there is nothing to show.
 *
 * Returning null rather than "0.00" is the whole point: `settled_total_odds` is
 * NULL for a lost or pending bet, and rendering a zero there would invent a
 * payout the server deliberately refused to express.
 */
export function formatDecimal(value: unknown, digits: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : null;
}

/** Odds carry two decimals everywhere else in the product; keep that. */
export function formatOdds(value: unknown): string | null {
  return formatDecimal(value, 2);
}

/** Confidence is a percentage; the API sends it as a number, not a fraction. */
export function formatConfidencePercent(value: unknown): string | null {
  const n = formatDecimal(value, 0);
  return n === null ? null : `${n}%`;
}

/** Value score is optional on a selection — absent means absent, never zero. */
export function formatValueScore(value: unknown): string | null {
  return formatDecimal(value, 1);
}

/**
 * fixture_id -> readable labels, built from prediction and history rows the
 * client already loaded.
 *
 * The snapshot stores ids only, so this is a presentation join, not a source of
 * truth: a miss degrades to the fixture id rather than to an invented name.
 */
export function buildFixtureLabelIndex(sources: readonly LabelSource[][]): Map<number, FixtureLabel> {
  const index = new Map<number, FixtureLabel>();
  for (const rows of sources) {
    for (const row of rows || []) {
      const id = Number(row?.id);
      if (!Number.isFinite(id) || index.has(id)) continue;
      const home = row?.teams?.home;
      const away = row?.teams?.away;
      index.set(id, {
        title: home && away ? `${home} – ${away}` : null,
        league: row?.league || null
      });
    }
  }
  return index;
}

export function lookupFixtureLabel(
  index: Map<number, FixtureLabel> | undefined,
  fixtureId: number
): FixtureLabel {
  return index?.get(Number(fixtureId)) ?? { title: null, league: null };
}

/** Empty strings are not names; treat them as the absence they are. */
function textOrNull(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/**
 * How a leg is named, snapshot first.
 *
 * The stored `fixture_label` / `league_name` (migration 048) win over the
 * display index, because they are what the bet was actually built from — the
 * index only knows fixtures still loaded in this session, which is precisely
 * the wrong set for a bet from three weeks ago.
 *
 * The two fields fall back independently: a selection can carry a fixture label
 * and no league, and there is no reason to discard the half we have. Both null
 * leaves the caller to show the ids.
 */
export function resolveSelectionLabel(
  selection: Pick<GlobalSpecialBetSelection, "fixture_id" | "fixture_label" | "league_name">,
  index: Map<number, FixtureLabel> | undefined
): FixtureLabel {
  const joined = lookupFixtureLabel(index, selection.fixture_id);
  return {
    title: textOrNull(selection.fixture_label) ?? joined.title,
    league: textOrNull(selection.league_name) ?? joined.league
  };
}

/**
 * Market families the engine can select, mapped onto vocabulary the product
 * already speaks.
 *
 * Reusing `card.marketGoals` / `match.featCorners` / … rather than minting a
 * parallel `gsb.market*` set keeps one name per market across the whole app; a
 * second translation of "Corners" would drift the moment one of them changed.
 */
const MARKET_LABEL_KEY: Record<string, string> = {
  ou: "card.marketGoals",
  corners: "match.featCorners",
  shots: "match.featShots",
  "1x2": "match.market1x2",
  dc: "recommendation.doubleChance",
  btts: "match.marketGgNgg"
};

const MARKET_ICON_KEY: Record<string, MarketFamilyKey> = {
  ou: "GOALS",
  corners: "CORNERS",
  shots: "SHOTS",
  "1x2": "1X2",
  dc: "DOUBLE_CHANCE",
  btts: "BTTS"
};

/** Null for an unmapped family, so callers show the raw value instead of a wrong name. */
export function marketLabelKey(market: string): string | null {
  return MARKET_LABEL_KEY[String(market).toLowerCase()] ?? null;
}

export function marketIconKey(market: string): MarketFamilyKey {
  return MARKET_ICON_KEY[String(market).toLowerCase()] ?? "OTHER";
}

/**
 * What actually happened to a bet, in one line.
 *
 * A lost 8-leg bet where seven legs won reads identically to one where five
 * failed — both are just "Pierdut" — and the user cannot tell them apart without
 * expanding and counting badges. This states the outcome the counts already
 * imply.
 *
 * Every case below follows from aggregateBetStatus() in the settlement engine:
 * ANY lost leg loses the bet, so when exactly one lost, that one ended it, and
 * when several did there is no single culprit to name. A void leg settles at
 * 1.00, which is why a won bet's settled odds can sit below what was promised.
 *
 * Deliberately absent: what the bet WOULD have paid without its losing leg. The
 * number is computable, but a product that tells you what you nearly won is
 * taunting the user, which PRODUCT_DNA rules out.
 */
export type GlobalSpecialBetReading = {
  tally: { won: number; lost: number; void: number; pending: number };
  total: number;
  /** i18n key for the one-line reading, with the counts it interpolates. */
  key: string;
  vars: Record<string, number>;
};

/**
 * Counts are exact; the copy never claims a partition.
 *
 * Romanian needs a separate singular, so the one-leg cases get their own keys.
 * The 20+ form ("20 de selecții") is unreachable: a bet holds 3, 5 or 8 legs,
 * enforced by the variant CHECK constraint and by GLOBAL_SPECIAL_BET_VARIANTS.
 */
export function readGlobalSpecialBet(bet: GlobalSpecialBet): GlobalSpecialBetReading {
  const tally = { won: 0, lost: 0, void: 0, pending: 0 };
  for (const selection of bet.selections || []) {
    const status = isGlobalSpecialBetStatus(selection.status) ? selection.status : "pending";
    tally[status] += 1;
  }
  const total = (bet.selections || []).length;
  const status = isGlobalSpecialBetStatus(bet.status) ? bet.status : "pending";

  if (status === "lost") {
    return tally.lost === 1
      ? { tally, total, key: "gsb.readingLostOne", vars: {} }
      : { tally, total, key: "gsb.readingLostMany", vars: { n: tally.lost, total } };
  }
  if (status === "won") {
    if (tally.void === 0) return { tally, total, key: "gsb.readingWonClean", vars: { total } };
    return tally.void === 1
      ? { tally, total, key: "gsb.readingWonVoidOne", vars: {} }
      : { tally, total, key: "gsb.readingWonVoidMany", vars: { n: tally.void } };
  }
  if (status === "void") return { tally, total, key: "gsb.readingVoid", vars: {} };
  return { tally, total, key: "gsb.readingPending", vars: { won: tally.won, pending: tally.pending, total } };
}

/**
 * Whether a leg is one of those that ended the bet.
 *
 * Only meaningful on a lost bet: nothing "decides" a win, every leg does. Used
 * to draw the eye straight to the failure instead of making it scan eight badges.
 */
export function isDecidingSelection(
  betStatus: string,
  selection: Pick<GlobalSpecialBetSelection, "status">
): boolean {
  return betStatus === "lost" && selection.status === "lost";
}

/**
 * The numbers shown in the card header, taken verbatim from the snapshot.
 *
 * `selectionCount` is the length of what the API returned — a fact about the
 * response, not a recomputation. Everything else is passed through untouched.
 */
export type GlobalSpecialBetSummary = {
  variant: number;
  selectionCount: number;
  totalOdds: string | null;
  settledTotalOdds: string | null;
  averageConfidence: string | null;
  status: GlobalSpecialBetStatus;
  createdAt: string;
};

export function summarizeGlobalSpecialBet(bet: GlobalSpecialBet): GlobalSpecialBetSummary {
  return {
    variant: Number(bet.variant),
    selectionCount: bet.selections.length,
    totalOdds: formatOdds(bet.total_odds),
    settledTotalOdds: formatOdds(bet.settled_total_odds),
    averageConfidence: formatConfidencePercent(bet.average_confidence),
    status: isGlobalSpecialBetStatus(bet.status) ? bet.status : "pending",
    createdAt: bet.created_at
  };
}

/**
 * Which message an HTTP failure deserves.
 *
 * The server's own text wins whenever it sent one — it knows why it refused far
 * better than any generic copy here. A 500 maps to a retryable failure and is
 * never dressed up as "not enough selections", which is a successful 200.
 */
export type GlobalSpecialBetErrorView = {
  titleKey: string;
  /** i18n key for the fallback message; ignored when `message` is present. */
  messageKey: string;
  /** Server-supplied reason, already human-readable. */
  message: string | null;
  retryable: boolean;
};

export function describeGlobalSpecialBetError(
  status: number,
  apiMessage: string | null
): GlobalSpecialBetErrorView {
  if (status === 401) {
    return { titleKey: "gsb.errorAuthTitle", messageKey: "gsb.errorAuthDesc", message: null, retryable: false };
  }
  if (status === 403) {
    return {
      titleKey: "gsb.errorAccessTitle",
      messageKey: "gsb.errorAccessDesc",
      message: apiMessage,
      retryable: false
    };
  }
  if (status === 400) {
    return {
      titleKey: "gsb.errorRequestTitle",
      messageKey: "gsb.errorRequestDesc",
      message: apiMessage,
      retryable: false
    };
  }
  if (status === 409) {
    return {
      titleKey: "gsb.errorConflictTitle",
      messageKey: "gsb.errorConflictDesc",
      message: apiMessage,
      retryable: true
    };
  }
  return {
    titleKey: "gsb.errorTitle",
    messageKey: "gsb.errorDesc",
    message: apiMessage,
    retryable: true
  };
}
