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
  /** ISO-8601 instant the bonus ends, or null. */
  bonusUntil: string | null;
  /** ISO-8601 instant the PAID subscription lapses, or null. */
  subscriptionUntil?: string | null;
  /** ISO-8601 instant the 24h trial lapses, or null. */
  trialUntil?: string | null;
  /**
   * Free-tier daily predictions. A free plan does not expire, so this is the
   * only honest answer to "how much have I got left" for it.
   */
  quota?: { used: number; limit: number | null } | null;
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

/**
 * Plan colours. Text always states the tier — see the header comment.
 *
 * TEXT COMES FROM A TOKEN, NOT A `dark:` VARIANT. tailwind.config sets no
 * darkMode, so `dark:` is media-keyed: it follows the OS, not the theme the
 * app applies through html.theme-*. A user choosing Dark in Settings on a
 * light OS kept the light ink on a dark card — sky-700 on the dark surface
 * measured 2.59:1. The border and fill are non-text and stay on Tailwind.
 */
const TONE: Record<UserTier, string> = {
  free: "border-amber-500/40 bg-amber-500/10 text-[var(--fp-tier-free)]",
  premium: "border-emerald-500/40 bg-emerald-500/10 text-[var(--fp-tier-premium)]",
  ultra: "border-sky-500/40 bg-sky-500/10 text-[var(--fp-tier-ultra)]"
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

/**
 * When does the access the user has RIGHT NOW run out?
 *
 * Three different grants can be running at once — a referral bonus, a 24h trial
 * and a paid subscription — and the plan card has one line to answer one
 * question. The honest answer is the LAST of them to expire: that is the moment
 * the current tier actually stops.
 *
 * Every input is the server's, unchanged. Nothing here re-derives entitlement;
 * it only picks which already-granted instant to display.
 *
 * Returns null when nothing is counting down, which is the normal state of a
 * free plan — free does not expire, so it has no time to show.
 */
/**
 * Which plural key a count needs.
 *
 * Romanian has three forms and the third is not optional: 1 predicție,
 * 5 predicții, 21 DE predicții. A single interpolated string rendered
 * "1 predicții azi" to a first-class locale. English collapses few/other,
 * so the same three keys serve both catalogues.
 */
function quotaKey(n: number): string {
  const base = "account.header.quotaLeft";
  if (n === 1) return `${base}One`;
  const mod = n % 100;
  return n === 0 || (mod >= 1 && mod <= 19) ? `${base}Few` : `${base}Other`;
}

export function resolveAccessEnd(input: {
  hasActiveBonus: boolean;
  bonusUntil?: string | null;
  subscriptionUntil?: string | null;
  trialUntil?: string | null;
  now: number;
}): number | null {
  const at = (iso?: string | null) => {
    if (!iso) return Number.NaN;
    const ts = Date.parse(iso);
    // Already past counts as no grant: an expired instant is not "time available".
    return Number.isFinite(ts) && ts > input.now ? ts : Number.NaN;
  };
  const ends = [
    input.hasActiveBonus ? at(input.bonusUntil) : Number.NaN,
    at(input.trialUntil),
    at(input.subscriptionUntil)
  ].filter(Number.isFinite) as number[];
  return ends.length ? Math.max(...ends) : null;
}

/**
 * The little rotated tag pinned to a card's top-right corner.
 *
 * DECORATIVE, AND ARIA-HIDDEN FOR THAT REASON. "Activ" restates what the card's
 * own detail line already says in words, and "Gratis" restates the offer beside
 * it; announcing either again would just make a screen reader read the card
 * twice. Nothing here is the only carrier of its meaning — which is also why a
 * colour-blind user loses nothing.
 *
 * It is absolutely positioned and therefore costs the layout nothing: it cannot
 * grow the 56px bar, push the card's contents, or move the text it sits beside.
 * The card is deliberately not overflow-hidden so the tag can overhang the
 * corner the way the design asks.
 */
function CornerBadge({ tone, label }: { tone: "active" | "free"; label: string }) {
  const skin =
    tone === "active"
      ? "bg-[var(--fp-chip-active)] shadow-emerald-900/25"
      : // The offer tag borrows the brand red rather than the danger token: this
        // says "costs nothing", it is not a warning.
        "bg-[var(--fp-chip-free)] shadow-red-900/25";
  return (
    <span
      aria-hidden="true"
      data-testid={`badge-${tone}`}
      /*
        10px, not smaller. The reference art shows a tinier tag, but
        geometry.guard.test.ts forbids UI text below 10px and a decorative label
        a sighted user cannot read is worse than a slightly larger one. The
        compactness comes from padding and leading instead.
      */
      /*
        rotate-6, not 12. Rotation inflates the box a badge actually occupies —
        a 30x12 pill at 12° needs ~18px of vertical room, which was enough to
        reach down into the tier text. Six degrees keeps the tilt the design
        asks for and gives the words underneath their space back.
      */
      className={`pointer-events-none absolute -right-2 -top-2.5 ${tone === "active" ? "rotate-6" : "-rotate-6"} rounded-full px-1 py-0 font-mono text-[10px] font-bold uppercase leading-none tracking-tight text-[var(--fp-on-accent)] shadow-sm ${skin}`}
    >
      {label}
    </span>
  );
}

export default function PlanHeaderStrip({
  tier,
  requestedTier,
  hasActiveBonus,
  bonusUntil,
  subscriptionUntil = null,
  trialUntil = null,
  quota = null,
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
  const clock = now ?? Date.now();
  /*
    STILL ONE TIMER. It used to start only for a bonus, which is why a paying
    Premium user saw no time at all; it now covers every grant that can expire,
    through the same single interval. A free plan with nothing running still
    creates no interval.
  */
  const accessEnd = resolveAccessEnd({ hasActiveBonus, bonusUntil, subscriptionUntil, trialUntil, now: clock });
  const counting = accessEnd !== null;
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
  const remaining =
    accessEnd !== null
      ? formatBonusRemaining(
          accessEnd - clock,
          t("account.header.unitDay"),
          t("account.header.unitHour"),
          t("account.header.unitMinute")
        )
      : "";

  /*
    The same figure in words, for assistive technology only. Built from the
    same accessEnd, so the two can never disagree.
  */
  const spokenRemaining = (() => {
    if (accessEnd === null) return "";
    const total = Math.max(0, Math.floor((accessEnd - clock) / 60000));
    const d = Math.floor(total / 1440);
    const h = Math.floor((total % 1440) / 60);
    const m = total % 60;
    const parts: string[] = [];
    if (d > 0) parts.push(t(d === 1 ? "account.header.spokenDayOne" : "account.header.spokenDayMany", { count: d }));
    if (h > 0) parts.push(t(h === 1 ? "account.header.spokenHourOne" : "account.header.spokenHourMany", { count: h }));
    parts.push(t(m === 1 ? "account.header.spokenMinuteOne" : "account.header.spokenMinuteMany", { count: m }));
    return parts.join(" ");
  })();

  /*
    A free plan has no expiry, so there is no countdown to show — and inventing
    one would be a lie. What a free user actually has left today is predictions,
    which the server already sends, so that is what the second line reports.
  */
  const quotaLeft =
    !remaining && quota && quota.limit !== null ? Math.max(0, quota.limit - quota.used) : null;

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
        /*
          FIXED COPY AND THE NAME TRAVEL SEPARATELY.

          They used to be one interpolated string, so the single clamp that
          bounds an unknowable name also cut the product's own words — at 390px
          "Invitație acceptată" lost its last characters despite being fixed
          text that always fits when nothing else is competing for the space.

          `name` is null whenever the whole message is fixed (invitee, or an
          inviter with no display name), and the card renders one unclamped
          span for those. `detail` keeps the assembled sentence for the screen
          reader, which needs it whole.
        */
        referral: {
          title: t("account.header.notice.referralTitle"),
          name: bonus.role === "inviter" && bonus.inviteeName ? bonus.inviteeName : null,
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
      }
    : null;

  return (
    <div
      /*
        The SAME gap the bar uses between its own zones. The strip holds two of
        the four zones, so if these two values differ the row reads as
        arbitrarily spaced — brand|plan wide, plan|referral tight.
      */
      className="flex min-w-0 shrink items-center gap-2 sm:gap-2.5"
      data-testid="plan-header-strip"
      data-notice={notice ? "true" : undefined}
    >
      <div
        role="group"
        aria-label={t("account.header.planAria", { tier: t(`account.header.tier.${tier}`) })}
        data-testid="plan-card"
        data-tier={tier}
        /*
          shrink-0: this card's content is short and must never be clipped — with
          min-w-0 the nowrap "+5 zile" spilled straight over the next card. The
          referral card beside it is the one that gives way, by truncating a name.

          `relative` anchors the corner badge; deliberately NOT overflow-hidden,
          because the badge is meant to sit ON the corner and overhang it.
        */
        className={`relative flex shrink-0 flex-col items-center justify-center rounded-[var(--fp-radius-sm)] border px-1.5 py-1 text-center leading-tight sm:px-2 ${TONE[tier]}`}
      >
        {/*
          Shown only while something is actually running. A free plan with no
          grant is not "active" in the sense this badge means, and a badge that
          is always lit says nothing at all.
        */}
        {!notice && counting ? <CornerBadge tone="active" label={t("account.header.badgeActive")} /> : null}
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
        {/*
          nowrap WITHOUT truncate. The card is shrink-0 and sized by this line,
          so clipping here would produce exactly the "ULTRA …" / "11z…" that
          showing the time is meant to prevent. The referral card gives way.
        */}
        <span className="whitespace-nowrap text-[10px] font-semibold opacity-80" data-testid="plan-detail">
          {notice ? (
            notice.plan.detail
          ) : remaining ? (
            <>
              {/*
                THE REASON EARNS ITS SPACE ONLY ON A BONUS.

                "Abonament activ" beside a green ACTIV badge says the same thing
                twice and cost this card ~85px, which is what pushed the brand
                down to "F…". "Premium + bonus" is different: it explains why a
                Premium subscriber currently reads Ultra, and a bare "Ultra"
                there hides what happens when the bonus ends.

                Below sm it drops even then — at 390 the bar cannot hold tier +
                reason + time + offer + CTA, and the reason is the one a user
                can look up in Account. Tier and time survive every width.
              */}
              {hasActiveBonus ? (
                <>
                  {/* No nested opacity: the parent already carries opacity-80,
                  and stacking them put 10px type at ~0.64 effective. */}
              <span className="hidden sm:inline">{detail}</span>
                  <span className="hidden sm:inline">{" · "}</span>
                </>
              ) : null}
              {/* Mono + bold: the number is the thing being looked up. */}
              {/* Sighted users get the compact form; AT gets the words, because
                  "11z 3h 47m" announces as unparseable single letters. */}
              <span className="font-mono font-bold opacity-100" data-testid="plan-time" aria-hidden="true">
                {remaining}
              </span>
              <span className="sr-only">{spokenRemaining}</span>
            </>
          ) : quotaLeft !== null ? (
            /*
              tabular-nums, not font-mono. The rule asks for "tabular-nums OR
              JetBrains Mono"; swapping the family widened this line enough to
              clip the brand at 390, and the brand outranks it. Tabular figures
              in Archivo satisfy the rule at the original width.
            */
            <span className="tabular-nums" data-testid="plan-time">
              {t(quotaKey(quotaLeft), { count: quotaLeft })}
            </span>
          ) : (
            detail
          )}
        </span>
      </div>

      <button
        type="button"
        onClick={onOpenReferral}
        data-testid="referral-cta"
        title={t("account.header.referralHint")}
        /*
          shrink-0, not min-w-0. Letting this card absorb the whole squeeze is
          what clipped the offer: at 390px "+5 zile Ultra" became "+5 zile Ul…",
          which sells nothing. Its content is short and fixed, so it is sized to
          fit; only a NAME is unbounded, and the notice branch caps that itself.
        */
        className="touch-target relative flex shrink-0 flex-col items-center justify-center rounded-[var(--fp-radius-sm)] border border-fp-accent/35 bg-fp-accent/[0.06] px-1.5 py-1 text-center leading-tight sm:px-2 text-[var(--fp-accent-text)] transition-colors hover-fine:bg-fp-accent/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
      >
        {/*
          The offer costs the user nothing, which is the whole pitch — so the
          tag says so. It is hidden during a notice: the card is announcing a
          reward then, and a "free" tag on top of that reads as noise.
        */}
        {!notice ? <CornerBadge tone="free" label={t("account.header.badgeFree")} /> : null}
        {/* nowrap: "+5 zile" breaking across two lines grew the card past the
            56px bar it has to live inside. */}
        <span className="whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-wider">
          {notice ? notice.referral.title : t("account.header.invite")}
        </span>
        {/*
          The fixed offer and a dynamic name need opposite treatment, so they no
          longer share one className: the offer must never be cut, the name must
          always be allowed to be.
        */}
        {notice ? (
          notice.referral.name ? (
            /*
              Name + fixed words, in two containers rather than one.

              The clamp belongs to the name alone: it is the only unknowable
              part, so it is the only part allowed to lose characters. The
              words after it are the product's own and stay whole at every
              width, which is why they carry shrink-0 rather than sharing the
              truncate above them.
            */
            <span className="flex min-w-0 items-baseline gap-1 text-[10px] font-semibold" data-testid="referral-detail">
              <span className="min-w-0 max-w-[2rem] truncate sm:max-w-[8rem]" data-testid="referral-name">
                {notice.referral.name}
              </span>
              <span className="shrink-0 whitespace-nowrap" data-testid="referral-fixed">
                {notice.referral.fixed}
              </span>
            </span>
          ) : (
            /* Entirely fixed copy — nothing here may ever be cut. */
            <span
              className="whitespace-nowrap text-[10px] font-semibold"
              data-testid="referral-detail"
              data-fixed="true"
            >
              {notice.referral.fixed}
            </span>
          )
        ) : (
          <span className="whitespace-nowrap text-[10px] font-semibold" data-testid="referral-detail">
            {t("account.header.inviteReward")}
          </span>
        )}
      </button>

      {/*
        The cards themselves are NOT live regions. They are permanent chrome, and
        marking them live would make a screen reader re-read the plan every time a
        countdown minute ticks. The arrival is announced once here, in full, which
        is also the wording Account › Notifications keeps.
      */}
      {/* title= is mouse-only; the offer terms need a text home for touch and AT. */}
      <span className="sr-only">{t("account.header.referralHint")}</span>

      <p aria-live="polite" role="status" className="sr-only">
        {notice ? `${notice.referral.title} ${notice.referral.detail}. ${notice.plan.title} ${notice.plan.detail}.` : ""}
      </p>
    </div>
  );
}
