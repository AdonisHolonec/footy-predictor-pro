import type { ReactNode } from "react";
import Button from "./Button";

type Props = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** The action exists but cannot run right now. */
  actionDisabled?: boolean;
  /**
   * Extra props spread onto the action button — accessible name, tooltip,
   * inert semantics. For Predict this is `predictSurfaceProps(action)`, which
   * is what keeps the reason reachable without printing it twice: the
   * description states it, and this carries it to assistive technology.
   */
  actionProps?: Record<string, unknown>;
  icon?: ReactNode;
};

/** Guided empty state: what happened · why · what to do next. */
export default function EmptyState({ title, description, actionLabel, onAction, actionDisabled = false, actionProps, icon }: Props) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[var(--fp-radius-lg)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-6 py-10 text-center">
      {icon && <div className="mb-3 text-[var(--fp-text-faint)]">{icon}</div>}
      <h3 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">{title}</h3>
      <p className="mt-2 max-w-sm text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{description}</p>
      {actionLabel && onAction && (
        <Button className="mt-5" onClick={onAction} disabled={actionDisabled} {...actionProps}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
