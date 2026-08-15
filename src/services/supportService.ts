import { fetchWithAuth } from "../utils/apiAuth";

/**
 * HTTP client for the support, feedback and prediction-report endpoints.
 *
 * The contract is the server's, not the form's — every value below is copied
 * from server-utils/supportApi.js, which validates it again and is the authority.
 * Duplicating the category lists here buys a disabled Send button instead of a
 * round trip that ends in 400; it does not make the client the gate.
 *
 * The browser never sends a user id. `user_id` comes from the verified session on
 * the server, and a body that supplies one is ignored.
 */

/** Mirrors SUPPORT_CATEGORIES. */
export const SUPPORT_CATEGORIES = [
  "general",
  "prediction",
  "gsb",
  "technical",
  "billing",
  "account",
  "other"
] as const;

/** Mirrors FEEDBACK_CATEGORIES. */
export const FEEDBACK_CATEGORIES = ["feature", "ux", "prediction", "gsb", "performance", "other"] as const;

/** Mirrors SUPPORT_PRIORITIES. */
export const SUPPORT_PRIORITIES = ["low", "normal", "high"] as const;

/** Mirrors LIMITS — used to cap the inputs before the server has to. */
export const SUPPORT_LIMITS = { subject: 200, message: 5000 } as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

/**
 * The only keys the server accepts in `context`. Anything else is a 400, by
 * design — the allow-list exists so a client cannot invent a field that later
 * code mistakes for something the server established.
 */
export type SupportContext = Partial<{
  fixtureId: number;
  leagueId: number;
  predictionId: string;
  market: string;
  family: string;
  period: string;
  scope: string;
  recommendation: string;
  modelVersion: string;
  kickoffAt: string;
  specialBetId: string;
  variant: number;
  betDate: string;
  selectionId: string;
  odds: number;
  probability: number;
}>;

export type SupportTicketPayload = {
  category: SupportCategory;
  subject: string;
  message: string;
  priority?: SupportPriority;
  contactRequested?: boolean;
  context?: SupportContext;
  pageRoute?: string;
};

export type FeedbackPayload = {
  category: FeedbackCategory;
  message: string;
  rating?: number;
  wouldRecommend?: number;
  contactRequested?: boolean;
};

export type PredictionReportPayload = {
  category: "prediction" | "gsb";
  message: string;
  context: SupportContext;
};

/**
 * Carries the HTTP status so the caller can tell a rate limit from a session
 * expiry from a real failure — the three need different copy, and collapsing
 * them into one "something went wrong" is what this class exists to prevent.
 */
export class SupportApiError extends Error {
  readonly status: number;
  /** The server's own message when it supplied one. */
  readonly apiMessage: string | null;
  /** Present on 429 — seconds until the quota window rolls over. */
  readonly retryAfterSec: number | null;

  constructor(status: number, apiMessage: string | null, retryAfterSec: number | null = null) {
    super(apiMessage || `support request failed with ${status}`);
    this.name = "SupportApiError";
    this.status = status;
    this.apiMessage = apiMessage;
    this.retryAfterSec = retryAfterSec;
  }
}

type ApiEnvelope = {
  ok?: boolean;
  error?: string;
  retryAfterSec?: number;
  ticket?: unknown;
  tickets?: unknown;
  feedback?: unknown;
};

async function readEnvelope(res: Response): Promise<ApiEnvelope> {
  try {
    return (await res.json()) as ApiEnvelope;
  } catch {
    // A gateway error page is not JSON. Treat it as an empty envelope rather
    // than letting a parse error masquerade as a network failure.
    return {};
  }
}

async function post(path: string, body: unknown): Promise<ApiEnvelope> {
  const res = await fetchWithAuth(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const envelope = await readEnvelope(res);
  if (!res.ok || envelope.ok === false) {
    const retry = Number(envelope.retryAfterSec);
    throw new SupportApiError(
      res.status,
      typeof envelope.error === "string" ? envelope.error : null,
      Number.isFinite(retry) ? retry : null
    );
  }
  return envelope;
}

async function get(path: string): Promise<ApiEnvelope> {
  const res = await fetchWithAuth(path);
  const envelope = await readEnvelope(res);
  if (!res.ok || envelope.ok === false) {
    throw new SupportApiError(res.status, typeof envelope.error === "string" ? envelope.error : null, null);
  }
  return envelope;
}

/** One message on a ticket, as `GET /api/support` returns it. */
export type SupportMessage = {
  id: string;
  ticket_id: string;
  /** Who wrote it. The server writes this literal; it is never client-supplied. */
  author_role: "user" | "admin";
  body: string;
  created_at: string;
};

/**
 * A ticket belonging to the signed-in user.
 *
 * There is no `is_internal_note` here because the server never sends one: an
 * internal note is filtered out by `handleSupportList` AND by the RLS policy in
 * migration 051. The absence is deliberate — a field the client never receives
 * is a field the client cannot leak.
 */
export type SupportTicket = {
  id: string;
  category: string;
  subject: string;
  /** open | in_progress | waiting_user | resolved | closed — displayed, never set. */
  status: string;
  priority: string;
  contact_requested: boolean;
  created_at: string;
  updated_at: string;
  messages: SupportMessage[];
};

/**
 * The signed-in user's own tickets, newest first, each with its visible thread.
 *
 * NO USER ID IS SENT. The server derives the owner from the verified session and
 * scopes the query with it; a client-supplied id would be a request to be trusted
 * about whose messages these are. That is why this takes no parameters at all.
 *
 * Read-only: there is no reply, no status change and no delete in this module.
 */
export async function listSupportTickets(): Promise<SupportTicket[]> {
  const envelope = await get("/api/support");
  return Array.isArray(envelope.tickets) ? (envelope.tickets as SupportTicket[]) : [];
}

/** Opens a support ticket. Resolves on 201; throws SupportApiError otherwise. */
export async function submitSupportTicket(payload: SupportTicketPayload): Promise<void> {
  await post("/api/support", payload);
}

/** Submits product feedback. Write-once — there is no follow-up thread. */
export async function submitFeedback(payload: FeedbackPayload): Promise<void> {
  await post("/api/feedback", payload);
}

/** Reports a specific prediction or special bet. `context` is required by the server. */
export async function submitPredictionReport(payload: PredictionReportPayload): Promise<void> {
  await post("/api/prediction-report", payload);
}
