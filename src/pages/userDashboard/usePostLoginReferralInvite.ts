import { useEffect, useRef, useState } from "react";
import { useReferralClaim } from "../../components/ux/useReferralClaim";
import { fetchReferralStatus } from "../../services/referralService";
import { readPendingReferral } from "../../utils/referralLink";

/**
 * Should the workspace open the referral invitation for this signed-in user?
 *
 * The same question the Account card asks, asked where a referred user actually
 * lands: a valid pending code exists (captured at boot by referralLink.ts) AND
 * the account is not already attributed (the server's `invitee` on the existing
 * status endpoint). Both are read through the existing helpers; nothing here
 * parses a URL, stores anything, or decides an outcome.
 *
 * ONCE PER SIGNED-IN USER PER MOUNT. `promptedFor` remembers the user id the
 * question was asked for, so re-renders, token refreshes and useAuth's two-step
 * user publication (profile pending, then profile) never ask twice, never fetch
 * status twice, and never re-open a dialog the user dismissed. A new session, or
 * a different user, asks again — the stored code is untouched by a dismiss and
 * lives out its own 30-day TTL.
 *
 * A status failure simply asks nothing: the Account card remains the manual
 * path, exactly as before.
 */
type Options = {
  userId: string | null;
  accessToken: string | null;
  /** Injected in tests; production reads the real clock. */
  now?: number;
  /** Runs after a SUCCESSFUL claim. */
  onAccepted?: () => void | Promise<void>;
};

export type PostLoginReferralInvite = {
  open: boolean;
  pendingCode: string | null;
  claiming: boolean;
  error: string | null;
  accept: () => Promise<void>;
  dismiss: () => void;
};

export function usePostLoginReferralInvite({ userId, accessToken, now, onAccepted }: Options): PostLoginReferralInvite {
  const enabled = Boolean(userId && accessToken);
  const [eligible, setEligible] = useState(false);
  const promptedFor = useRef<string | null>(null);
  const claim = useReferralClaim({ enabled, now, onClaimed: onAccepted });

  useEffect(() => {
    if (!enabled || !userId) return;
    if (promptedFor.current === userId) return;
    promptedFor.current = userId;
    // The cheap check first: no stored code, no request at all.
    if (!readPendingReferral(now)) return;
    fetchReferralStatus()
      .then((status) => {
        if (!status.invitee) setEligible(true);
      })
      .catch(() => {
        // Nothing to show; the Account card is still there.
      });
  }, [enabled, userId, now]);

  /*
    Open while there is something to decide or something to read: the code is
    still pending, or the last claim failed and the message is on screen. A
    successful claim empties both and the dialog closes by itself.
  */
  const open = eligible && !claim.dismissed && (claim.pendingCode !== null || claim.error !== null);

  return {
    open,
    pendingCode: claim.pendingCode,
    claiming: claim.claiming,
    error: claim.error,
    accept: claim.accept,
    dismiss: claim.dismiss
  };
}
