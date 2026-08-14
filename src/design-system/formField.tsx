import { useId } from "react";
import type { ReactNode } from "react";

/**
 * The parts every labelled form control repeats: a label bound to the control,
 * an optional description, an error message, and the wiring that tells a screen
 * reader which of those belong to the field.
 *
 * Input, Textarea and Select differ only in the element they render — the label,
 * the description, the error and the aria plumbing are identical. Keeping that
 * here means a fix to the association logic lands in all three at once, and the
 * three components stay small enough to read in one screen.
 */

export type FieldProps = {
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  className?: string;
};

/**
 * Stable ids for the control and the two texts that describe it.
 *
 * `useId` rather than a counter: the same field rendered twice on a page must
 * not collide, and React owns uniqueness across concurrent renders. `id` is
 * still accepted from the caller so an existing form can keep its own naming.
 *
 * `describedBy` is undefined rather than an empty string when there is nothing
 * to describe — `aria-describedby=""` points at no element and some screen
 * readers announce the failed lookup.
 */
export function useFieldIds(id: string | undefined, hasDescription: boolean, hasError: boolean) {
  const generated = useId();
  const fieldId = id || `fp-field-${generated}`;
  const descriptionId = hasDescription ? `${fieldId}-description` : undefined;
  const errorId = hasError ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return { fieldId, descriptionId, errorId, describedBy };
}

/** Shared control classes. `glass-input` is the app's existing form surface — see index.css. */
export const FIELD_CONTROL_CLASS =
  "glass-input w-full rounded-xl px-3 py-2.5 text-sm text-[var(--fp-text)] outline-none transition duration-[var(--fp-ease)] " +
  "focus:ring-2 focus:ring-[var(--fp-accent)]/35 disabled:cursor-not-allowed disabled:opacity-50";

/** Applied on top of the base class when the field is in an error state. */
export const FIELD_ERROR_CLASS = "border-[var(--fp-danger)]/60 focus:ring-[var(--fp-danger)]/35";

export function FieldLabel({
  htmlFor,
  children,
  required
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-[var(--fp-text-muted)]">
      {children}
      {/* The asterisk is decorative — `required` on the control is what assistive
          tech announces, so repeating it in the accessible name adds noise. */}
      {required ? (
        <span aria-hidden="true" className="ml-1 text-[var(--fp-danger)]">
          *
        </span>
      ) : null}
    </label>
  );
}

export function FieldDescription({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-[11px] leading-relaxed text-[var(--fp-text-faint)]">
      {children}
    </p>
  );
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  // role="alert" so the message is announced when it appears after a failed submit.
  return (
    <p id={id} role="alert" className="mt-1 text-[11px] font-medium text-[var(--fp-danger)]">
      {children}
    </p>
  );
}
