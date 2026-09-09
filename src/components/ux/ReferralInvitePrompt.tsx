import Button from "../../design-system/Button";
import { useLocale } from "../../context/LocaleContext";
import { REFERRAL_REWARD_DAYS } from "../../utils/referralCopy";

/**
 * The invitation prompt's words and actions — one implementation, two homes.
 *
 * "inline" is the bordered box inside the Account referral card, unchanged from
 * before the extraction, including its test id. "dialog" is the same copy and
 * the same two actions inside the post-login dialog, which owns the heading and
 * therefore renders none here.
 *
 * It computes nothing and claims nothing: both actions are the caller's, and
 * the caller is always useReferralClaim.
 */
type Props = {
  variant: "inline" | "dialog";
  claiming: boolean;
  /** False once a terminal refusal has dropped the code: only the way out remains. */
  canAccept: boolean;
  /** Shown only by the dialog; the card has its own alert slot. */
  error?: string | null;
  onAccept: () => void;
  onDecline: () => void;
};

export default function ReferralInvitePrompt({ variant, claiming, canAccept, error = null, onAccept, onDecline }: Props) {
  const { t } = useLocale();
  const actions = (
    <div className="flex flex-wrap gap-2">
      {canAccept ? (
        <Button
          variant="primary"
          loading={claiming}
          disabled={claiming}
          onClick={onAccept}
          data-testid="referral-invite-accept"
        >
          {claiming ? t("account.referral.claiming") : t("account.referral.accept")}
        </Button>
      ) : null}
      <Button variant="secondary" disabled={claiming} onClick={onDecline} data-testid="referral-invite-decline">
        {t("account.referral.decline")}
      </Button>
    </div>
  );

  if (variant === "inline") {
    return (
      <div className="space-y-2 rounded-lg border border-white/10 p-3" data-testid="referral-invite-prompt">
        <p className="text-sm font-semibold">{t("account.referral.inviteTitle")}</p>
        <p className="text-sm opacity-80">{t("account.referral.inviteBody", { days: REFERRAL_REWARD_DAYS })}</p>
        {/* Stated plainly, not as an alarm: accepting cannot be undone. */}
        <p className="text-xs opacity-70">{t("account.referral.inviteOnce")}</p>
        {actions}
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="referral-invite-dialog-body">
      <p className="text-[length:var(--fp-body)] leading-relaxed text-[var(--fp-text)]">
        {t("account.referral.inviteBody", { days: REFERRAL_REWARD_DAYS })}
      </p>
      <p className="text-xs text-[var(--fp-text-muted)]">{t("account.referral.inviteOnce")}</p>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      {actions}
    </div>
  );
}
