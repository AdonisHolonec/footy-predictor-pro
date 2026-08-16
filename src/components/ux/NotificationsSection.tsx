import { useMemo } from "react";
import type { NotificationItem } from "../../utils/deriveNotifications";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import SectionHeader from "../../design-system/SectionHeader";
import EmptyState from "../../design-system/EmptyState";

type Props = {
  items: NotificationItem[];
  seenIds: string[];
  onMarkAllSeen: () => void;
  onOpenFixture: (fixtureId: number) => void;
};

const KIND_ICON: Record<NotificationItem["kind"], string> = {
  kickoff: "⏱",
  value: "💡",
  momentum: "📈",
  liveSwing: "⚡",
  settled: "🏁"
};

export default function NotificationsSection({ items, seenIds, onMarkAllSeen, onOpenFixture }: Props) {
  const { t } = useLocale();
  const seen = useMemo(() => new Set(seenIds), [seenIds]);
  const hasUnseen = items.some((item) => !seen.has(item.id));

  const iconFor = (item: NotificationItem) => {
    if (item.kind === "momentum") return item.trend === "down" ? "📉" : "📈";
    return KIND_ICON[item.kind];
  };

  const titleFor = (item: NotificationItem) => {
    if (item.kind === "kickoff") return t("dash.notifKickoffTitle");
    if (item.kind === "value") return t("dash.notifValueTitle");
    if (item.kind === "momentum") {
      return item.trend === "down" ? t("dash.notifMomentumDownTitle") : t("dash.notifMomentumUpTitle");
    }
    if (item.kind === "liveSwing") return t("dash.notifLiveSwingTitle");
    return item.validation === "win" ? t("dash.notifSettledWinTitle") : t("dash.notifSettledLossTitle");
  };

  const bodyFor = (item: NotificationItem) => {
    const teamsLine = `${item.teams.home} ${t("common.vs")} ${item.teams.away}`;
    if (item.kind === "kickoff") {
      const h = item.hoursToKickoff ?? 0;
      const label = h < 1 ? t("dash.notifInMinutes", { m: Math.max(1, Math.round(h * 60)) }) : t("dash.notifInHours", { h: Math.round(h) });
      return `${teamsLine} · ${label}`;
    }
    if (item.kind === "value") {
      return item.ev != null ? `${teamsLine} · EV +${item.ev.toFixed(1)}%` : teamsLine;
    }
    if (item.kind === "liveSwing" && item.swingOutcome && item.swingPp != null) {
      const outcomeLabel =
        item.swingOutcome === "home"
          ? item.teams.home
          : item.swingOutcome === "away"
            ? item.teams.away
            : t("match.liveWinDraw");
      const pp = Math.round(item.swingPp);
      return `${teamsLine} · ${outcomeLabel} ${pp > 0 ? `+${pp}` : pp} pp`;
    }
    return teamsLine;
  };

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <SectionHeader as="h1" size="page" eyebrow={t("nav.notifications")} title={t("nav.notifications")} />
        {hasUnseen && (
          <Button variant="ghost" size="sm" onClick={onMarkAllSeen}>
            {t("dash.notifMarkAllRead")}
          </Button>
        )}
      </header>

      {!items.length ? (
        <EmptyState title={t("dash.notifEmptyTitle")} description={t("dash.notifEmptyDesc")} />
      ) : (
        <div className="overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)]">
          {items.map((item, idx) => {
            const isUnseen = !seen.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenFixture(item.fixtureId)}
                className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--fp-bg-muted)] ${
                  idx !== items.length - 1 ? "border-b border-[var(--fp-border)]" : ""
                }`}
              >
                <span className="mt-0.5 shrink-0 text-base" aria-hidden>
                  {iconFor(item)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-[var(--fp-text)]">{titleFor(item)}</span>
                    {isUnseen && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fp-accent)]" />}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--fp-text-muted)]">{bodyFor(item)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
