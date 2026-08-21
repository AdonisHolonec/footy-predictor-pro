import type { ReactNode } from "react";

/**
 * The list surface MatchListRow items sit in: one bordered panel, rows
 * separated by hairlines (the rows own their own bottom border), never a grid
 * of cards. Home and Matches share it so the two surfaces read as one product.
 */
export default function MatchList({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul
      aria-label={label}
      className="m-0 list-none overflow-hidden rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-0 shadow-fp-sm"
    >
      {children}
    </ul>
  );
}
