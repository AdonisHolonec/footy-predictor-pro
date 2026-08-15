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
 * READ ONLY, STRUCTURALLY. Nothing here inserts, updates or deletes. `status` is returned so
 * it can be shown and never so it can be changed; managing it is a later increment and will
 * need its own handler, not a flag on this one.
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

export function isValidInboxKind(kind) {
  return INBOX_KINDS.includes(String(kind));
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
  let query = supabase
    .from("support_tickets")
    .select(TICKET_COLUMNS)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  query =
    kind === "report"
      ? query.in("category", REPORT_CATEGORIES)
      : query.not("category", "in", `(${REPORT_CATEGORIES.join(",")})`);

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

  return tickets.map((ticket) => ({
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
    messages: (byTicket.get(ticket.id) || []).map((m) => ({
      id: m.id,
      author_role: m.author_role,
      body: m.body,
      is_internal_note: m.is_internal_note,
      created_at: m.created_at
    }))
  }));
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
 * GET /api/admin?view=inbox&kind=support|report|feedback&limit=&offset=
 *
 * Order is the contract: method, configuration, THEN authorisation, and only after that is
 * a parameter parsed or a row touched. A validation error returned before assertAdmin would
 * tell an anonymous caller which parameters this endpoint accepts.
 */
export async function handleAdminInbox(req, res, deps = {}) {
  const admin = deps.assertAdmin || assertAdmin;
  const configured = deps.assertSupabaseConfigured || assertSupabaseConfigured;
  const client = deps.getSupabaseAdmin || getSupabaseAdmin;

  if (String(req.method || "GET").toUpperCase() !== "GET") {
    // Read-only by construction: status management is a later increment with its own
    // handler, so there is no verb here to grow one accidentally.
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
