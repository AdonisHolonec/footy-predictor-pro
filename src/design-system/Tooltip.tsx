import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
  /** Edge-safe placement for trailing header icons on narrow screens. */
  align?: "center" | "start" | "end";
};

/** Hover/focus/press tooltip — desktop hover + touch active/focus. */
export default function Tooltip({ label, children, className = "", align = "center" }: Props) {
  const pos =
    align === "end"
      ? "left-auto right-0 translate-x-0"
      : align === "start"
        ? "left-0 translate-x-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span className={`group/tip relative inline-flex ${className}`} title={label}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-[100] mt-2 max-w-[min(16rem,calc(100vw-1.5rem))] whitespace-nowrap rounded-md bg-[var(--fp-navy)] px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity duration-[var(--fp-ease)] group-focus-within/tip:opacity-100 group-active/tip:opacity-100 [@media(hover:hover)]:group-hover/tip:opacity-100 ${pos}`}
      >
        {label}
      </span>
    </span>
  );
}
