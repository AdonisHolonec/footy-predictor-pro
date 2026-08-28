import { useEffect, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import type { UserTier } from "../../types";
import type { ReferralBonus } from "../../services/referralNotificationService";
import { isPredictBlocked, type PredictQuota } from "./predictState";

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
  /** Active 24h trials, each with the tier it grants. Never pre-collapsed. */
  trials?: ReadonlyArray<TrialGrant>;
  /**
   * Free-tier daily predictions. A free plan does not expire, so this is the
   * only honest answer to "how much have I got left" for it.
   */
  quota?: PredictQuota | null;
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
/**
 * The same instant, shortened to its two leading units.
 *
 * "34z 1h 0m" is three units and ~54px of mono; when the quota shares the line
 * the third unit is noise on a month-long figure and the 390px row cannot pay
 * for it. Dropping trailing minutes keeps the fact truthful — the value is
 * still the real remaining time, just coarser — and the sr-only form beside it
 * carries the full precision for assistive technology.
 */
export function compactRemaining(full: string): string {
  const parts = full.split(" ");
  return parts.length > 2 ? parts.slice(0, 2).join(" ") : full;
}

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
 * Which plural key a count needs — ONE implementation for every count here.
 *
 * Romanian has three forms and the third is not optional: 1 predicție,
 * 5 predicții, 21 DE predicții. A single interpolated string rendered
 * "1 predicții azi" to a first-class locale. English collapses few/other, so
 * the same three keys serve both catalogues.
 *
 * The spoken countdown below used to carry its own two-form model — One/Many —
 * which is the same defect this exists to prevent, in the same file: it said
 * "45 minute" where Romanian needs "45 DE minute", for 40 of every 60 minute
 * values. It calls this now. A second plural system is how the first drifts.
 */
function pluralKey(base: string, n: number): string {
  if (n === 1) return `${base}One`;
  const mod = n % 100;
  return n === 0 || (mod >= 1 && mod <= 19) ? `${base}Few` : `${base}Other`;
}

/** Ascending capability order. Used only to ask "did a grant raise this?". */
const TIER_RANK: Record<UserTier, number> = { free: 0, premium: 1, ultra: 2 };

/**
 * A 24h trial, WITH the tier it grants.
 *
 * The tier is the whole point. `useAuth` also exposes a single collapsed
 * `trialExpiresAt` — Math.max of both trial columns — and feeding that here
 * recreated the defect resolveAccess exists to prevent: an Ultra trial ending
 * in 1h beside a Premium trial ending in 23h produced "ULTRA · 23h", pairing
 * the tier of one grant with the clock of another. A trial can only be counted
 * against a tier it is actually able to sustain.
 */
export type TrialGrant = { tier: UserTier; until?: string | null };

export type AccessState = {
  /** The tier the card names — the server's effective tier, unchanged. */
  tier: UserTier;
  /** Which grant sustains THAT tier, and therefore owns the countdown. */
  source: "bonus" | "trial" | "subscription" | "none";
  /** Sub-label key, chosen from the same resolution as the clock. */
  reasonKey: string;
  /** True when a temporary grant is why `tier` reads above the paid tier. */
  explainsUpgrade: boolean;
  /** When the NAMED tier stops. null when nothing is counting down. */
  expiresAt: number | null;
};

/**
 * Resolve the tier, the reason and the deadline TOGETHER, because shown
 * separately they can contradict each other.
 *
 * THE BUG THIS REPLACES. The old resolver returned the last of bonus / trial /
 * subscription to expire — the moment the user drops to free. The card paired
 * that clock with the EFFECTIVE tier, and when the two came from different
 * grants the pairing was a false statement. A Premium subscriber with 30 days
 * left who accepts a 5-day Ultra referral read:
 *
 *     ULTRA · Premium + bonus · 30z 4h
 *
 * Ultra ends in five days. On mobile the reason is hidden and it reduced to
 * "ULTRA · 30z 4h" — an unqualified claim about paid access, in permanent
 * chrome, produced by the referral loop this header exists to sell.
 *
 * THE RULE. The countdown must end when the tier ON SCREEN ends. A subscription
 * sustains the tier that was paid for and nothing above it, so once a grant has
 * raised the effective tier the subscription's end says nothing about how long
 * the user keeps what the card is naming — and is excluded from the candidates.
 *
 * Nothing here re-derives entitlement. Every instant is the server's, unchanged;
 * this only picks which already-granted one the card is allowed to show.
 */
export function resolveAccess(input: {
  /** EFFECTIVE tier from the server — what the card names. */
  tier: UserTier;
  /** UNDERLYING paid tier, independent of any bonus. */
  requestedTier: UserTier;
  hasActiveBonus: boolean;
  bonusUntil?: string | null;
  subscriptionUntil?: string | null;
  trials?: ReadonlyArray<TrialGrant>;
  now: number;
}): AccessState {
  const at = (iso?: string | null) => {
    if (!iso) return null;
    const ts = Date.parse(iso);
    // Already past counts as no grant: an expired instant is not "time available".
    return Number.isFinite(ts) && ts > input.now ? ts : null;
  };
  const bonus = input.hasActiveBonus ? at(input.bonusUntil) : null;
  const subscription = at(input.subscriptionUntil);

  /*
    A trial counts only if it can sustain the tier being NAMED. A Premium trial
    says nothing about how long an Ultra card stays Ultra, however long it runs
    — so it is not a candidate for it. Among the trials that do qualify, the
    last to expire is the one that holds the tier up.
  */
  const trial = (input.trials ?? [])
    .filter((g) => TIER_RANK[g.tier] >= TIER_RANK[input.tier])
    .map((g) => at(g.until))
    .filter((ts): ts is number => ts !== null)
    .reduce<number | null>((acc, ts) => (acc === null || ts > acc ? ts : acc), null);

  const upgraded = TIER_RANK[input.tier] > TIER_RANK[input.requestedTier];

  /*
    Only grants that can actually sustain the NAMED tier are candidates. When
    the effective tier is above the paid one, the subscription is not one of
    them however long it runs.
  */
  const candidates: ReadonlyArray<readonly [AccessState["source"], number | null]> = upgraded
    ? [
        ["bonus", bonus],
        ["trial", trial]
      ]
    : [
        ["bonus", bonus],
        ["trial", trial],
        ["subscription", subscription]
      ];

  let source: AccessState["source"] = "none";
  let expiresAt: number | null = null;
  for (const [name, end] of candidates) {
    if (end !== null && (expiresAt === null || end > expiresAt)) {
      expiresAt = end;
      source = name;
    }
  }

  /*
    The reason names the grant that OWNS THE CLOCK, so the two halves of the
    line cannot describe different things — keying it off the upgrade instead
    would tell an Ultra subscriber "Abonament activ" beside a countdown that is
    actually their bonus running out.

    `explainsUpgrade` is a narrower question and stays separate: it is only true
    when a bonus is why the tier reads higher than the paid one, which is what
    earns the reason its space on a 390px row.
  */
  /*
    A TRIAL explains an upgrade just as a bonus does. Gating this on the bonus
    alone left a trial user reading a bare "ULTRA · 20h 0m" — true, but with
    nothing saying why they are Ultra or what happens when the clock runs out,
    which is the whole job of this line.
  */
  const explainsUpgrade = upgraded && (source === "bonus" || source === "trial" || input.hasActiveBonus);
  /*
    With no clock at all there is nothing for the reason to contradict, so it
    falls back to the only fact the server gave us: a bonus is running, even
    though no instant was supplied to count it down.
  */
  const bonusOwnsClock = source === "bonus" || (source === "none" && input.hasActiveBonus);
  /*
    EVERY BRANCH NAMES THE GRANT THAT OWNS THE CLOCK — including the branch
    where nothing does.

    `source` has four members and this used to have three keys, so anything
    unaccounted for fell through to "Abonament activ". That produced a card
    reading "ULTRA · Abonament activ" for a user with no subscription at all:
    a quota-exempt account (the server forces effectiveTier to ULTRA with no
    grants), or an expired Ultra trial beside a live Premium one. It is the
    same false pairing this resolver exists to prevent, one branch further on.

    When no grant owns the clock, the honest sentence is that the access is
    active — not that it was paid for.
  */
  const reasonKey = bonusOwnsClock
    ? explainsUpgrade && input.requestedTier === "premium"
      ? "account.header.premiumPlusBonus"
      : "account.header.bonusActive"
    : source === "trial"
      ? "account.header.trialActive"
      : source === "subscription"
        ? "account.header.subscriptionActive"
        : input.tier === "free"
          ? "account.header.freePlan"
          : "account.header.tierActive";

  return { tier: input.tier, source, reasonKey, explainsUpgrade, expiresAt };
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
      ? // Neutral shadow, not shadow-emerald-900. The fill is a token that moves
        // per theme — it is teal now, and the chip-free fill is white in two
        // themes — so a hue-locked Tailwind shadow drifts away from whatever it
        // is meant to be sitting under. Black at low alpha reads as shadow under
        // every fill this chip can take.
        "bg-[var(--fp-chip-active)] shadow-black/25"
      : // The offer tag borrows the brand red rather than the danger token: this
        // says "costs nothing", it is not a warning.
        "bg-[var(--fp-chip-free)] shadow-black/25";
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
  trials,
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
  const access = resolveAccess({
    tier,
    requestedTier,
    hasActiveBonus,
    bonusUntil,
    subscriptionUntil,
    trials,
    now: clock
  });
  const accessEnd = access.expiresAt;
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
    if (d > 0) parts.push(t(pluralKey("account.header.spokenDay", d), { count: d }));
    // Same condition as formatBonusRemaining: "2z 0h 5m" must not be heard as
    // "2 zile 5 minute". The two renderings share an instant AND a unit list.
    if (h > 0 || d > 0) parts.push(t(pluralKey("account.header.spokenHour", h), { count: h }));
    parts.push(t(pluralKey("account.header.spokenMinute", m), { count: m }));
    return parts.join(" ");
  })();

  /*
    A free plan has no expiry, so there is no countdown to show — and inventing
    one would be a lie. What a free user actually has left today is predictions,
    which the server already sends, so that is what the second line reports.
  */
  /*
    An exempt account has no allowance to report, so it never renders a count —
    the exemption is read off the quota itself now, not inferred from the caller
    having passed null.
  */
  const quotaLeft =
    !remaining && quota && !quota.quotaExempt && quota.limit !== null
      ? Math.max(0, quota.limit - quota.used)
      : null;

  /*
    THE QUOTA IS THE URGENT FACT ONCE IT IS SPENT, so it LEADS the detail line
    even while a countdown is running. It does not replace it — see the
    quotaSpent branch below, which renders both.

    Otherwise a Premium subscriber saw "ULTRA · 34z 1h" beside a Predict button
    that refused, with nothing anywhere explaining why — the quota line only
    rendered when there was no clock. The fix used to be a tag pinned to the
    button; it overlapped the button's own glyphs and put the same number in two
    places. Status belongs on the status card.

    An intermediate version of that fix then let the quota REPLACE the clock,
    which cost a subscriber their expiry for the rest of any day they used the
    product. Access and allowance are different questions and a blocked user has
    both, so the line leads with the allowance and keeps the clock behind it.

    `isPredictBlocked` is the SAME rule the Predict gate uses, and it is now
    given the SAME inputs.

    It used to be called with a hardcoded `quotaExempt: false`, which was only
    ever correct because the caller separately encoded exemption by passing
    `quota={null}` — a convention no type enforced and nothing here could check.
    A caller that reasonably passed real counters for an exempt account (to show
    an unlimited user their usage, say) would have made this card announce "0
    predicții azi" beside a Predict button that worked perfectly: the plan card
    and the Predict button disagreeing about one fact, which is the exact defect
    the shared rule exists to prevent, reintroduced by the way the rule was
    called. The quota now states its own exemption and the predicate reads it.
  */
  const quotaSpent = quota !== null && isPredictBlocked(quota);

  /*
    The sub-label comes from the SAME resolution as the clock — see
    resolveAccess. Deriving it separately is how the two came to describe
    different grants.
  */
  const detail = t(access.reasonKey);

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
      className="flex min-w-0 shrink items-center gap-1.5 sm:gap-2.5"
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
        {/*
          NO opacity HERE. `opacity-80` composited this whole line at 0.8 alpha
          over the tinted card and took it to 3.21:1 (free, on the #a16207 ink
          of the day), 3.47 (premium) and 3.68 (ultra) in the light theme — the
          free ink has since been deepened to #854d0e, which would have measured
          4.08 under the same opacity, still short. 10px semibold is normal text, so the
          bar is 4.5:1, and this line carries the countdown, the quota and the
          plan reason. De-emphasis cannot be re-added as a lighter ink either:
          the tier inks already sit near the threshold on their own fill. The
          hierarchy is carried by the line above being mono, bold, uppercase and
          tracked instead — weight and case, not transparency.
        */}
        <span className="whitespace-nowrap text-[10px] font-semibold" data-testid="plan-detail">
          {notice ? (
            notice.plan.detail
          ) : quotaSpent ? (
            /*
              BOTH FACTS, not one instead of the other.

              An earlier pass let the spent allowance replace the clock, which
              cost a paying subscriber their expiry for the rest of any day they
              actually used the product — the exact thing this card exists to
              show. Access and allowance are different questions and a blocked
              user has both.

              The quota leads because it is the one that just changed and the
              one that explains the refused button. The clock follows it at ≥sm,
              where there is room, and the spoken form carries it at every width
              so assistive technology never loses the expiry at all.
            */
            <>
              {/*
                THE REASON SURVIVES BEING BLOCKED. Without it a Premium
                subscriber on a bonus reads "ULTRA · 0 predicții azi · 5z" with
                nothing saying the Ultra is temporary — the same omission the
                remaining branch guards against, one branch over.
              */}
              {access.explainsUpgrade ? (
                <>
                  <span className="sr-only sm:not-sr-only sm:inline">{detail}</span>
                  <span className="hidden sm:inline">{" · "}</span>
                </>
              ) : null}
              <span className="tabular-nums" data-testid="plan-time">
                {t(pluralKey("account.header.quotaLeft", 0), { count: 0 })}
              </span>
              {remaining ? (
                <>
                  {/*
                    VISIBLE AT EVERY WIDTH. This was `hidden sm:inline`, which
                    meant a mobile subscriber — the majority — still lost their
                    expiry the moment their allowance ran out, which is the
                    defect the both-facts line exists to fix. At 390 it shows
                    the two leading units; the full value stays in the spoken
                    form so nothing is lost to assistive technology.
                  */}
                  <span aria-hidden="true">{" · "}</span>
                  <span className="font-mono font-bold sm:hidden" aria-hidden="true">
                    {compactRemaining(remaining)}
                  </span>
                  <span className="hidden font-mono font-bold sm:inline" aria-hidden="true">
                    {remaining}
                  </span>
                  <span className="sr-only">{spokenRemaining}</span>
                </>
              ) : null}
            </>
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
              {access.explainsUpgrade ? (
                <>
                  {/* The parent no longer dims, so there is nothing to stack
                      with — the earlier ~0.64-effective bug cannot recur here. */}
                  {/*
                    sr-only below sm, not display:none. `hidden` drops the node
                    from the accessibility tree as well as the layout, and the
                    justification for hiding it was WIDTH — which costs a screen
                    reader nothing. The reason is the one thing that explains why
                    a Premium subscriber's card reads Ultra; it stays audible at
                    every width and only stops taking pixels.
                  */}
                  <span className="sr-only sm:not-sr-only sm:inline">{detail}</span>
                  <span className="hidden sm:inline">{" · "}</span>
                </>
              ) : null}
              {/* Mono + bold: the number is the thing being looked up. The
                  `opacity-100` that used to sit here was a no-op — CSS opacity
                  composites a subtree as a group, so a child cannot climb back
                  out of a parent's 0.8. The parent no longer dims at all. */}
              {/* Sighted users get the compact form; AT gets the words, because
                  "11z 3h 47m" announces as unparseable single letters. */}
              <span className="font-mono font-bold" data-testid="plan-time" aria-hidden="true">
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
              {t(pluralKey("account.header.quotaLeft", quotaLeft), { count: quotaLeft })}
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
          shrink-0 UNLESS it is holding a name.

          Letting this card absorb the squeeze unconditionally is what clipped
          the offer: at 390px "+5 zile Ultra" became "+5 zile Ul…", which sells
          nothing. So at rest it is sized to fit and never yields.

          With a notice carrying a dynamic name it becomes the row's pressure
          valve, because that name is the one thing the priority order permits
          to lose characters — everything inside it that is fixed copy stays
          shrink-0 and whole. Before this the valve was the brand, which the
          same order ranks first.
        */
        className={`touch-target relative flex ${notice?.referral.name ? "min-w-0 shrink" : "shrink-0"} flex-col items-center justify-center rounded-[var(--fp-radius-sm)] border border-fp-accent/35 bg-fp-accent/[0.06] px-1.5 py-1 text-center leading-tight sm:px-2 text-[var(--fp-accent-text)] transition-colors hover-fine:bg-fp-accent/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]`}
      >
        {/*
          The offer costs the user nothing, which is the whole pitch — so the
          tag says so. It is hidden during a notice: the card is announcing a
          reward then, and a "free" tag on top of that reads as noise.
        */}
        {!notice ? <CornerBadge tone="free" label={t("account.header.badgeFree")} /> : null}
        {/* nowrap: "+5 zile" breaking across two lines grew the card past the
            56px bar it has to live inside. */}
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-wider">
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
            <span
              /*
                w-full is load-bearing. The card is a COLUMN flex box with
                items-center, which sizes every child to its own content — so
                min-w-0 on the name below had nothing to shrink against, and a
                long name rendered at its full natural width straight out
                through the card and under the Predict button. Matching this row
                to the card's own width is what gives the name a boundary to
                truncate at, and that width is decided by the priority order
                rather than by the name.
              */
              className="flex w-full min-w-0 items-baseline justify-center gap-1 text-[10px] font-semibold"
              data-testid="referral-detail"
            >
              {/*
                NO fixed max-width. `max-w-[2rem]` was a 32px cap — about four
                characters — so "Alexandra" became "Ale…" at 390px whether or
                not the row was actually short of space, while the brand beside
                it truncated to make room for a name nobody could read. The cap
                is gone and the span simply shrinks: flex hands the shortfall to
                the only item in the row that is allowed to lose characters, and
                gives it every pixel the fixed copy is not using.
              */}
              <span className="min-w-0 shrink truncate" data-testid="referral-name">
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
      {/*
        NO sr-only copy of the referral hint here.

        There used to be one, on the theory that `title=` is mouse-only. That is
        wrong: when a control already has an accessible name from its contents,
        `title` becomes its accessible DESCRIPTION and screen readers announce
        it — so the sr-only sibling made assistive technology hear the same
        sentence twice in a row, while doing nothing at all for the sighted
        touch users it was added for (it is, after all, sr-only). The `title` on
        the button is the single home for the offer terms.
      */}

      <p aria-live="polite" role="status" className="sr-only">
        {notice ? `${notice.referral.title} ${notice.referral.detail}. ${notice.plan.title} ${notice.plan.detail}.` : ""}
      </p>
    </div>
  );
}
