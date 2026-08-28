import type { ReferralBonus } from "../../services/referralNotificationService";

/**
 * The two halves of a freshly-arrived referral reward, derived ONCE.
 *
 * WHY THIS IS ITS OWN MODULE. The reward is announced on two surfaces — the
 * days on the plan card, the person on the referral campaign — and those two
 * surfaces no longer live in the same component: the campaign moved out of the
 * 56px header. Leaving the derivation inside the plan card and re-deriving the
 * other half in the campaign would put one message in two places, which is the
 * exact shape of every drift this codebase has spent its recent history
 * removing. One builder, two consumers, one wording.
 *
 * This does NOT change the notification architecture. The transient bonus
 * notifications, ReferralBonusHistory and the claim/reward flow are untouched;
 * this only formats what the header chrome shows while a bonus is fresh, which
 * is what it already did.
 */
export type ReferralNotice = {
  /** The plan card's half: how much time was granted. */
  plan: { title: string; detail: string };
  /** The campaign strip's half: who it came from. */
  referral: {
    title: string;
    /**
     * The unknowable part, or null when the whole message is fixed copy.
     * Only this may ever be truncated.
     */
    name: string | null;
    /** Product copy that must never be cut. */
    fixed: string;
    /** The assembled sentence, for assistive technology, which needs it whole. */
    detail: string;
  };
};

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/**
 * FIXED COPY AND THE NAME TRAVEL SEPARATELY.
 *
 * They used to be one interpolated string, so the single clamp that bounds an
 * unknowable name also cut the product's own words — at 390px "Invitație
 * acceptată" lost its last characters despite being fixed text that always fits
 * when nothing else is competing for the space.
 */
export function buildReferralNotice(bonus: ReferralBonus | null | undefined, t: Translate): ReferralNotice | null {
  if (!bonus) return null;
  const named = bonus.role === "inviter" && bonus.inviteeName ? bonus.inviteeName : null;
  return {
    plan: {
      title: t("account.header.notice.planTitle", { days: bonus.days }),
      detail: t("account.header.notice.planSubject")
    },
    referral: {
      title: t("account.header.notice.referralTitle"),
      name: named,
      fixed:
        bonus.role === "invitee"
          ? t("account.header.notice.referralAccepted")
          : bonus.inviteeName
            ? t("account.header.notice.referralJoinedSuffix")
            : t("account.header.notice.referralJoinedAnonymous"),
      detail:
        bonus.role === "invitee"
          ? t("account.header.notice.referralAccepted")
          : bonus.inviteeName
            ? t("account.header.notice.referralJoined", { name: bonus.inviteeName })
            : t("account.header.notice.referralJoinedAnonymous")
    }
  };
}
