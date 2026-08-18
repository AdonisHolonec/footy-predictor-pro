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
        /**
         * No `whitespace-nowrap`: it fought `max-w` and the text won. The cap
         * sizes the BOX, nowrap keeps the line intact, so a label wider than
         * 16rem painted straight through the edge of it and dragged the whole
         * document's scrollWidth along — 433px on a 390px phone.
         *
         * It only showed on some machines because the stack is
         * `Archivo, system-ui, sans-serif` and Archivo is blocked by the CSP:
         * every platform renders these labels in a different fallback, and the
         * wider ones overflowed. Wrapping removes the dependency on whichever
         * font a given device happens to substitute.
         */
        className={`pointer-events-none absolute top-full z-[var(--fp-z-tooltip)] mt-2 max-w-[min(16rem,calc(100vw-1.5rem))] rounded-md bg-[var(--fp-navy)] px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity duration-[var(--fp-ease)] group-focus-within/tip:opacity-100 group-active/tip:opacity-100 [@media(hover:hover)]:group-hover/tip:opacity-100 ${pos}`}
      >
        {label}
      </span>
    </span>
  );
}
