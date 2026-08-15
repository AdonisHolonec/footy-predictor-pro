/**
 * Client for the admin inbox — `GET /api/admin?view=inbox`.
 *
 * READ ONLY, and there is nothing here to make it otherwise: no update, no reply, no send.
 * Status is data that arrives, not a control that leaves.
 *
 * The server holds every decision. It authorises the caller, chooses the tables, strips the
 * user-supplied context down to known keys and returns a fixed shape. This module adds no
 * interpretation on top — it fetches, checks the envelope, and hands the rows over.
 */

import { fetchWithAuth } from "../utils/apiAuth";

/** The three things a user can send us. `report` is a ticket about a prediction or a GSB. */
export const INBOX_KINDS = ["support", "report", "feedback"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** One page of the inbox. Matches the server's `limit` default; the server caps it at 50. */
export const INBOX_PAGE_SIZE = 20;

/**
 * The ticket lifecycle, mirroring the CHECK constraint in migration 051 and the server's own
 * TICKET_STATUSES. The server remains the authority — it revalidates every value — but the
 * list lives here so the UI can offer exactly these five and never a sixth.
 */
export const TICKET_STATUSES = ["open", "in_progress", "waiting_user", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Mirrors the CHECK on support_messages.body in migration 051. The server revalidates. */
export const MAX_REPLY_LENGTH = 5000;

/**
 * A ticket's context after the server has narrowed it to known keys and primitives.
 *
 * Values are user-supplied. They are rendered as text and never as markup — see
 * AdminInboxPanel, which prints them through React's own escaping and nothing else.
 */
export type InboxContext = Record<string, string | number | boolean>;

export type InboxMessage = {
  id: string;
  author_role: "user" | "admin";
  body: string;
  is_internal_note: boolean;
  created_at: string;
};

/** Support and Report share one table, so they share one shape. */
export type InboxTicket = {
  id: string;
  kind: "support" | "report";
  user_id: string;
  category: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  contact_requested: boolean;
  page_route: string | null;
  app_version: string | null;
  created_at: string;
  updated_at: string;
  context: InboxContext | null;
  messages: InboxMessage[];
};

/**
 * Feedback is write-once: no status, no subject, no thread. The type says so rather than
 * carrying nullable copies of fields the table does not have.
 */
export type InboxFeedback = {
  id: string;
  kind: "feedback";
  user_id: string;
  category: string;
  message: string;
  rating: number | null;
  would_recommend: number | null;
  contact_requested: boolean;
  created_at: string;
  context: InboxContext | null;
};

export type InboxItem = InboxTicket | InboxFeedback;

export type InboxPage = {
  kind: InboxKind;
  items: InboxItem[];
  hasMore: boolean;
};

export class AdminInboxError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminInboxError";
    this.status = status;
  }
}

/** A ticket carries a thread; feedback does not. One check, so callers stop guessing. */
export function isInboxTicket(item: InboxItem): item is InboxTicket {
  return item.kind === "support" || item.kind === "report";
}

/**
 * One page of one kind, newest first.
 *
 * Errors surface as `AdminInboxError` with the HTTP status attached, so the panel can tell
 * "you are not an admin" from "the server broke" without parsing a message.
 */
export async function fetchInboxPage(params: {
  kind: InboxKind;
  limit?: number;
  offset?: number;
}): Promise<InboxPage> {
  const qs = new URLSearchParams({ view: "inbox", kind: params.kind });
  qs.set("limit", String(params.limit ?? INBOX_PAGE_SIZE));
  if (params.offset) qs.set("offset", String(params.offset));

  const res = await fetchWithAuth(`/api/admin?${qs.toString()}`);
  let json: { ok?: boolean; error?: string; items?: unknown; hasMore?: boolean };
  try {
    json = await res.json();
  } catch {
    // A non-JSON body is a server or gateway failure, not a payload to inspect.
    throw new AdminInboxError(res.status, "");
  }
  if (!res.ok || json?.ok !== true) {
    throw new AdminInboxError(res.status, String(json?.error || ""));
  }

  return {
    kind: params.kind,
    items: Array.isArray(json.items) ? (json.items as InboxItem[]) : [],
    hasMore: Boolean(json.hasMore)
  };
}

/**
 * Set a ticket's status. The only mutation this client can perform.
 *
 * `kind` travels with the request because the server scopes the update by category as well
 * as by id — a support id sent as a report matches no row and comes back 404 rather than
 * quietly changing the wrong ticket. Feedback has no status, so its kind is not accepted
 * here at all.
 *
 * Returns the ticket as stored afterwards, so the caller shows what the database holds
 * rather than what was asked for.
 */
/**
 * Reply to a ticket, as the team.
 *
 * The server owns the authorship: `author_role` and `is_internal_note` are literals it
 * writes itself, and there is no parameter here that could influence either. This sends a
 * ticket id and some text, and nothing else.
 *
 * Returns the row the database created — the caller appends that, never a locally
 * constructed stand-in, so what appears in the thread is what was actually stored.
 */
export async function replyToTicket(params: {
  kind: "support" | "report";
  id: string;
  body: string;
}): Promise<InboxMessage> {
  const qs = new URLSearchParams({ view: "inbox", kind: params.kind });
  const res = await fetchWithAuth(`/api/admin?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: params.id, body: params.body })
  });

  let json: { ok?: boolean; error?: string; item?: unknown };
  try {
    json = await res.json();
  } catch {
    throw new AdminInboxError(res.status, "");
  }
  if (!res.ok || json?.ok !== true || !json.item) {
    throw new AdminInboxError(res.status, String(json?.error || ""));
  }
  return json.item as InboxMessage;
}

export async function updateTicketStatus(params: {
  kind: "support" | "report";
  id: string;
  status: TicketStatus;
}): Promise<InboxTicket> {
  const qs = new URLSearchParams({ view: "inbox", kind: params.kind });
  const res = await fetchWithAuth(`/api/admin?${qs.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: params.id, status: params.status })
  });

  let json: { ok?: boolean; error?: string; item?: unknown };
  try {
    json = await res.json();
  } catch {
    throw new AdminInboxError(res.status, "");
  }
  if (!res.ok || json?.ok !== true || !json.item) {
    throw new AdminInboxError(res.status, String(json?.error || ""));
  }
  return json.item as InboxTicket;
}
