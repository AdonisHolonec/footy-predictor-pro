/**
 * Contract of `/api/special-bets` — the Global Special Bet product.
 *
 * Distinct from the per-match "Special Bet · Top signals" (src/utils/specialBet.ts),
 * which combines markets WITHIN one fixture. This one is an accumulator built by
 * the SERVER from selections ACROSS the fixtures of the user's favourite leagues.
 *
 * Every field here is server-authoritative and arrives as a frozen snapshot: the
 * client never derives odds, confidence, value or status, and never re-ranks a
 * selection. These types describe what the API returns, nothing more.
 */

export type GlobalSpecialBetStatus = "pending" | "won" | "lost" | "void";

/** The three variants the engine slices out of one ranked pool. */
export const GLOBAL_SPECIAL_BET_VARIANTS = [3, 5, 8] as const;
export type GlobalSpecialBetVariant = (typeof GLOBAL_SPECIAL_BET_VARIANTS)[number];

/**
 * A System ticket is exactly five selections of which k must win — 3/5, 4/5 or
 * 5/5, and nothing else. Mirrors the server contract in
 * server-utils/globalSpecialBetEngine.js, the same way the variants above mirror
 * GLOBAL_SPECIAL_BET_VARIANTS.
 */
export const SYSTEM_SELECTION_COUNT = 5;
export const SYSTEM_K_VALUES = [3, 4, 5] as const;
export type SystemK = (typeof SYSTEM_K_VALUES)[number];

/**
 * What happened to a settled ticket, as a fact rather than a feeling.
 *
 * The distinction that forces this type to exist: for a combo, WON implies the
 * ticket returned more than it cost — every leg's odds exceed 1, so the product
 * does too. For a System it does NOT. A 3/5 with exactly three winners at 2.00
 * returns 0.80 for every 1.00 staked: won, and down twenty percent. The status
 * alone can no longer answer "did I make money", so the kinds below split WON by
 * what actually came back.
 */
export type TicketOutcomeKind =
  | "pending"
  | "void"
  | "lost"
  | "won_above_stake"
  | "won_at_stake"
  | "won_below_stake"
  | "won_return_unknown";

export type TicketOutcome = {
  kind: TicketOutcomeKind;
  status: GlobalSpecialBetStatus;
  /** Gross return per unit of total stake. Null only when there is no answer yet. */
  returnMultiple: number | null;
  /** returnMultiple − 1, as a fraction of stake. Negative is a loss. Null when unsettled. */
  netFraction: number | null;
  /** True ONLY when more came back than went in. A won ticket can be false here. */
  profitable: boolean;
  /** The status word, via the existing gsb.status* keys. */
  labelKey: string;
  /** One factual sentence about the return. */
  detailKey: string;
  /** Extra line shown only when a won ticket returned less than its stake. */
  warningKey: string | null;
  vars: Record<string, string | number>;
  tone: "success" | "danger" | "warning" | "neutral";
};

/**
 * One leg of the accumulator, exactly as stored in `special_bet_selections`.
 *
 * Since migration 048 the snapshot carries the names it was built from as well
 * as the ids. They are nullable in both directions: null for every selection
 * written before 048 (there is no backfill), and null for a fixture the engine
 * could not name. A null falls back to the display join, then to the id — so
 * the label chain degrades, and never invents.
 */
export type GlobalSpecialBetSelection = {
  id: string;
  special_bet_id: string;
  fixture_id: number;
  league_id: number;
  /** "Arsenal – Chelsea" as it read when the bet was generated. */
  fixture_label: string | null;
  league_name: string | null;
  kickoff_at: string;
  market: string;
  selection: string;
  side: "over" | "under" | null;
  line: number | null;
  odds: number;
  confidence: number;
  value_score: number | null;
  /**
   * Model P(full win) this leg was ranked on, as a 0–1 fraction (migration 050).
   * NULL for selections stored before 050 — there is no backfill, and the UI
   * renders a dash rather than inventing a number. Distinct from `confidence`,
   * which is fixture-level metadata and never a probability.
   */
  probability: number | null;
  status: GlobalSpecialBetStatus;
  settled_at: string | null;
};

/** A row of `special_bets`. */
export type GlobalSpecialBetRow = {
  id: string;
  user_id: string;
  bet_date: string;
  league_ids: number[];
  league_scope: string;
  variant: number;
  status: GlobalSpecialBetStatus;
  total_odds: number;
  average_confidence: number;
  model_version: string | null;
  /**
   * Engine-estimated ticket chance (migration 050): the product of the legs'
   * P(full win), 0–1, under an explicit independence assumption. NULL for bets
   * stored before 050. The persisted value is the source of truth — the client
   * never recomputes it from the selections.
   */
  ticket_probability: number | null;
  created_at: string;
  settled_at: string | null;
  /**
   * What the bet resolved at, voids counted as 1.00. NULL while pending and for
   * lost bets — the API never expresses a payout that does not exist, so the UI
   * must render a dash rather than a zero.
   */
  settled_total_odds: number | null;
};

/** A bet together with its legs — the shape GET returns and POST is normalised into. */
export type GlobalSpecialBet = GlobalSpecialBetRow & {
  selections: GlobalSpecialBetSelection[];
};

/**
 * The server's explicit "this variant cannot be built" answer. It is a 200, not
 * an error: too few eligible selections is a product state, and nothing is
 * written. The UI must not pad the variant to reach the requested size.
 */
export type GlobalSpecialBetUnavailable = {
  available: false;
  variant: number;
  required: number;
  availableCandidates: number;
};

export type GlobalSpecialBetGenerateResult =
  | { available: true; created: boolean; bet: GlobalSpecialBet }
  | { available: false; created: false; unavailable: GlobalSpecialBetUnavailable };
