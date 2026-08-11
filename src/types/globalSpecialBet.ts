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
 * One leg of the accumulator, exactly as stored in `special_bet_selections`.
 *
 * Note the absence of team and league NAMES: the snapshot carries `fixture_id`
 * and `league_id` only. Labels are resolved for display from data the client
 * already holds, and fall back to the ids when that lookup misses.
 */
export type GlobalSpecialBetSelection = {
  id: string;
  special_bet_id: string;
  fixture_id: number;
  league_id: number;
  kickoff_at: string;
  market: string;
  selection: string;
  side: "over" | "under" | null;
  line: number | null;
  odds: number;
  confidence: number;
  value_score: number | null;
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
