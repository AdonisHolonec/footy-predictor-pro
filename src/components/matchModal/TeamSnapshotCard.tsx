/**
 * TeamSnapshotCard — moved verbatim from MatchModal.tsx (Sprint 7). Behavior unchanged.
 */

import { useLocale } from "../../context/LocaleContext";
import type { TeamStandingsFormSnapshot } from "../../types";

export default function TeamSnapshotCard({
  title,
  snap,
  accent
}: {
  title: string;
  snap?: TeamStandingsFormSnapshot | null;
  accent: string;
}) {
  const { t } = useLocale();
  if (!snap) {
    return (
      <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 text-center shadow-[var(--fp-shadow-sm)]">
        <div className="text-[10px] font-bold uppercase text-[var(--fp-text-muted)]">{title}</div>
        <p className="mt-1.5 text-sm text-[var(--fp-text-muted)]">{t("match.noStandings")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-3 shadow-[var(--fp-shadow-sm)]">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--fp-text-muted)]">{title}</div>
      <div className="flex flex-wrap items-baseline gap-2">
        {snap.rank != null && (
          <span className="font-display text-xl font-bold tabular-nums" style={{ color: accent }}>
            #{snap.rank}
          </span>
        )}
        {snap.points != null && (
          <span className="text-sm font-bold tabular-nums text-[var(--fp-text)]">
            {snap.points} {t("match.points")}
          </span>
        )}
        {snap.played != null && (
          <span className="text-xs font-medium text-[var(--fp-text-muted)]">
            · {snap.played} {t("match.matches")}
          </span>
        )}
      </div>
      <div className="mt-1.5 text-sm font-semibold tabular-nums text-[var(--fp-text)]">
        GF {snap.goalsFor ?? "—"} · GA {snap.goalsAgainst ?? "—"}
        {snap.goalsDiff != null && (
          <span className="text-[var(--fp-text-muted)]">
            {" "}
            · GD {snap.goalsDiff > 0 ? "+" : ""}
            {snap.goalsDiff}
          </span>
        )}
      </div>
      {snap.form ? (
        <div className="mt-2">
          <div className="mb-1 text-[10px] font-bold uppercase text-[var(--fp-text-muted)]">{t("match.form")}</div>
          <div className="flex flex-wrap gap-1">
            {snap.form.split("").map((ch, i) => (
              <span
                key={`${ch}-${i}`}
                className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border text-[10px] font-bold ${
                  ch === "W"
                    ? "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/15 text-[var(--fp-success)]"
                    : ch === "L"
                      ? "border-[var(--fp-danger)]/40 bg-[var(--fp-danger)]/15 text-[var(--fp-danger)]"
                      : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)] text-[var(--fp-text-muted)]"
                }`}
              >
                {ch}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

