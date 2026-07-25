import type { PredictionRow } from "../../types";
import { isFixtureInPlay } from "../../utils/appUtils";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import EmptyState from "../../design-system/EmptyState";
import StatTile from "../../design-system/StatTile";

type Props = {
  matches: PredictionRow[];
  onOpenMatch: (m: PredictionRow) => void;
  onGoMatches: () => void;
  onGoLive?: () => void;
  onGoHistory?: () => void;
  onGoStatistics?: () => void;
  onPredict?: () => void;
  continueMatch?: PredictionRow | null;
  winRate?: number;
  pendingCount?: number;
  settledCount?: number;
  wins?: number;
  losses?: number;
  usageLabel?: string;
};

function confOf(m: PredictionRow) {
  const c = Number(m.recommended?.confidence);
  return Number.isFinite(c) ? c : 0;
}

function evOf(m: PredictionRow) {
  const e = Number(m.valueBet?.ev ?? m.valueEngine?.expectedValue);
  return Number.isFinite(e) ? e : 0;
}

function isFinal(m: PredictionRow) {
  return ["FT", "AET", "PEN"].includes(String(m.status || "").toUpperCase());
}

function PickTile({
  label,
  match,
  meta,
  onOpen
}: {
  label: string;
  match: PredictionRow | null;
  meta: string;
  onOpen: (m: PredictionRow) => void;
}) {
  if (!match) {
    return (
      <Card>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-text-muted)]">
          {label}
        </p>
        <p className="mt-2 text-sm text-[var(--fp-text-faint)]">Run Predict to unlock today’s picks.</p>
      </Card>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="w-full rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 text-left transition-[border-color,transform] duration-[var(--fp-ease)] hover:border-[var(--fp-accent)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] active:scale-[0.99]"
    >
      <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-accent)]">
        {label}
      </p>
      <p className="mt-2 font-display text-[length:var(--fp-card-title)] font-semibold text-[var(--fp-text)]">
        {match.teams.home} vs {match.teams.away}
      </p>
      <p className="mt-1 text-sm text-[var(--fp-text-muted)]">
        Top Pick <span className="font-semibold text-[var(--fp-text)]">{match.recommended?.pick || "—"}</span>
        {" · "}
        {meta}
      </p>
      {match.league && (
        <p className="mt-2 font-mono text-[length:var(--fp-caption)] text-[var(--fp-text-faint)]">{match.league}</p>
      )}
    </button>
  );
}

export default function HomeSection({
  matches,
  onOpenMatch,
  onGoMatches,
  onGoLive,
  onGoHistory,
  onGoStatistics,
  onPredict,
  continueMatch,
  winRate = 0,
  pendingCount = 0,
  settledCount = 0,
  wins = 0,
  losses = 0,
  usageLabel
}: Props) {
  const playable = matches.filter((m) => !m.insufficientData);
  const byConf = [...playable].sort((a, b) => confOf(b) - confOf(a));
  const bestPick = byConf[0] || null;
  const highestConfidence = byConf.find((m) => m.id !== bestPick?.id) || bestPick;
  const bestValue =
    [...playable]
      .filter((m) => m.valueBet?.detected || evOf(m) > 0)
      .sort((a, b) => evOf(b) - evOf(a))[0] || null;
  const live = playable.filter((m) => isFixtureInPlay(m.status)).slice(0, 6);
  const upcoming = [...playable]
    .filter((m) => !isFinal(m) && !isFixtureInPlay(m.status))
    .slice(0, 6);
  const trending = [...playable]
    .filter((m) => confOf(m) >= 65 || evOf(m) > 0)
    .sort((a, b) => confOf(b) + evOf(b) - (confOf(a) + evOf(a)))
    .slice(0, 5);
  const avgConf = playable.length ? playable.reduce((s, m) => s + confOf(m), 0) / playable.length : 0;
  const valueCount = playable.filter((m) => m.valueBet?.detected || evOf(m) > 0).length;

  if (!matches.length) {
    return (
      <section className="space-y-6">
        <header>
          <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
            Home
          </p>
          <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold tracking-tight">
            Today’s best opportunities
          </h1>
        </header>
        <EmptyState
          title="No predictions yet"
          description="Select your leagues, then run Predict to see Top Picks, Best Value, and Live matches for today."
          actionLabel={onPredict ? "Run Predict" : "Go to Matches"}
          onAction={onPredict || onGoMatches}
        />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          Home
        </p>
        <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold tracking-tight text-[var(--fp-text)]">
          Today’s best opportunities
        </h1>
        <p className="mt-2 max-w-xl text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
          Top Pick, highest confidence, and Best Value — then Live and upcoming fixtures.
        </p>
      </header>

      {/* Today's Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Matches", value: String(matches.length) },
          { label: "Avg confidence", value: avgConf ? `${Math.round(avgConf)}%` : "—" },
          { label: "Best Value spots", value: String(valueCount) },
          { label: "Success Rate", value: winRate ? `${winRate.toFixed(0)}%` : "—" },
          { label: "Live now", value: String(live.length) }
        ].map((k) => (
          <StatTile key={k.label} label={k.label} value={k.value} />
        ))}
      </div>

      {/* Best Pick / Highest Confidence / Best Value */}
      <div className="grid gap-3 md:grid-cols-3">
        <PickTile
          label="Top Pick today"
          match={bestPick}
          meta={bestPick ? `${Math.round(confOf(bestPick))}% confidence` : ""}
          onOpen={onOpenMatch}
        />
        <PickTile
          label="Highest confidence"
          match={highestConfidence}
          meta={highestConfidence ? `${Math.round(confOf(highestConfidence))}% · ${highestConfidence.recommended?.pick || "—"}` : ""}
          onOpen={onOpenMatch}
        />
        <PickTile
          label="Best Value"
          match={bestValue}
          meta={bestValue ? `EV ${evOf(bestValue).toFixed(1)}%` : ""}
          onOpen={onOpenMatch}
        />
      </div>

      {continueMatch && (
        <button
          type="button"
          onClick={() => onOpenMatch(continueMatch)}
          className="flex w-full min-h-[var(--fp-touch)] items-center justify-between rounded-[var(--fp-radius)] border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
        >
          <div>
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-accent)]">
              Continue
            </p>
            <p className="mt-0.5 font-semibold">
              {continueMatch.teams.home} vs {continueMatch.teams.away}
            </p>
          </div>
          <span className="text-sm text-[var(--fp-accent)]">Open →</span>
        </button>
      )}

      {/* Live */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Live matches</h2>
          {onGoLive && (
            <Button variant="ghost" size="sm" onClick={onGoLive}>
              All live
            </Button>
          )}
        </div>
        {!live.length ? (
          <p className="mt-3 text-sm text-[var(--fp-text-muted)]">No live fixtures in your current set.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--fp-border)]">
            {live.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(m)}
                  className="flex w-full min-h-[var(--fp-touch)] items-center justify-between gap-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                >
                  <span>
                    <span className="inline-flex items-center gap-1.5 text-[var(--fp-danger)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--fp-danger)] motion-reduce:animate-none" />
                      LIVE
                    </span>
                    <br />
                    <span className="font-semibold">
                      {m.teams.home} {m.score?.home ?? ""} – {m.score?.away ?? ""} {m.teams.away}
                    </span>
                  </span>
                  <Badge tone="accent">{m.recommended?.pick || "—"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Upcoming */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Upcoming matches</h2>
          <Button variant="ghost" size="sm" onClick={onGoMatches}>
            See all
          </Button>
        </div>
        {!upcoming.length ? (
          <p className="mt-3 text-sm text-[var(--fp-text-muted)]">No upcoming matches — expand leagues or date.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--fp-border)]">
            {upcoming.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(m)}
                  className="flex w-full min-h-[var(--fp-touch)] items-center justify-between gap-3 py-2 text-left text-sm hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                >
                  <span>
                    <span className="text-[var(--fp-text-muted)]">{m.league}</span>
                    <br />
                    <span className="font-semibold">
                      {m.teams.home} vs {m.teams.away}
                    </span>
                  </span>
                  <Badge tone="accent">{m.recommended?.pick || "—"}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Trending */}
      {trending.length > 0 && (
        <Card>
          <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Trending predictions</h2>
          <ul className="mt-3 divide-y divide-[var(--fp-border)]">
            {trending.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(m)}
                  className="flex w-full min-h-[var(--fp-touch)] items-center justify-between gap-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                >
                  <span className="font-semibold">
                    {m.teams.home} vs {m.teams.away}
                  </span>
                  <span className="font-mono text-[length:var(--fp-caption)] tabular-nums text-[var(--fp-text-muted)]">
                    {Math.round(confOf(m))}% · {m.recommended?.pick || "—"}
                    {evOf(m) > 0 ? ` · EV ${evOf(m).toFixed(0)}%` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Recent performance + shortcuts */}
      <Card>
        <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Recent performance</h2>
        <div className="mt-3 flex flex-wrap gap-4 text-sm text-[var(--fp-text-muted)]">
          <span>
            Success Rate{" "}
            <strong className="tabular-nums text-[var(--fp-text)]">{winRate ? `${winRate.toFixed(0)}%` : "—"}</strong>
          </span>
          <span>
            {wins}W · {losses}L · {settledCount} settled
          </span>
          {pendingCount > 0 && <span>{pendingCount} pending</span>}
          {usageLabel && (
            <span>
              Plan <strong className="text-[var(--fp-text)]">{usageLabel}</strong>
            </span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {onGoHistory && (
            <Button variant="secondary" size="sm" onClick={onGoHistory}>
              History
            </Button>
          )}
          {onGoStatistics && (
            <Button variant="ghost" size="sm" onClick={onGoStatistics}>
              Statistics
            </Button>
          )}
        </div>
      </Card>
    </section>
  );
}
