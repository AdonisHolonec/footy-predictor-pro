import { Link } from "react-router-dom";
import type { UiTheme } from "../../hooks/useUiPrefs";

export type AppNavView = "today" | "live" | "watchlist" | "history" | "settings" | "admin";

type Props = {
  active: AppNavView;
  onNavigate: (view: AppNavView) => void;
  email?: string | null;
  tier?: string;
  dbMode?: boolean;
  theme: UiTheme;
  onCycleTheme: () => void;
  onOpenCommand: () => void;
  onOpenNotifications: () => void;
  onPredict?: () => void;
  predictBusy?: boolean;
  showAdmin?: boolean;
  onLogout?: () => void;
};

const NAV: { id: AppNavView; label: string; adminOnly?: boolean }[] = [
  { id: "today", label: "Today" },
  { id: "live", label: "Live" },
  { id: "watchlist", label: "Watchlist" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
  { id: "admin", label: "Admin", adminOnly: true }
];

export default function TopNav({
  active,
  onNavigate,
  email,
  tier = "free",
  dbMode,
  theme,
  onCycleTheme,
  onOpenCommand,
  onOpenNotifications,
  onPredict,
  predictBusy,
  showAdmin,
  onLogout
}: Props) {
  const items = NAV.filter((n) => !n.adminOnly || showAdmin);

  return (
    <header className="sticky top-0 z-40 -mx-3 border-b border-[var(--border)] bg-[var(--bg)]/90 px-3 backdrop-blur-md sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={() => onNavigate("today")}
            className="shrink-0 font-display text-lg font-semibold tracking-tight text-[var(--text)]"
          >
            Footy<span className="text-[var(--accent)]">Predictor</span>
          </button>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                  active === item.id
                    ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenCommand}
            className="hidden items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-1.5 font-mono text-[10px] text-[var(--text-muted)] sm:inline-flex"
            title="Command palette (Ctrl+K)"
          >
            Search <kbd className="rounded border border-[var(--border)] px-1">⌘K</kbd>
          </button>
          {onPredict && (
            <button
              type="button"
              onClick={onPredict}
              disabled={predictBusy}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[#0b0f14] disabled:opacity-50"
            >
              {predictBusy ? "Predict…" : "Predict"}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenNotifications}
            className="rounded-lg border border-[var(--border)] px-2.5 py-2 text-xs text-[var(--text-muted)]"
            aria-label="Notifications"
          >
            Bell
          </button>
          <button
            type="button"
            onClick={onCycleTheme}
            className="rounded-lg border border-[var(--border)] px-2.5 py-2 font-mono text-[10px] uppercase text-[var(--text-muted)]"
            title={`Theme: ${theme}`}
          >
            {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "HC"}
          </button>
          {email && (
            <div className="hidden items-center gap-2 font-mono text-[10px] text-[var(--text-muted)] lg:flex">
              <span className="max-w-[10rem] truncate">{email}</span>
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 uppercase text-[var(--accent)]">
                {tier}
              </span>
              {dbMode && (
                <span className="rounded-full border border-[var(--success)]/40 px-2 py-0.5 text-[var(--success)]">DB</span>
              )}
            </div>
          )}
          <Link to="/privacy" className="hidden text-[10px] text-[var(--accent)] sm:inline">
            Privacy
          </Link>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
            >
              Logout
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="flex gap-1 overflow-x-auto pb-2 md:hidden" aria-label="Mobile primary">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
              active === item.id
                ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                : "bg-[var(--bg-muted)] text-[var(--text-muted)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
