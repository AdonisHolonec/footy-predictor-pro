/**
 * Global Special Bet — persistence layer.
 *
 * The server is the only authority on which selections a bet contains: it
 * rebuilds the candidate pool from the canonical `predictions_history.raw_payload`
 * and runs globalSpecialBetEngine.js. A client sends intent only (date, variant,
 * leagues) and never a selection, an odd or a confidence.
 *
 * Everything above the Supabase calls is pure and separately testable, because
 * the interesting rules — canonical scope, variant availability, the snapshot
 * shape — must be provable without a database.
 */

import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { buildGlobalSpecialBets, GLOBAL_SPECIAL_BET_VARIANTS } from "./globalSpecialBetEngine.js";

const HISTORY_TABLE = "predictions_history";
const BETS_TABLE = "special_bets";
const SELECTIONS_TABLE = "special_bet_selections";

/** Bet dates are calendar days; fixtures are bucketed by UTC so the key is stable. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidVariant(variant) {
  return GLOBAL_SPECIAL_BET_VARIANTS.includes(Number(variant));
}

export function isValidBetDate(betDate) {
  const raw = String(betDate || "");
  if (!DATE_PATTERN.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

/**
 * Deduped, numerically sorted league ids plus their canonical text form.
 *
 * Mirrors exactly what create_global_special_bet() derives in SQL. The database
 * remains the authority — this exists so the API can reject nonsense early and
 * so the canonicalisation rule is unit-testable without a database.
 */
export function canonicalizeLeagueScope(leagueIds) {
  const cleaned = [...new Set((Array.isArray(leagueIds) ? leagueIds : []).map((id) => Number(id)))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
  return { leagueIds: cleaned, scope: cleaned.join(",") };
}

/**
 * The model version behind a bet, taken from the payloads that produced its
 * selections — never a constant. Selections can in principle straddle two model
 * versions (a fixture re-predicted after a deploy); the first one present wins
 * and is recorded as the bet's version.
 */
export function resolveModelVersion(payloadsByFixtureId, selections) {
  for (const selection of selections || []) {
    const version = payloadsByFixtureId.get(Number(selection.fixtureId))?.modelVersion;
    if (version) return String(version);
  }
  return null;
}

/** Engine candidate -> the row shape create_global_special_bet() expects. */
export function toSelectionRows(selections) {
  return (selections || []).map((s) => ({
    fixture_id: s.fixtureId,
    league_id: s.leagueId,
    kickoff_at: s.kickoff,
    market: s.market,
    selection: s.selection,
    side: s.side ?? null,
    line: s.line ?? null,
    odds: s.odds,
    confidence: s.confidence,
    value_score: s.valueScore ?? null
  }));
}

/** The explicit "this variant cannot be built" response, per the product rules. */
export function unavailableResponse(variant, availableCandidates) {
  return {
    available: false,
    variant: Number(variant),
    required: Number(variant),
    availableCandidates: Number(availableCandidates)
  };
}

/**
 * Canonical prediction payloads for one calendar day and set of leagues.
 *
 * Reads `raw_payload` — the prediction of record, frozen at kickoff — rather
 * than recomputing anything.
 */
export async function loadCandidatePayloads(supabase, betDate, leagueIds) {
  const dayStart = `${betDate}T00:00:00.000Z`;
  const dayEnd = `${betDate}T23:59:59.999Z`;

  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select("fixture_id, league_id, kickoff_at, raw_payload")
    .in("league_id", leagueIds)
    .gte("kickoff_at", dayStart)
    .lte("kickoff_at", dayEnd);
  if (error) throw error;

  const payloadsByFixtureId = new Map();
  const rows = [];
  for (const row of data || []) {
    const payload = row?.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : null;
    if (!payload) continue;
    // The columns win over the payload for identity fields: they are what the
    // query matched on, and legacy payloads predate some of them.
    const normalized = {
      ...payload,
      id: payload.id ?? row.fixture_id,
      leagueId: payload.leagueId ?? row.league_id,
      kickoff: payload.kickoff ?? row.kickoff_at
    };
    payloadsByFixtureId.set(Number(row.fixture_id), normalized);
    rows.push(normalized);
  }

  return { rows, payloadsByFixtureId };
}

/**
 * Generate (or return) the Global Special Bet for one user/date/variant/scope.
 *
 * Idempotent through the database: create_global_special_bet() owns the
 * uniqueness check and the transaction, so a repeat request, a retry or two
 * concurrent devices converge on one row instead of racing to create several.
 *
 * @param {{ userId: string, betDate: string, variant: number, leagueIds: number[], now?: number }} params
 */
export async function createGlobalSpecialBet({
  userId,
  betDate,
  variant,
  leagueIds,
  now = Date.now(),
  // Injectable so the orchestration is testable without a database; production
  // callers never pass it.
  supabase = getSupabaseAdmin()
}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");

  const { leagueIds: canonicalLeagues } = canonicalizeLeagueScope(leagueIds);
  const { rows, payloadsByFixtureId } = await loadCandidatePayloads(supabase, betDate, canonicalLeagues);

  const built = buildGlobalSpecialBets({ rows, leagueIds: canonicalLeagues, now }, [Number(variant)]);
  const bet = built.bets[Number(variant)];

  // Not enough eligible selections: say so, and write nothing. A padded
  // accumulator would be a worse product than an absent one.
  if (!bet) return { ok: true, created: false, ...unavailableResponse(variant, built.pool.length) };

  const { data, error } = await supabase.rpc("create_global_special_bet", {
    p_user_id: userId,
    p_bet_date: betDate,
    p_variant: Number(variant),
    p_league_ids: canonicalLeagues,
    p_total_odds: bet.totalOdds,
    p_average_confidence: bet.averageConfidence,
    p_model_version: resolveModelVersion(payloadsByFixtureId, bet.selections),
    p_selections: toSelectionRows(bet.selections)
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(`create_global_special_bet: ${data?.error || "unknown_error"}`);

  return {
    ok: true,
    available: true,
    created: Boolean(data.created),
    bet: data.bet,
    selections: data.selections || []
  };
}

/**
 * The user's stored bets. Reads the snapshot and nothing else — no engine, no
 * recomputation, so a bet shown today is the bet that was generated.
 *
 * @param {{ userId: string, variant?: number, betDate?: string, limit?: number, offset?: number }} params
 */
export async function listGlobalSpecialBets({
  userId,
  variant,
  betDate,
  limit = 20,
  offset = 0,
  supabase = getSupabaseAdmin()
}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");

  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);

  let query = supabase
    .from(BETS_TABLE)
    .select("*")
    // Scoped to the caller even though the service role bypasses RLS: the
    // policy is the second lock, this is the first.
    .eq("user_id", userId)
    .order("bet_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);

  if (variant !== undefined && variant !== null && variant !== "") query = query.eq("variant", Number(variant));
  if (betDate) query = query.eq("bet_date", betDate);

  const { data: bets, error } = await query;
  if (error) throw error;
  if (!bets?.length) return { bets: [] };

  const { data: selections, error: selError } = await supabase
    .from(SELECTIONS_TABLE)
    .select("*")
    .in(
      "special_bet_id",
      bets.map((b) => b.id)
    )
    .order("kickoff_at", { ascending: true });
  if (selError) throw selError;

  const byBetId = new Map();
  for (const selection of selections || []) {
    if (!byBetId.has(selection.special_bet_id)) byBetId.set(selection.special_bet_id, []);
    byBetId.get(selection.special_bet_id).push(selection);
  }

  return { bets: bets.map((b) => ({ ...b, selections: byBetId.get(b.id) || [] })) };
}

export default {
  canonicalizeLeagueScope,
  createGlobalSpecialBet,
  isValidBetDate,
  isValidVariant,
  listGlobalSpecialBets,
  loadCandidatePayloads,
  resolveModelVersion,
  toSelectionRows,
  unavailableResponse
};
