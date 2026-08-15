import { useCallback, useEffect, useState } from "react";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import EmptyState from "../../design-system/EmptyState";
import ErrorState from "../../design-system/ErrorState";
import Skeleton from "../../design-system/Skeleton";
import Select from "../../design-system/Select";
import Textarea from "../../design-system/Textarea";
import {
  AdminInboxError,
  INBOX_PAGE_SIZE,
  MAX_REPLY_LENGTH,
  TICKET_STATUSES,
  fetchInboxPage,
  isInboxTicket,
  replyToTicket,
  updateTicketStatus,
  type InboxItem,
  type InboxKind,
  type InboxTicket,
  type TicketStatus
} from "../../services/adminInboxService";

/**
 * What users have sent us: support requests, prediction/GSB reports, and product feedback.
 *
 * ONE CONTROL, ONE COLUMN. A ticket's status can be moved between the five values migration
 * 051 defines. There is no reply box, no send button, no delete, no priority editing and no
 * bulk action — and feedback carries no status at all, so its cards have no control either.
 *
 * THE TABS ARE FILTERS, not routes — each is a separate server query for its own kind, and
 * they are separate because the kinds are genuinely different shapes. A support request and
 * a report share a table and therefore a status and a thread; feedback is write-once with
 * neither. Merging them into one list would mean inventing a status for feedback, and there
 * is no such column.
 *
 * EVERY USER-SUPPLIED VALUE IS TEXT. Subjects, message bodies and the context the client
 * attached are rendered as React children and nothing else — no dangerouslySetInnerHTML, no
 * markdown pass, no URL auto-linking. Migration 051 calls `context` "User-owned data — never
 * treat as trusted server metadata", and an admin screen is exactly where a crafted string
 * would most like to be interpreted.
 */

const TABS: { id: InboxKind; label: string }[] = [
  { id: "support", label: "Support" },
  { id: "report", label: "Reports" },
  { id: "feedback", label: "Feedback" }
];

/** The five values migration 051 allows, mapped to tones the design system already has. */
function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "resolved" || status === "closed") return "success";
  if (status === "open") return "warning";
  return "neutral";
}

function priorityTone(priority: string): "danger" | "warning" | "neutral" {
  if (priority === "high") return "danger";
  if (priority === "low") return "neutral";
  return "warning";
}

function formatWhen(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return `${new Date(ms).toISOString().replace("T", " ").slice(0, 16)}Z`;
}

/** A short, stable handle for a submitter. The full id sits on the expanded row. */
function shortId(userId: string): string {
  return String(userId || "").slice(0, 8);
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; items: InboxItem[]; hasMore: boolean }
  | { phase: "error"; message: string };

export default function AdminInboxPanel() {
  const [kind, setKind] = useState<InboxKind>("report");
  const [state, setState] = useState<State>({ phase: "loading" });
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The ticket whose status is in flight — one at a time, so the control can disable itself. */
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Draft text per ticket, so switching rows does not lose what was typed. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async (nextKind: InboxKind, nextOffset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setState({ phase: "loading" });
    try {
      const page = await fetchInboxPage({ kind: nextKind, limit: INBOX_PAGE_SIZE, offset: nextOffset });
      setState((prev) => {
        const previous = append && prev.phase === "ready" ? prev.items : [];
        return { phase: "ready", items: [...previous, ...page.items], hasMore: page.hasMore };
      });
      setOffset(nextOffset);
    } catch (error) {
      // The server's message is deliberately generic; a 403 is worth naming because it is
      // actionable, and anything else is not the reader's problem to diagnose.
      const status = error instanceof AdminInboxError ? error.status : 0;
      setState({
        phase: "error",
        message:
          status === 401 || status === 403
            ? "Admin access is required to read the inbox."
            : "The inbox could not be loaded."
      });
    } finally {
      setLoadingMore(false);
    }
  }, []);

  /**
   * Save a status, then show what the server stored.
   *
   * NOT OPTIMISTIC. The row is replaced only once the server has confirmed it, and with the
   * server's own copy rather than the value that was requested — the database is what decides
   * whether the change happened, and this project has no optimistic-update pattern to follow.
   */
  const changeStatus = useCallback(
    async (ticket: InboxTicket, status: TicketStatus) => {
      if (status === ticket.status) return;
      setSavingId(ticket.id);
      setSaveError(null);
      try {
        const saved = await updateTicketStatus({ kind: ticket.kind, id: ticket.id, status });
        setState((prev) =>
          prev.phase === "ready"
            ? { ...prev, items: prev.items.map((item) => (item.id === saved.id ? saved : item)) }
            : prev
        );
      } catch (error) {
        const httpStatus = error instanceof AdminInboxError ? error.status : 0;
        setSaveError(
          httpStatus === 401 || httpStatus === 403
            ? "Admin access is required to change a status."
            : httpStatus === 404
              ? "That ticket no longer matches this list."
              : "The status could not be saved."
        );
      } finally {
        setSavingId(null);
      }
    },
    []
  );

  /**
   * Send a reply, then show what the server stored.
   *
   * NOT OPTIMISTIC. The message appended to the thread is the row the database created —
   * never a locally built stand-in — so what is on screen is what a user will read.
   */
  const sendReply = useCallback(
    async (ticket: InboxTicket) => {
      const draft = (drafts[ticket.id] || "").trim();
      if (!draft) return;
      setSendingId(ticket.id);
      setSendError(null);
      try {
        const message = await replyToTicket({ kind: ticket.kind, id: ticket.id, body: draft });
        setState((prev) =>
          prev.phase === "ready"
            ? {
                ...prev,
                items: prev.items.map((item) =>
                  item.id === ticket.id && isInboxTicket(item)
                    ? { ...item, messages: [...item.messages, message] }
                    : item
                )
              }
            : prev
        );
        setDrafts((prev) => ({ ...prev, [ticket.id]: "" }));
      } catch (error) {
        const httpStatus = error instanceof AdminInboxError ? error.status : 0;
        setSendError(
          httpStatus === 401 || httpStatus === 403
            ? "Admin access is required to reply."
            : httpStatus === 409
              ? "This ticket is closed and cannot receive a reply."
              : httpStatus === 404
                ? "That ticket no longer matches this list."
                : "The reply could not be sent."
        );
      } finally {
        setSendingId(null);
      }
    },
    [drafts]
  );

  useEffect(() => {
    setExpandedId(null);
    setSaveError(null);
    setSendError(null);
    void load(kind, 0, false);
  }, [kind, load]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">Inbox</h2>
        <p className="mt-1 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
          What users have sent. A ticket's status can be changed and an open ticket can be replied
          to; nothing else here can be edited, and feedback is read-only.
        </p>
      </div>

      <div className="flex gap-1" role="group" aria-label="Inbox filter">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setKind(tab.id)}
            aria-pressed={kind === tab.id}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              kind === tab.id
                ? "bg-[var(--fp-accent)]/15 text-[var(--fp-accent)]"
                : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {state.phase === "loading" && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {state.phase === "error" && <ErrorState message={state.message} onRetry={() => void load(kind, 0, false)} />}

      {/* A failed save is its own message: the list is still valid, only the write failed. */}
      {saveError && <ErrorState title="Status not saved" message={saveError} />}
      {sendError && <ErrorState title="Reply not sent" message={sendError} />}

      {state.phase === "ready" && state.items.length === 0 && (
        <EmptyState title="Nothing here yet" description="No messages of this kind have been submitted." />
      )}

      {state.phase === "ready" && state.items.length > 0 && (
        <Card className="divide-y divide-[var(--fp-border)] p-0">
          {state.items.map((item) => {
            const expanded = expandedId === item.id;
            // Both bindings, so each branch is narrowed to the shape it actually renders —
            // a ternary on one of them would leave the other as the union.
            const ticket = isInboxTicket(item) ? item : null;
            const feedback = isInboxTicket(item) ? null : item;
            return (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  aria-expanded={expanded}
                  className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                    expanded ? "bg-[var(--fp-accent-muted)]" : "hover:bg-[var(--fp-bg-muted)]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                      {formatWhen(item.created_at)} · {item.category} · user {shortId(item.user_id)}
                    </p>
                    <p className="mt-0.5 truncate text-[length:var(--fp-body)] text-[var(--fp-text)]">
                      {ticket ? ticket.subject : feedback?.message}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.contact_requested && <Badge tone="warning">contact</Badge>}
                    {ticket && <Badge tone={priorityTone(ticket.priority)}>{ticket.priority}</Badge>}
                    {ticket && <Badge tone={statusTone(ticket.status)}>{ticket.status}</Badge>}
                  </div>
                </button>

                {expanded && (
                  <div className="space-y-3 border-t border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-3">
                    <p className="font-mono text-[11px] text-[var(--fp-text-muted)]">user_id: {item.user_id}</p>

                    {ticket ? (
                      <>
                        {/* The only control in this panel. Tickets only — feedback has no
                            status column, so there is nothing here to offer for it. */}
                        <Select
                          label="Status"
                          className="max-w-xs"
                          value={ticket.status}
                          disabled={savingId === ticket.id}
                          options={TICKET_STATUSES.map((value) => ({ value, label: value }))}
                          onChange={(event) =>
                            void changeStatus(ticket, event.target.value as TicketStatus)
                          }
                        />
                        {savingId === ticket.id && (
                          <p className="text-[11px] text-[var(--fp-text-muted)]" role="status">
                            Saving…
                          </p>
                        )}
                        {ticket.context && (
                          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                            {Object.entries(ticket.context).map(([key, value]) => (
                              <div key={key} className="contents">
                                <dt className="text-[var(--fp-text-muted)]">{key}</dt>
                                {/* Text. Never markup — this is whatever the client attached. */}
                                <dd className="text-[var(--fp-text)]">{String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <ul className="space-y-2">
                          {ticket.messages.map((message) => (
                            <li
                              key={message.id}
                              className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3"
                            >
                              <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                                {message.author_role} · {formatWhen(message.created_at)}
                                {message.is_internal_note ? " · internal note" : ""}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-[length:var(--fp-body)] text-[var(--fp-text)]">
                                {message.body}
                              </p>
                            </li>
                          ))}
                        </ul>
                        {/* Closed is final for both sides: handleSupportReply refuses a
                            user's reply on a closed ticket, and the server refuses ours the
                            same way. So there is no composer here at all — a disabled Send
                            would advertise a reply that cannot happen. Reopening is an
                            explicit status change above. */}
                        {ticket.status === "closed" ? (
                          <p className="text-[11px] text-[var(--fp-text-muted)]">
                            This ticket is closed. Change its status to reply.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            <Textarea
                              label="Reply"
                              rows={3}
                              maxLength={MAX_REPLY_LENGTH}
                              value={drafts[ticket.id] || ""}
                              disabled={sendingId === ticket.id}
                              onChange={(event) =>
                                setDrafts((prev) => ({ ...prev, [ticket.id]: event.target.value }))
                              }
                            />
                            <div className="flex items-center gap-3">
                              <Button
                                size="sm"
                                disabled={sendingId === ticket.id || !(drafts[ticket.id] || "").trim()}
                                onClick={() => void sendReply(ticket)}
                              >
                                {sendingId === ticket.id ? "Sending…" : "Send reply"}
                              </Button>
                              <span className="font-mono text-[10px] text-[var(--fp-text-muted)]">
                                {(drafts[ticket.id] || "").length}/{MAX_REPLY_LENGTH}
                              </span>
                            </div>
                          </div>
                        )}
                        {(ticket.page_route || ticket.app_version) && (
                          <p className="font-mono text-[10px] text-[var(--fp-text-muted)]">
                            {ticket.page_route ? `route ${ticket.page_route}` : ""}
                            {ticket.page_route && ticket.app_version ? " · " : ""}
                            {ticket.app_version ? `app ${ticket.app_version}` : ""}
                          </p>
                        )}
                      </>
                    ) : (
                      feedback && (
                        <>
                          <p className="whitespace-pre-wrap text-[length:var(--fp-body)] text-[var(--fp-text)]">
                            {feedback.message}
                          </p>
                          {/* Both are nullable in the schema; a dash would imply a score of none. */}
                          {(feedback.rating !== null || feedback.would_recommend !== null) && (
                            <p className="font-mono text-[11px] text-[var(--fp-text-muted)]">
                              {feedback.rating !== null ? `rating ${feedback.rating}/5` : ""}
                              {feedback.rating !== null && feedback.would_recommend !== null ? " · " : ""}
                              {feedback.would_recommend !== null
                                ? `would recommend ${feedback.would_recommend}/10`
                                : ""}
                            </p>
                          )}
                        </>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {state.phase === "ready" && state.hasMore && (
        <Button
          variant="secondary"
          size="sm"
          disabled={loadingMore}
          onClick={() => void load(kind, offset + INBOX_PAGE_SIZE, true)}
        >
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
