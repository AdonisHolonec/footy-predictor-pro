import LuckBadge from "../LuckBadge";
import XGPerformanceBar from "../XGPerformanceBar";
import type { PredictionRow, XGData } from "../../types";
import type { TranslateFn } from "../../i18n";

/**
 * xG & LUCK — the model's shot-quality read on the fixture.
 *
 * This is the block that used to live inline in AnalysisPanels behind the `xg` part,
 * reachable only through Advanced — a panel gated on `showModelInternals`, which is
 * off by default, so in practice no ordinary account ever saw it. It has been LIFTED
 * OUT unchanged rather than reimplemented: same XGPerformanceBar, same two LuckBadges,
 * same `match.luckStats` fallbacks, same `match.xgLuck` heading. There is no second xG
 * implementation and nothing here recomputes xG — `xgData` arrives already built by
 * useMatchModalModel, which remains its only source of truth.
 *
 * It exists as its own component for one reason: Match Detail needs to mount this card
 * on its own, and AnalysisPanels evaluates every one of its blocks regardless of the
 * visibility gate (the gate only adds `hidden`). Every other AnalysisPanels call site
 * sits inside a lazy CollapsiblePanel, so mounting the whole panel eagerly just to
 * reach this card would run — and can crash on — analysis code that has nothing to do
 * with xG.
 */
export default function XgCard({
  match,
  tr,
  xgData,
  className = ""
}: {
  match: PredictionRow;
  tr: TranslateFn;
  xgData: XGData | null;
  className?: string;
}) {
  return (
    <section
      data-slot="xg-card"
      aria-labelledby="detail-xg-title"
      className={`rounded-[var(--fp-radius)] border border-[var(--fp-border)] bg-[var(--fp-bg-muted)] p-3 shadow-fp-sm sm:p-4 ${className}`}
    >
      <h2
        id="detail-xg-title"
        className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fp-accent/80"
      >
        {tr("match.xgLuck")}
      </h2>
      <div className="w-full">{xgData ? <XGPerformanceBar xg={xgData} /> : null}</div>
      {match.luckStats && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <LuckBadge goals={match.luckStats.hG} xg={xgData?.homeXG ?? match.luckStats.hXG} />
          <LuckBadge goals={match.luckStats.aG} xg={xgData?.awayXG ?? match.luckStats.aXG} />
        </div>
      )}
      {!match.luckStats && (
        <p className="text-center text-[10px] text-[var(--fp-text-muted)]">{tr("match.luckUnavailable")}</p>
      )}
    </section>
  );
}
