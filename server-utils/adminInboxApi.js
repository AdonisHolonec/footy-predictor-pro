/**
 * server-utils/adminInboxApi.js — the admin's read side of Support, Reports and Feedback.
 *
 * SEPARATE FROM supportApi.js ON PURPOSE. That module is the user's write path: it takes
 * whatever someone types and stores it against their own id. This one reads everybody's.
 * The two have opposite trust models and opposite blast radii, and keeping them in one file
 * would mean every future change to a submission form sits inches away from the query that
 * returns every user's messages.
 *
 * WHY A SERVER MODULE AT ALL. Migration 051 gives the three tables owner-only RLS: a user
 * reads their own rows and nothing else, and there is no admin policy. That is deliberate —
 * an admin is not a user with wider vision, and widening RLS would put the decision in the
 * database where every client inherits it. Instead the service role reads, and `assertAdmin`
 * decides who may ask. The same shape api/admin.js already uses for profiles.
 *
 * READS EVERYTHING, WRITES ONE COLUMN. The only mutation this module can perform is setting
 * `support_tickets.status` to one of the five values migration 051 already allows. It cannot
 * insert a ticket, delete one, reply to one, or touch feedback — `feedback_entries` has no
 * status, and PATCH refuses that kind rather than pretending otherwise.
 *
 * THREE KINDS, TWO TABLES:
 *
 *   support   support_tickets   category NOT IN (prediction, gsb)
 *   report    support_tickets   category IN (prediction, gsb)
 *   feedback  feedback_entries  — no status, no thread, write-once by design
 *
 * A prediction report is not a fourth table; 051 says so in its own header. It is a ticket
 * carrying the fixture identifiers in `context`, which is why the split is on category and
 * not on some new column.
 *
 * NO EMAIL. The UI identifies a submitter by `user_id`, which is enough to find them in the
 * profiles admin, so an address is never fetched. `profiles` has never carried one, and
 * pulling it out of auth.users would put personal data into a screen that does not need it.
 */

import { assertAdmin } from "./authAdmin.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "./supabaseAdmin.js";
// The allow-list the write path already validates against, imported rather than restated:
// two copies would be free to disagree about what a context may contain.
import { CONTEXT_KEYS } from "./supportApi.js";

/** What the inbox can be asked for. Anything else is a 400, never an empty list. */
export const INBOX_KINDS = ["support", "report", "feedback"];

/** Ticket categories that make a ticket a prediction/GSB report rather than plain support. */
export const REPORT_CATEGORIES = ["prediction", "gsb"];

export const INBOX_DEFAULT_LIMIT = 20;
export const INBOX_MAX_LIMIT = 50;

/**
 * The ticket lifecycle, copied from the CHECK constraint in migration 051 and from nowhere
 * else. Not a new enum, not a superset, not a set of UI labels — the database refuses
 * anything outside these five, so a sixth value here would be a 500 waiting to happen.
 *
 * Feedback has no status at all: `feedback_entries` carries no such column, which is why
 * PATCH refuses that kind rather than pretending to update something.
 */
export const TICKET_STATUSES = ["open", "in_progress", "waiting_user", "resolved", "closed"];

/**
 * Exact membership, no coercion.
 *
 * `typeof` first, so a number, an object or an array cannot reach `includes` as a
 * stringified near-miss. No case folding either: the constraint is lowercase, so "OPEN" is
 * not a status this product has, and accepting it would mean the application and the
 * database disagree about what was asked for.
 */
export function isValidTicketStatus(status) {
  return typeof status === "string" && TICKET_STATUSES.includes(status);
}

export function isValidInboxKind(kind) {
  return INBOX_KINDS.includes(String(kind));
}

/** Kinds that live in `support_tickets` and therefore have a status to manage. */
export function isTicketKind(kind) {
  return kind === "support" || kind === "report";
}

/** Mirrors api/admin.js — a body may arrive parsed, as a string, or not at all. */
function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

/**
 * Validate paging. A bad number is clamped rather than refused — a page size is a request,
 * not an assertion about the data — but the ceiling is enforced server-side so a caller
 * cannot ask for the whole table in one go.
 */
export function parseInboxPaging(query = {}) {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.trunc(rawLimit), INBOX_MAX_LIMIT))
    : INBOX_DEFAULT_LIMIT;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.trunc(rawOffset) : 0;
  return { limit, offset };
}

/**
 * The subset of a user-supplied `context` worth showing, as data.
 *
 * UNTRUSTED INPUT. 051 labels this column "User-owned data — never treat as trusted server
 * metadata", so only known keys survive and only as primitives. Nested objects and arrays
 * are dropped: they would make the row unbounded, and nothing in the inbox needs them. The
 * caller renders what comes back as text — there is no HTML here, and none may be inferred
 * from it downstream.
 *
 * Returns null when nothing recognisable is present, so the UI shows no context section at
 * all rather than an empty one.
 */
export function normalizeInboxContext(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!CONTEXT_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    const type = typeof value;
    if (type !== "string" && type !== "number" && type !== "boolean") continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Columns the inbox needs from a ticket — never select("*"). */
const TICKET_COLUMNS =
  "id, user_id, category, subject, status, priority, contact_requested, context, page_route, app_version, created_at, updated_at";

/** Columns the inbox needs from a feedback entry. */
const FEEDBACK_COLUMNS =
  "id, user_id, category, message, rating, would_recommend, contact_requested, context, created_at";

/**
 * Tickets for one kind, newest first, with their conversation attached.
 *
 * Two queries rather than a join, the same shape listGlobalSpecialBets uses for its
 * selections: the page of tickets is bounded first, then the messages are fetched for
 * exactly those ids. A join would page over the joined rows, so one long thread could
 * swallow an entire page.
 */
async function listTickets(supabase, { kind, limit, offset }) {
  const query = scopeToKind(
    supabase
      .from("support_tickets")
      .select(TICKET_COLUMNS)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    kind
  );

  const { data: tickets, error } = await query;
  if (error) throw error;
  if (!tickets?.length) return [];

  const { data: messages, error: messageError } = await supabase
    .from("support_messages")
    .select("id, ticket_id, author_role, body, is_internal_note, created_at")
    .in(
      "ticket_id",
      tickets.map((t) => t.id)
    )
    .order("created_at", { ascending: true });
  if (messageError) throw messageError;

  const byTicket = new Map(tickets.map((t) => [t.id, []]));
  for (const message of messages || []) byTicket.get(message.ticket_id)?.push(message);

  return tickets.map((ticket) => toTicketItem(ticket, kind, byTicket.get(ticket.id) || []));
}

/**
 * Feedback, newest first.
 *
 * Deliberately a different shape from a ticket: there is no status, no subject and no
 * thread, and inventing any of the three would be describing a product we do not have.
 */
async function listFeedback(supabase, { limit, offset }) {
  const { data, error } = await supabase
    .from("feedback_entries")
    .select(FEEDBACK_COLUMNS)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  return (data || []).map((row) => ({
    id: row.id,
    kind: "feedback",
    user_id: row.user_id,
    category: row.category,
    message: row.message,
    rating: row.rating,
    would_recommend: row.would_recommend,
    contact_requested: row.contact_requested,
    created_at: row.created_at,
    context: normalizeInboxContext(row.context)
  }));
}

/**
 * A stored ticket as the inbox exposes it. One shape for the list and for the row a PATCH
 * returns, so the client never has to reconcile two versions of the same ticket.
 */
function toTicketItem(ticket, kind, messages = []) {
  return {
    id: ticket.id,
    kind,
    user_id: ticket.user_id,
    category: ticket.category,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    contact_requested: ticket.contact_requested,
    page_route: ticket.page_route,
    app_version: ticket.app_version,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    context: normalizeInboxContext(ticket.context),
    messages: messages.map((m) => ({
      id: m.id,
      author_role: m.author_role,
      body: m.body,
      is_internal_note: m.is_internal_note,
      created_at: m.created_at
    }))
  };
}

/**
 * Narrow a ticket query to one kind. The same predicate serves reads and the update, so the
 * two can never disagree about what "a report" means.
 */
function scopeToKind(query, kind) {
  return kind === "report"
    ? query.in("category", REPORT_CATEGORIES)
    : query.not("category", "in", `(${REPORT_CATEGORIES.join(",")})`);
}

/**
 * Set a ticket's status.
 *
 * IDENTITY AND CATEGORY IN ONE STATEMENT. The category predicate sits on the UPDATE itself
 * rather than on a lookup before it: fetching by id and then comparing the category in
 * JavaScript would leave a window between the check and the write, and would make the
 * boundary a decision the application remembers to make rather than one the database
 * enforces. A cross-kind id therefore matches zero rows and changes nothing — there is no
 * path where the wrong ticket is updated and the mismatch is noticed afterwards.
 *
 * ONLY `status` IS WRITTEN. `updated_at` moves because migration 051 installs a BEFORE
 * UPDATE trigger for exactly that purpose; setting it here would be a second opinion about
 * a value the database already owns. Everything else — subject, category, priority,
 * context, user_id, contact_requested, page_route, app_version, created_at — is absent from
 * the payload and so cannot be touched.
 *
 * @returns the updated row, or null when nothing matched
 */
async function updateTicketStatus(supabase, { kind, id, status }) {
  const { data, error } = await scopeToKind(
    supabase.from("support_tickets").update({ status }).eq("id", id),
    kind
  ).select(TICKET_COLUMNS);
  if (error) throw error;
  return data?.[0] || null;
}

/**
 * PATCH /api/admin?view=inbox&kind=support|report   body: { id, status }
 *
 * Idempotent: setting the status a ticket already has is a 200 with the row, not an error.
 * The trigger still moves `updated_at`, which is what an UPDATE means — the row was touched,
 * and saying otherwise would require reading before writing purely to avoid a timestamp.
 */
async function handleStatusPatch(req, res, { supabase, kind }) {
  if (!isTicketKind(kind)) {
    // feedback_entries has no status column. Refusing is honest; silently succeeding would
    // report a change that never happened.
    return res.status(400).json({ ok: false, error: "Doar tichetele au status." });
  }

  const body = parseBody(req);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return res.status(400).json({ ok: false, error: "id este obligatoriu." });
  if (!isValidTicketStatus(body.status)) {
    return res
      .status(400)
      .json({ ok: false, error: `status invalid (permise: ${TICKET_STATUSES.join(", ")}).` });
  }

  const updated = await updateTicketStatus(supabase, { kind, id, status: body.status });
  if (!updated) {
    // Same answer for "no such ticket" and "that ticket is not this kind": distinguishing
    // them would confirm the existence of a row the caller asked for under the wrong kind.
    return res.status(404).json({ ok: false, error: "Tichetul nu a fost găsit." });
  }

  return res.status(200).json({ ok: true, kind, item: toTicketItem(updated, kind, []) });
}

/**
 * GET   /api/admin?view=inbox&kind=support|report|feedback&limit=&offset=
 * PATCH /api/admin?view=inbox&kind=support|report   body: { id, status }
 *
 * Order is the contract: method, configuration, THEN authorisation, and only after that is
 * a parameter parsed, a body read, or a row touched. A validation error returned before
 * assertAdmin would tell an anonymous caller which parameters this endpoint accepts — and
 * for PATCH it would also disclose the status vocabulary.
 */
export async function handleAdminInbox(req, res, deps = {}) {
  const admin = deps.assertAdmin || assertAdmin;
  const configured = deps.assertSupabaseConfigured || assertSupabaseConfigured;
  const client = deps.getSupabaseAdmin || getSupabaseAdmin;

  const method = String(req.method || "GET").toUpperCase();
  // GET reads, PATCH sets a ticket's status. Nothing else: POST would mean creating a
  // ticket on a user's behalf and DELETE would mean destroying their message, and neither
  // is something an inbox should be able to do.
  if (method !== "GET" && method !== "PATCH") {
    return res.status(405).json({ ok: false, error: "Metodă nepermisă." });
  }

  const config = configured();
  if (!config.ok) return res.status(500).json({ ok: false, error: config.error });

  const adminCheck = await admin(req);
  if (!adminCheck.ok) {
    return res.status(adminCheck.status || 403).json({ ok: false, error: adminCheck.error });
  }

  const kind = String(req.query?.kind || "");
  if (!isValidInboxKind(kind)) {
    return res
      .status(400)
      .json({ ok: false, error: `kind invalid (permise: ${INBOX_KINDS.join(", ")}).` });
  }
  const { limit, offset } = parseInboxPaging(req.query || {});

  try {
    const supabase = client();

    if (method === "PATCH") return await handleStatusPatch(req, res, { supabase, kind });

    const items =
      kind === "feedback"
        ? await listFeedback(supabase, { limit, offset })
        : await listTickets(supabase, { kind, limit, offset });

    // A full page means there may be another; the tables return rows, not totals, and a
    // count query on every request would cost more than the answer is worth.
    return res.status(200).json({ ok: true, kind, items, hasMore: items.length === limit });
  } catch (error) {
    // The message can name a column or a constraint, and the rows hold whatever a user
    // typed. Neither belongs in a response.
    console.error("[adminInbox]", kind, error?.code || error?.message || "unknown_error");
    return res.status(500).json({ ok: false, error: "Nu am putut încărca mesajele." });
  }
}

export default { handleAdminInbox };
