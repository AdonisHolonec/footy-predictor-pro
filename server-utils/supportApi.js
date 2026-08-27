import { getRequester } from "./authAdmin.js";
import { SAFETY_REASONS, validateAdminMessage } from "./contentSafety.js";
import { checkUserRateLimit } from "./anonymousRateLimit.js";
import { assertSupabaseConfigured, getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * Support tickets, prediction reports and product feedback.
 *
 * Three user-facing flows, one module, because they differ in shape rather than
 * in machinery: all three authenticate the same way, rate-limit the same way,
 * and write user-owned rows that the user may read back but never edit.
 *
 * WHY THIS IS NOT api/support.js. Vercel counts every file under api/ as a
 * serverless function and the plan allows twelve; the directory is at twelve.
 * These endpoints keep public URLs through rewrites in vercel.json and are
 * served by api/alerts.js, the same consolidation /api/special-bets already
 * uses. See tests/vercelFunctionBudget.test.js.
 *
 * IDENTITY COMES FROM THE TOKEN. `user_id` is read from the verified session and
 * never from the body — a request that supplies one is answered with the
 * requester's own id, not theirs. Same for `author_role`: the API writes 'user'
 * as a literal, so a crafted body cannot post as an admin. The database agrees
 * independently (051's WITH CHECK policies and the internal-note constraint), so
 * neither layer is the only thing standing between a user and an admin reply.
 *
 * The service role is used for persistence, which means RLS is bypassed and this
 * module owns the ownership checks: every read filters by user_id, and a reply
 * verifies the ticket belongs to the requester before inserting.
 */

export const SUPPORT_CATEGORIES = [
  "general",
  "prediction",
  "gsb",
  "technical",
  "billing",
  "account",
  "other"
];
export const FEEDBACK_CATEGORIES = ["feature", "ux", "prediction", "gsb", "performance", "other"];
export const SUPPORT_PRIORITIES = ["low", "normal", "high"];

/** Mirrors the CHECK constraints in migration 051 — both layers must agree. */
export const LIMITS = {
  subject: 200,
  message: 5000,
  pageRoute: 200,
  appVersion: 50,
  contextKeys: 30,
  contextBytes: 4096,
  contextValue: 300
};

/** Per-user hourly quotas. Deliberately generous for humans, useless for scripts. */
export const RATE_LIMITS = {
  support: 5,
  feedback: 10,
  "prediction-report": 10,
  reply: 20
};

/**
 * The only context keys a client may send.
 *
 * An allow-list rather than a blocklist: `context` is echoed back into an admin
 * inbox, and the failure we are guarding against is a caller inventing a field
 * that later code mistakes for something the server established — `userId`,
 * `role`, `isAdmin`, `status`. Naming what is permitted means a future reader
 * cannot accidentally widen it by forgetting an entry.
 */
export const CONTEXT_KEYS = new Set([
  // prediction
  "fixtureId",
  "leagueId",
  "predictionId",
  "market",
  "family",
  "period",
  "scope",
  "recommendation",
  "modelVersion",
  "kickoffAt",
  // global special bet
  "specialBetId",
  "variant",
  "betDate",
  "selectionId",
  "odds",
  "probability"
]);

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Integer within a range, or null when absent.
 * Returns `undefined` to mean "present but invalid" — distinct from a real null,
 * because "no rating given" and "rating 11" must not collapse to the same case.
 */
function optionalInt(value, min, max) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

/**
 * Validate and narrow client-supplied context.
 *
 * Rejects arrays, strings and primitives: `context` is a bag of identifiers, and
 * accepting a string here would let a caller push 4KB of prose into a column the
 * admin UI renders as structured data.
 *
 * Unknown keys are an error rather than silently dropped. Dropping would let a
 * client believe it reported something it did not, and both sides of this
 * contract are ours to keep in step.
 */
export function normalizeContext(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (!isPlainObject(raw)) {
    return { ok: false, error: "context trebuie să fie un obiect JSON." };
  }
  const keys = Object.keys(raw);
  if (keys.length > LIMITS.contextKeys) {
    return { ok: false, error: `context are prea multe câmpuri (maxim ${LIMITS.contextKeys}).` };
  }

  const out = {};
  for (const key of keys) {
    if (!CONTEXT_KEYS.has(key)) {
      return { ok: false, error: `context conține un câmp nepermis: ${key}` };
    }
    const value = raw[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return { ok: false, error: `context.${key} nu este un număr valid.` };
      out[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      if (value.length > LIMITS.contextValue) {
        return { ok: false, error: `context.${key} depăşeşte ${LIMITS.contextValue} caractere.` };
      }
      out[key] = value;
      continue;
    }
    // Nested objects and arrays would make the admin view unbounded.
    return { ok: false, error: `context.${key} trebuie să fie text, număr sau boolean.` };
  }

  if (JSON.stringify(out).length > LIMITS.contextBytes) {
    return { ok: false, error: "context este prea mare." };
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

function optionalText(value, max, label) {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const text = trimmedString(value);
  if (!text) return { ok: true, value: null };
  if (text.length > max) return { ok: false, error: `${label} depăşeşte ${max} caractere.` };
  return { ok: true, value: text };
}

/** Shared validation for a new support ticket, including prediction/GSB reports. */
export function validateSupportPayload(body, { allowedCategories = SUPPORT_CATEGORIES, requireContext = false } = {}) {
  const payload = isPlainObject(body) ? body : {};

  const category = trimmedString(payload.category);
  if (!allowedCategories.includes(category)) {
    return { ok: false, error: `category invalid (permise: ${allowedCategories.join(", ")}).` };
  }

  const subject = trimmedString(payload.subject);
  if (!subject) return { ok: false, error: "subject este obligatoriu." };
  if (subject.length > LIMITS.subject) {
    return { ok: false, error: `subject depăşeşte ${LIMITS.subject} caractere.` };
  }

  const message = trimmedString(payload.message);
  if (!message) return { ok: false, error: "message este obligatoriu." };
  if (message.length > LIMITS.message) {
    return { ok: false, error: `message depăşeşte ${LIMITS.message} caractere.` };
  }

  /*
    Content safety, on both fields a human administrator will actually read.

    Deliberately AFTER the shape checks and BEFORE anything is written: a rejected
    message must leave no row behind, not even a partial one. The response carries
    a stable reason code and never the matched term — naming the word that tripped
    the filter is a recipe for working around it.
  */
  for (const field of [subject, message]) {
    if (!validateAdminMessage(field).ok) {
      return {
        ok: false,
        reason: SAFETY_REASONS.MESSAGE_CONTENT,
        error: "Mesajul conține un termen nepotrivit."
      };
    }
  }

  const priority =
    payload.priority === undefined || payload.priority === null ? "normal" : trimmedString(payload.priority);
  if (!SUPPORT_PRIORITIES.includes(priority)) {
    return { ok: false, error: `priority invalid (permise: ${SUPPORT_PRIORITIES.join(", ")}).` };
  }

  const context = normalizeContext(payload.context);
  if (!context.ok) return context;
  if (requireContext && !context.value) {
    return { ok: false, error: "context este obligatoriu pentru un raport de predicţie." };
  }

  const pageRoute = optionalText(payload.pageRoute, LIMITS.pageRoute, "pageRoute");
  if (!pageRoute.ok) return pageRoute;
  const appVersion = optionalText(payload.appVersion, LIMITS.appVersion, "appVersion");
  if (!appVersion.ok) return appVersion;

  return {
    ok: true,
    value: {
      category,
      subject,
      message,
      priority,
      contact_requested: payload.contactRequested === true,
      context: context.value,
      page_route: pageRoute.value,
      app_version: appVersion.value
    }
  };
}

export function validateFeedbackPayload(body) {
  const payload = isPlainObject(body) ? body : {};

  const category = trimmedString(payload.category);
  if (!FEEDBACK_CATEGORIES.includes(category)) {
    return { ok: false, error: `category invalid (permise: ${FEEDBACK_CATEGORIES.join(", ")}).` };
  }

  const message = trimmedString(payload.message);
  if (!message) return { ok: false, error: "message este obligatoriu." };
  if (message.length > LIMITS.message) {
    return { ok: false, error: `message depăşeşte ${LIMITS.message} caractere.` };
  }

  const rating = optionalInt(payload.rating, 1, 5);
  if (rating === undefined) return { ok: false, error: "rating invalid (întreg între 1 şi 5)." };

  const wouldRecommend = optionalInt(payload.wouldRecommend, 0, 10);
  if (wouldRecommend === undefined) {
    return { ok: false, error: "wouldRecommend invalid (întreg între 0 şi 10)." };
  }

  const context = normalizeContext(payload.context);
  if (!context.ok) return context;

  return {
    ok: true,
    value: {
      category,
      message,
      rating,
      would_recommend: wouldRecommend,
      contact_requested: payload.contactRequested === true,
      context: context.value
    }
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateReplyPayload(body) {
  const payload = isPlainObject(body) ? body : {};
  const ticketId = trimmedString(payload.ticketId);
  if (!UUID_RE.test(ticketId)) return { ok: false, error: "ticketId invalid." };

  const bodyText = trimmedString(payload.body);
  if (!bodyText) return { ok: false, error: "body este obligatoriu." };
  if (bodyText.length > LIMITS.message) {
    return { ok: false, error: `body depăşeşte ${LIMITS.message} caractere.` };
  }
  return { ok: true, value: { ticketId, body: bodyText } };
}

/** Request bodies arrive parsed on Vercel, but a raw string is still possible. */
function parseBody(req) {
  const raw = req?.body;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rateLimited(res, limit) {
  return res.status(429).json({
    ok: false,
    error: "Prea multe cereri. Încearcă din nou mai târziu.",
    retryAfterSec: limit.retryAfterSec
  });
}

/**
 * Dependencies are injectable so the handlers can be exercised without a
 * database or a KV store. Production passes nothing and gets the real ones.
 */
const defaultDeps = {
  getRequester,
  checkUserRateLimit,
  getSupabaseAdmin,
  assertSupabaseConfigured
};

async function authorize(req, res, deps) {
  const requester = await deps.getRequester(req);
  if (!requester.ok) {
    return {
      ok: false,
      sent: res.status(requester.status || 401).json({ ok: false, error: requester.error || "Neautorizat" })
    };
  }
  const cfg = deps.assertSupabaseConfigured();
  if (!cfg.ok) {
    return { ok: false, sent: res.status(500).json({ ok: false, error: cfg.error }) };
  }
  const supabase = deps.getSupabaseAdmin();
  if (!supabase) {
    return { ok: false, sent: res.status(500).json({ ok: false, error: "Clientul Supabase nu este disponibil" }) };
  }
  return { ok: true, userId: requester.user.id, supabase };
}

async function insertTicket(supabase, userId, ticket) {
  const { message, ...columns } = ticket;
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({ ...columns, user_id: userId })
    .select("id, category, subject, status, priority, created_at")
    .single();
  if (error) throw error;

  const { error: messageError } = await supabase.from("support_messages").insert({
    ticket_id: data.id,
    author_role: "user",
    body: message,
    is_internal_note: false
  });
  if (messageError) throw messageError;

  return data;
}

/** POST /api/support — open a ticket. */
export async function handleSupport(req, res, deps = defaultDeps) {
  const auth = await authorize(req, res, deps);
  if (!auth.ok) return auth.sent;

  const limit = await deps.checkUserRateLimit(auth.userId, {
    namespace: "support",
    maxPerHour: RATE_LIMITS.support
  });
  if (!limit.ok) return rateLimited(res, limit);

  const validated = validateSupportPayload(parseBody(req));
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error, reason: validated.reason });

  const created = await insertTicket(auth.supabase, auth.userId, validated.value);
  return res.status(201).json({ ok: true, ticket: created });
}

/** POST /api/prediction-report — a ticket that must carry its fixture context. */
export async function handlePredictionReport(req, res, deps = defaultDeps) {
  const auth = await authorize(req, res, deps);
  if (!auth.ok) return auth.sent;

  const limit = await deps.checkUserRateLimit(auth.userId, {
    namespace: "prediction-report",
    maxPerHour: RATE_LIMITS["prediction-report"]
  });
  if (!limit.ok) return rateLimited(res, limit);

  const body = parseBody(req);
  const payload = isPlainObject(body) ? body : {};
  const validated = validateSupportPayload(
    {
      ...payload,
      // The report form has no subject field; the category names the report.
      subject: payload.subject || `Raport ${trimmedString(payload.category) || "predicţie"}`
    },
    { allowedCategories: ["prediction", "gsb"], requireContext: true }
  );
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error, reason: validated.reason });

  const created = await insertTicket(auth.supabase, auth.userId, validated.value);
  return res.status(201).json({ ok: true, ticket: created });
}

/** POST /api/feedback — write-once, no conversation. */
export async function handleFeedback(req, res, deps = defaultDeps) {
  const auth = await authorize(req, res, deps);
  if (!auth.ok) return auth.sent;

  const limit = await deps.checkUserRateLimit(auth.userId, {
    namespace: "feedback",
    maxPerHour: RATE_LIMITS.feedback
  });
  if (!limit.ok) return rateLimited(res, limit);

  const validated = validateFeedbackPayload(parseBody(req));
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error, reason: validated.reason });

  const { data, error } = await auth.supabase
    .from("feedback_entries")
    .insert({ ...validated.value, user_id: auth.userId })
    .select("id, category, rating, would_recommend, created_at")
    .single();
  if (error) throw error;

  return res.status(201).json({ ok: true, feedback: data });
}

/** POST /api/support?action=reply — the owner adds to their own thread. */
export async function handleSupportReply(req, res, deps = defaultDeps) {
  const auth = await authorize(req, res, deps);
  if (!auth.ok) return auth.sent;

  const limit = await deps.checkUserRateLimit(auth.userId, {
    namespace: "support-reply",
    maxPerHour: RATE_LIMITS.reply
  });
  if (!limit.ok) return rateLimited(res, limit);

  const validated = validateReplyPayload(parseBody(req));
  if (!validated.ok) return res.status(400).json({ ok: false, error: validated.error, reason: validated.reason });

  // Ownership is checked here because persistence runs as the service role,
  // which RLS does not constrain. A ticket that is not the requester's answers
  // 404 rather than 403 — telling a stranger the id exists is itself a leak.
  const { data: ticket, error: ticketError } = await auth.supabase
    .from("support_tickets")
    .select("id, user_id, status")
    .eq("id", validated.value.ticketId)
    .maybeSingle();
  if (ticketError) throw ticketError;
  if (!ticket || ticket.user_id !== auth.userId) {
    return res.status(404).json({ ok: false, error: "Tichetul nu a fost găsit." });
  }
  if (ticket.status === "closed") {
    return res.status(409).json({ ok: false, error: "Tichetul este închis." });
  }

  // author_role and is_internal_note are literals, not client input.
  const { data, error } = await auth.supabase
    .from("support_messages")
    .insert({
      ticket_id: ticket.id,
      author_role: "user",
      body: validated.value.body,
      is_internal_note: false
    })
    .select("id, ticket_id, author_role, body, created_at")
    .single();
  if (error) throw error;

  return res.status(201).json({ ok: true, message: data });
}

/** GET /api/support — the requester's own tickets with their visible messages. */
export async function handleSupportList(req, res, deps = defaultDeps) {
  const auth = await authorize(req, res, deps);
  if (!auth.ok) return auth.sent;

  const { data: tickets, error } = await auth.supabase
    .from("support_tickets")
    .select("id, category, subject, status, priority, contact_requested, context, created_at, updated_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const ids = (tickets || []).map((t) => t.id);
  let messages = [];
  if (ids.length) {
    // is_internal_note is filtered here AND by the RLS policy in 051. The service
    // role skips the policy, so this filter is the one doing the work — the
    // policy covers anything that ever reads these rows as the user.
    const { data: rows, error: messageError } = await auth.supabase
      .from("support_messages")
      .select("id, ticket_id, author_role, body, created_at")
      .in("ticket_id", ids)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: true });
    if (messageError) throw messageError;
    messages = rows || [];
  }

  const byTicket = new Map(ids.map((id) => [id, []]));
  for (const message of messages) byTicket.get(message.ticket_id)?.push(message);

  return res.status(200).json({
    ok: true,
    tickets: (tickets || []).map((ticket) => ({ ...ticket, messages: byTicket.get(ticket.id) || [] }))
  });
}

/**
 * Entry point used by api/alerts.js. Views map one-to-one to the rewritten
 * public paths, so the URL a client calls and the branch that serves it stay
 * legible together.
 */
export async function handleSupportApi(req, res, deps = defaultDeps) {
  const view = String(req.query?.view || "");
  const action = String(req.query?.action || "");
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (view === "support") {
      if (method === "GET") return await handleSupportList(req, res, deps);
      if (method === "POST") {
        return action === "reply"
          ? await handleSupportReply(req, res, deps)
          : await handleSupport(req, res, deps);
      }
      return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
    }
    if (view === "feedback") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handleFeedback(req, res, deps);
    }
    if (view === "prediction-report") {
      if (method !== "POST") return res.status(405).json({ ok: false, error: "Metodă nepermisă" });
      return await handlePredictionReport(req, res, deps);
    }
    return res.status(404).json({ ok: false, error: "Resursă inexistentă" });
  } catch (error) {
    // The message may name a column or a constraint; neither belongs in a
    // client response, and the body may hold whatever the user typed.
    console.error("[supportApi]", view, action, error?.code || error?.message || "unknown_error");
    return res.status(500).json({ ok: false, error: "Nu am putut procesa cererea." });
  }
}

export default { handleSupportApi };
