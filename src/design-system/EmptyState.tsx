import type { ReactNode } from "react";
import Button from "./Button";

type Props = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Everything about the action's STATE, spread onto the button: inert
   * semantics, accessible name, tooltip, the state attribute. For Predict this
   * is `predictSurfaceProps(action)`.
   *
   * There is deliberately no `actionDisabled` beside it any more. This
   * component used to take both, and its Predict callers passed both — the
   * native `disabled` attribute AND `aria-disabled` with the reason as the
   * accessible name. Those are two different interaction models and the pair
   * cancels out: the native attribute pulls the control from the tab order, so
   * the name carrying the reason became unreachable by the very users it was
   * added for. One model, chosen here: `aria-disabled`, focusable, and it can
   * say why.
   */
  actionProps?: Record<string, unknown>;
  icon?: ReactNode;
};

/** Guided empty state: what happened · why · what to do next. */
export default function EmptyState({ title, description, actionLabel, onAction, actionProps, icon }: Props) {
  return (
    <div className="grid min-h-[240px] place-items-center rounded-[var(--fp-radius-lg)] border border-dashed border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-6 py-10 text-center">
      {icon && <div className="mb-3 text-[var(--fp-text-faint)]">{icon}</div>}
      <h3 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">{title}</h3>
      <p className="mt-2 max-w-sm text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{description}</p>
      {/*
        No `disabled` prop below: the inert semantics arrive with actionProps,
        and Button now carries a real blocked skin for aria-disabled. Setting
        the native attribute as well would take the control out of the tab
        order and silence the reason it is carrying.
      */}
      {actionLabel && onAction && (
        <Button className="mt-5" onClick={onAction} {...actionProps}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
