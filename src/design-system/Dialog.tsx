import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

type Size = "sm" | "md" | "lg";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: Size;
  /** Set false when a half-filled form would be lost by a stray click on the backdrop. */
  closeOnBackdrop?: boolean;
  className?: string;
};

/**
 * Modal dialog.
 *
 * The surface is the one MatchModal already established — same backdrop tint and
 * blur, same rounded card, same shadow — so this reads as the app's one modal
 * language rather than a second one. What is new here is only what a reusable
 * primitive has to own and an inline modal can hand-wave: Escape, focus, and a
 * body that does not scroll behind the panel.
 *
 * MatchModal itself is deliberately NOT rebuilt on top of this. It renders three
 * different shells depending on data availability and presentation mode, each with
 * its own width and border treatment; folding those into a generic Dialog would be
 * a behavioural refactor of the prediction surface, which this increment is scoped
 * to leave untouched.
 *
 * `--fp-z-modal` (60) rather than MatchModal's literal `z-50`: the token exists for
 * exactly this layer, and it keeps a dialog above dropdowns (50) while leaving
 * toasts (70) visible on top — a form that fails validation must still be able to
 * tell the user why.
 *
 * FOCUS. On open, focus moves to the panel and Tab is contained inside it; on
 * close, it returns to whatever was focused before. Containment is a plain
 * wrap-around over the panel's tabbable elements — enough for a form dialog, and
 * without the aria-hidden bookkeeping a full inert-background implementation
 * would need.
 */

const sizeClass: Record<Size, string> = {
  sm: "max-w-md",
  md: "max-w-lg sm:max-w-xl",
  lg: "max-w-lg sm:max-w-2xl"
};

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  className = ""
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const generatedId = useId();
  const titleId = `fp-dialog-${generatedId}-title`;
  const descriptionId = `fp-dialog-${generatedId}-description`;

  // Escape and Tab are handled on document because focus may sit on the panel
  // itself, which is not a descendant that would receive a bubbled React event
  // from a child-less dialog.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        // Nothing to move to — keep focus on the panel rather than letting it
        // escape to the page behind.
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Focus in on open, back out on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  // The page behind must not scroll while the dialog is up — on a 390px screen a
  // scrolling background under a modal reads as the modal itself being broken.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--fp-z-modal)] flex items-center justify-center bg-fp-navy/88 p-3 backdrop-blur-md sm:p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-[90vh] w-full ${sizeClass[size]} overflow-y-auto rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-fp-bg-card/95 p-5 shadow-fp-lg backdrop-blur-xl focus-visible:outline-none sm:p-8 ${className}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-lg font-semibold text-[var(--fp-text)]">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-[11px] leading-relaxed text-[var(--fp-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--fp-border)] text-sm text-[var(--fp-text-muted)] hover:border-fp-accent/40 hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fp-accent/45"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 text-sm text-[var(--fp-text)]">{children}</div>

        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
