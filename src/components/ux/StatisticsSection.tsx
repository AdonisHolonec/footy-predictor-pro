import { lazy, Suspense, type ReactNode } from "react";
import { useLocale } from "../../context/LocaleContext";
import Card from "../../design-system/Card";
import Skeleton from "../../design-system/Skeleton";

const TrackRecordSection = lazy(() => import("../TrackRecordSection"));

type Props = {
  trackerSlot?: ReactNode;
  winRate: number;
  settled: number;
  wins: number;
  losses: number;
};

export default function StatisticsSection({ trackerSlot, winRate, settled, wins, losses }: Props) {
  const { t } = useLocale();
  return (
    <section className="space-y-4">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--fp-accent)]">{t("stats.eyebrow")}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-[var(--fp-text)]">{t("stats.title")}</h1>
        <p className="mt-1.5 text-sm font-medium text-[var(--fp-text-muted)]">{t("stats.sub")}</p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: t("stats.successRate"), value: settled ? `${winRate.toFixed(1)}%` : "—", accent: "text-[var(--fp-accent)]" },
          { label: t("stats.wins"), value: String(wins), accent: "text-[var(--fp-success)]" },
          { label: t("stats.losses"), value: String(losses), accent: "text-[var(--fp-danger)]" },
          { label: t("stats.settled"), value: String(settled), accent: "text-[var(--fp-text)]" }
        ].map((k) => (
          <Card key={k.label} padding="sm">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">{k.label}</p>
            <p className={`mt-1 font-display text-xl font-bold tabular-nums ${k.accent}`}>{k.value}</p>
          </Card>
        ))}
      </div>

      {trackerSlot}

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <TrackRecordSection days={45} showLinkToFull compact={false} />
      </Suspense>
    </section>
  );
}
