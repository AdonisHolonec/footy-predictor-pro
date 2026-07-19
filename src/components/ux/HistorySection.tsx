import type { HistoryEntry } from "../../types";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import { useLocale } from "../../context/LocaleContext";
import type { ReactNode } from "react";

type Props = {
  history: HistoryEntry[];
  trackerSlot?: ReactNode;
  pendingCount: number;
  wins: number;
  losses: number;
  settled: number;
  winRate: number;
};

function toneFor(v?: string): "success" | "danger" | "warning" | "neutral" {
  if (v === "win") return "success";
  if (v === "loss") return "danger";
  if (v === "pending") return "warning";
  return "neutral";
}

export default function HistorySection({
  history,
  trackerSlot,
  pendingCount,
  wins,
  losses,
  settled,
  winRate
}: Props) {
  const { t } = useLocale();
  const rows = [...history].sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || "")));

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

      {!rows.length ? (
        <Card>
          <p className="text-sm text-[var(--fp-text-muted)]">{t("history.empty")}</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 80).map((row) => (
            <li key={String(row.id ?? `${row.teams?.home}-${row.teams?.away}-${row.kickoff}`)}>
              <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] text-[var(--fp-text-muted)]">
                    {row.league || "—"} · {row.kickoff ? String(row.kickoff).slice(0, 16).replace("T", " ") : "—"}
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
                <Badge tone={toneFor(row.validation)}>{labelFor(row.validation)}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
