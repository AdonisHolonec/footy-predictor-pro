import { assertAdmin } from "./authAdmin.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import {
  GLOBAL_TICKET_POOL_STATES,
  generateGlobalTicket,
  listGlobalTickets,
  publishGlobalTicket
} from "./globalTicketService.js";
import { GLOBAL_SPECIAL_BET_VARIANTS } from "./globalSpecialBetEngine.js";

/**
 * Admin HTTP surface for Global Tickets — the FIRST production caller of the
 * Global Ticket backend.
 *
 * ── WHY THIS RIDES ON /api/admin ─────────────────────────────────────────────
 * Not a preference. The api/ directory sits at exactly the Hobby plan's twelve
 * serverless functions, and a thirteenth file fails at DEPLOY, after merge, with
 * `exceeded_serverless_functions_per_deployment` — which is why
 * tests/vercelFunctionBudget.test.js exists at all. The inbox and referral-admin
 * views are here for precisely the same reason, and this follows them.
 *
 * ── EVERY PATH STARTS WITH assertAdmin ───────────────────────────────────────
 * Frontend visibility is NOT the security boundary. A non-admin reaching this
 * module by URL is refused before a candidate pool is loaded, before the engine
 * runs, and before any statement that could write. The `{ok:false,status,error}`
 * shape is authAdmin's, forwarded rather than reinterpreted.
 *
 * ── WHAT THE BROWSER MAY DECIDE ──────────────────────────────────────────────
 * The variant, and optionally which date to (re)generate. Nothing else. Not the
 * leagues, not a user, not which predictions are eligible, not the selections.
 * Those come from loadGlobalCandidatePayloads, which has no parameter capable of
 * expressing a narrowing — a client that POSTs `leagueIds` is ignored because
 * nothing reads it. That is the point of the 2B-i design, and this layer must
 * not reintroduce what it removed.
 *
 * ── WHAT GOES BACK OVER THE WIRE ─────────────────────────────────────────────
 * Ticket scalars and the stored selection snapshot, through an explicit field
 * list. NEVER `raw_payload`, never `ticket_candidates`, never the candidate
 * pool: a generate response echoing the examined markets would ship megabytes to
 * a browser rendering at most eight legs. The `rejected` counters are counts,
 * not payloads, and they are what lets the UI explain a thin pool honestly.
 */

/** Bounded by default: the admin list is a working view, not an archive. */
export const GLOBAL_TICKET_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

/** The variants 2B-i actually builds. System tickets are deliberately absent. */
export const ADMIN_GLOBAL_VARIANTS = GLOBAL_SPECIAL_BET_VARIANTS;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored ticket -> the shape the admin UI renders.
 *
 * An explicit field list rather than the row: it documents what the client is
 * allowed to see, and it means a future column cannot reach the browser merely
 * by coming into existence.
 */
function toTicketView(bet) {
  return {
    id: bet.id,
    betDate: bet.bet_date,
    variant: bet.variant,
    betKind: bet.bet_kind,
    systemK: bet.system_k ?? null,
    status: bet.status,
    betType: bet.bet_type,
    betSource: bet.bet_source,
    publishedAt: bet.published_at ?? null,
    createdAt: bet.created_at ?? null,
    settledAt: bet.settled_at ?? null,
    totalOdds: bet.total_odds != null ? Number(bet.total_odds) : null,
    averageConfidence: bet.average_confidence != null ? Number(bet.average_confidence) : null,
    ticketProbability: bet.ticket_probability != null ? Number(bet.ticket_probability) : null,
    modelVersion: bet.model_version ?? null,
    selections: (bet.selections || []).map((s) => ({
      id: s.id,
      fixtureId: s.fixture_id,
      leagueId: s.league_id,
      kickoffAt: s.kickoff_at,
      market: s.market,
      selection: s.selection,
      side: s.side ?? null,
      line: s.line != null ? Number(s.line) : null,
      odds: s.odds != null ? Number(s.odds) : null,
      confidence: s.confidence != null ? Number(s.confidence) : null,
      probability: s.probability != null ? Number(s.probability) : null,
      fixtureLabel: s.fixture_label ?? null,
      leagueName: s.league_name ?? null,
      status: s.status ?? null
    }))
  };
}

/**
 * Today in Europe/Bucharest, the default bet_date.
 *
 * The SERVER picks it, not the browser: bet_date is half the idempotency key,
 * and a client with a skewed clock or another timezone would otherwise be able
 * to create a second ticket for what is really the same day.
 */
export function defaultBetDate(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(now));
}

/** GET — the bounded admin list, drafts included. */
async function listHandler(req, res, supabase) {
  const requested = Number(req.query?.limit);
  const limit =
    Number.isInteger(requested) && requested > 0 ? Math.min(requested, MAX_LIST_LIMIT) : GLOBAL_TICKET_LIST_LIMIT;

  // Drafts are admin-only by construction: this runs on the service role, which
  // bypasses RLS. An authenticated client asking the same question through its
  // own key matches only the published policy and cannot see a draft at all.
  const tickets = await listGlobalTickets(supabase, { includeDrafts: true, limit });
  return res.status(200).json({ ok: true, tickets: tickets.map(toTicketView), limit });
}

/** POST — generate one GLOBAL draft from the admin-wide pool. */
async function generateHandler(req, res, supabase) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const variant = Number(body.variant);

  if (!ADMIN_GLOBAL_VARIANTS.includes(variant)) {
    return res.status(400).json({ ok: false, error: "invalid_variant", allowed: ADMIN_GLOBAL_VARIANTS });
  }
  // A system ticket has its own builder and its own k semantics, neither wired
  // up yet. Refused by name — answering with a combo would silently substitute a
  // different product for the one that was asked for.
  if (body.betKind != null && body.betKind !== "combo") {
    return res.status(400).json({ ok: false, error: "unsupported_bet_kind" });
  }

  // The client MAY name a date (to regenerate an earlier day) but may not name
  // anything that decides eligibility.
  const betDate = DATE_PATTERN.test(String(body.betDate || "")) ? String(body.betDate) : defaultBetDate();

  const result = await generateGlobalTicket({ betDate, variant, supabase });

  if (!result.available) {
    /*
      NOT an error. A pool that cannot build the requested variant is a correct,
      expected answer, and 200 is what lets the UI render it as a state rather
      than as a failure. The distinction the operator needs is `poolState`:
      "run the backfill" and "wait for more fixtures" are different actions.
    */
    return res.status(200).json({
      ok: true,
      created: false,
      available: false,
      poolState: result.poolState,
      variant: result.variant,
      required: result.required,
      candidatesAvailable: result.candidatesAvailable,
      fixturesConsidered: result.fixturesConsidered,
      leaguesConsidered: result.leaguesConsidered?.length ?? 0,
      rejected: result.rejected
    });
  }

  return res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    available: true,
    // A repeat request: the uniqueness key already held a ticket, so the stored
    // one comes back instead of a second being made.
    duplicate: !result.created,
    poolState: result.poolState,
    ticket: toTicketView({ ...result.bet, selections: result.selections }),
    candidatesAvailable: result.candidatesAvailable,
    fixturesConsidered: result.fixturesConsidered,
    leaguesConsidered: result.leaguesConsidered?.length ?? 0
  });
}

/** POST — release one draft to authenticated users. */
async function publishHandler(req, res, supabase) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return res.status(400).json({ ok: false, error: "missing_id" });

  const result = await publishGlobalTicket(supabase, id);
  if (result.ok) {
    return res.status(200).json({ ok: true, ticket: toTicketView({ ...result.bet, selections: [] }) });
  }

  // Each refusal maps to the status a client should act on differently: a
  // missing ticket is 404, a USER ticket reaching the GLOBAL publish path is a
  // 400 (the request was incoherent), and an already-published one is 409 so a
  // double-click is distinguishable from a real failure.
  const status = result.reason === "not_found" ? 404 : result.reason === "already_published" ? 409 : 400;
  return res.status(status).json({ ok: false, error: result.reason });
}

/**
 * The one entry point. `view` is already lower-cased by api/admin.js.
 *
 * @param {object} req
 * @param {object} res
 * @param {{ assertAdmin?: Function, supabase?: object }} [deps] injectable, for tests
 */
export async function handleGlobalTicketAdmin(req, res, deps = {}) {
  const view = String(req.query?.view || "").toLowerCase();
  const method = String(req.method || "GET").toUpperCase();

  try {
    const admin = await (deps.assertAdmin || assertAdmin)(req);
    if (!admin.ok) return res.status(admin.status).json({ ok: false, error: admin.error });

    const supabase = deps.supabase || getSupabaseAdmin();
    if (!supabase) return res.status(503).json({ ok: false, error: "Clientul Supabase admin nu este disponibil." });

    if (view === "publish-global-ticket") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await publishHandler(req, res, supabase);
    }

    if (view === "global-tickets") {
      if (method === "GET") return await listHandler(req, res, supabase);
      if (method === "POST") return await generateHandler(req, res, supabase);
      return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
    }

    return res.status(400).json({ ok: false, error: "Vedere necunoscută." });
  } catch (err) {
    // Logged, never returned: a Postgres error can name columns and constraints,
    // and the browser has no use for either.
    console.error("[global-tickets] admin_handler_failed", err?.message || err);
    return res.status(500).json({ ok: false, error: "Eroare internă." });
  }
}

export default {
  handleGlobalTicketAdmin,
  defaultBetDate,
  ADMIN_GLOBAL_VARIANTS,
  GLOBAL_TICKET_LIST_LIMIT,
  GLOBAL_TICKET_POOL_STATES
};
