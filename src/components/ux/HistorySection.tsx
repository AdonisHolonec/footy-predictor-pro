import { useMemo, useState } from "react";
import type { HistoryEntry } from "../../types";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import { StatTile } from "../../design-system";
import { useLocale } from "../../context/LocaleContext";
import type { ReactNode } from "react";
import HistorySpecialBetCard from "./HistorySpecialBetCard";
import { formatRecommendedPick } from "../../utils/formatRecommendation";

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
  /** Special Bet is Ultra-only; fails closed (locked) when omitted. */
  canShowSpecialBet?: boolean;
  onUpgradeRequired?: (feature: string, requiredTier: "ultra") => void;
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
  onOpenMatch,
  canShowSpecialBet = false,
  onUpgradeRequired
}: Props) {
  const { t } = useLocale();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(
    () => [...history].sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || ""))),
    [history]
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

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
        <StatTile
          label={t("history.successRate")}
          value={settled ? `${winRate.toFixed(1)}%` : "—"}
          tone={!settled ? "neutral" : winRate >= 50 ? "success" : "warning"}
        />
        <StatTile label="W / L" value={`${wins} / ${losses}`} tone="neutral" />
        <StatTile
          label={t("history.pending")}
          value={String(pendingCount)}
          tone={pendingCount > 0 ? "warning" : "neutral"}
        />
        <StatTile label={t("history.settled")} value={String(settled)} tone="neutral" />
      </div>

      {!rows.length ? (
        <Card>
          <p className="text-sm text-[var(--fp-text-muted)]">{t("history.empty")}</p>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
          {rows.slice(0, 80).map((row, idx, visibleRows) => {
            const id = rowKey(row);
            const active = selectedId === id;
            const isLast = idx === visibleRows.length - 1;
            return (
              <div key={id} className={!isLast || active ? "border-b border-[var(--fp-border)]" : ""}>
                <button
                  type="button"
                  onClick={() => setSelectedId(active ? null : id)}
                  aria-pressed={active}
                  className={`flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--fp-accent)] ${
                    active ? "bg-[var(--fp-success)]/5" : "hover:bg-[var(--fp-bg-muted)]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    {row.logos?.home || row.logos?.away ? (
                      <div className="flex shrink-0 items-center -space-x-1.5">
                        {row.logos?.home ? (
                          <img
                            src={row.logos.home}
                            alt=""
                            className="h-6 w-6 rounded-full bg-[var(--fp-bg-muted)] object-contain"
                          />
                        ) : null}
                        {row.logos?.away ? (
                          <img
                            src={row.logos.away}
                            alt=""
                            className="h-6 w-6 rounded-full bg-[var(--fp-bg-muted)] object-contain"
                          />
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
                        <span className="text-[var(--fp-text)]">
                          {formatRecommendedPick(row.recommended?.pick, row.recommended?.family, t).label}
                        </span>
                        {row.score?.home != null && row.score?.away != null
                          ? ` · ${t("history.score", { home: row.score.home, away: row.score.away })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <Badge tone={toneFor(row.validation)}>{labelFor(row.validation)}</Badge>
                </button>

                {active ? (
                  <div className="border-t border-[var(--fp-border)] bg-[var(--fp-bg-muted)] px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
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
                    <HistorySpecialBetCard
                      row={row}
                      onOpenDetails={onOpenMatch}
                      canShowSpecialBet={canShowSpecialBet}
                      onUpgradeRequired={onUpgradeRequired}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
