/**
 * Global Ticket — the admin-wide generation path.
 *
 * A Global Ticket is the product's own ticket: one per day and shape, built from
 * EVERY league the model has predicted, owned by nobody, published by a separate
 * later step. That is a different thing from the Global Special Bet in
 * globalSpecialBets.js, which is a per-user ticket built from the leagues that
 * user selected, and the two must not be conflated because their difference is
 * the whole security property here.
 *
 * ── WHY THIS IS A SEPARATE MODULE AND NOT A PARAMETER ────────────────────────
 * The user path threads `userId` and `leagueIds` from the request through
 * loadCandidatePayloads, canonicalizeLeagueScope and the RPC. The obvious
 * economy is to make both optional and branch. It was rejected for the same
 * reason migration 070 is a second function rather than a flag: an optional
 * `leagueIds` means the admin-wide guarantee is "the caller happened to pass
 * nothing", which is a convention, not a rule, and a convention cannot be
 * tested. In this module the parameters DO NOT EXIST — there is no userId to
 * read, no leagueIds to filter on, and no request-shaped object anywhere below
 * the authorization check. A user's favourites cannot narrow this pool because
 * nothing in the chain can express a narrowing.
 *
 * ── WHAT IT READS ────────────────────────────────────────────────────────────
 * `predictions_history.ticket_candidates` (migration 069) and nothing else.
 * NOT raw_payload — a 500-row query over it is ~151 MB in one statement, the
 * shape that produced the 57014 statement timeouts. NOT hydration_payload — it
 * keeps one market per fixture and no modelMeta, so every candidate would be
 * rejected as missingData.
 *
 * There is deliberately NO FALLBACK to raw_payload when ticket_candidates is
 * NULL. A row without the projection is simply not yet available to this path.
 * A fallback would reintroduce the egress pattern 069 removed, and it would do
 * so silently and precisely under the conditions where the pool is thin and the
 * query is largest.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 * No selection logic lives here. The candidate gates, the ranking and the
 * diversification are globalSpecialBetEngine.js's, unchanged and unparameterised
 * — the engine is not told which source fed it, because a path that could tell
 * would be a path free to diverge.
 *
 * Combos only in this increment: variants 3, 5 and 8. A system ticket is a
 * different builder (buildGlobalSystemBets) with its own k semantics; the RPC in
 * 070 accepts and validates one so the schema story is complete, but this
 * service refuses `bet_kind: "system"` by name rather than quietly building a
 * combo instead.
 */

import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { assertAdmin } from "./authAdmin.js";
import { TICKET_CANDIDATE_SELECT, rehydrateTicketCandidateRow } from "./ticketCandidateColumn.js";
import { loadUsedFixtureIds } from "./ticketFixtureUsage.js";
import { buildGlobalSpecialBets, GLOBAL_SPECIAL_BET_VARIANTS } from "./globalSpecialBetEngine.js";
import {
  CANDIDATE_POOL_LIMIT,
  isValidBetDate,
  isValidVariant,
  resolveModelVersion,
  toSelectionRows
} from "./globalSpecialBets.js";

const HISTORY_TABLE = "predictions_history";
const BETS_TABLE = "special_bets";
const SELECTIONS_TABLE = "special_bet_selections";

/** GLOBAL tickets are admin-generated, always. Stored by the RPC, asserted here. */
export const GLOBAL_TICKET_SOURCE = "ADMIN_PREDICTIONS";

/**
 * Why a generation attempt produced no ticket. Deterministic and exhaustive:
 * every unavailable answer carries exactly one of these, and the caller can
 * distinguish "the backfill has not run" from "today is thin" without guessing.
 */
export const GLOBAL_TICKET_POOL_STATES = Object.freeze({
  /** Not one upcoming prediction row carries the projection yet. */
  NO_POPULATED_PREDICTIONS: "no_populated_predictions",
  /** Rows exist, but fewer safe candidates survived the gates than the variant needs. */
  INSUFFICIENT_CANDIDATES: "insufficient_candidates",
  /** Enough candidates; a ticket was built. */
  OK: "ok"
});

/**
 * Every upcoming prediction that carries a ticket-generation projection.
 *
 * ADMIN-WIDE BY CONSTRUCTION. There is no league predicate in this query. The
 * pool is bounded by kickoff and by CANDIDATE_POOL_LIMIT — the same ceiling the
 * user path uses, imported rather than restated so the two cannot drift — and
 * ordered by kickoff, so if the ceiling is ever reached the nearest fixtures
 * win.
 *
 * ONE QUERY, one projection, no N+1: the identity a candidate needs
 * (fixture_id, league_id, kickoff_at, league_name, model_version) is already
 * columns on this row, so nothing is joined and nothing is fetched per fixture.
 *
 * `.not("ticket_candidates", "is", null)` keeps the un-backfilled rows out of
 * the wire response rather than out of the loop — a filter applied in JavaScript
 * would still pay the egress for every row it then discarded.
 *
 * One row per fixture: `payloadsByFixtureId` is the authority and `rows` is
 * derived from it, so a duplicate history row can never seed two candidates.
 *
 * @param {object} supabase a service-role client
 * @param {number} [now] epoch ms; fixtures at or before this are not candidates
 * @returns {Promise<{rows: object[], payloadsByFixtureId: Map<number, object>,
 *                    leagueIds: number[], scanned: number, unusable: number}>}
 */
export async function loadGlobalCandidatePayloads(supabase, now = Date.now()) {
  const nowIso = new Date(now).toISOString();

  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select(TICKET_CANDIDATE_SELECT)
    .not("ticket_candidates", "is", null)
    .gt("kickoff_at", nowIso)
    .order("kickoff_at", { ascending: true })
    .limit(CANDIDATE_POOL_LIMIT);
  if (error) throw error;

  const payloadsByFixtureId = new Map();
  let unusable = 0;

  for (const row of data || []) {
    const fixtureId = Number(row?.fixture_id);
    if (!Number.isFinite(fixtureId) || payloadsByFixtureId.has(fixtureId)) continue;

    // The projection becomes exactly the shape collectGlobalCandidates already
    // reads. Not a variant of it, not a superset — the same shape, through the
    // same function the parity study validated.
    const rehydrated = rehydrateTicketCandidateRow(row);
    if (!rehydrated) {
      // Reachable only if a row's projection is malformed rather than absent;
      // the query already excluded NULL. Counted, never repaired.
      unusable += 1;
      continue;
    }
    payloadsByFixtureId.set(fixtureId, rehydrated);
  }

  const rows = [...payloadsByFixtureId.values()];

  /*
    The leagues the POOL turned out to contain — never a request parameter.

    collectGlobalCandidates takes a `leagueIds` allow-list and counts anything
    outside it as `rejected.leagueNotSelected`. Passing the pool's own leagues
    makes that gate a tautology, which is exactly the intent: admin-wide means
    no league is excluded, and the cleanest way to say so through an engine that
    insists on an allow-list is to hand it one that cannot exclude anything.

    The alternative — teaching the engine that null means "all" — was rejected:
    it puts a second meaning into a parameter the USER path also passes, where an
    accidental null would silently widen a user's ticket to every league.
  */
  const leagueIds = [...new Set(rows.map((row) => Number(row?.leagueId)))]
    .filter((id) => Number.isInteger(id))
    .sort((a, b) => a - b);

  return { rows, payloadsByFixtureId, leagueIds, scanned: (data || []).length, unusable };
}

/**
 * The deterministic "no ticket" answer, with its reason.
 *
 * Never a partial ticket, never a downgraded variant, never a fabricated leg. An
 * 8-fold assembled from six good selections and two fillers is a worse product
 * than no 8-fold, and a request for an 8 that silently returns a 5 is worse
 * still: it looks like it worked.
 */
function unavailable({ variant, poolState, candidatesAvailable, built, pool }) {
  return {
    ok: true,
    created: false,
    available: false,
    variant: Number(variant),
    required: Number(variant),
    poolState,
    candidatesAvailable,
    fixturesConsidered: pool.fixtures,
    fixturesScanned: pool.scanned,
    // Scanned minus considered would conflate a malformed projection with a
    // duplicate history row. They call for different responses, so they are
    // reported apart.
    fixturesUnusable: pool.unusable,
    leaguesConsidered: pool.leagueIds,
    examined: built?.examined ?? 0,
    rejected: built?.rejected ?? {}
  };
}

/**
 * Build and persist THE Global Ticket for one date and variant.
 *
 * The chain is load -> collect -> rank -> diversify -> build -> RPC, with the
 * middle four inside buildGlobalSpecialBets, which is the engine's own
 * composition of exactly those steps in exactly that order. Reproducing them
 * here would be a second copy of the ordering to keep in step.
 *
 * Idempotent through the database: create_global_ticket owns the uniqueness
 * check and the transaction, so a double tap, a retry or two administrators
 * pressing at once converge on one row rather than racing to create several.
 *
 * @param {{ betDate: string, variant: number, betKind?: string, now?: number, supabase?: object }} params
 */
export async function generateGlobalTicket({
  betDate,
  variant,
  betKind = "combo",
  now = Date.now(),
  // Injectable so the orchestration is testable without a database; production
  // callers never pass it.
  supabase = getSupabaseAdmin()
}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  if (!isValidBetDate(betDate)) throw new Error("invalid_bet_date");
  if (!isValidVariant(variant)) throw new Error("invalid_variant");
  // Refused by name rather than coerced. The RPC can store a system ticket; the
  // builder that chooses its five legs is buildGlobalSystemBets, which this
  // increment does not wire up. Answering with a combo would be a silent
  // downgrade of the thing that was asked for.
  if (betKind !== "combo") throw new Error("unsupported_bet_kind");

  const { rows, payloadsByFixtureId, leagueIds, scanned, unusable } =
    await loadGlobalCandidatePayloads(supabase, now);

  const poolContext = { fixtures: rows.length, scanned, unusable, leagueIds };

  // Nothing carries the projection yet. Distinguished from a thin day on
  // purpose: one is answered by running the backfill, the other by waiting for
  // tomorrow's fixtures, and a caller that cannot tell them apart will do the
  // wrong one.
  if (rows.length === 0) {
    return unavailable({
      variant,
      poolState: GLOBAL_TICKET_POOL_STATES.NO_POPULATED_PREDICTIONS,
      candidatesAvailable: 0,
      built: null,
      pool: poolContext
    });
  }

  /*
    Fixtures the GLOBAL tickets already published for this day used. No userId:
    the product's ticket is narrowed by the product's other tickets and by
    nothing personal.
  */
  const excludeFixtureIds = await loadUsedFixtureIds(supabase, { betDate });

  const built = buildGlobalSpecialBets({ rows, leagueIds, now, excludeFixtureIds }, [Number(variant)]);
  const bet = built.bets[Number(variant)];

  if (!bet) {
    return unavailable({
      variant,
      poolState: GLOBAL_TICKET_POOL_STATES.INSUFFICIENT_CANDIDATES,
      candidatesAvailable: built.pool.length,
      built,
      pool: poolContext
    });
  }

  const { data, error } = await supabase.rpc("create_global_ticket", {
    p_bet_date: betDate,
    p_variant: Number(variant),
    p_total_odds: bet.totalOdds,
    p_average_confidence: bet.averageConfidence,
    p_model_version: resolveModelVersion(payloadsByFixtureId, bet.selections),
    // The engine's own selections, unchanged. toSelectionRows renames fields to
    // the column names; it does not reinterpret a value.
    p_selections: toSelectionRows(bet.selections),
    p_ticket_probability: bet.estimatedTicketProbability
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(`create_global_ticket: ${data?.error || "unknown_error"}`);

  return {
    ok: true,
    available: true,
    created: Boolean(data.created),
    poolState: GLOBAL_TICKET_POOL_STATES.OK,
    bet: data.bet,
    selections: data.selections || [],
    // As computed for a fresh ticket, as stored for a repeat — never a number
    // attributed to selections it was not computed from.
    estimatedTicketProbability: data.created
      ? bet.estimatedTicketProbability
      : data.bet?.ticket_probability != null
        ? Number(data.bet.ticket_probability)
        : null,
    candidatesAvailable: built.pool.length,
    fixturesConsidered: rows.length,
    fixturesScanned: scanned,
    fixturesUnusable: unusable,
    leaguesConsidered: leagueIds,
    examined: built.examined,
    rejected: built.rejected
  };
}

/**
 * The authorized entry point: administrator, or nothing happens.
 *
 * The check is FIRST and it is server-side. Not a hidden route, not a button the
 * UI declines to render — a non-admin caller is refused here, before a pool is
 * loaded, before the engine runs and before any statement that could write. The
 * `{ ok: false, status, error }` shape is authAdmin's, so an HTTP layer can
 * forward it without interpreting it.
 *
 * `req` is used for exactly one thing — the bearer token assertAdmin reads — and
 * nothing from it reaches generation. The parameters below come from the
 * caller's explicit arguments, and none of them can name a user or a league.
 *
 * @param {object} req the incoming request, for authorization only
 * @param {{ betDate: string, variant: number, betKind?: string, now?: number, supabase?: object }} params
 * @param {{ assertAdmin?: Function }} [deps] injectable authorization, for tests
 */
export async function generateGlobalTicketAsAdmin(req, params, deps = {}) {
  const admin = await (deps.assertAdmin || assertAdmin)(req);
  if (!admin.ok) return { ok: false, status: admin.status, error: admin.error };

  const result = await generateGlobalTicket(params);
  return { ...result, status: 200 };
}

/**
 * Read foundation for the surfaces that come next. Deliberately minimal: the one
 * query a Global Bets list needs, and nothing speculative.
 *
 * The DRAFT/PUBLISHED split is enforced by RLS (migration 068), not by this
 * function: an authenticated client sees a published GLOBAL ticket and matches
 * no policy at all for a draft. `includeDrafts` therefore only means anything
 * with a service-role client, which bypasses RLS — pass a user client and the
 * database returns published rows either way.
 *
 * Selections come back in ONE query keyed by bet id, not one query per ticket.
 *
 * @param {object} supabase
 * @param {{ includeDrafts?: boolean, limit?: number }} [options]
 */
export async function listGlobalTickets(supabase, { includeDrafts = false, limit = 50 } = {}) {
  let query = supabase
    .from(BETS_TABLE)
    .select("*")
    .eq("bet_type", "GLOBAL")
    .order("bet_date", { ascending: false })
    .limit(limit);
  if (!includeDrafts) query = query.not("published_at", "is", null);

  const { data: bets, error } = await query;
  if (error) throw error;
  if (!bets?.length) return [];

  const { data: selections, error: selectionError } = await supabase
    .from(SELECTIONS_TABLE)
    .select("*")
    .in("special_bet_id", bets.map((bet) => bet.id))
    .order("kickoff_at", { ascending: true });
  if (selectionError) throw selectionError;

  const byBetId = new Map();
  for (const selection of selections || []) {
    const list = byBetId.get(selection.special_bet_id);
    if (list) list.push(selection);
    else byBetId.set(selection.special_bet_id, [selection]);
  }

  return bets.map((bet) => ({ ...bet, selections: byBetId.get(bet.id) || [] }));
}

/**
 * Publish one GLOBAL ticket — the explicit release step.
 *
 * SEPARATE FROM CREATION ON PURPOSE. `create_global_ticket` writes
 * `published_at = NULL` and has no parameter that could set it, so nothing that
 * builds a ticket can also release it to users. This is the only path that
 * flips that bit, and it is service-role only.
 *
 * NO RLS CHANGE. 068 gives authenticated users a SELECT policy for published
 * GLOBAL rows and grants no INSERT or UPDATE policy at all, so a browser cannot
 * reach this column whatever it sends. The guard below is not the security
 * boundary — the absence of a write policy is; this is the correctness boundary.
 *
 * THREE THINGS ARE VERIFIED IN THE PREDICATE, NOT IN JAVASCRIPT:
 *   bet_type = 'GLOBAL'      a USER ticket has no publish step and must not
 *                            gain one through this path
 *   published_at IS NULL     re-publishing would move the timestamp and rewrite
 *                            when users were first shown the ticket
 *   id = the requested one
 *
 * A row failing any of them yields zero updated rows rather than an error, which
 * is why the result distinguishes them: the caller needs to tell "already
 * published" from "not a GLOBAL ticket" from "no such ticket", and an exception
 * would collapse all three.
 *
 * @param {object} supabase a service-role client
 * @param {string} betId
 * @param {{ now?: number }} [options]
 * @returns {Promise<{ok: boolean, reason?: string, bet?: object}>}
 */
export async function publishGlobalTicket(supabase, betId, { now = Date.now() } = {}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  if (!betId || typeof betId !== "string") return { ok: false, reason: "invalid_id" };

  const { data, error } = await supabase
    .from(BETS_TABLE)
    .update({ published_at: new Date(now).toISOString() })
    .eq("id", betId)
    .eq("bet_type", "GLOBAL")
    .is("published_at", null)
    .select("*");
  if (error) throw error;

  if (Array.isArray(data) && data.length > 0) return { ok: true, bet: data[0] };

  // Nothing matched. Read back to say WHY, so the UI can distinguish a
  // double-click from an attempt to publish something that is not a draft.
  const { data: existing, error: readError } = await supabase
    .from(BETS_TABLE)
    .select("id, bet_type, published_at")
    .eq("id", betId)
    .maybeSingle();
  if (readError) throw readError;

  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.bet_type !== "GLOBAL") return { ok: false, reason: "not_global" };
  if (existing.published_at) return { ok: false, reason: "already_published" };
  return { ok: false, reason: "not_updated" };
}

export default {
  loadGlobalCandidatePayloads,
  publishGlobalTicket,
  generateGlobalTicket,
  generateGlobalTicketAsAdmin,
  listGlobalTickets,
  GLOBAL_TICKET_POOL_STATES,
  GLOBAL_TICKET_SOURCE,
  GLOBAL_SPECIAL_BET_VARIANTS
};
