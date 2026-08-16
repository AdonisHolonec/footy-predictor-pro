import { Card, Badge } from "../../design-system";
import MarketFamilyIcon from "../icons/MarketFamilyIcon";
import type { MarketFamilyKey } from "../../utils/formatRecommendation";

/**
 * Consensus block — a small, secondary "external opinion" panel comparing
 * our own recommendation against API-Football's independent prediction.
 *
 * NOT wired into MatchModal.tsx / MatchCard.tsx by default. Per the product
 * constraint ("Do NOT expose API-Football as the primary recommendation"),
 * this component is built and exported only; the intended future slotting
 * point is inside MatchModal.tsx as a sibling <section> alongside
 * ExplanationCard (~line 1534) and ConfidenceEnginePanel (~line 1557), gated
 * behind a client-visible boolean surfaced from PREDICTION_BENCHMARK_ENABLED
 * (never the raw env var) — that one-line addition is deliberately left out
 * of this change so the block stays inert until a separate, explicit
 * decision to enable it in the UI.
 */
export type ConsensusBlockProps = {
  ourRecommendation: {
    pick: string;
    familyKey: MarketFamilyKey;
    confidence: number | null;
  };
  benchmark: {
    /** false when no API-Football benchmark exists yet for this fixture —
     * the component renders nothing rather than a misleading "0%". */
    available: boolean;
    apiInferredPick: string | null;
    apiConfidencePct: number | null;
    consensus: {
      agree: boolean | null;
      familyComparable: boolean;
      confidenceDelta: number | null;
    } | null;
  };
  /** Product DNA: interpret, don't just dump two numbers — a short human
   * sentence computed by the caller from `benchmark.consensus`, e.g. "Both
   * models favor Team A" / "Models disagree: we favor Over 2.5, external
   * model leans Under". */
  interpretationText: string;
};

export default function ConsensusBlock({ ourRecommendation, benchmark, interpretationText }: ConsensusBlockProps) {
  if (!benchmark.available) return null;

  const { consensus } = benchmark;
  const tone = consensus?.agree === true ? "success" : consensus?.agree === false ? "danger" : "neutral";
  const agreementLabel =
    consensus?.agree === true ? "Models agree" : consensus?.agree === false ? "Models disagree" : "Not comparable";

  return (
    <Card padding="sm" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--fp-text-muted)]">
          <MarketFamilyIcon familyKey={ourRecommendation.familyKey} size={12} />
          External Consensus
        </div>
        <Badge tone={tone}>{agreementLabel}</Badge>
      </div>

      <p className="text-[length:var(--fp-body)] text-[var(--fp-text)]">{interpretationText}</p>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">Our pick</div>
          <div className="font-medium text-[var(--fp-text)]">{ourRecommendation.pick}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--fp-text-muted)]">External opinion</div>
          <div className="font-medium text-[var(--fp-text-muted)]">
            {benchmark.apiInferredPick ?? "—"}
            {benchmark.apiConfidencePct != null ? ` (${benchmark.apiConfidencePct}%)` : ""}
          </div>
        </div>
      </div>
    </Card>
  );
}
