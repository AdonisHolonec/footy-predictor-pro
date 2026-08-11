import type { ReactNode } from "react";
import Button from "../../design-system/Button";
import Badge from "../../design-system/Badge";
import Tooltip from "../../design-system/Tooltip";
import { useLocale } from "../../context/LocaleContext";
import { MOBILE_TAB_ITEMS, type AppNavView } from "./appNav";
import { NavIcon } from "./navIcons";

type Props = {
  activeNav: AppNavView;
  onNavigate: (view: AppNavView) => void;
  date: string;
  onDateChange: (date: string) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onOpenLeagues: () => void;
  onRefresh: () => void;
  refreshBusy?: boolean;
  /** Generate new predictions (quota). Distinct from Refresh (reload saved). */
  onPredict?: () => void;
  predictBusy?: boolean;
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
 * Consumer chrome — tools toolbar + RO/EN + mobile bottom tabs (primary nav).
 * Mobile: top = brand + filters/tools only; nav lives in the bottom bar.
 * Desktop (lg+): top also shows favorites / alerts / profile / settings icons.
 */
export default function ConsumerShell({
  activeNav,
  onNavigate,
  date,
  onDateChange,
  search,
  onSearchChange,
  onOpenLeagues,
  onRefresh,
  refreshBusy,
  onPredict,
  predictBusy,
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
    "flex h-9 min-w-9 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-sm font-semibold text-[var(--fp-text)] transition-colors hover-fine:border-[var(--fp-accent)] hover-fine:bg-[var(--fp-accent-muted)] hover-fine:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

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

  /**
   * Desktop-only: duplicates bottom tabs / profile shortcuts on mobile.
   *
   * The destinations come first and are not decoration. The bottom tab bar is
   * `lg:hidden`, so above that breakpoint these are the ONLY pointer route to
   * History, Live and the rest — the command palette aside, which nobody
   * discovers with a mouse. Until this existed, a desktop account with no
   * settled picks could not open its own history at all: the one link lived on
   * a Home card that hides itself on a first run.
   */
  const desktopNavIcons = (
    <div className="hidden items-center gap-1 lg:flex">
      {MOBILE_TAB_ITEMS.map((item) => {
        const label = t(item.labelKey);
        const isActive = activeNav === item.id;
        return (
          <Tooltip key={item.id} label={label} align="end">
            <button
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={`${iconBtn} ${isActive ? "border-[var(--fp-accent)] bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]" : ""}`}
            >
              <NavIcon id={item.id} />
            </button>
          </Tooltip>
        );
      })}
      <span aria-hidden className="mx-1 h-5 w-px bg-[var(--fp-border)]" />
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
    </div>
  );

  const actionIcons = (
    <>
      {desktopNavIcons}
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
              onClick={() => onNavigate("home")}
              title={t("nav.home")}
              className="mr-auto min-w-0 truncate font-display text-base font-bold tracking-tight text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:mr-1 sm:text-lg"
              aria-label={t("shell.brandAria")}
            >
              Footy<span className="text-[var(--fp-accent)]">Predictor</span>
            </button>
            <div className="flex shrink-0 items-center gap-1 sm:order-last sm:ml-auto">{actionIcons}</div>
          </div>

          <div className="flex w-full flex-col gap-1.5 sm:flex-1 sm:gap-2">
            {/* Row 1: date range + leagues — always one line */}
            <div className="flex w-full min-w-0 flex-nowrap items-center gap-1">
              <label className="sr-only" htmlFor="consumer-date">
                {t("shell.date")}
              </label>
              <input
                id="consumer-date"
                type="date"
                title={t("shell.selectDate")}
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className="h-8 w-[6.4rem] shrink-0 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-1 text-[11px] font-medium text-[var(--fp-text)] sm:h-9 sm:w-[7.5rem] sm:px-1.5 sm:text-sm"
              />
              {extraDates}
              <Tooltip label={t("shell.filterLeagues")}>
                <button
                  type="button"
                  onClick={onOpenLeagues}
                  className="h-8 min-w-0 flex-1 truncate rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-2 text-[10px] font-bold leading-tight text-[var(--fp-text)] hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:h-9 sm:flex-none sm:px-2.5 sm:text-xs"
                  aria-label={t("shell.filterLeagues")}
                >
                  {t("shell.leagues")}
                </button>
              </Tooltip>
            </div>

            {/* Row 2: search + actions */}
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
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
                className="h-8 min-w-[6.5rem] flex-[1_1_8rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-2 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:h-9 sm:max-w-[14rem] sm:px-2.5"
              />

              {onPredict ? (
                <Tooltip label={t("shell.predictTip")}>
                  <span className="inline-flex">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={predictBusy}
                      onClick={onPredict}
                      className="h-8 shrink-0 font-bold sm:h-9"
                      aria-label={t("shell.predictTip")}
                      aria-busy={predictBusy}
                    >
                      {t("shell.predict")}
                    </Button>
                  </span>
                </Tooltip>
              ) : null}

              <Tooltip label={t("shell.refreshPredictions")}>
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={refreshBusy && !predictBusy}
                    onClick={onRefresh}
                    className="h-8 shrink-0 sm:h-9"
                    aria-label={t("shell.refreshPredictions")}
                    aria-busy={refreshBusy && !predictBusy}
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
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-5 lg:px-8 lg:pb-5">
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label={t("nav.home")}
      >
        {MOBILE_TAB_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-semibold transition-colors duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-current={isActive ? "page" : undefined}
            >
              <span
                className={`flex items-center justify-center rounded-[var(--fp-radius-sm)] px-3.5 py-1 transition-colors duration-[var(--fp-ease)] ${
                  isActive ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]"
                }`}
              >
                <NavIcon id={item.id} />
              </span>
              <span className={isActive ? "text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]"}>
                {t(item.mobileShortKey ?? item.shortKey)}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
