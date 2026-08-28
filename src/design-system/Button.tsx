import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
};

/*
  THE INK ON AN ACCENT FILL IS A TOKEN, NEVER A LITERAL.

  `text-white` was measured on the primary fill in all three themes and failed
  4.5:1 in two of them — 2.87 on dark and 1.78 on high contrast, on 14px
  semibold text. The accent is GREEN in those themes; white was only ever
  legible against the light theme's red.

  `--fp-on-accent` is the ink that flips with the theme, and switching to it
  reads 6.81 and 11.77 — the same rule the Predict CTA and its busy rail already
  follow, which is why they measured clean while the Button beneath them did
  not. Light stays at 4.20: there the token IS white, and clearing 4.5 needs the
  light accent itself to darken to roughly its own hover step, which measures
  4.74. That is a brand-token decision, recorded and not taken here.

  (No colour literals in this comment: primitives.guard.test.ts scans this file
  for hex and cannot tell a value from a measurement written about one.)
*/
const variantClass: Record<Variant, string> = {
  primary:
    "bg-[var(--fp-accent)] text-[var(--fp-on-accent)] hover:bg-[var(--fp-accent-hover)] active:bg-[var(--fp-accent-hover)] active:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "border border-[var(--fp-border)] bg-[var(--fp-bg-elevated)] text-[var(--fp-text)] hover:border-[var(--fp-border-strong)] hover:bg-[var(--fp-bg-muted)] active:border-[var(--fp-border-strong)] active:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost: "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)] active:opacity-70 disabled:opacity-50 disabled:cursor-not-allowed",
  danger: "bg-fp-danger/15 text-[var(--fp-danger)] hover:bg-fp-danger/25 active:bg-fp-danger/35 disabled:opacity-50 disabled:cursor-not-allowed"
};

/*
  THE BLOCKED SKIN, for controls that opt out of the native attribute.

  A control carrying `aria-disabled` is still enabled as far as the browser is
  concerned, so NONE of the `disabled:` utilities above match it. Every Button
  handed `predictSurfaceProps(action)` therefore rendered a blocked action at
  full primary fill with a normal cursor and a working press animation, while
  its onClick did nothing — the Banner retry shipped exactly that. A dead
  control that looks alive is the defect the Predict contract exists to remove,
  and it was reintroduced one altitude below the contract, in the primitive.

  The treatment is the same recessed language the Predict CTA uses — declared
  surface, ink and boundary tokens rather than a blanket fade — because an
  aria-disabled control stays focusable and can be landed on, so it is not an
  "inactive component" and does not get WCAG's contrast exemption: its label
  still owes 4.5:1 and its edge 3:1. `disabled:opacity-50` above is untouched
  and remains correct for natively disabled buttons, which no one can reach.

  `aria-disabled:hover:` and `aria-disabled:active:` are spelled out rather than
  left to variant ordering: the hover and active utilities in every variant
  above have equal specificity, so which one wins would otherwise depend on the
  order Tailwind happens to emit them in.
*/
const ARIA_DISABLED_CLASS =
  "aria-disabled:cursor-not-allowed aria-disabled:shadow-none " +
  "aria-disabled:border aria-disabled:border-[var(--fp-disabled-border)] " +
  "aria-disabled:bg-[var(--fp-disabled-surface)] aria-disabled:text-[var(--fp-disabled-ink)] " +
  "aria-disabled:hover:border-[var(--fp-disabled-border)] " +
  "aria-disabled:hover:bg-[var(--fp-disabled-surface)] aria-disabled:hover:text-[var(--fp-disabled-ink)] " +
  /* No press feedback on a control that will refuse — the base `active:scale`
     and every variant's `active:` colour shift are both cancelled here. */
  "aria-disabled:active:scale-100 aria-disabled:active:opacity-100 " +
  "aria-disabled:active:bg-[var(--fp-disabled-surface)] aria-disabled:active:border-[var(--fp-disabled-border)]";

const sizeClass: Record<Size, string> = {
  sm: "min-h-9 px-3 text-xs",
  md: "min-h-[var(--fp-touch)] px-4 text-sm",
  lg: "min-h-12 px-5 text-sm font-semibold"
};

/**
 * The one loading spinner (PR 4). Inline SVG so no icon dependency; currentColor
 * follows the variant's text colour; motion-reduce respects the user setting.
 */
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className = "",
  children,
  ...rest
}: Props) {
  /*
    ONE INERTNESS MODEL PER CONTROL.

    `loading` used to set the native attribute unconditionally. For a caller
    that also passes `aria-disabled` — every Predict surface built on this
    primitive — that produced both models at once on the same button: the
    native attribute pulled it out of the tab order, so the busy reason it was
    carrying in its accessible name became unreachable by the users it was for.
    It also read inconsistently, because a busy Banner faded to 0.5 while a busy
    empty state, differing only in passing `loading`, did not.

    So: a caller that has declared `aria-disabled` owns inertness, and `loading`
    contributes only the spinner and `aria-busy`. A caller that has NOT declared
    it keeps the old behaviour exactly — `loading` still disables natively,
    which is what every non-Predict Button in the app relies on.
  */
  const callerOwnsInertness = rest["aria-disabled"] !== undefined;
  return (
    <button
      type="button"
      disabled={disabled || (loading && !callerOwnsInertness)}
      /* Loading (PR 4): spinner BESIDE the label, never instead of it. The old
         behaviour swapped children for a literal "…", so the accessible name of
         every in-flight action became "…" and the button visibly changed size.
         Same API — callers keep passing `loading` exactly as before. */
      aria-busy={loading || undefined}
      /*
        ARIA_DISABLED_CLASS sits AFTER the variant so its colours win: the two
        have equal specificity and later simply beats earlier.
      */
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--fp-radius-sm)] font-semibold transition duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] active:scale-[0.98] ${variantClass[variant]} ${ARIA_DISABLED_CLASS} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
