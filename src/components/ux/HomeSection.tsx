import type { PredictionRow } from "../../types";
import Card from "../../design-system/Card";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";

type Props = {
  matches: PredictionRow[];
  onOpenMatch: (m: PredictionRow) => void;
  onGoMatches: () => void;
  continueMatch?: PredictionRow | null;
  winRate?: number;
  pendingCount?: number;
  settledCount?: number;
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
        <p className="mt-2 text-sm text-[var(--fp-text-faint)]">Rulează Predict pentru a vedea pick-uri.</p>
      </Card>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="w-full rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] p-4 text-left transition hover:border-[var(--fp-accent)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] active:scale-[0.99]"
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
    </button>
  );
}

export default function HomeSection({
  matches,
  onOpenMatch,
  onGoMatches,
  continueMatch,
  winRate = 0,
  pendingCount = 0,
  settledCount = 0,
  usageLabel
}: Props) {
  const playable = matches.filter((m) => !m.insufficientData);
  const bestPick = [...playable].sort((a, b) => confOf(b) - confOf(a))[0] || null;
  const bestValue =
    [...playable]
      .filter((m) => m.valueBet?.detected || evOf(m) > 0)
      .sort((a, b) => evOf(b) - evOf(a))[0] || null;
  const avgConf = playable.length
    ? playable.reduce((s, m) => s + confOf(m), 0) / playable.length
    : 0;
  const upcoming = [...playable]
    .filter((m) => !["FT", "AET", "PEN"].includes(String(m.status || "").toUpperCase()))
    .slice(0, 5);

  return (
    <section className="space-y-6">
      <header>
        <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-[0.2em] text-[var(--fp-accent)]">
          Home
        </p>
        <h1 className="mt-1 font-display text-[length:var(--fp-hero)] font-semibold tracking-tight text-[var(--fp-text)]">
          Pe ce pariez azi?
        </h1>
        <p className="mt-2 max-w-xl text-[length:var(--fp-body)] text-[var(--fp-text-muted)]">
          Scorul zilei, cele mai bune pick-uri și meciurile următoare — fără zgomot.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Meciuri azi", value: String(matches.length) },
          { label: "Confidence medie", value: avgConf ? `${Math.round(avgConf)}%` : "—" },
          { label: "Success Rate", value: winRate ? `${winRate.toFixed(0)}%` : "—" },
          { label: "Settled", value: String(settledCount) }
        ].map((k) => (
          <Card key={k.label} padding="sm">
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-text-muted)]">
              {k.label}
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-[var(--fp-text)]">{k.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PickTile
          label="Cel mai bun pick"
          match={bestPick}
          meta={bestPick ? `${Math.round(confOf(bestPick))}% confidence` : ""}
          onOpen={onOpenMatch}
        />
        <PickTile
          label="Confidence maximă"
          match={bestPick}
          meta={bestPick ? `Top Pick ${bestPick.recommended?.pick || "—"}` : ""}
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
          className="flex w-full items-center justify-between rounded-[var(--fp-radius)] border border-[var(--fp-accent)]/30 bg-[var(--fp-accent-muted)] px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
        >
          <div>
            <p className="font-mono text-[length:var(--fp-badge)] uppercase tracking-wider text-[var(--fp-accent)]">
              Continuă
            </p>
            <p className="mt-0.5 font-semibold">
              {continueMatch.teams.home} vs {continueMatch.teams.away}
            </p>
          </div>
          <span className="text-sm text-[var(--fp-accent)]">Deschide →</span>
        </button>
      )}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-[length:var(--fp-section)] font-semibold">Meciuri viitoare</h2>
          <Button variant="ghost" size="sm" onClick={onGoMatches}>
            Vezi toate
          </Button>
        </div>
        {!upcoming.length ? (
          <p className="mt-3 text-sm text-[var(--fp-text-muted)]">Niciun meci încă — selectează ligi și apasă Predict.</p>
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

      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--fp-text-muted)]">
        <span>
          Succes recent:{" "}
          <strong className="text-[var(--fp-text)]">{winRate ? `${winRate.toFixed(0)}%` : "—"}</strong>
        </span>
        {pendingCount > 0 && <span>{pendingCount} pending</span>}
        {usageLabel && (
          <span>
            Usage: <strong className="text-[var(--fp-text)]">{usageLabel}</strong>
          </span>
        )}
      </div>
    </section>
  );
}
