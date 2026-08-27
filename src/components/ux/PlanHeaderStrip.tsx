import { useEffect, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { UserTier } from "../../types";
import type { ReferralBonus } from "../../services/referralNotificationService";

/**
 * The permanent status strip in the workspace chrome: what you have, and the one
 * way to get more.
 *
 * WHY IT EXISTS. Plan and referral both lived in Account — a screen you have to
 * navigate to. A user could be running on bonus Ultra time and never see it
 * expiring, and the referral that would extend it was two clicks away. Both now
 * sit beside Predict, where the eye already goes.
 *
 * IT RENDERS THE EFFECTIVE TIER, NEVER THE PAID ONE. `entitlement.tier` is what
 * the server says the user can do right now, bonus and trials already applied;
 * `requestedTier` is what they pay for. Showing the paid tier would tell a Free
 * user on bonus Ultra that they are Free — exactly the confusion PR2b separated
 * these two fields to end. The sub-label is the only place the underlying tier
 * shows through, and only to explain WHY the effective one is what it is.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every state spells its tier out in text; the
 * colour repeats that, it does not carry it.
 */

type Props = {
  /** EFFECTIVE tier from the server — feature access, bonus already applied. */
  tier: UserTier;
  /** UNDERLYING paid tier, independent of any bonus. Explains the sub-label. */
  requestedTier: UserTier;
  hasActiveBonus: boolean;
  /** ISO-8601 instant the bonus ends, or null. The countdown's only source. */
  bonusUntil: string | null;
  /** Opens the full referral surface in Account. Never claims anything. */
  onOpenReferral: () => void;
  /**
   * A freshly received referral bonus, shown INSIDE the two cards for a few
   * seconds rather than as a separate toast.
   *
   * Each half of the news lands on the card responsible for it: the reward on the
   * plan card, who joined on the referral card. The copy is deliberately terse —
   * these are 100px-wide surfaces, and the full sentence lives in
   * Account › Notifications.
   */
  bonus?: ReferralBonus | null;
  /** Injected in tests; production reads the real clock. */
  now?: number;
};

/** Plan colours. Text always states the tier — see the header comment. */
const TONE: Record<UserTier, string> = {
  free: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  premium: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  ultra: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
};

/**
 * "12z 7h 44m" — days, hours, minutes, dropping the units that are zero.
 *
 * Minute granularity on purpose: this is a multi-day figure, and a ticking
 * seconds display in permanent chrome is noise that also forces a per-second
 * re-render of the whole header.
 */
export function formatBonusRemaining(ms: number, unitDay: string, unitHour: string, unitMinute: string): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.floor(ms / 60000);
  const days = Math.floor(total / (60 * 24));
  const hours = Math.floor((total % (60 * 24)) / 60);
  const minutes = total % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${unitDay}`);
  if (hours > 0 || days > 0) parts.push(`${hours}${unitHour}`);
  parts.push(`${minutes}${unitMinute}`);
  return parts.join(" ");
}

export default function PlanHeaderStrip({
  tier,
  requestedTier,
  hasActiveBonus,
  bonusUntil,
  onOpenReferral,
  bonus = null,
  now
}: Props) {
  const { t } = useLocale();

  /**
   * ONE timer, and only while a bonus is actually running.
   *
   * A minute tick is enough for a d/h/m readout, and the interval is not created
   * at all when there is nothing counting down — a Free user with no bonus pays
   * nothing for this.
   */
  // Value unused: re-rendering each minute IS the effect.
  const [, setTick] = useState(0);
  const counting = hasActiveBonus && Boolean(bonusUntil);
  useEffect(() => {
    if (!counting || now !== undefined) return;
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [counting, now]);

  /*
    Computed during render rather than memoised. `tick` exists purely to force
    that render each minute, and a useMemo would have to list its own trigger as
    a dependency to work — the confusing spelling of the same thing, for a
    calculation this cheap.
  */
  const end = counting && bonusUntil ? Date.parse(bonusUntil) : Number.NaN;
  const remaining = Number.isFinite(end)
    ? formatBonusRemaining(
        end - (now ?? Date.now()),
        t("account.header.unitDay"),
        t("account.header.unitHour"),
        t("account.header.unitMinute")
      )
    : "";

  /*
    The sub-label answers "why am I on this tier". A paying Premium user running
    on bonus Ultra is told exactly that, rather than being shown a bare "Ultra"
    that hides what happens when the bonus ends.
  */
  const detail = hasActiveBonus
    ? requestedTier === "premium"
      ? t("account.header.premiumPlusBonus")
      : t("account.header.bonusActive")
    : tier === "free"
      ? t("account.header.freePlan")
      : t("account.header.subscriptionActive");

  /*
    The two halves of a reward, each on the card that owns it: the days on the
    plan card, the person on the referral card. Terse by necessity — a card is
    roughly 100px wide, and the full sentence lives in Account › Notifications.
  */
  const notice = bonus
    ? {
        plan: {
          title: t("account.header.notice.planTitle", { days: bonus.days }),
          detail: t("account.header.notice.planSubject")
        },
        referral: {
          title: t("account.header.notice.referralTitle"),
          detail:
            bonus.role === "invitee"
              ? t("account.header.notice.referralAccepted")
              : bonus.inviteeName
                ? t("account.header.notice.referralJoined", { name: bonus.inviteeName })
                : t("account.header.notice.referralJoinedAnonymous")
        }
      }
    : null;

  return (
    <div
      className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2"
      data-testid="plan-header-strip"
      data-notice={notice ? "true" : undefined}
    >
      <div
        data-testid="plan-card"
        data-tier={tier}
        /*
          shrink-0: this card's content is short and must never be clipped — with
          min-w-0 the nowrap "+5 zile" spilled straight over the next card. The
          referral card beside it is the one that gives way, by truncating a name.
        */
        className={`flex shrink-0 flex-col justify-center rounded-[var(--fp-radius-sm)] border px-2 py-1 leading-tight ${TONE[tier]}`}
      >
        {/* nowrap: "+5 zile" breaking across two lines grew the card past the
            56px bar it has to live inside. */}
        <span className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-wider">
          {notice ? notice.plan.title : t(`account.header.tier.${tier}`)}
        </span>
        {/*
          BOTH, on one line — not the countdown instead of the state.
          A paying Premium user on bonus Ultra needs to know why they are Ultra
          AND when it ends: showing only the clock hides what happens afterwards,
          showing only the words hides how long they have.
        */}
        <span className="truncate whitespace-nowrap text-[10px] font-semibold opacity-80" data-testid="plan-detail">
          {notice ? notice.plan.detail : remaining ? `${detail} · ${remaining}` : detail}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpenReferral}
        data-testid="referral-cta"
        title={t("account.header.referralHint")}
        // min-w-0 so this card, not the plan card, absorbs a narrow viewport.
        className="flex min-w-0 flex-col justify-center rounded-[var(--fp-radius-sm)] border border-fp-accent/35 bg-fp-accent/10 px-2 py-1 text-left leading-tight text-[var(--fp-accent)] transition-colors hover-fine:bg-fp-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
      >
        {/* nowrap: "+5 zile" breaking across two lines grew the card past the
            56px bar it has to live inside. */}
        <span className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-wider">
          {notice ? notice.referral.title : t("account.header.invite")}
        </span>
        <span
          className="max-w-[8rem] truncate whitespace-nowrap text-[10px] font-semibold"
          data-testid="referral-detail"
        >
          {notice ? notice.referral.detail : t("account.header.inviteReward")}
        </span>
      </button>

      {/*
        The cards themselves are NOT live regions. They are permanent chrome, and
        marking them live would make a screen reader re-read the plan every time a
        countdown minute ticks. The arrival is announced once here, in full, which
        is also the wording Account › Notifications keeps.
      */}
      <p aria-live="polite" role="status" className="sr-only">
        {notice ? `${notice.referral.title} ${notice.referral.detail}. ${notice.plan.title} ${notice.plan.detail}.` : ""}
      </p>
    </div>
  );
}
