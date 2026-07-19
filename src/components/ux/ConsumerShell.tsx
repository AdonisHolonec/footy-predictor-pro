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
 * Header: Date · League · Search · Refresh · Favorites · Notifications · Profile · Settings.
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
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={onOpenProfile}
            title="Open profile"
            className="mr-1 font-display text-base font-bold tracking-tight text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:text-lg"
            aria-label="Footy Predictor — profile"
          >
            Footy<span className="text-[var(--fp-accent)]">Predictor</span>
          </button>

          <label className="sr-only" htmlFor="consumer-date">
            Date
          </label>
          <input
            id="consumer-date"
            type="date"
            title="Select date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="min-h-11 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-3 text-sm font-medium text-[var(--fp-text)]"
          />
          {extraDates}

          <Tooltip label="Filter leagues">
            <button type="button" onClick={onOpenLeagues} className={iconBtn} aria-label="Filter leagues">
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
            className="min-h-11 min-w-[8rem] flex-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-3 text-sm font-medium text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:max-w-xs"
          />

          <Tooltip label="Refresh predictions">
            <span>
              <Button size="sm" loading={refreshBusy} onClick={onRefresh} aria-label="Refresh predictions" aria-busy={refreshBusy}>
                Refresh
              </Button>
            </span>
          </Tooltip>

          <Tooltip label={favoritesActive ? "Show all matches" : "Show favorites only"}>
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
          <Tooltip label="Notifications">
            <button type="button" onClick={onOpenNotifications} className={iconBtn} aria-label="Notifications">
              🔔
            </button>
          </Tooltip>
          <Tooltip label="Profile & upgrade">
            <button type="button" onClick={onOpenProfile} className={iconBtn} aria-label="Profile and upgrade">
              👤
            </button>
          </Tooltip>
          <Tooltip label="Settings">
            <button type="button" onClick={onOpenSettings} className={iconBtn} aria-label="Settings">
              ⚙
            </button>
          </Tooltip>

          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <span className="max-w-[12rem] truncate text-xs font-medium text-[var(--fp-text-muted)]" title={email || undefined}>
              {email}
            </span>
            <Badge tone="accent">{tier}</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
