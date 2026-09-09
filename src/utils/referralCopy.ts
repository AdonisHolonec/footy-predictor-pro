import { ReferralError } from "../services/referralService";

/**
 * Display constants and the error vocabulary the referral surfaces share.
 *
 * `REFERRAL_REWARD_DAYS` mirrors the server's STANDARD_BONUS_DAYS for COPY only —
 * the server decides what is granted, this only fills a sentence.
 *
 * `describeReferralError` is the one mapping from a claim or status failure to
 * something a person can act on. It used to live inside ReferralCard; the
 * post-login invitation needs the same words for the same statuses, and two
 * copies of a status table drift. No raw server reason ever reaches the UI.
 */
export const REFERRAL_REWARD_DAYS = 5;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export function describeReferralError(err: unknown, t: Translate): string {
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
}
