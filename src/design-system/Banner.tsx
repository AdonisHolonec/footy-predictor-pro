import type { ReactNode } from "react";

type Tone = "success" | "warning" | "danger" | "info" | "neutral";

type Props = {
  children: ReactNode;
  tone?: Tone;
  /**
   * Accessibility semantics are chosen by URGENCY, not by colour:
   *  - "alert"  → role="alert" (interrupts AT immediately) — real failures only;
   *  - "status" → role="status"/aria-live=polite — async outcomes worth announcing;
   *  - "none"   → plain landmark-free content — ambient notices.
   * Deliberately NOT defaulted from tone: a red banner that is merely
   * decorative-critical must not spam screen readers.
   */
  live?: "alert" | "status" | "none";
  /** Optional inline action (a Button) rendered at the end. */
  action?: ReactNode;
  className?: string;
};

const toneClass: Record<Tone, string> = {
  success: "border-fp-success/35 bg-fp-success/10 text-[var(--fp-text)]",
  warning: "border-fp-warning/40 bg-fp-warning/10 text-[var(--fp-text)]",
  danger: "border-fp-danger/35 bg-fp-danger/10 text-[var(--fp-text)]",
  info: "border-fp-accent/25 bg-[var(--fp-accent-muted)] text-[var(--fp-text)]",
  neutral: "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text)]"
};

/**
 * Banner (PR 4) — one surface for the seven hand-rolled notice recipes the
 * audit found (the danger tint alone was re-implemented 7×, only 3 of them
 * with a role). Colour comes from the PR-1 tokens; radius/spacing from PR 3;
 * the live-region contract is explicit instead of accidental.
 */
export default function Banner({ children, tone = "neutral", live = "none", action, className = "" }: Props) {
  return (
    <div
      role={live === "alert" ? "alert" : live === "status" ? "status" : undefined}
      aria-live={live === "status" ? "polite" : undefined}
      className={`rounded-[var(--fp-radius)] border px-3 py-2.5 text-sm ${toneClass[tone]} ${className}`}
    >
      {action != null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{children}</div>
          <div className="shrink-0">{action}</div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
