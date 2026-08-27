import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import SectionHeader from "../../design-system/SectionHeader";
import Skeleton from "../../design-system/Skeleton";
import StatTile from "../../design-system/StatTile";
import {
  ReferralError,
  claimReferral,
  fetchOrCreateReferralCode,
  fetchReferralStatus,
  type ReferralStatus
} from "../../services/referralService";
import { buildReferralLink, clearPendingReferral, readPendingReferral } from "../../utils/referralLink";

/**
 * The user-facing referral surface, in the account page.
 *
 * IT COMPUTES NOTHING. Successful referrals, earned days and cap remaining all
 * arrive from the server, which counts `inviter_rewarded_at IS NOT NULL AND
 * state <> 'reversed'`. Deriving "successful" from `state` in the client would
 * credit a capped inviter for a payout they never received — eleven referrals
 * implying 55 days when they earned ten and 50. Same for expiry, qualification and
 * tier: this renders server answers.
 *
 * CLAIMING IS EXPLICIT AND IRREVERSIBLE. `UNIQUE(invitee_id)` means a person can be
 * attributed exactly once, ever, with no undo — so an invitation is never accepted
 * on the user's behalf. The prompt says so plainly ("you can only use one
 * invitation") without dressing it up as a warning.
 *
 * THE INVITER IS NEVER NAMED. The API does not return their identity and this must
 * never start asking for it: knowing you were referred is the user's business,
 * knowing by whom — before that person chose to be known — is not.
 */

/** Mirrors STANDARD_BONUS_DAYS. Display only; the server decides what is granted. */
const REWARD_DAYS = 5;

type Props = {
  /** Null while signed out — the card renders nothing rather than a teaser. */
  userId: string | null | undefined;
  /** Injected in tests; production reads the real clock. */
  now?: number;
};

function formatDate(value: string | null, locale: string): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export default function ReferralCard({ userId, now }: Props) {
  const { t, locale } = useLocale();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  /**
   * One status request per mount.
   *
   * The ref is the guard: React 18 StrictMode double-invokes effects in
   * development, and without it every account visit would fire two identical reads —
   * and `?view=status` opportunistically triggers qualification server-side, so a
   * duplicate is not free.
   */
  const requested = useRef(false);

  const describeError = useCallback(
    (err: unknown): string => {
      if (err instanceof ReferralError) {
        switch (err.status) {
          case 401:
            return t("account.referral.errorUnauthenticated");
          case 404:
            return t("account.referral.errorInvalidCode");
          case 409:
            return t("account.referral.errorAlreadyAttributed");
          case 410:
            return t("account.referral.errorExpired");
          case 429:
            return t("account.referral.errorRateLimited");
          case 503:
            return t("account.referral.errorUnavailable");
          default:
            return t("account.referral.errorGeneric");
        }
      }
      return t("account.referral.errorGeneric");
    },
    [t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchReferralStatus();
      // The code is minted on first ask rather than on every account visit, so a
      // user who never opens this card never creates a row.
      if (!next.code) {
        try {
          const code = await fetchOrCreateReferralCode();
          next.code = code || null;
          next.hasReferralCode = Boolean(code);
        } catch {
          // A missing code is not worth failing the whole card for; the metrics and
          // the invitee state are still worth showing.
        }
      }
      setStatus(next);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [describeError]);

  useEffect(() => {
    if (!userId || requested.current) return;
    requested.current = true;
    setPendingCode(readPendingReferral(now)?.code ?? null);
    void load();
  }, [userId, load, now]);

  const link = status?.code ? buildReferralLink(status.code) : "";

  const announce = useCallback((message: string) => {
    setFeedback(message);
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      announce(t("account.referral.copied"));
    } catch {
      announce(t("account.referral.copyFailed"));
    }
  }, [announce, link, t]);

  /**
   * Native share where it exists, clipboard otherwise — the same progressive
   * fallback MatchCard already uses, so there is one share behaviour in the app.
   */
  const handleShare = useCallback(async () => {
    const text = t("account.referral.description", { days: REWARD_DAYS });
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Footy Predictor", text, url: link });
        return;
      } catch {
        // A cancelled share is not a failure; fall through to copying.
      }
    }
    await handleCopy();
  }, [handleCopy, link, t]);

  const handleClaim = useCallback(async () => {
    if (!pendingCode) return;
    setClaiming(true);
    setError(null);
    try {
      await claimReferral(pendingCode);
      // Only cleared on SUCCESS: a network failure must leave the invitation
      // available to retry rather than silently consuming it.
      clearPendingReferral();
      setPendingCode(null);
      await load();
    } catch (err) {
      setError(describeError(err));
      if (err instanceof ReferralError && [404, 409, 410].includes(err.status)) {
        // Terminal for this code — keeping it would re-offer an invitation the
        // server has already refused for good.
        clearPendingReferral();
        setPendingCode(null);
      }
    } finally {
      setClaiming(false);
    }
  }, [describeError, load, pendingCode]);

  if (!userId) return null;

  const inviter = status?.inviter;
  const invitee = status?.invitee;
  const atCap = Boolean(inviter && inviter.cap > 0 && inviter.capRemaining === 0);
  const showInvite = Boolean(pendingCode) && !dismissed && !invitee;

  return (
    <Card className="space-y-4" data-testid="account-referral">
      <SectionHeader
        as="h2"
        size="section"
        title={t("account.referral.title")}
        description={t("account.referral.description", { days: REWARD_DAYS })}
      />

      {/* Copy and claim outcomes are announced, not only shown. */}
      <p aria-live="polite" className="sr-only">
        {feedback ?? ""}
      </p>

      {showInvite ? (
        <div className="space-y-2 rounded-lg border border-white/10 p-3" data-testid="referral-invite-prompt">
          <p className="text-sm font-semibold">{t("account.referral.inviteTitle")}</p>
          <p className="text-sm opacity-80">{t("account.referral.inviteBody", { days: REWARD_DAYS })}</p>
          {/* Stated plainly, not as an alarm: accepting cannot be undone. */}
          <p className="text-xs opacity-70">{t("account.referral.inviteOnce")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={claiming} disabled={claiming} onClick={() => void handleClaim()}>
              {claiming ? t("account.referral.claiming") : t("account.referral.accept")}
            </Button>
            <Button variant="secondary" disabled={claiming} onClick={() => setDismissed(true)}>
              {t("account.referral.decline")}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label={t("account.referral.loading")}>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : error && !status ? (
        <div className="space-y-2" data-testid="referral-error">
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
          <Button variant="secondary" onClick={() => void load()}>
            {t("account.referral.retry")}
          </Button>
        </div>
      ) : (
        <>
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}

          {status?.code ? (
            <div className="space-y-2">
              <div>
                <p className="text-xs uppercase tracking-wide opacity-70">{t("account.referral.codeLabel")}</p>
                {/* break-all so a long code can never widen the card on a 390px screen */}
                <p className="font-mono text-lg break-all" data-testid="referral-code">
                  {status.code}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide opacity-70">{t("account.referral.linkLabel")}</p>
                <p className="text-sm break-all opacity-80" data-testid="referral-link">
                  {link}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void handleCopy()} aria-label={t("account.referral.copy")}>
                  {t("account.referral.copy")}
                </Button>
                <Button variant="secondary" onClick={() => void handleShare()} aria-label={t("account.referral.share")}>
                  {t("account.referral.share")}
                </Button>
              </div>
            </div>
          ) : null}

          {inviter ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="referral-metrics">
              {/* Every number here is the server's; none is derived locally. */}
              <StatTile label={t("account.referral.successful")} value={String(inviter.successful)} />
              <StatTile
                label={t("account.referral.earned", { n: inviter.earnedDays })}
                value={String(inviter.earnedDays)}
              />
              <StatTile
                label={
                  atCap ? t("account.referral.capReached") : t("account.referral.capRemaining", { n: inviter.capRemaining })
                }
                value={String(inviter.capRemaining)}
              />
            </div>
          ) : null}

          {inviter && inviter.attributed + inviter.qualified > 0 ? (
            <p className="text-sm opacity-70">
              {t("account.referral.pending", { n: inviter.attributed + inviter.qualified })}
            </p>
          ) : null}

          {atCap ? (
            // The cap limits what the INVITER earns, never what their friends get.
            <p className="text-sm opacity-70">{t("account.referral.capReachedHint", { days: REWARD_DAYS })}</p>
          ) : null}

          {invitee ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="referral-invitee-state">
              {invitee.state === "rewarded" ? (
                <Badge tone="success">{t("account.referral.stateRewarded", { days: REWARD_DAYS })}</Badge>
              ) : invitee.state === "qualified" ? (
                <Badge tone="accent">{t("account.referral.stateQualified")}</Badge>
              ) : invitee.state === "attributed" ? (
                <>
                  <Badge tone="neutral">{t("account.referral.stateAttributed")}</Badge>
                  {invitee.expiresAt ? (
                    <span className="text-sm opacity-70">
                      {t("account.referral.stateExpiresOn", { date: formatDate(invitee.expiresAt, locale) })}
                    </span>
                  ) : null}
                </>
              ) : (
                <Badge tone="neutral">{t("account.referral.stateExpired")}</Badge>
              )}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
