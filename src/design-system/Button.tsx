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
  return (
    <button
      type="button"
      disabled={disabled || loading}
      /* Loading (PR 4): spinner BESIDE the label, never instead of it. The old
         behaviour swapped children for a literal "…", so the accessible name of
         every in-flight action became "…" and the button visibly changed size.
         Same API — callers keep passing `loading` exactly as before. */
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--fp-radius-sm)] font-semibold transition duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] active:scale-[0.98] ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
