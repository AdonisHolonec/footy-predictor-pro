import { useLocale } from "../../context/LocaleContext";
import type { ReferralBonus } from "../../services/referralNotificationService";
import { CornerBadge } from "./PlanHeaderStrip";
import { buildReferralNotice } from "./referralNotice";

/**
 * The permanent referral campaign — its own strip, directly under the header.
 *
 * WHY IT IS NOT IN THE HEADER ANY MORE. It used to be a third card inside a
 * 56px bar that also carries the brand, the browsed date, the plan and Predict.
 * At 390px the sum of those zones' min-content widths exceeded the row, so
 * something always had to give — and it was always the wrong thing: the brand
 * truncating to "F…", or the offer to "+5 zile Ul…", which sells nothing. The
 * repeated fix was to shave the functional zones to make room for a marketing
 * one, which is the priority order upside down.
 *
 * So the campaign moves rather than the chrome shrinking. It is an engagement
 * surface, not a navigation control, and it belongs beside the content it wants
 * you to act on — still on the first viewport, still one tap, but no longer
 * bidding against Predict for width.
 *
 * IT IS SEPARATE FROM THE BONUS NOTIFICATIONS. Transient reward notifications,
 * ReferralBonusHistory and the claim flow are untouched. While a reward is
 * fresh this strip shows the "who" half of it — the same half the referral card
 * always showed — from the same shared builder the plan card uses.
 */
type Props = {
  /** Opens the full referral surface in Account. Never claims anything. */
  onOpenReferral: () => void;
  /** A freshly received referral bonus, shown here for a few seconds. */
  bonus?: ReferralBonus | null;
};

export default function ReferralCampaignStrip({ onOpenReferral, bonus = null }: Props) {
  const { t } = useLocale();
  const notice = buildReferralNotice(bonus, t);

  return (
    /*
      The page's own container and gutters, so the strip lines up with the
      header above it and the content below rather than floating in its own
      geometry. No arbitrary margins: py-1.5 is the existing rhythm's smallest
      step, and it is what keeps this a strip rather than a banner.
    */
    <div
      data-testid="referral-campaign-strip"
      className="border-b border-[var(--fp-border)] bg-[var(--fp-bg)]"
    >
      <div className="mx-auto flex max-w-[var(--fp-container)] items-center px-3 py-1.5 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenReferral}
          data-testid="referral-cta"
          title={t("account.header.referralHint")}
          /*
            A REAL BUTTON, named by its own visible words.

            No aria-label: the campaign's wording is right there in the button,
            so overriding it would only hide from a voice-control user the
            words they can actually see. The badge beside it is decorative and
            aria-hidden, so it contributes nothing to the name — which is what
            keeps the name equal to the visible campaign copy.

            `touch-target` grows the hit area to 44px through a pseudo-element
            without growing the strip: the row stays compact and the tap target
            still clears the minimum.
          */
          /*
            MEASURED, not chosen by eye. Both of these were something else first
            and both failed on rendered pixels:

            - INK. `--fp-accent-text` on the 10% accent tint read 3.99 in the
              light theme — under the 4.5 this size owes. `--fp-text` reads
              12.91 / 15.93 / 18.61. The accent has not left the control; it is
              carried by the fill and the boundary, which is where it can be
              strong without putting brand colour under small words.

            - BOUNDARY. A tinted border is the design system's badge habit, and
              it is wrong here: this is an actionable control, so its edge owes
              3:1 under 1.4.11. accent/40 measured 1.79 / 1.99 / 2.49 and
              accent/70 still missed light at 2.75. At full strength it reads
              3.76 / 6.81 / 11.77. (`--fp-border-strong` was measured too and is
              a hairline, not a boundary: 1.64 / 1.55.)

            Outlined rather than solid-filled ON PURPOSE. Predict is the solid
            accent button in this viewport and must stay the loudest thing in
            it; the campaign is meant to be noticed, not to win.
          */
          className="touch-target relative inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--fp-accent)] bg-fp-accent/10 pl-5 pr-3 py-1 text-[var(--fp-text)] transition-colors hover-fine:bg-fp-accent/[0.16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
        >
          {/*
            The approved corner chip, reused rather than reinvented — same
            component, same tokens, same decorative/aria-hidden contract. It is
            absolutely positioned, so it costs this row no height.
          */}
          {!notice ? <CornerBadge tone="free" label={t("account.header.badgeFree")} placement="inline-start" /> : null}

          {/*
            FIXED PRODUCT COPY, NEVER TRUNCATED.

            Both of these are the product's own words and always fit; only the
            invitee name below is unknowable, and it is the only thing allowed
            to lose characters. No ellipsis reaches this line.
          */}
          <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-wider">
            {notice ? notice.referral.title : t("account.header.invite")}
          </span>

          {notice ? (
            notice.referral.name ? (
              <span className="flex min-w-0 items-baseline gap-1 text-[11px] font-semibold" data-testid="referral-detail">
                {/* The one unknowable part, and so the only truncatable one. */}
                <span className="min-w-0 shrink truncate" data-testid="referral-name">
                  {notice.referral.name}
                </span>
                <span className="shrink-0 whitespace-nowrap" data-testid="referral-fixed">
                  {notice.referral.fixed}
                </span>
              </span>
            ) : (
              /* Entirely fixed copy — nothing here may ever be cut. */
              <span
                className="whitespace-nowrap text-[11px] font-semibold"
                data-testid="referral-detail"
                data-fixed="true"
              >
                {notice.referral.fixed}
              </span>
            )
          ) : (
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold" data-testid="referral-detail">
              {t("account.header.inviteReward")}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
