/**
 * NotificationsView extracted verbatim from UserDashboard.tsx (Sprint 6, step c).
 * Rendering and copy are unchanged; state stays in the page, arrives as props.
 */

import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import NotificationsSection from "../../components/ux/NotificationsSection";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Card from "../../design-system/Card";
import type { useUiPrefs } from "../../hooks/useUiPrefs";
import type { HistoryEntry, PredictionRow } from "../../types";
import type { deriveNotifications } from "../../utils/deriveNotifications";

type NotificationItems = ReturnType<typeof deriveNotifications>;

type NotificationsViewProps = {
  notificationItems: NotificationItems;
  alertsPreview: { safe: number; value: number };
  preds: PredictionRow[];
  prefs: ReturnType<typeof useUiPrefs>["prefs"];
  openMatch: (row: PredictionRow | HistoryEntry) => void;
  history: HistoryEntry[];
  markNotificationsSeen: (ids: string[]) => void;
  saveNotificationPrefs: () => void;
  notifSaveBusy: boolean;
  notifySafe: boolean;
  setNotifySafe: Dispatch<SetStateAction<boolean>>;
  notifyValue: boolean;
  setNotifyValue: Dispatch<SetStateAction<boolean>>;
  notifyEmail: boolean;
  setNotifyEmail: Dispatch<SetStateAction<boolean>>;
  notifyEmailConsent: boolean;
  setNotifyEmailConsent: Dispatch<SetStateAction<boolean>>;
};

export default function NotificationsView(props: NotificationsViewProps) {
  const {
    notificationItems,
    alertsPreview,
    preds,
    prefs,
    openMatch,
    history,
    markNotificationsSeen,
    saveNotificationPrefs,
    notifSaveBusy,
    notifySafe,
    setNotifySafe,
    notifyValue,
    setNotifyValue,
    notifyEmail,
    setNotifyEmail,
    notifyEmailConsent,
    setNotifyEmailConsent
  } = props;
  const { t } = useLocale();
  return (
        <section className="space-y-6">
          <NotificationsSection
            items={notificationItems}
            seenIds={prefs.notificationsSeenIds}
            onMarkAllSeen={() => markNotificationsSeen(notificationItems.map((n) => n.id))}
            onOpenFixture={(fixtureId) => {
              const row = preds.find((p) => Number(p.id) === fixtureId) || history.find((h) => Number(h.id) === fixtureId);
              if (row) openMatch(row);
            }}
          />
          <Card>
            <h2 className="font-display text-[length:var(--fp-section)] font-semibold text-[var(--fp-text)]">
              {t("dash.notifyLowRisk")} / {t("dash.notifyValue")}
            </h2>
            <p className="mt-1 text-xs text-[var(--fp-text-muted)]">
              {t("dash.alertsPreview", { low: alertsPreview.safe, value: alertsPreview.value })}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="flex min-h-[var(--fp-touch)] items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 text-sm">
                <input type="checkbox" checked={notifySafe} onChange={(e) => setNotifySafe(e.target.checked)} />
                {t("dash.notifyLowRisk")}
              </label>
              <label className="flex min-h-[var(--fp-touch)] items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 text-sm">
                <input type="checkbox" checked={notifyValue} onChange={(e) => setNotifyValue(e.target.checked)} />
                {t("dash.notifyValue")}
              </label>
              <label className="flex min-h-[var(--fp-touch)] items-center gap-2 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] px-3 text-sm">
                <input
                  type="checkbox"
                  checked={notifyEmail}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setNotifyEmail(next);
                    if (!next) setNotifyEmailConsent(false);
                  }}
                />
                {t("dash.notifyEmail")}
              </label>
            </div>
            {notifyEmail && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] text-[var(--fp-text-muted)]">
                <input
                  type="checkbox"
                  checked={notifyEmailConsent}
                  onChange={(e) => setNotifyEmailConsent(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Confirm consimțământul pentru email — vezi{" "}
                  <Link to="/privacy" className="text-[var(--fp-accent)] underline">
                    politica
                  </Link>
                  .
                </span>
              </label>
            )}
            <Button className="mt-4" loading={notifSaveBusy} onClick={() => void saveNotificationPrefs()}>
              Salvează preferințe
            </Button>
          </Card>
        </section>
  );
}