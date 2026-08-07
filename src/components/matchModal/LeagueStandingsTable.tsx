/**
 * LeagueStandingsTable — moved verbatim from MatchModal.tsx (Sprint 7). Behavior unchanged.
 */

import { useLocale } from "../../context/LocaleContext";
import type { LeagueStandingEntry } from "../../types";

export default function LeagueStandingsTable({
  rows,
  highlightHomeId,
  highlightAwayId
}: {
  rows: LeagueStandingEntry[];
  highlightHomeId?: number;
  highlightAwayId?: number;
}) {
  const { t } = useLocale();
  return (
    <div className="max-h-56 overflow-auto rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]">
      <table className="w-full min-w-[480px] text-left text-xs">
        <thead className="sticky top-0 z-[1] border-b border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]">
          <tr className="uppercase tracking-wide">
            <th className="px-2 py-2 font-bold">#</th>
            <th className="px-2 py-2 font-bold">{t("match.team")}</th>
            <th className="px-2 py-2 font-bold">{t("match.played")}</th>
            <th className="px-2 py-2 font-bold">{t("match.points")}</th>
            <th className="px-2 py-2 font-bold">{t("match.gfGa")}</th>
            <th className="px-2 py-2 font-bold">{t("match.form")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hi = r.teamId === highlightHomeId || r.teamId === highlightAwayId;
            return (
              <tr
                key={r.teamId}
                className={`border-t border-[var(--fp-border)] ${hi ? "bg-[var(--fp-accent-muted)]" : "bg-[var(--fp-bg-card)] hover:bg-[var(--fp-bg-muted)]"}`}
              >
                <td className="px-2 py-1.5 font-semibold tabular-nums text-[var(--fp-text)]">{r.rank ?? "—"}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-2">
                    {r.logo ? <img src={r.logo} alt="" className="h-5 w-5 shrink-0 object-contain" /> : null}
                    <span className={`font-semibold ${hi ? "text-[var(--fp-accent)]" : "text-[var(--fp-text)]"}`}>
                      {r.teamName}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-1.5 tabular-nums text-[var(--fp-text-muted)]">{r.played ?? "—"}</td>
                <td className="px-2 py-1.5 font-bold tabular-nums text-[var(--fp-text)]">{r.points ?? "—"}</td>
                <td className="px-2 py-1.5 tabular-nums text-[var(--fp-text-muted)]">
                  {r.goalsFor ?? "—"}-{r.goalsAgainst ?? "—"}
                </td>
                <td className="px-2 py-1.5 font-semibold tracking-tight text-[var(--fp-text)]">{r.form || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

