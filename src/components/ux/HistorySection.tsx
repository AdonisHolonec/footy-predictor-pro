import { useMemo, useState } from "react";
import type { HistoryEntry } from "../../types";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import { useLocale } from "../../context/LocaleContext";
import type { ReactNode } from "react";
import HistorySpecialBetCard from "./HistorySpecialBetCard";

type Props = {
  history: HistoryEntry[];
  trackerSlot?: ReactNode;
  pendingCount: number;
  wins: number;
  losses: number;
  settled: number;
  winRate: number;
  /** Open full match analysis (MatchModal). */
  onOpenMatch?: (row: HistoryEntry) => void;
};

function toneFor(v?: string): "success" | "danger" | "warning" | "neutral" {
  if (v === "win") return "success";
  if (v === "loss") return "danger";
  if (v === "pending") return "warning";
  return "neutral";
}

function rowKey(row: HistoryEntry): string {
  return String(row.id ?? `${row.teams?.home}-${row.teams?.away}-${row.kickoff}`);
}

export default function HistorySection({
  history,
  trackerSlot,
  pendingCount,
  wins,
  losses,
  settled,
  winRate,
  onOpenMatch
}: Props) {
  const { t } = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(
    () => [...history].sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || ""))),
    [history]
  );

  const selected = useMemo(
    () => (selectedId ? rows.find((r) => rowKey(r) === selectedId) || null : null),
    [rows, selectedId]
  );

  const labelFor = (v?: string) => {
    if (v === "win") return t("history.win");
    if (v === "loss") return t("history.loss");
    if (v === "pending") return t("history.pendingBadge");
    return String(v || "—").toUpperCase();
  };

  return (
    <section className="space-y-6">
      <header>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          {t("history.eyebrow")}
        </p>
        <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold">{t("history.title")}</h1>
        <p className="mt-2 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">{t("history.sub")}</p>
      </header>

      {trackerSlot}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("history.successRate"), value: settled ? `${winRate.toFixed(1)}%` : "—" },
          { label: "W / L", value: `${wins} / ${losses}` },
          { label: t("history.pending"), value: String(pendingCount) },
          { label: t("history.settled"), value: String(settled) }
        ].map((k) => (
          <Card key={k.label} padding="sm">
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-text-muted)]">
              {k.label}
            </p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums">{k.value}</p>
          </Card>
        ))}
      </div>

      {selected ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">
              {t("history.selectedMatch")}
            </p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-xs font-semibold text-[var(--fp-accent)] hover:underline"
            >
              {t("history.clearSelection")}
            </button>
          </div>
          <HistorySpecialBetCard row={selected} onOpenDetails={onOpenMatch} />
        </div>
      ) : null}

      {!rows.length ? (
        <Card>
          <p className="text-sm text-[var(--fp-text-muted)]">{t("history.empty")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 80).map((row) => {
            const id = rowKey(row);
            const active = selectedId === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(active ? null : id)}
                  aria-pressed={active}
                  className={`w-full rounded-[var(--fp-radius)] text-left transition-[box-shadow,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] ${
                    active
                      ? "ring-2 ring-[var(--fp-success)]/50"
                      : "hover:ring-1 hover:ring-[var(--fp-border)]"
                  }`}
                >
                  <Card
                    padding="sm"
                    className={`flex flex-wrap items-center justify-between gap-3 ${
                      active ? "border-[var(--fp-success)]/40 bg-[var(--fp-success)]/5" : ""
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {row.logos?.home || row.logos?.away ? (
                        <div className="flex shrink-0 items-center -space-x-1.5">
                          {row.logos?.home ? (
                            <img src={row.logos.home} alt="" className="h-6 w-6 rounded-full bg-[var(--fp-bg-muted)] object-contain" />
                          ) : null}
                          {row.logos?.away ? (
                            <img src={row.logos.away} alt="" className="h-6 w-6 rounded-full bg-[var(--fp-bg-muted)] object-contain" />
                          ) : null}
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-mono text-[10px] text-[var(--fp-text-muted)]">
                          {row.league || "—"} ·{" "}
                          {row.kickoff ? String(row.kickoff).slice(0, 16).replace("T", " ") : "—"}
                        </p>
                        <p className="mt-0.5 truncate font-semibold">
                          {row.teams?.home || "?"} {t("common.vs")} {row.teams?.away || "?"}
                        </p>
                        <p className="mt-0.5 text-sm text-[var(--fp-text-muted)]">
                          {t("history.topPick")}{" "}
                          <span className="text-[var(--fp-text)]">{row.recommended?.pick || "—"}</span>
                          {row.score?.home != null && row.score?.away != null
                            ? ` · ${t("history.score", { home: row.score.home, away: row.score.away })}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <Badge tone={toneFor(row.validation)}>{labelFor(row.validation)}</Badge>
                  </Card>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
