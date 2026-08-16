import type { ReactNode } from "react";

export type SegmentedOption<V extends string> = {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  /** tabs mode only: id of the panel this tab controls, when one exists. */
  ariaControls?: string;
};

type Props<V extends string> = {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /**
   * The two a11y contracts are deliberately explicit and NOT interchangeable:
   *  - "toggle" — a FILTER (options select what a list shows):
   *     role="group" + aria-pressed;
   *  - "tabs" — a PANEL SWITCHER (options swap visible content):
   *     role="tablist"/"tab" + aria-selected (+ aria-controls when a panel
   *     id exists). Forcing filters into tablist semantics misleads assistive
   *     tech about what activation does.
   */
  mode: "toggle" | "tabs";
  /** Accessible name for the whole control. */
  "aria-label"?: string;
  disabled?: boolean;
  /** tinted = accent wash on the active option (app default);
      solid = filled accent (GSB product selector family). */
  variant?: "tinted" | "solid";
  /** track = bordered card track around the options; bare = options only
      (the scrolling tab strips). */
  frame?: "track" | "bare";
  /** Option height: sm = 36px, touch = 44px (--fp-touch). */
  size?: "sm" | "touch";
  /**
   * Replaces the option padding/typography block entirely (default
   * "px-2.5 text-xs") — an override REPLACES rather than appends, so call
   * sites keep their exact type scale without conflicting utility classes.
   */
  optionClassName?: string;
  /** Extra container classes (wrap/scroll behaviour stays with the caller). */
  className?: string;
  /** Rendered inside the track after the options (e.g. an adjacent checkbox). */
  trailing?: ReactNode;
};

const activeClass: Record<"tinted" | "solid", string> = {
  tinted: "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]",
  solid: "bg-[var(--fp-accent)] text-white shadow-sm"
};

const idleClass = "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]";

const heightClass: Record<"sm" | "touch", string> = {
  sm: "h-9 shrink-0",
  touch: "min-h-[var(--fp-touch)]"
};

/**
 * One segmented control (PR 4) for the seven hand-rolled implementations the
 * audit found — one look family, one of two explicit a11y contracts, chosen
 * by the caller. Option ORDER is the caller's: PR 4 reorders nothing (IA is
 * a later phase).
 */
export default function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  mode,
  "aria-label": ariaLabel,
  disabled,
  variant = "tinted",
  frame = "track",
  size = "sm",
  optionClassName = "px-2.5 text-xs",
  className = "",
  trailing
}: Props<V>) {
  const isTabs = mode === "tabs";
  const container =
    frame === "track"
      ? "inline-flex flex-wrap items-center gap-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-1"
      : "flex items-center gap-0.5";
  return (
    <div role={isTabs ? "tablist" : "group"} aria-label={ariaLabel} className={`${container} ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={isTabs ? "tab" : undefined}
            aria-selected={isTabs ? active : undefined}
            aria-controls={isTabs ? option.ariaControls : undefined}
            aria-pressed={isTabs ? undefined : active}
            title={option.title}
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-md font-bold transition duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--fp-accent)] disabled:cursor-not-allowed disabled:opacity-50 ${
              heightClass[size]
            } ${optionClassName} ${active ? activeClass[variant] : idleClass}`}
          >
            {option.label}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}
