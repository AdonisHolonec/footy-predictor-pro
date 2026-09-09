import Button from "../../design-system/Button";
import Dialog from "../../design-system/Dialog";
import { useLocale } from "../../context/LocaleContext";

/**
 * The referral promo shown while a Predict run loads.
 *
 * WHAT IT IS. A short incentive, opened by the EXPLICIT Predict press and
 * dismissed at will: "your predictions are on their way; meanwhile, earn Ultra
 * days by recommending a friend." It replaces the permanent campaign strip that
 * used to sit under the bar — the same offer, made once, at the moment the
 * user is waiting anyway rather than on every screen forever.
 *
 * WHAT IT IS NOT. It is not the day's recommendation, not a prediction result
 * and not a ticket. It reads no prediction data, waits for nothing, and its
 * open state is a side effect of the press, never of the run's outcome.
 *
 * THE CTA IS THE EXISTING REFERRAL ACTION. `onRecommend` is wired by the
 * dashboard to the same navigate-and-reveal call the strip made, which lands
 * on ReferralCard — copy, native share and the referral link all stay there.
 * Nothing here knows how a reward is computed; the offer wording is the
 * product's existing `account.header.referralHint`.
 */
type Props = {
  open: boolean;
  onClose: () => void;
  /** The existing referral action. The dialog closes before it runs. */
  onRecommend: () => void;
};

export default function PredictPromoDialog({ open, onClose, onRecommend }: Props) {
  const { t } = useLocale();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("dash.predictPromoTitle")}
      size="sm"
      /* Compact bottom sheet on phones (safe-area padded), centred from `sm` up. */
      presentation="sheet"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} data-testid="predict-promo-later">
            {t("dash.predictPromoLater")}
          </Button>
          <Button variant="primary" onClick={onRecommend} data-testid="predict-promo-cta">
            {t("dash.predictPromoCta")}
          </Button>
        </>
      }
    >
      <div data-testid="predict-promo" className="flex items-start gap-3">
        {/*
          Decorative. The same pulsing accent dot the workspace shows beside its
          loading pill, so "still loading" is said in the language the page
          already speaks; the words carry the meaning.
        */}
        <span
          aria-hidden
          className="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
        >
          <span className="h-2 w-2 rounded-full bg-[var(--fp-accent)] motion-safe:animate-pulse" />
        </span>
        <div className="min-w-0">
          <p className="text-[length:var(--fp-body)] leading-relaxed text-[var(--fp-text)]">
            {t("dash.predictPromoBody")}
          </p>
          {/* The offer's terms, in the product's own existing words. */}
          <p className="mt-2 text-[11px] text-[var(--fp-text-muted)]">{t("account.header.referralHint")}</p>
        </div>
      </div>
    </Dialog>
  );
}
