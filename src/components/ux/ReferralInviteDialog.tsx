import Dialog from "../../design-system/Dialog";
import { useLocale } from "../../context/LocaleContext";
import ReferralInvitePrompt from "./ReferralInvitePrompt";

/**
 * The post-login invitation: the Account card's prompt, in a dialog, at the
 * moment a referred user first arrives instead of on a page they may never open.
 *
 * Every close path — X, Escape, backdrop, "Not now" — is a dismiss and claims
 * nothing. While a claim is in flight the Dialog's `busy` refuses all of them,
 * which is the existing rule for a submit that cannot be cancelled.
 */
type Props = {
  open: boolean;
  claiming: boolean;
  error: string | null;
  canAccept: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export default function ReferralInviteDialog({ open, claiming, error, canAccept, onAccept, onDecline }: Props) {
  const { t } = useLocale();
  return (
    <Dialog
      open={open}
      onClose={onDecline}
      title={t("account.referral.inviteTitle")}
      size="sm"
      /* Compact bottom sheet on phones (safe-area padded), centred from `sm` up. */
      presentation="sheet"
      busy={claiming}
    >
      <ReferralInvitePrompt
        variant="dialog"
        claiming={claiming}
        canAccept={canAccept}
        error={error}
        onAccept={onAccept}
        onDecline={onDecline}
      />
    </Dialog>
  );
}
