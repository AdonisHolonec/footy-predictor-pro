import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { getOverlayRoot } from "./overlayInfra";

type Props = {
  message: string | null;
  onDismiss: () => void;
  /**
   * Auto-dismiss delay. `null` disables auto-dismiss entirely (the toast stays
   * until closed). The old fixed 2.2s gave slower readers no chance and no
   * recourse — the default is longer and, more importantly, escapable.
   */
  durationMs?: number | null;
  /** Accessible name for the close button — pass t("common.close"). */
  dismissLabel: string;
  /** Optional inline action (e.g. an "Undo" Button). */
  action?: ReactNode;
  /**
   * Extra classes for the toast surface. Empty by default, so every existing
   * caller renders exactly as before.
   *
   * It exists for WIDTH. `left-1/2` makes the shrink-to-fit available width half
   * the viewport, so on a 390px screen the surface stops at ~194px and the
   * `max-w` below never binds — fine for "Copiat", cramped for a sentence. A
   * caller with a long message can pass an explicit `w-…` to opt out.
   */
  className?: string;
};

/**
 * Toast (PR 4) — same single-message contract the app already had (one
 * caller owns the message string), consolidated to be escapable and honest:
 *
 *  - an explicit, keyboard-focusable close button (the old toast could ONLY
 *    time out — nothing to click, nothing to Tab to);
 *  - the countdown PAUSES while the pointer or focus is inside, so the toast
 *    never disappears mid-read or mid-interaction;
 *  - aria-live=polite, announced as before.
 *
 * PR 5: renders through the shared #overlay-root portal so it escapes any
 * transformed/isolated ancestor and never lands inside an inert #root. It
 * shares the CONTAINER only — a toast is not modal, so it never joins the
 * overlay stack, never locks scroll and never consumes Escape.
 */
export default function Toast({ message, onDismiss, durationMs = 5000, dismissLabel, action, className = "" }: Props) {
  const timer = useRef<number | null>(null);
  const remaining = useRef<number | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!message || durationMs == null) return;
    remaining.current = durationMs;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(onDismiss, durationMs);
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [message, durationMs, onDismiss]);

  const pause = () => {
    if (timer.current == null || remaining.current == null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
  };

  const resume = () => {
    if (!message || durationMs == null || timer.current != null || remaining.current == null) return;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(onDismiss, remaining.current);
  };

  if (!message) return null;

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className={`fixed bottom-24 left-1/2 z-[var(--fp-z-toast)] flex max-w-[min(92vw,24rem)] -translate-x-1/2 items-center gap-2 rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-elevated)] px-4 py-3 text-sm text-[var(--fp-text)] shadow-lg lg:bottom-8 ${className}`}
    >
      <span className="min-w-0 flex-1">{message}</span>
      {action}
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={onDismiss}
        className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-[var(--fp-radius-sm)] text-[var(--fp-text-muted)] transition hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>,
    getOverlayRoot()
  );
}
