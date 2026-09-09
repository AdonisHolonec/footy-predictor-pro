import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import { ReferralError, claimReferral } from "../../services/referralService";
import { clearPendingReferral, readPendingReferral } from "../../utils/referralLink";
import { describeReferralError } from "../../utils/referralCopy";

/**
 * The pending invitation and the ONE way to claim it.
 *
 * Extracted from ReferralCard so the post-login invitation dialog and the
 * Account card run the same state machine: the same reader of the stored code,
 * the same call to the existing claim endpoint, the same rule for when the
 * stored code is dropped. Two surfaces, one claim.
 *
 * WHAT IT DOES NOT DO. It decides nothing the server decides — self-referral,
 * uniqueness, expiry, qualification, reward all stay on the server, and every
 * failure comes back through `describeReferralError`. It never claims on its
 * own: `accept` is called by a button, and only by a button.
 *
 * WHEN THE STORED CODE IS DROPPED. Only on a successful claim, or on a refusal
 * that is terminal for THIS code (404 invalid, 409 already attributed, 410
 * disabled or expired). A network failure, a rate limit or a 503 leaves the code
 * where it is, so the invitation can be retried rather than silently consumed.
 * Dismissing is "not now", never "never": it hides the prompt for this mount
 * and touches nothing in storage — the existing 30-day TTL is the only clock.
 */
const TERMINAL_CLAIM_STATUSES: readonly number[] = [404, 409, 410];

export type ReferralClaim = {
  /** The valid, unexpired stored code, or null. */
  pendingCode: string | null;
  claiming: boolean;
  /** A user-facing message for the last failed claim, or null. */
  error: string | null;
  /** Hidden for this mount by the user; storage untouched. */
  dismissed: boolean;
  /** Claims `pendingCode`. No-op without a code or while a claim is in flight. */
  accept: () => Promise<void>;
  dismiss: () => void;
};

type Options = {
  /** Read the stored code only once a signed-in user can act on it. */
  enabled: boolean;
  /** Injected in tests; production reads the real clock. */
  now?: number;
  /** Runs after a SUCCESSFUL claim (the card reloads its status here). */
  onClaimed?: () => void | Promise<void>;
};

export function useReferralClaim({ enabled, now, onClaimed }: Options): ReferralClaim {
  const { t } = useLocale();
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  /* Synchronous mirror of `claiming`: two clicks in one tick must not claim twice. */
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    setPendingCode(readPendingReferral(now)?.code ?? null);
  }, [enabled, now]);

  const accept = useCallback(async () => {
    if (!pendingCode || inFlight.current) return;
    inFlight.current = true;
    setClaiming(true);
    setError(null);
    try {
      await claimReferral(pendingCode);
      // Only cleared on SUCCESS: a transient failure must leave the invitation
      // available to retry rather than silently consuming it.
      clearPendingReferral();
      setPendingCode(null);
      await onClaimed?.();
    } catch (err) {
      setError(describeReferralError(err, t));
      if (err instanceof ReferralError && TERMINAL_CLAIM_STATUSES.includes(err.status)) {
        // Terminal for this code — keeping it would re-offer an invitation the
        // server has already refused for good.
        clearPendingReferral();
        setPendingCode(null);
      }
    } finally {
      inFlight.current = false;
      setClaiming(false);
    }
  }, [onClaimed, pendingCode, t]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return { pendingCode, claiming, error, dismissed, accept, dismiss };
}
