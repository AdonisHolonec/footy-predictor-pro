import type { ReactNode } from "react";
import Button from "../../design-system/Button";
import Badge from "../../design-system/Badge";
import Tooltip from "../../design-system/Tooltip";
import { useLocale } from "../../context/LocaleContext";

type Props = {
  date: string;
  onDateChange: (date: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onOpenLeagues: () => void;
  onRefresh: () => void;
  refreshBusy?: boolean;
  favoritesActive?: boolean;
  onToggleFavorites: () => void;
  onOpenNotifications: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  email?: string | null;
  tier?: string;
  extraDates?: ReactNode;
  children: ReactNode;
};

/**
 * Consumer chrome — compact toolbar + RO/EN switch.
 * Mobile: 2 rows; sm+: single wrapping row.
 */
export default function ConsumerShell({
  date,
  onDateChange,
  search,
  onSearchChange,
  onOpenLeagues,
  onRefresh,
  refreshBusy,
  favoritesActive,
  onToggleFavorites,
  onOpenNotifications,
  onOpenProfile,
  onOpenSettings,
  onOpenSearch,
  email,
  tier = "free",
  extraDates,
  children
}: Props) {
  const { locale, setLocale, t } = useLocale();

  const iconBtn =
    "flex h-9 min-w-9 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-sm font-semibold text-[var(--fp-text)] transition-colors hover:border-[var(--fp-accent)] hover:bg-[var(--fp-accent-muted)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

  const langSwitch = (
    <div
      className="inline-flex h-9 overflow-hidden rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)]"
      role="group"
      aria-label={t("shell.switchLang")}
    >
      <button
        type="button"
        title={t("shell.switchLang")}
        onClick={() => setLocale("ro")}
        className={`min-w-9 px-2 text-[11px] font-bold ${
          locale === "ro" ? "bg-[var(--fp-accent)] text-white" : "bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)]"
        }`}
      >
        {t("shell.langRo")}
      </button>
      <button
        type="button"
        title={t("shell.switchLang")}
        onClick={() => setLocale("en")}
        className={`min-w-9 px-2 text-[11px] font-bold ${
          locale === "en" ? "bg-[var(--fp-accent)] text-white" : "bg-[var(--fp-bg-card)] text-[var(--fp-text-muted)]"
        }`}
      >
        {t("shell.langEn")}
      </button>
    </div>
  );

  const actionIcons = (
    <>
      <Tooltip label={favoritesActive ? t("shell.favoritesOn") : t("shell.favoritesOff")} align="end">
        <button
          type="button"
          onClick={onToggleFavorites}
          className={`${iconBtn} ${favoritesActive ? "border-[var(--fp-warning)] bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]" : ""}`}
          aria-label={favoritesActive ? t("shell.favoritesOn") : t("shell.favoritesOff")}
          aria-pressed={favoritesActive}
        >
          ★
        </button>
      </Tooltip>
      <Tooltip label={t("shell.notifications")} align="end">
        <button type="button" onClick={onOpenNotifications} className={iconBtn} aria-label={t("shell.notifications")}>
          🔔
        </button>
      </Tooltip>
      <Tooltip label={t("shell.profileUpgrade")} align="end">
        <button type="button" onClick={onOpenProfile} className={iconBtn} aria-label={t("shell.profileUpgrade")}>
          👤
        </button>
      </Tooltip>
      <Tooltip label={t("shell.settings")} align="end">
        <button type="button" onClick={onOpenSettings} className={iconBtn} aria-label={t("shell.settings")}>
          ⚙
        </button>
      </Tooltip>
      {langSwitch}
      <Badge tone="accent">{tier}</Badge>
    </>
  );

  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 shadow-[var(--fp-shadow-sm)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:px-6 sm:py-2.5 lg:px-8">
          <div className="flex items-center gap-1.5 sm:contents">
            <button
              type="button"
              onClick={onOpenProfile}
              title={t("shell.openProfile")}
              className="mr-auto min-w-0 truncate font-display text-base font-bold tracking-tight text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:mr-1 sm:text-lg"
              aria-label={t("shell.brandAria")}
            >
              Footy<span className="text-[var(--fp-accent)]">Predictor</span>
            </button>
            <div className="flex shrink-0 items-center gap-1 sm:order-last sm:ml-auto">{actionIcons}</div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:flex-1 sm:gap-2">
            <label className="sr-only" htmlFor="consumer-date">
              {t("shell.date")}
            </label>
            <input
              id="consumer-date"
              type="date"
              title={t("shell.selectDate")}
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="h-9 min-w-0 flex-[1_1_8.5rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-2 text-sm font-medium text-[var(--fp-text)] sm:flex-none sm:px-2.5"
            />
            {extraDates}

            <Tooltip label={t("shell.filterLeagues")}>
              <button
                type="button"
                onClick={onOpenLeagues}
                className="h-9 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2.5 text-xs font-bold text-[var(--fp-text)] hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
                aria-label={t("shell.filterLeagues")}
              >
                {t("shell.leagues")}
              </button>
            </Tooltip>

            <label className="sr-only" htmlFor="consumer-search">
              {t("shell.search")}
            </label>
            <input
              id="consumer-search"
              type="search"
              title={t("shell.searchTeams")}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => onOpenSearch?.()}
              placeholder={t("shell.searchTeams")}
              className="h-9 min-w-[6.5rem] flex-[1_1_8rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-2.5 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:max-w-[14rem]"
            />

            <Tooltip label={t("shell.refreshPredictions")}>
              <span className="inline-flex">
                <Button
                  size="sm"
                  loading={refreshBusy}
                  onClick={onRefresh}
                  className="h-9"
                  aria-label={t("shell.refreshPredictions")}
                  aria-busy={refreshBusy}
                >
                  {t("shell.refresh")}
                </Button>
              </span>
            </Tooltip>

            <span
              className="hidden max-w-[9rem] truncate text-xs font-medium text-[var(--fp-text-muted)] md:inline"
              title={email || undefined}
            >
              {email}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-4 sm:px-6 sm:py-5 lg:px-8">{children}</main>
    </div>
  );
}
