import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
};

const variantClass: Record<Variant, string> = {
  primary:
    "bg-[var(--fp-accent)] text-white hover:bg-[var(--fp-accent-hover)] disabled:opacity-50",
  secondary:
    "border border-[var(--fp-border)] bg-[var(--fp-bg-elevated)] text-[var(--fp-text)] hover:border-[var(--fp-border-strong)] disabled:opacity-50",
  ghost: "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)] disabled:opacity-50",
  danger: "bg-[var(--fp-danger)]/15 text-[var(--fp-danger)] hover:bg-[var(--fp-danger)]/25 disabled:opacity-50"
};

const sizeClass: Record<Size, string> = {
  sm: "min-h-9 px-3 text-xs",
  md: "min-h-[var(--fp-touch)] px-4 text-sm",
  lg: "min-h-12 px-5 text-sm font-semibold"
};

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
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--fp-radius-sm)] font-semibold transition duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] active:scale-[0.98] ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {loading ? "…" : children}
    </button>
  );
}
