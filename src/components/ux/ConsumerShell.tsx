import type { ReactNode } from "react";
import Button from "../../design-system/Button";
import Badge from "../../design-system/Badge";

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
 * Header only: Date · League · Search · Refresh · Favorites · Notifications · Profile · Settings.
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
    "flex h-11 min-w-11 items-center justify-center rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] text-sm font-semibold text-[var(--fp-text-muted)] transition-colors hover:border-[var(--fp-accent)] hover:text-[var(--fp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]";

  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      <header className="sticky top-0 z-40 border-b border-[var(--fp-border)] bg-[var(--fp-bg-card)]/95 shadow-[var(--fp-shadow-sm)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={onOpenProfile}
            className="mr-1 font-display text-base font-bold tracking-tight text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] sm:text-lg"
            aria-label="Footy Predictor home"
          >
            Footy<span className="text-[var(--fp-accent)]">Predictor</span>
          </button>

          <label className="sr-only" htmlFor="consumer-date">
            Date
          </label>
          <input
            id="consumer-date"
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="min-h-11 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-3 text-sm text-[var(--fp-text)]"
          />
          {extraDates}

          <button type="button" onClick={onOpenLeagues} className={iconBtn} aria-label="League filter">
            Leagues
          </button>

          <label className="sr-only" htmlFor="consumer-search">
            Search
          </label>
          <input
            id="consumer-search"
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => onOpenSearch?.()}
            placeholder="Search teams…"
            className="min-h-11 min-w-[8rem] flex-1 rounded-[var(--fp-radius-sm)] border border-[var(--fp-border)] bg-[var(--fp-bg)] px-3 text-sm text-[var(--fp-text)] placeholder:text-[var(--fp-text-faint)] sm:max-w-xs"
          />

          <Button size="sm" loading={refreshBusy} onClick={onRefresh} aria-label="Refresh predictions" aria-busy={refreshBusy}>
            Refresh
          </Button>

          <button
            type="button"
            onClick={onToggleFavorites}
            className={`${iconBtn} ${favoritesActive ? "border-[var(--fp-warning)] text-[var(--fp-warning)]" : ""}`}
            aria-label="Favorites filter"
            aria-pressed={favoritesActive}
          >
            ★
          </button>
          <button type="button" onClick={onOpenNotifications} className={iconBtn} aria-label="Notifications">
            🔔
          </button>
          <button type="button" onClick={onOpenProfile} className={iconBtn} aria-label="Profile">
            👤
          </button>
          <button type="button" onClick={onOpenSettings} className={iconBtn} aria-label="Settings">
            ⚙
          </button>

          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <span className="max-w-[10rem] truncate font-mono text-[10px] text-[var(--fp-text-faint)]">{email}</span>
            <Badge tone="accent">{tier}</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
