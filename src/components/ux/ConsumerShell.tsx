import type { ReactNode } from "react";
import Button from "../../design-system/Button";
import Badge from "../../design-system/Badge";
import Tooltip from "../../design-system/Tooltip";

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
 * Enterprise UI V2 consumer chrome.
 * Mobile: brand + actions on row 1; date/search/filters on row 2.
 * Desktop: single wrapping toolbar.
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
  const iconBtn =
    "flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-base font-semibold text-[var(--fp-text)] transition-colors hover:border-[var(--fp-accent)] hover:bg-[var(--fp-accent-muted)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 shadow-[var(--fp-shadow-sm)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-2 px-3 py-2.5 sm:px-6 sm:py-3 lg:px-8">
          {/* Row 1 — brand + account actions (always visible on mobile) */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onOpenProfile}
              title="Open profile"
              className="mr-auto min-w-0 truncate font-display text-base font-bold tracking-tight text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:text-lg"
              aria-label="Footy Predictor — profile"
            >
              Footy<span className="text-[var(--fp-accent)]">Predictor</span>
            </button>

            <Tooltip label={favoritesActive ? "Show all matches" : "Show favorites only"} align="end">
              <button
                type="button"
                onClick={onToggleFavorites}
                className={`${iconBtn} ${favoritesActive ? "border-[var(--fp-warning)] bg-[var(--fp-warning)]/10 text-[var(--fp-warning)]" : ""}`}
                aria-label={favoritesActive ? "Show all matches" : "Show favorites only"}
                aria-pressed={favoritesActive}
              >
                ★
              </button>
            </Tooltip>
            <Tooltip label="Notifications" align="end">
              <button type="button" onClick={onOpenNotifications} className={iconBtn} aria-label="Notifications">
                🔔
              </button>
            </Tooltip>
            <Tooltip label="Profile & upgrade" align="end">
              <button type="button" onClick={onOpenProfile} className={iconBtn} aria-label="Profile and upgrade">
                👤
              </button>
            </Tooltip>
            <Tooltip label="Settings" align="end">
              <button type="button" onClick={onOpenSettings} className={iconBtn} aria-label="Settings">
                ⚙
              </button>
            </Tooltip>

            <div className="flex shrink-0 items-center gap-1.5 pl-0.5">
              <span
                className="hidden max-w-[10rem] truncate text-xs font-medium text-[var(--fp-text-muted)] md:inline"
                title={email || undefined}
              >
                {email}
              </span>
              <Badge tone="accent">{tier}</Badge>
            </div>
          </div>

          {/* Row 2 — date, leagues, search, refresh */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="consumer-date">
              Date
            </label>
            <input
              id="consumer-date"
              type="date"
              title="Select date"
              value={date}
              onChange={(e) => onDateChange(e.target.value)}
              className="min-h-11 min-w-0 flex-[1_1_9.5rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-2.5 text-sm font-medium text-[var(--fp-text)] sm:flex-none sm:px-3"
            />
            {extraDates}

            <Tooltip label="Filter leagues">
              <button
                type="button"
                onClick={onOpenLeagues}
                className="min-h-11 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] px-3 text-xs font-bold text-[var(--fp-text)] hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:text-sm"
                aria-label="Filter leagues"
              >
                Leagues
              </button>
            </Tooltip>

            <label className="sr-only" htmlFor="consumer-search">
              Search
            </label>
            <input
              id="consumer-search"
              type="search"
              title="Search teams"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onFocus={() => onOpenSearch?.()}
              placeholder="Search teams…"
              className="min-h-11 min-w-[7rem] flex-[1_1_10rem] rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-3 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:max-w-xs"
            />

            <Tooltip label="Refresh predictions">
              <span className="inline-flex min-w-0 flex-[1_1_auto] sm:flex-none">
                <Button
                  size="sm"
                  loading={refreshBusy}
                  onClick={onRefresh}
                  className="w-full sm:w-auto"
                  aria-label="Refresh predictions"
                  aria-busy={refreshBusy}
                >
                  Refresh
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
