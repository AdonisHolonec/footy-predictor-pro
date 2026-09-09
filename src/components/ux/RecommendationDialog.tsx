import Dialog from "../../design-system/Dialog";
import EmptyState from "../../design-system/EmptyState";
import { useLocale } from "../../context/LocaleContext";
import type { PredictionRow } from "../../types";
import FeaturedPredictionCard from "./FeaturedPredictionCard";

/**
 * The post-Predict recommendation.
 *
 * This is the Featured card that used to sit on Today, moved into a dialog that
 * opens when a Predict run COMPLETES. Nothing about the recommendation moved
 * with it: the row is still `analysisMatch` (the same strongest-pick derivation
 * in useDerivedPredictions), the content is still FeaturedPredictionCard, and
 * the tier masking, the "why confident" toggle and the open-analysis action are
 * the card's own. This file owns only the chrome and the empty state.
 *
 * WHY A DIALOG AND NOT A CARD. Predict is an action with an outcome; the outcome
 * deserves to be the thing the user sees next, once, rather than a card that
 * was always there and quietly changed. It is deliberately NOT reachable from
 * a floating button: it represents a completed run, not a place.
 */

/**
 * The one rule for opening: a run that produced rows. It is applied by the
 * dashboard inside `onPredictCompleted`, which usePredictFlow reaches only after
 * every page answered ok — so loading, a 429, a failed status and a thrown fetch
 * never get as far as asking this question.
 */
export function shouldOpenRecommendationAfterPredict(rows: ReadonlyArray<unknown>): boolean {
  return Array.isArray(rows) && rows.length > 0;
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** The strongest recommendation of the run — `analysisMatch`, unchanged. */
  match: PredictionRow | null;
  /**
   * Opens Match Detail for the row. The dialog closes itself first so one
   * overlay hands over to the next instead of stacking under it.
   */
  onOpenAnalysis: (row: PredictionRow) => void;
};

export default function RecommendationDialog({ open, onClose, match, onOpenAnalysis }: Props) {
  const { t } = useLocale();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("dash.recommendationTitle")}
      description={t("dash.recommendationDesc")}
      /* Bottom sheet on phones (safe-area aware), centred from `sm` up. */
      presentation="sheet"
    >
      <div data-testid="recommendation-dialog">
        {match ? (
          <FeaturedPredictionCard
            match={match}
            onOpenAnalysis={() => {
              onClose();
              onOpenAnalysis(match);
            }}
          />
        ) : (
          /* A run with rows but nothing the model will stand behind: say so, in
             the same words Matches › Picks uses, rather than showing nothing. */
          <EmptyState title={t("dash.emptyPicksTitle")} description={t("dash.emptyPicksDesc")} />
        )}
      </div>
    </Dialog>
  );
}
