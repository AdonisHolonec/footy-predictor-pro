import IconButton from "./IconButton";
import Overlay from "./Overlay";
import { useId } from "react";
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
  /**
   * A submit in flight that cannot be cancelled: X, Escape and backdrop are
   * all refused together (the audit found dialogs whose Cancel was disabled
   * while X and Escape still dismissed the form mid-request).
   */
  busy?: boolean;
  className?: string;
};

/**
 * Modal dialog — the app's one titled-modal chrome, now sitting on the shared
 * Overlay engine (PR 5): same portal root, same ESC stack (only the top
 * overlay consumes Escape), same ref-counted scroll lock, same focus
 * trap/restore, same background isolation as every other overlay. This file
 * keeps only what is Dialog-specific: the panel chrome, title/description
 * wiring and the close button.
 */

const sizeClass: Record<Size, string> = {
  sm: "max-w-md",
  md: "max-w-lg sm:max-w-xl",
  lg: "max-w-lg sm:max-w-2xl"
};

export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  busy = false,
  className = ""
}: Props) {
  const generatedId = useId();
  const titleId = `fp-dialog-${generatedId}-title`;
  const descriptionId = `fp-dialog-${generatedId}-description`;

  return (
    <Overlay
      open={open}
      onClose={onClose}
      presentation="center"
      closeOnBackdrop={closeOnBackdrop}
      busy={busy}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      backdropClassName="bg-fp-navy/88 backdrop-blur-md"
      panelClassName={`max-h-[90vh] w-full ${sizeClass[size]} overflow-y-auto rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-fp-bg-card/95 p-5 shadow-fp-lg backdrop-blur-xl sm:p-8 ${className}`}
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
        <IconButton
          shape="round"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
          className="shrink-0 !text-sm"
        >
          ✕
        </IconButton>
      </div>

      <div className="mt-5 text-sm text-[var(--fp-text)]">{children}</div>

      {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
    </Overlay>
  );
}
