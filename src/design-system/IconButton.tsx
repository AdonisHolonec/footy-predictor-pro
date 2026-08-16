import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "outline" | "ghost" | "solid";
type Size = "sm" | "md";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Required: an icon-only control has no text to name it. */
  "aria-label": string;
  /** The glyph/icon. Marked aria-hidden by the wrapper — the label names the control. */
  children: ReactNode;
  variant?: Variant;
  /** md = 44px (--fp-touch, the default for critical actions); sm = 36px, allowed in dense toolbars only. */
  size?: Size;
  /** Round shape for the close-✕ family; square (radius-sm) is the toolbar default. */
  shape?: "square" | "round";
  pressed?: boolean;
};

const variantClass: Record<Variant, string> = {
  outline:
    "border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)] hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)] disabled:opacity-50 disabled:cursor-not-allowed",
  solid:
    "bg-[var(--fp-accent)] text-white hover:bg-[var(--fp-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
};

const sizeClass: Record<Size, string> = {
  md: "h-[var(--fp-touch)] min-w-[var(--fp-touch)]",
  sm: "h-9 min-w-9"
};

/**
 * Icon-only button (PR 4) — one primitive for the four hand-rolled shapes the
 * audit found (36px bordered toolbar squares, 44px card squares, 44px round
 * closes, borderless shell buttons). Contract: an aria-label is REQUIRED (the
 * type makes it non-optional), the glyph itself is aria-hidden, type="button"
 * unless told otherwise, and the theme focus ring applies like everywhere else.
 * Not for links, checkboxes or text buttons — those keep their own semantics.
 */
const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton(
  {
    "aria-label": ariaLabel,
    children,
    variant = "outline",
    size = "md",
    shape = "square",
    pressed,
    className = "",
    type,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      className={`inline-flex items-center justify-center transition duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] active:scale-[0.96] ${
        shape === "round" ? "rounded-full" : "rounded-[var(--fp-radius-sm)]"
      } ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {children}
      </span>
    </button>
  );
});

export default IconButton;
