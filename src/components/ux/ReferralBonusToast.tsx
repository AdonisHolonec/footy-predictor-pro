import { useLocale } from "../../context/LocaleContext";
import Toast from "../../design-system/Toast";
import type { ReferralBonus } from "../../services/referralNotificationService";

/**
 * The transient "you just earned Ultra days" notice.
 *
 * IT REUSES THE APP'S ONE TOAST. `Toast` already auto-dismisses after 5s, already
 * announces through role="status" + aria-live="polite", already pauses its
 * countdown while hovered or focused, and already clears its timer on unmount.
 * Building a second toast system for this would have duplicated all of that and
 * given the app two competing notification surfaces.
 *
 * IT RENDERS SERVER TEXT ONLY AS DATA. `inviteeName` is the single string that
 * crosses from one user to another, and it goes through JSX as a normal
 * interpolation — never dangerouslySetInnerHTML — so a name containing markup is
 * shown as the characters the person typed, not parsed as HTML.
 *
 * THE NAME IS OPTIONAL, NOT ASSUMED. An invitee who set no display name stays
 * anonymous, and the inviter gets the same news without the identity rather than
 * "undefined joined through your referral".
 */
export default function ReferralBonusToast({ bonus, onDismiss }: { bonus: ReferralBonus | null; onDismiss: () => void }) {
  const { t } = useLocale();
  if (!bonus) return null;

  const days = bonus.days;
  const message =
    bonus.role === "inviter"
      ? bonus.inviteeName
        ? `${t("account.referral.notification.inviterTitle")} ${t("account.referral.notification.inviterMessage", {
            name: bonus.inviteeName,
            days
          })}`
        : `${t("account.referral.notification.inviterTitle")} ${t(
            "account.referral.notification.inviterMessageAnonymous",
            { days }
          )}`
      : `${t("account.referral.notification.inviteeTitle")} ${t("account.referral.notification.inviteeMessage", {
          days
        })}`;

  return (
    <Toast
      message={message}
      onDismiss={onDismiss}
      // Explicit rather than inherited: this notice is specified at five seconds,
      // and a change to the shared default must not silently change it.
      durationMs={5000}
      dismissLabel={t("common.close")}
      /*
        An explicit width, because this message is a sentence rather than a word.
        Without it `left-1/2` caps the shrink-to-fit surface at half the viewport
        (194px of a 390px screen) and the reward wraps to five lines. Scoped to
        this toast so every other caller keeps its existing sizing.
      */
      className="w-[min(92vw,24rem)]"
    />
  );
}
