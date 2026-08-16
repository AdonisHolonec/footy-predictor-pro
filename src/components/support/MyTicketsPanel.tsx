import { useCallback, useEffect, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Skeleton from "../../design-system/Skeleton";
import { listSupportTickets, type SupportTicket } from "../../services/supportService";

/**
 * The messages a user has sent us, and anything we have written back.
 *
 * WHY THIS EXISTS. Support has been able to accept a ticket since #72 and to hold a
 * reply at the database level since migration 051 — but nothing ever showed a user
 * their own thread, so an answer would have been written and never read. This is
 * the read half of that conversation, and it ships before the admin composer
 * rather than after it.
 *
 * READ ONLY. No reply box, no status control, no delete. A user cannot change a
 * ticket at all: 051 grants them INSERT and SELECT and no UPDATE policy whatsoever,
 * so a control here would be a button that could only fail.
 *
 * EVERY BODY IS TEXT. Subjects and message bodies are rendered as React children
 * and nothing else — no dangerouslySetInnerHTML, no markdown pass, no URL
 * auto-linking. They are the user's own words coming back to them, but they have
 * been through a database and an API, and the only safe assumption about text is
 * that it is text.
 *
 * INTERNAL NOTES CANNOT APPEAR HERE. `GET /api/support` filters them, the RLS
 * policy in 051 filters them independently, and the response carries no
 * `is_internal_note` field at all — three layers, of which this component is not
 * one. It renders what it is given, and it is never given a note.
 */

type State =
  | { phase: "loading" }
  | { phase: "ready"; tickets: SupportTicket[] }
  | { phase: "error" };

/** The five values migration 051 allows, mapped onto tones the design system has. */
function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "resolved" || status === "closed") return "success";
  if (status === "open" || status === "waiting_user") return "warning";
  return "neutral";
}

export default function MyTicketsPanel({ className = "" }: { className?: string }) {
  const { t, locale } = useLocale();
  const [state, setState] = useState<State>({ phase: "loading" });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      // No argument: the server derives the owner from the verified session.
      const tickets = await listSupportTickets();
      setState({ phase: "ready", tickets });
    } catch {
      // The server's message can name a column or a constraint. The user needs to
      // know it failed and that they can try again, not why it failed.
      setState({ phase: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const formatWhen = (value: string) => {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return value;
    return new Intl.DateTimeFormat(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(ms));
  };

  /**
   * A prediction or special-bet report is a ticket with that category — 051 says so
   * in its own header — so the two are told apart by category, not by table.
   */
  const kindLabel = (category: string) =>
    category === "prediction" || category === "gsb" ? t("myTickets.kindReport") : t("myTickets.kindSupport");

  const heading = <h3 className="font-display text-sm font-semibold text-[var(--fp-text)]">{t("myTickets.title")}</h3>;

  if (state.phase === "loading") {
    return (
      <section className={className} aria-busy="true">
        {heading}
        <div className="mt-3 space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </section>
    );
  }

  if (state.phase === "error") {
    return (
      <section className={className}>
        {heading}
        <div
          role="alert"
          className="mt-3 rounded-[var(--fp-radius)] border border-[var(--fp-danger)]/35 bg-[var(--fp-danger)]/10 px-4 py-3"
        >
          <p className="text-sm text-[var(--fp-text-muted)]">{t("myTickets.error")}</p>
          <Button className="mt-2" variant="secondary" size="sm" onClick={() => void load()}>
            {t("myTickets.retry")}
          </Button>
        </div>
      </section>
    );
  }

  if (state.tickets.length === 0) {
    return (
      <section className={className}>
        {heading}
        <p className="mt-2 text-sm text-[var(--fp-text-muted)]">{t("myTickets.empty")}</p>
      </section>
    );
  }

  return (
    <section className={className}>
      {heading}
      {/* Newest first, exactly as the server ordered them — the client does not re-sort. */}
      <ul className="mt-3 divide-y divide-[var(--fp-border)] rounded-[var(--fp-radius)] border border-[var(--fp-border)]">
        {state.tickets.map((ticket) => {
          const expanded = expandedId === ticket.id;
          return (
            <li key={ticket.id}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : ticket.id)}
                aria-expanded={expanded}
                className={`flex w-full flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors ${
                  expanded ? "bg-[var(--fp-accent-muted)]" : "hover:bg-[var(--fp-bg-muted)]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                    {kindLabel(ticket.category)} · {formatWhen(ticket.created_at)}
                  </span>
                  {/* The user's own words, as text. */}
                  <span className="mt-0.5 block truncate text-sm text-[var(--fp-text)]">{ticket.subject}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone="neutral">{t(`myTickets.priority.${ticket.priority}`)}</Badge>
                  <Badge tone={statusTone(ticket.status)}>{t(`myTickets.status.${ticket.status}`)}</Badge>
                </span>
              </button>

              {expanded && (
                <div className="border-t border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-3 py-3">
                  {ticket.messages.length === 0 ? (
                    <p className="text-sm text-[var(--fp-text-muted)]">{t("myTickets.noMessages")}</p>
                  ) : (
                    /* Oldest first, as the server ordered them, so the exchange reads
                       forward like a conversation rather than backwards like a log. */
                    <ul className="space-y-2">
                      {ticket.messages.map((message) => (
                        <li
                          key={message.id}
                          className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-2.5"
                        >
                          <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
                            {message.author_role === "admin" ? t("myTickets.fromTeam") : t("myTickets.fromYou")} ·{" "}
                            {formatWhen(message.created_at)}
                          </p>
                          {/* Plain text. Never markup. */}
                          <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--fp-text)]">{message.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
