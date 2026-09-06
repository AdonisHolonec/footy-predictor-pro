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
import {
  buildGlobalSpecialBets,
  buildGlobalSystemBets,
  GLOBAL_SPECIAL_BET_VARIANTS,
  // SYSTEM_K_VALUES is deliberately not imported: nothing here iterates the k
  // values any more. The engine validates the single requested k.
  validateSystemShape
} from "./globalSpecialBetEngine.js";
import { BET_STATUS, settleGlobalSpecialBet, settleSelection } from "./globalSpecialBetSettlement.js";
import { rehydrateSettlementRow } from "./predictionsHistory.js";
import { calendarDateKeyEuropeBucharest } from "./fixtureCalendarDateKey.js";
import { loadUsedFixtureIds } from "./ticketFixtureUsage.js";

const HISTORY_TABLE = "predictions_history";
const DAY_MS = 24 * 60 * 60 * 1000;
const BETS_TABLE = "special_bets";
const SELECTIONS_TABLE = "special_bet_selections";

/** Bet dates are calendar days; fixtures are bucketed by UTC so the key is stable. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidVariant(variant) {
  return GLOBAL_SPECIAL_BET_VARIANTS.includes(Number(variant));
}

/**
 * The two products stored in `special_bets`, spelled as the `bet_kind` column spells them.
 *
 * Kept as its own list rather than derived from the variant, because the variant cannot
 * tell them apart: a Combo 5 and any stored System are both variant 5.
 */
export const GLOBAL_SPECIAL_BET_KINDS = ["combo", "system"];

export function isValidBetKind(betKind) {
  return GLOBAL_SPECIAL_BET_KINDS.includes(String(betKind));
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

/**
 * Engine candidate -> the row shape create_global_special_bet() expects.
 *
 * `fixture_label` and `league_name` are the readable snapshot (migration 048).
 * They are stored, not derived at read time, because the names a bet was built
 * from are part of what was bet — the display join that used to stand in for
 * them misses exactly on the old bets the history exists to show.
 *
 * A candidate the engine could not name sends null, never a placeholder: the UI
 * already falls back to the fixture id, and "? – ?" would read as data.
 */
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
    value_score: s.valueScore ?? null,
    fixture_label: s.fixtureLabel ?? null,
    league_name: s.leagueName ?? null,
    // The exact P(full win) the probability-first ranking used — never
    // confidence, never implied probability. Stored at the column's own
    // numeric(5,4) precision (migration 050).
    probability: s.probability ?? null
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
 * Defensive query ceiling, NOT a product rule: the pool is naturally bounded by
 * which upcoming fixtures actually have prediction rows in the user's leagues
 * (warm cron covers today; users generate the dates they browse). The cap only
 * protects the query if that assumption ever breaks. Ordered by kickoff, so if
 * it is ever hit the nearest fixtures win.
 */
export const CANDIDATE_POOL_LIMIT = 500;

/**
 * Canonical prediction payloads for the user's MULTI-DAY upcoming pool.
 *
 * Reads `raw_payload` — the prediction of record, frozen at kickoff — rather
 * than recomputing anything.
 *
 * The pool is every fixture that (a) has a prediction row, (b) is in the given
 * leagues, and (c) has not kicked off yet — regardless of calendar day. The
 * previous behaviour sliced one Europe/Bucharest day around `bet_date`;
 * `bet_date` is now generation metadata only (idempotency key + audit), it no
 * longer filters candidates. Live and finished fixtures never enter: the query
 * excludes them here and collectGlobalCandidates rejects them again
 * (`alreadyStarted`) as a second, independent gate.
 *
 * One row per fixture: `payloadsByFixtureId` is the authority and `rows` is
 * derived from it, so a duplicate history row can never seed two candidates.
 */
export async function loadCandidatePayloads(supabase, leagueIds, now = Date.now()) {
  const nowIso = new Date(now).toISOString();

  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select("fixture_id, league_id, league_name, kickoff_at, raw_payload")
    .in("league_id", leagueIds)
    .gt("kickoff_at", nowIso)
    .order("kickoff_at", { ascending: true })
    .limit(CANDIDATE_POOL_LIMIT);
  if (error) throw error;

  const payloadsByFixtureId = new Map();
  for (const row of data || []) {
    const fixtureId = Number(row?.fixture_id);
    if (!Number.isFinite(fixtureId) || payloadsByFixtureId.has(fixtureId)) continue;

    const payload = row?.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : null;
    if (!payload) continue;
    // The columns win over the payload for identity fields: they are what the
    // query matched on, and legacy payloads predate some of them.
    const normalized = {
      ...payload,
      id: payload.id ?? row.fixture_id,
      leagueId: payload.leagueId ?? row.league_id,
      kickoff: payload.kickoff ?? row.kickoff_at,
      // Same precedence /api/history uses for this field, minus its "Necunoscut"
      // fallback: an unnamed league stays unnamed rather than being stored under
      // a word that looks like a name.
      league: row.league_name ?? payload.league ?? null
    };
    payloadsByFixtureId.set(fixtureId, normalized);
  }

  return { rows: [...payloadsByFixtureId.values()], payloadsByFixtureId };
}

/**
 * The consumer page size for published Global Bets. Bounded server-side: the
 * client may ask for fewer, never for more, and never for "all".
 */
export const PUBLISHED_GLOBAL_PAGE_SIZE = 20;
const PUBLISHED_GLOBAL_MAX_PAGE = 50;

/**
 * How many calendar days the consumer's "recent" window spans, INCLUSIVE of
 * the current business day. Seven means today plus the previous six.
 */
export const CONSUMER_HISTORY_WINDOW_DAYS = 7;

/**
 * The oldest `bet_date` still inside the consumer's recent window, as
 * YYYY-MM-DD.
 *
 * ── CALENDAR DAYS, NOT 168 HOURS ─────────────────────────────────────────────
 * `bet_date` is a Postgres `date` (migration 043), so this is date-to-date
 * arithmetic and a rolling timestamp window would be the wrong shape entirely:
 * a ticket does not become older at 14:00 than it was at 09:00 on the same day.
 * The business day comes from `calendarDateKeyEuropeBucharest`, the same helper
 * that decides `bet_date` everywhere else, so the boundary a consumer sees is
 * the boundary generation used.
 *
 * The subtraction runs on UTC midnight of that already-resolved date string,
 * in exact 24h multiples. That is deliberate and is NOT a timezone bug: both
 * ends are plain calendar dates by this point, so stepping back six UTC days
 * from "2026-09-06" yields "2026-08-31" whatever Bucharest's offset is doing.
 * Doing the arithmetic in local time is what would break across a DST change.
 */
export function consumerHistoryWindowStart(now = Date.now()) {
  const today = calendarDateKeyEuropeBucharest(new Date(now).toISOString());
  if (!today) return null;
  const base = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(base)) return null;
  return new Date(base - (CONSUMER_HISTORY_WINDOW_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Published GLOBAL tickets, for any authenticated consumer.
 *
 * ── WHY THIS IS NOT listGlobalSpecialBets ────────────────────────────────────
 * That function is the USER path and filters `.eq("user_id", userId)`. A GLOBAL
 * row carries `user_id = NULL`, so it can never match — the existing read is
 * structurally incapable of returning one, whatever else is passed to it.
 * Widening it would have meant making ownership optional on the one query whose
 * whole job is enforcing ownership, so this is a separate function and the USER
 * read is untouched.
 *
 * ── THE TWO PREDICATES ARE NOT PARAMETERS ────────────────────────────────────
 * `bet_type = 'GLOBAL'` and `published_at IS NOT NULL` are written here, not
 * accepted from a caller. A consumer cannot ask for a draft, cannot ask for a
 * USER row, and cannot ask on somebody's behalf, because none of those is
 * expressible. RLS (migration 068) is the second lock and would refuse a draft
 * even if this query asked for one; this is the first.
 *
 * The snapshot is authoritative: selections come from `special_bet_selections`
 * as stored, never re-derived from predictions_history, and nothing here reads
 * raw_payload, hydration_payload or ticket_candidates.
 *
 * ── THE HISTORY WINDOW ───────────────────────────────────────────────────────
 * Recent tickets show at every status; older ones show only if they WON. The
 * cut is `consumerHistoryWindowStart`, and the rule is enforced in Postgres,
 * before the page is cut — see the `.or()` below for why that matters.
 *
 * Two queries, never N+1: one page of tickets, then their legs in one `.in()`.
 */
export async function listPublishedGlobalBets({
  limit = PUBLISHED_GLOBAL_PAGE_SIZE,
  offset = 0,
  now = Date.now(),
  supabase = getSupabaseAdmin()
} = {}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");

  const safeLimit = Math.max(1, Math.min(Number(limit) || PUBLISHED_GLOBAL_PAGE_SIZE, PUBLISHED_GLOBAL_MAX_PAGE));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const windowStart = consumerHistoryWindowStart(now);

  let query = supabase
    .from(BETS_TABLE)
    .select("*")
    .eq("bet_type", "GLOBAL")
    .not("published_at", "is", null);

  /*
    "recent, OR old but won" — as ONE predicate, and that is not a shortcut.

    Written out, the product rule is `R ∨ (¬R ∧ W)` where R is "inside the
    window" and W is "won". Absorption collapses that to `R ∨ W`: an old loser
    fails both sides, an old winner passes on W, and anything recent passes on R
    whatever its status. The two forms accept exactly the same rows, so the
    shorter one is used and the longer one is what the tests assert in terms of.

    It runs in the DATABASE, before .range(). Filtering after the page is cut is
    the failure this avoids: fetch twenty old tickets, drop nineteen losers in
    JS, hand back one — while qualifying winners sit unread on the next page.
    Here the page is twenty QUALIFYING rows or it is the end of the list.

    `windowStart` is null only if the clock is unreadable. The filter is then
    dropped rather than guessed at: showing a recent ticket that should have
    been hidden is a display quirk, hiding a winner is losing the record.
  */
  if (windowStart) {
    query = query.or(`bet_date.gte.${windowStart},status.eq.${BET_STATUS.WON}`);
  }

  const { data: bets, error } = await query
    .order("bet_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);
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

/**
 * The UTC instants that safely bracket one Europe/Bucharest calendar day.
 *
 * Deliberately a SUPERSET, not the exact boundary: Bucharest runs UTC+2 in
 * winter and UTC+3 in summer, so its day D begins at 21:00Z or 22:00Z on D-1.
 * One UTC day of slack either side covers both offsets and every DST
 * transition. The database only narrows the scan; which day a kickoff belongs
 * to is decided by `calendarDateKeyEuropeBucharest`, the same helper the rest
 * of the app uses for `bet_date`.
 */
export function betDateScanWindow(betDate) {
  const base = Date.parse(`${betDate}T00:00:00.000Z`);
  if (!Number.isFinite(base)) return null;
  return { from: new Date(base - DAY_MS).toISOString(), to: new Date(base + DAY_MS).toISOString() };
}

/**
 * Every fixture (any status) of the selected leagues on the `bet_date`
 * calendar day — kick-off instants and league names only. Read-only, and the
 * only place the generation looks at fixtures that have already kicked off:
 * `loadCandidatePayloads` excludes those in its query, so the engine never
 * sees them and `rejected.alreadyStarted` cannot say which league lost its day.
 */
export async function loadBetDateFixtures(supabase, leagueIds, betDate) {
  const window = betDateScanWindow(betDate);
  if (!window || !leagueIds?.length) return [];
  const { data, error } = await supabase
    .from(HISTORY_TABLE)
    .select("fixture_id, league_id, league_name, kickoff_at")
    .in("league_id", leagueIds)
    .gte("kickoff_at", window.from)
    .lte("kickoff_at", window.to);
  if (error) throw error;
  return (data || []).filter((row) => calendarDateKeyEuropeBucharest(row?.kickoff_at) === betDate);
}

/**
 * Which selected leagues fed the pool, and — for the ones that did not —
 * whether the calendar day simply ran out. The temporal verdict needs all of:
 * selected · zero eligible candidates · ≥1 fixture of `bet_date` already
 * kicked off · zero fixtures of `bet_date` still to come. A league with a later
 * kick-off today, or with no fixture today at all, or whose upcoming fixtures
 * fell at another gate, is listed under `noEligibleLeagueIds` only — the UI
 * must never blame kick-off time without this proof.
 *
 * Names come from what is already in hand (pool candidates, the day's rows);
 * a league with no name resolved is simply absent from `names`.
 *
 * @returns {{ selectedLeagueIds: number[], eligibleLeagueIds: number[], noEligibleLeagueIds: number[],
 *             noEligibleBecauseAlreadyStartedLeagueIds: number[], names: Record<number, string> }}
 */
export function summarizeLeagueCoverage({ selectedLeagueIds, pool, dayFixtures, now }) {
  const selected = [...new Set((selectedLeagueIds || []).map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
  const eligible = new Set((pool || []).map((c) => Number(c?.leagueId)).filter(Number.isFinite));
  const started = new Set();
  const upcoming = new Set();
  const names = {};
  for (const c of pool || []) if (c?.leagueName && Number.isFinite(Number(c.leagueId))) names[Number(c.leagueId)] = String(c.leagueName);
  for (const row of dayFixtures || []) {
    const id = Number(row?.league_id);
    const ko = Date.parse(row?.kickoff_at ?? "");
    if (!Number.isFinite(id) || !Number.isFinite(ko)) continue;
    (ko <= now ? started : upcoming).add(id);
    if (row?.league_name && !names[id]) names[id] = String(row.league_name);
  }
  const eligibleLeagueIds = selected.filter((id) => eligible.has(id));
  const noEligibleLeagueIds = selected.filter((id) => !eligible.has(id));
  const noEligibleBecauseAlreadyStartedLeagueIds = noEligibleLeagueIds.filter((id) => started.has(id) && !upcoming.has(id));
  const keptNames = {};
  for (const id of selected) if (names[id]) keptNames[id] = names[id];
  return { selectedLeagueIds: selected, eligibleLeagueIds, noEligibleLeagueIds, noEligibleBecauseAlreadyStartedLeagueIds, names: keptNames };
}

async function buildLeagueSummary(supabase, selectedLeagueIds, betDate, pool, now) {
  const dayFixtures = await loadBetDateFixtures(supabase, selectedLeagueIds, betDate);
  return summarizeLeagueCoverage({ selectedLeagueIds, pool, dayFixtures, now });
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
  // bet_date is generation metadata + the idempotency key — the pool itself is
  // every upcoming fixture the user has predictions for, regardless of day.
  const { rows, payloadsByFixtureId } = await loadCandidatePayloads(supabase, canonicalLeagues, now);

  /*
    Fixtures this user's OTHER tickets for the same day already used. Scoped to
    them alone: another user's ticket can never narrow this pool, and a GLOBAL
    ticket can never narrow it either.
  */
  const excludeFixtureIds = await loadUsedFixtureIds(supabase, { betDate, userId });

  const built = buildGlobalSpecialBets(
    { rows, leagueIds: canonicalLeagues, now, excludeFixtureIds },
    [Number(variant)]
  );
  const bet = built.bets[Number(variant)];
  // Additive: which selected leagues fed the pool and which ran out of day.
  const leagueSummary = await buildLeagueSummary(supabase, canonicalLeagues, betDate, built.pool, now);

  // Not enough SAFE selections: say so, write nothing, and say WHY the pool is
  // thin — the rejection counters are what lets the UI explain "doar 6 selecții
  // îndeplinesc criteriile de siguranță" instead of a bare unavailable.
  if (!bet) {
    return {
      ok: true,
      created: false,
      ...unavailableResponse(variant, built.pool.length),
      examined: built.examined,
      rejected: built.rejected,
      leagueSummary
    };
  }

  const { data, error } = await supabase.rpc("create_global_special_bet", {
    p_user_id: userId,
    p_bet_date: betDate,
    p_variant: Number(variant),
    p_league_ids: canonicalLeagues,
    p_total_odds: bet.totalOdds,
    p_average_confidence: bet.averageConfidence,
    p_model_version: resolveModelVersion(payloadsByFixtureId, bet.selections),
    p_selections: toSelectionRows(bet.selections),
    // Π p_i exactly as the engine computed it (4 decimals) — migration 050.
    p_ticket_probability: bet.estimatedTicketProbability
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(`create_global_special_bet: ${data?.error || "unknown_error"}`);

  return {
    ok: true,
    available: true,
    created: Boolean(data.created),
    bet: data.bet,
    selections: data.selections || [],
    // Π P(full win) under the independence assumption the UI must disclaim.
    // For a bet created by THIS request it is the engine's own product; for a
    // repeat request it is what migration 050 stored with the bet — never a
    // freshly computed number attributed to selections it was not computed
    // from. Legacy bets stored before 050 answer null honestly.
    estimatedTicketProbability: data.created
      ? bet.estimatedTicketProbability
      : data.bet?.ticket_probability != null
        ? Number(data.bet.ticket_probability)
        : null,
    examined: built.examined,
    rejected: built.rejected,
    leagueSummary
  };
}

/**
 * Generate (or return) THE System ticket for one user/date/league scope.
 *
 * ONE POOL, ONE BUILD, ONE ROW. The five legs are chosen once and written at the
 * k the caller supplied. The public product fixes that at 3 — in the API layer,
 * not here — so what ships is Bilet Sistem 3/5 and nothing else.
 *
 * This once wrote three rows from one pool, one per k, which turned a single
 * five-leg opinion into three stored tickets and three stakes. 4/5 and 5/5 are
 * not other tickets: they are what a 3/5 DOES when four or five of its legs
 * land, and settlement already says so through the combinations that won.
 *
 * Everything below the build is the Combo path, reused rather than rebuilt:
 * canonicalizeLeagueScope, loadCandidatePayloads, resolveModelVersion,
 * toSelectionRows and the same RPC. The only additions are the two parameters
 * migration 052 already provides.
 *
 * `total_odds` carries the PRODUCT of the five odds, the schema's existing
 * required field. It is not the ticket's payout — that is derived at settlement,
 * from the combinations that actually won — and no surface may present it as
 * one.
 *
 * `ticket_probability` is P(X >= k), never Πp. The engine computed it in
 * toSystemBet through the single Poisson-binomial implementation; nothing is
 * recalculated here.
 *
 * @param {{ userId: string, betDate: string, leagueIds: number[], systemK: number,
 *           now?: number, supabase?: object }} params
 */
export async function createGlobalSystemBets({
  userId,
  betDate,
  leagueIds,
  systemK,
  now = Date.now(),
  supabase = getSupabaseAdmin()
}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");

  const { leagueIds: canonicalLeagues } = canonicalizeLeagueScope(leagueIds);
  const { rows, payloadsByFixtureId } = await loadCandidatePayloads(supabase, canonicalLeagues, now);

  /*
    THE SAME EXCLUSION THE COMBO PATH USES — same function, same scope, and no
    `bet_kind` filter. That absence is the point: one user's day is one budget
    of fixtures, so a System avoids what their combos took and their combos
    avoid what the System took. Whichever product the user builds first no
    longer owns the pool.

    The scope is (userId, betDate, USER) and deliberately NOT the ticket's
    uniqueness key: `league_scope` belongs to that key, so two Systems on one
    day under different league selections are two rows — and they must still
    exclude each other, which they only do while the scope ignores the league.

    GLOBAL tickets, other users and other dates cannot enter: the query filters
    user_id, bet_type and bet_date, and a GLOBAL row carries user_id = NULL.
  */
  const excludeFixtureIds = await loadUsedFixtureIds(supabase, { betDate, userId });
  const built = buildGlobalSystemBets({
    rows,
    leagueIds: canonicalLeagues,
    now,
    systemK,
    excludeFixtureIds
  });
  const leagueSummary = await buildLeagueSummary(supabase, canonicalLeagues, betDate, built.pool, now);

  // Nothing to write: either the requested k is not a shape the product sells,
  // or fewer than five safe candidates survived the gates. Both answers carry
  // their reason, and neither pads, relaxes a gate or duplicates a fixture.
  if (!built.bet) {
    return {
      ok: true,
      created: false,
      available: false,
      unavailable: built.unavailable,
      examined: built.examined,
      rejected: built.rejected,
      leagueSummary
    };
  }

  const modelVersion = resolveModelVersion(payloadsByFixtureId, built.selections);
  const bet = built.bet;

  // The application refuses a malformed ticket BEFORE the RPC — now against the
  // selections that will actually be written, not a placeholder count. The CHECK
  // constraints in 052 are the second lock, not the first: a database error is a
  // worse diagnosis than a named reason, and relying on it would mean the only
  // description of the product contract lived in SQL.
  const shape = validateSystemShape({ selections: bet.selections, systemK: bet.systemK });
  if (!shape.valid) {
    throw new Error(
      `refusing to persist a system ticket: ${shape.reason} ` +
        `(selections=${shape.selectionCount}, system_k=${bet.systemK})`
    );
  }

  // EXACTLY ONE ROW. This used to loop over SYSTEM_K_VALUES and issue three
  // RPCs, turning one five-leg opinion into three stored tickets and three
  // stakes. One invocation, one k, one ticket.
  const { data, error } = await supabase.rpc("create_global_special_bet", {
    p_user_id: userId,
    p_bet_date: betDate,
    p_variant: bet.variant,
    p_league_ids: canonicalLeagues,
    // The product of the five odds — the schema's field, not the system payout.
    p_total_odds: bet.productOdds,
    p_average_confidence: bet.averageConfidence,
    p_model_version: modelVersion,
    p_selections: toSelectionRows(bet.selections),
    // P(X >= k) from the Poisson-binomial tail, never the product.
    p_ticket_probability: bet.estimatedTicketProbability,
    p_bet_kind: "system",
    p_system_k: bet.systemK
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(`create_global_special_bet: ${data?.error || "unknown_error"}`);

  return {
    ok: true,
    available: true,
    created: Boolean(data.created),
    bet: data.bet,
    // Same shape createGlobalSpecialBet returns, so the HTTP layer can answer
    // for both products without knowing which one it just built: `selections`
    // is what the database stored. The engine's own five legs are kept beside
    // it under a name that says so — they answer a different question (what was
    // chosen, with probabilities) and collapsing the two would make an empty
    // echo look like an empty ticket.
    selections: data.selections || [],
    engineSelections: built.selections,
    systemK: bet.systemK,
    combinationCount: shape.combinationCount,
    // As stored for a repeat request, as computed for a fresh one — never a
    // number attributed to selections it was not computed from.
    ticketProbability: data.created
      ? bet.estimatedTicketProbability
      : data.bet?.ticket_probability != null
        ? Number(data.bet.ticket_probability)
        : null,
    examined: built.examined,
    rejected: built.rejected,
    leagueSummary
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
  betKind,
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
  // Variant does NOT imply kind: a Combo 5 and any stored System both carry
  // variant 5, so filtering on variant alone returns Combos and Systems under one
  // heading. `bet_kind` is the only thing that separates them, and it is optional
  // so a caller asking for everything still gets everything.
  //
  // Stored shapes are wider than the public product on purpose: the column holds
  // system_k 3, 4 or 5 (migration 054), while the only System on sale is 3/5.
  // There is no system_k filter here — narrowing the list by a threshold nobody
  // can choose would be answering a question the product does not ask.
  if (betKind !== undefined && betKind !== null && betKind !== "") query = query.eq("bet_kind", String(betKind));
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

/**
 * Columns settlement reads for a fixture. The totals are the PROMOTED columns
 * (migration 057) — the history sync writes them and no longer guarantees
 * `raw_payload.marketResults`. The legacy document is read only as a JSON path
 * (`raw_payload->marketResults`), never the 353 KB document, and only to cover
 * rows written before 057 that were never backfilled.
 */
export const FIXTURE_STATE_SELECT =
  "fixture_id, match_status, score_home, score_away, " +
  "corners_total, shots_total, shots_on_target_total, " +
  "legacy_market_results:raw_payload->marketResults";

/** The totals a selection can settle against, in the key names settlement reads. */
const TOTAL_KEYS = Object.freeze(["cornersTotal", "shotsTotal", "shotsOnTargetTotal"]);

/**
 * One fixture's settlement state from a `FIXTURE_STATE_SELECT` row.
 *
 * Source of truth is the promoted columns, mapped by `rehydrateSettlementRow` —
 * the same function the history sync's own settlement pass uses, so a total
 * means exactly one thing across both paths. Per key:
 *
 *   promoted present          → promoted (legacy ignored, even when it differs)
 *   promoted NULL, legacy set → legacy `raw_payload.marketResults` (pre-057 row)
 *   both absent               → key absent; the leg stays ungraded
 *
 * NULL is never coerced: a statistic the provider did not publish stays missing
 * and the selection stays pending (then voids at 48h), exactly as before.
 */
export function fixtureStateFromRow(row) {
  const promoted = rehydrateSettlementRow(row).raw_payload.marketResults || {};
  const legacy =
    row?.legacy_market_results && typeof row.legacy_market_results === "object"
      ? row.legacy_market_results
      : {};
  const marketTotals = {};
  for (const key of TOTAL_KEYS) {
    const value = promoted[key] != null ? promoted[key] : legacy[key];
    if (value != null) marketTotals[key] = value;
  }
  return {
    status: row?.match_status ?? null,
    score: { home: row?.score_home ?? null, away: row?.score_away ?? null },
    marketTotals
  };
}

/**
 * Fixture state for the selections of the bets being settled: status, score and
 * the official totals, keyed by fixture id. One query for all fixtures, as before.
 */
export async function loadFixtureStates(supabase, fixtureIds) {
  const ids = [...new Set((fixtureIds || []).map((id) => Number(id)))].filter(Number.isFinite);
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase.from(HISTORY_TABLE).select(FIXTURE_STATE_SELECT).in("fixture_id", ids);
  if (error) throw error;

  const byFixtureId = new Map();
  for (const row of data || []) {
    byFixtureId.set(Number(row.fixture_id), fixtureStateFromRow(row));
  }
  return byFixtureId;
}

/**
 * Write a settled bet, refusing to call a write that touched nothing a success.
 *
 * With RLS enabled and no UPDATE policy, Postgres does not raise — the statement
 * succeeds having matched zero rows (proven in the 2.1 integration suite). So
 * "no error" is not evidence of anything; every update asks for its rows back
 * and compares the count against what it intended to change.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
/**
 * Write a set of selection status changes for one bet, exactly as many rows
 * as intended. Shared by the bet settlement below and by the re-grade of legs
 * left pending on tickets that already reached their verdict.
 *
 * @returns {{ ok: boolean, error?: string }}
 */
export async function persistSelectionChanges(supabase, betId, selectionChanges, now) {
  const settledAt = new Date(now).toISOString();

  // Selections grouped by target status: one statement per status, still exact
  // about how many rows each is allowed to move.
  const byStatus = new Map();
  for (const change of selectionChanges) {
    if (!byStatus.has(change.status)) byStatus.set(change.status, []);
    byStatus.get(change.status).push(change.id);
  }

  for (const [status, ids] of byStatus) {
    const isTerminal = status !== "pending";
    const { data, error } = await supabase
      .from(SELECTIONS_TABLE)
      .update({ status, settled_at: isTerminal ? settledAt : null })
      .in("id", ids)
      .select("id");
    if (error) return { ok: false, error: `selections update failed: ${error.message}` };

    const affected = (data || []).length;
    if (affected !== ids.length) {
      return {
        ok: false,
        error:
          `selections update touched ${affected} of ${ids.length} rows for status "${status}" ` +
          `on bet ${betId} — refusing to report success (check the Supabase role and RLS policies)`
      };
    }
  }
  return { ok: true };
}

export async function persistSettledBet(supabase, bet, settlement, now) {
  const settledAt = new Date(now).toISOString();

  const legs = await persistSelectionChanges(supabase, bet.id, settlement.selectionChanges, now);
  if (!legs.ok) return legs;

  const { data, error } = await supabase
    .from(BETS_TABLE)
    .update({
      status: settlement.betStatus,
      settled_total_odds: settlement.settledTotalOdds,
      settled_at: settlement.isTerminal ? settledAt : null
    })
    .eq("id", bet.id)
    .select("id");
  if (error) return { ok: false, error: `bet update failed: ${error.message}` };

  const affected = (data || []).length;
  if (affected !== 1) {
    return {
      ok: false,
      error: `bet update touched ${affected} rows for bet ${bet.id} — refusing to report success`
    };
  }

  return { ok: true };
}

/**
 * Settle every bet that is still pending.
 *
 * Idempotent: a bet whose computed end state already matches what is stored
 * issues no write at all, so a cron that runs twice produces the same rows and
 * the same `settled_at`.
 *
 * @param {{ now?: number, limit?: number, supabase?: object }} params
 */
export async function settlePendingGlobalSpecialBets({
  now = Date.now(),
  limit = 200,
  supabase = getSupabaseAdmin()
} = {}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");

  const summary = { scanned: 0, settled: 0, unchanged: 0, failures: [] };

  const { data: bets, error } = await supabase
    .from(BETS_TABLE)
    // bet_kind and system_k decide WHICH grader answers for the ticket. They are
    // read, never written here: creating a system bet is still refused by
    // create_global_special_bet (migration 052, `system_not_enabled`). This
    // layer only has to know how to settle one that already exists.
    .select("id, status, settled_total_odds, bet_kind, system_k")
    .eq("status", "pending")
    .order("bet_date", { ascending: true })
    .limit(Math.max(1, Math.min(Number(limit) || 200, 1000)));
  if (error) throw error;
  if (!bets?.length) {
    // No ticket to settle — legs left behind on already-settled tickets still get their grade.
    return mergeRegrade(summary, await regradeLegsOnSettledBets({ now, supabase }));
  }

  summary.scanned = bets.length;

  const { data: selections, error: selError } = await supabase
    .from(SELECTIONS_TABLE)
    .select("id, special_bet_id, fixture_id, market, selection, side, line, odds, status, kickoff_at")
    .in(
      "special_bet_id",
      bets.map((b) => b.id)
    );
  if (selError) throw selError;

  const byBetId = new Map();
  for (const selection of selections || []) {
    if (!byBetId.has(selection.special_bet_id)) byBetId.set(selection.special_bet_id, []);
    byBetId.get(selection.special_bet_id).push(selection);
  }

  const fixturesById = await loadFixtureStates(
    supabase,
    (selections || []).map((s) => s.fixture_id)
  );

  for (const bet of bets) {
    const betSelections = byBetId.get(bet.id) || [];
    if (betSelections.length === 0) {
      summary.unchanged += 1;
      continue;
    }

    const settlement = settleGlobalSpecialBet({ bet, selections: betSelections, fixturesById, now });
    // A ticket the grader refuses to settle — today only a system row whose k is
    // missing or out of range. It writes nothing and stays pending, but it is
    // reported rather than counted as "unchanged", because silence here would
    // hide a corrupt row for as long as the cron keeps running.
    if (settlement.error) {
      console.error("[global-special-bet-settlement]", settlement.error);
      summary.failures.push({ betId: bet.id, error: settlement.error });
      continue;
    }
    if (!settlement.changed) {
      summary.unchanged += 1;
      continue;
    }

    const written = await persistSettledBet(supabase, bet, settlement, now);
    if (written.ok) {
      summary.settled += 1;
    } else {
      console.error("[global-special-bet-settlement]", written.error);
      summary.failures.push({ betId: bet.id, error: written.error });
    }
  }

  return mergeRegrade(summary, await regradeLegsOnSettledBets({ now, supabase }));
}

function mergeRegrade(summary, regrade) {
  return {
    ...summary,
    legsRegraded: regrade.regraded,
    legsRegradeScanned: regrade.scanned,
    failures: [...summary.failures, ...regrade.failures]
  };
}

/**
 * Grade the legs a verdict left behind.
 *
 * A combo is LOST the moment one leg loses, and a system the moment too few
 * legs can still reach k — before its other legs have finished. The ticket's
 * verdict is final and correct, but those legs stayed `pending` forever,
 * because settlement only ever scans PENDING tickets. This pass scans the
 * other way round: pending LEGS whose ticket is no longer pending, grades each
 * one with the same `settleSelection` and the same fixture state, and writes
 * only the selection rows. The ticket row is never touched — nothing here can
 * change a verdict, a settled price or a `settled_at`.
 *
 * Idempotent and bounded: a leg whose computed status matches what is stored
 * issues no write; the 48-hour void applies exactly as it does for live tickets.
 *
 * @param {{ now?: number, limit?: number, supabase?: object }} params
 * @returns {Promise<{ scanned: number, regraded: number, failures: Array<{ betId: string, error: string }> }>}
 */
export async function regradeLegsOnSettledBets({ now = Date.now(), limit = 500, supabase = getSupabaseAdmin() } = {}) {
  if (!supabase) throw new Error("Clientul Supabase nu este disponibil.");
  const result = { scanned: 0, regraded: 0, failures: [] };

  // PostgREST inner join on the parent: only legs whose ticket already has a verdict.
  const { data: legs, error } = await supabase
    .from(SELECTIONS_TABLE)
    .select("id, special_bet_id, fixture_id, market, selection, side, line, odds, status, kickoff_at, special_bets!inner(id, status)")
    .eq("status", "pending")
    .neq("special_bets.status", "pending")
    .limit(Math.max(1, Math.min(Number(limit) || 500, 2000)));
  if (error) throw error;
  if (!legs?.length) return result;

  result.scanned = legs.length;
  const fixturesById = await loadFixtureStates(
    supabase,
    legs.map((leg) => leg.fixture_id)
  );

  const byBetId = new Map();
  for (const leg of legs) {
    const fixture = fixturesById.get(Number(leg.fixture_id)) ?? { status: "", score: {}, marketTotals: {} };
    const status = settleSelection(leg, fixture, now);
    if (status === leg.status) continue;
    if (!byBetId.has(leg.special_bet_id)) byBetId.set(leg.special_bet_id, []);
    byBetId.get(leg.special_bet_id).push({ id: leg.id, status });
  }

  for (const [betId, changes] of byBetId) {
    const written = await persistSelectionChanges(supabase, betId, changes, now);
    if (written.ok) {
      result.regraded += changes.length;
    } else {
      console.error("[global-special-bet-regrade]", written.error);
      result.failures.push({ betId, error: written.error });
    }
  }
  return result;
}

export default {
  canonicalizeLeagueScope,
  createGlobalSpecialBet,
  createGlobalSystemBets,
  fixtureStateFromRow,
  loadFixtureStates,
  persistSelectionChanges,
  persistSettledBet,
  regradeLegsOnSettledBets,
  settlePendingGlobalSpecialBets,
  isValidBetDate,
  isValidVariant,
  listGlobalSpecialBets,
  loadCandidatePayloads,
  resolveModelVersion,
  toSelectionRows,
  unavailableResponse
};
