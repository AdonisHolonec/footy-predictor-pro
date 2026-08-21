/**
 * PoissonMarketSection — moved verbatim from MatchModal.tsx (Sprint 7). Behavior unchanged.
 */

import { useLocale } from "../../context/LocaleContext";
import type { PoissonMarketProbs } from "../../types";
import { deriveBestOverUnderPick, formatLineKey, marketResultBadge } from "./helpers";

export default function PoissonMarketSection({
  title,
  subtitle,
  accent,
  icon,
  data,
  homeLabel,
  awayLabel,
  actualTotal,
  quotedOdd,
  quoteSource,
  badgeTone = "neutral",
  framed = true
, showInternals = false }: {
  title: string;
  subtitle: string;
  accent: string;
  icon: string;
  data: PoissonMarketProbs;
  /** Account › Model internals. Off: λ, expected-total and sample lines are not rendered. */
  showInternals?: boolean;
  homeLabel: string;
  awayLabel: string;
  actualTotal?: number | null;
  quotedOdd?: number | null;
  quoteSource?: string | null;
  badgeTone?: "corners" | "shots" | "ht" | "neutral";
  framed?: boolean;
}) {
  const { t: tr } = useLocale();
  const totalKeys = Object.keys(data.total || {});
  const homeKeys = Object.keys(data.home || {});
  const awayKeys = Object.keys(data.away || {});
  const hasTeamLines = homeKeys.length > 0 || awayKeys.length > 0;
  const bestPick = deriveBestOverUnderPick(data.total);
  const settled =
    bestPick && actualTotal != null
      ? bestPick.pick.startsWith("Over")
        ? actualTotal > bestPick.line
        : actualTotal < bestPick.line
      : null;

  const settledShell =
    settled === true
      ? "ring-1 ring-fp-success/50 border-fp-success/40 bg-fp-success/10"
      : settled === false
        ? "ring-1 ring-fp-danger/50 border-fp-danger/40 bg-fp-danger/10"
        : "border-[var(--fp-border)] bg-[var(--fp-bg-muted)]";

  const toneClass = (pct: number) => {
    if (pct >= 60) return "text-[var(--fp-success)]";
    if (pct >= 40) return "text-[var(--fp-warning)]";
    return "text-[var(--fp-text-muted)]";
  };

  return (
    <section
      className={`relative ${framed ? "rounded-[var(--fp-radius)] border p-4 shadow-inner sm:p-5" : "rounded-xl border p-3 sm:p-4"} ${settled != null ? settledShell : framed ? "" : "border-transparent"}`}
      style={
        framed && settled == null
          ? { borderColor: `${accent}40`, background: `linear-gradient(180deg, ${accent}0d, transparent)` }
          : undefined
      }
    >
      {settled != null ? (
        <span
          className={`absolute -right-1 -top-2 z-10 rounded-md px-2 py-0.5 font-mono text-[10px] font-extrabold uppercase tracking-wider shadow-sm sm:text-[10px] ${
            settled
              ? "bg-[var(--fp-success)] text-white"
              : "bg-[var(--fp-danger)] text-white"
          }`}
        >
          {settled ? tr("card.chipWin") : tr("card.chipLose")}
        </span>
      ) : null}
      {framed ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[var(--fp-border)] pb-2">
          <div>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: accent }}>
              {icon} {title}
            </h3>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{subtitle}</p>
          </div>
          {showInternals && <div className="text-right font-mono text-[10px] tabular-nums">
            <div className="text-[var(--fp-text-muted)]">
              λ · {data.lambdaHome.toFixed(1)} vs {data.lambdaAway.toFixed(1)}
            </div>
            <div className="text-[10px] text-[var(--fp-text-muted)]">
              total aşteptat ≈ {data.expectedTotal.toFixed(1)}
              {data.usedFallback ? " · fallback" : ""}
            </div>
          </div>}
        </div>
      ) : showInternals ? (
        <div className="mb-3 text-right font-mono text-[10px] tabular-nums text-[var(--fp-text-muted)]">
          λ · {data.lambdaHome.toFixed(1)} vs {data.lambdaAway.toFixed(1)} · ≈ {data.expectedTotal.toFixed(1)}
          {data.usedFallback ? " · fallback" : ""}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* TOTAL */}
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.poissonTotal")}</div>
          <table className="w-full font-mono text-[10px] tabular-nums">
            <tbody>
              {totalKeys.map((k) => {
                const pct = data.total[k];
                return (
                  <tr key={k} className="border-t border-[var(--fp-border)]">
                    <td className="py-1 pr-2 text-[var(--fp-text-muted)]">{formatLineKey(k)}</td>
                    <td className={`py-1 pl-2 text-right ${toneClass(pct)}`}>{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
              <tr className="border-t border-[var(--fp-border)]">
                <td className="py-1 pr-2 text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.mostLikely")}</td>
                <td className="py-1 pl-2 text-right text-[var(--fp-warning)]">{data.mostProbableTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* TEAM LINES */}
        {hasTeamLines ? (
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">{tr("match.perTeamOver")}</div>
            <table className="w-full font-mono text-[10px] tabular-nums">
              <thead className="text-left text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">
                <tr>
                  <th className="py-1"></th>
                  <th className="py-1 text-right" title={homeLabel}>
                    {homeLabel.slice(0, 12)}
                  </th>
                  <th className="py-1 text-right" title={awayLabel}>
                    {awayLabel.slice(0, 12)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {homeKeys.map((k) => {
                  const hp = data.home[k];
                  const ap = data.away[k] ?? 0;
                  return (
                    <tr key={k} className="border-t border-[var(--fp-border)]">
                      <td className="py-1 pr-2 text-[var(--fp-text-muted)]">{formatLineKey(k)}</td>
                      <td className={`py-1 pl-2 text-right ${toneClass(hp)}`}>{hp.toFixed(0)}%</td>
                      <td className={`py-1 pl-2 text-right ${toneClass(ap)}`}>{ap.toFixed(0)}%</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-[var(--fp-border)]">
                  <td className="py-1 pr-2 text-[10px] uppercase tracking-wider text-[var(--fp-text-muted)]">Modal</td>
                  <td className="py-1 pl-2 text-right text-[var(--fp-warning)]">{data.mostProbableHome}</td>
                  <td className="py-1 pl-2 text-right text-[var(--fp-warning)]">{data.mostProbableAway}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {showInternals && (data.sampleHome != null || data.sampleAway != null || data.leagueBaseline != null) && (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--fp-border)] pt-2 font-mono text-[10px] text-[var(--fp-text-muted)]">
          {data.sampleHome != null && <span>{tr("match.sampleHome", { n: data.sampleHome })}</span>}
          {data.sampleAway != null && <span>{tr("match.sampleAway", { n: data.sampleAway })}</span>}
          {data.leagueBaseline != null && (
            <span>{tr("match.leagueAverage", { n: data.leagueBaseline.toFixed(1) })}</span>
          )}
          {data.usedFallback && <span className="text-[var(--fp-warning)]">{tr("match.sampleFallback")}</span>}
        </div>
      )}
      {bestPick && (
        <div
          className={`mt-3 border-t pt-2 ${
            settled === true
              ? "border-fp-success/35"
              : settled === false
                ? "border-fp-danger/35"
                : "border-[var(--fp-border)]"
          }`}
        >
          {marketResultBadge(
            bestPick.pick,
            bestPick.probability,
            settled,
            quotedOdd,
            quoteSource,
            badgeTone,
            tr("card.noBookOdd")
          )}
          {actualTotal != null && (
            <span
              className={`ml-2 font-mono text-[10px] font-semibold tabular-nums ${
                settled === true
                  ? "text-[var(--fp-success)]"
                  : settled === false
                    ? "text-[var(--fp-danger)]"
                    : "text-[var(--fp-text-muted)]"
              }`}
            >
              {tr("match.finalTotal")} {actualTotal}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** Mini-card pentru un pick în secţiunea „Pieţe & scor" — afişează probabilitatea + badge încredere. */
