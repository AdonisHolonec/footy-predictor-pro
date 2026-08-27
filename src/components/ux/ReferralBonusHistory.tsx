import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../context/LocaleContext";
import Badge from "../../design-system/Badge";
import Card from "../../design-system/Card";
import SectionHeader from "../../design-system/SectionHeader";
import { fetchReferralBonusHistory, type ReferralBonus } from "../../services/referralNotificationService";

/**
 * The long form of what the header cards say in passing.
 *
 * The notice in the plan and referral cards is deliberately terse — those are
 * ~100px surfaces and it disappears after five seconds. A reward is worth more
 * than a glance, so the whole sentence lives here, where it stays.
 *
 * READ-ONLY AND SELF-CONTAINED. It fetches its own history rather than being fed
 * through the dashboard, because nothing else on the notifications screen needs
 * this data and threading it would touch four components to no benefit. It never
 * acknowledges anything: reading your history must not consume a notice you have
 * not actually seen.
 */
export default function ReferralBonusHistory() {
  const { t, locale } = useLocale();
  const [bonuses, setBonuses] = useState<ReferralBonus[]>([]);
  /* StrictMode double-invokes effects in development; one read per mount. */
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    // No user id is threaded in: the caller IS the verified session, and the
    // endpoint answers for whoever that is. Signed out, it returns nothing.
    void fetchReferralBonusHistory().then(setBonuses);
  }, []);

  // Nothing to show is not an empty state worth rendering — most users have none.
  if (bonuses.length === 0) return null;

  const when = (iso: string | null) => {
    if (!iso) return "";
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return "";
    return new Date(ms).toLocaleDateString(locale === "ro" ? "ro-RO" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  };

  return (
    <Card className="space-y-3" data-testid="referral-bonus-history">
      <SectionHeader
        as="h2"
        size="section"
        title={t("account.referral.notification.historyTitle")}
        description={t("account.referral.notification.historyDescription")}
      />
      <ul className="space-y-2">
        {bonuses.map((b) => (
          <li
            key={b.grantId}
            className="flex flex-wrap items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 py-2"
          >
            <Badge tone="success">{t("account.referral.notification.planTitleLong", { days: b.days })}</Badge>
            {/* The full sentence, the same one the toast would have carried. */}
            <span className="min-w-0 flex-1 text-sm">
              {b.role === "inviter"
                ? b.inviteeName
                  ? t("account.referral.notification.inviterMessage", { name: b.inviteeName, days: b.days })
                  : t("account.referral.notification.inviterMessageAnonymous", { days: b.days })
                : t("account.referral.notification.inviteeMessage", { days: b.days })}
            </span>
            {b.grantedAt ? <span className="text-xs opacity-70">{when(b.grantedAt)}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
