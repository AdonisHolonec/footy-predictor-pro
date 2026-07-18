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
        <p className="mt-2 text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
          Performanța ta personală și track record-ul public verificat.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Success Rate", value: settled ? `${winRate.toFixed(1)}%` : "—" },
          { label: "Wins", value: String(wins) },
          { label: "Losses", value: String(losses) },
          { label: "Settled", value: String(settled) }
        ].map((k) => (
          <Card key={k.label} padding="sm">
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-text-muted)]">
              {k.label}
            </p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums">{k.value}</p>
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
