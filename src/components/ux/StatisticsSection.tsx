import { lazy, Suspense, type ReactNode } from "react";
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
  return (
    <section className="space-y-6">
      <header>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          Statistici
        </p>
        <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold">Statistics</h1>
        <p className="mt-2 text-[length:var(--fp-body)] font-medium text-[var(--fp-text-muted)]">
          Your personal performance and verified public track record.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Success Rate", value: settled ? `${winRate.toFixed(1)}%` : "—", accent: "text-[var(--fp-accent)]" },
          { label: "Wins", value: String(wins), accent: "text-[var(--fp-success)]" },
          { label: "Losses", value: String(losses), accent: "text-[var(--fp-danger)]" },
          { label: "Settled", value: String(settled), accent: "text-[var(--fp-text)]" }
        ].map((k) => (
          <Card key={k.label} padding="sm">
            <p className="text-[length:var(--fp-badge)] font-bold uppercase tracking-wider text-[var(--fp-text-muted)]">
              {k.label}
            </p>
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
