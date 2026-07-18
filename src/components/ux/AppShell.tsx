import type { ReactNode } from "react";
import { APP_NAV_ITEMS, MOBILE_TAB_ITEMS, type AppNavView } from "./appNav";
import Button from "../../design-system/Button";
import Badge from "../../design-system/Badge";

type Props = {
  active: AppNavView;
  onNavigate: (view: AppNavView) => void;
  email?: string | null;
  tier?: string;
  dbMode?: boolean;
  onPredict?: () => void;
  predictBusy?: boolean;
  onOpenCommand?: () => void;
  onOpenNotifications?: () => void;
  onLogout?: () => void;
  children: ReactNode;
};

function NavIcon({ id }: { id: AppNavView }) {
  const common = "h-5 w-5 shrink-0";
  switch (id) {
    case "home":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
        </svg>
      );
    case "matches":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M3 12h18M5.5 5.5c2.5 2 5 3 6.5 3s4-1 6.5-3M5.5 18.5c2.5-2 5-3 6.5-3s4 1 6.5 3" />
        </svg>
      );
    case "history":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <path d="M12 8v5l3 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "statistics":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <path d="M4 19V5M10 19V9M16 19v-7M22 19H2" />
        </svg>
      );
    case "notifications":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 7H3s3 0 3-7Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case "profile":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5" />
        </svg>
      );
    default:
      return null;
  }
}

export default function AppShell({
  active,
  onNavigate,
  email,
  tier = "free",
  dbMode,
  onPredict,
  predictBusy,
  onOpenCommand,
  onOpenNotifications,
  onLogout,
  children
}: Props) {
  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-[var(--fp-border)] bg-[var(--fp-bg-elevated)] lg:flex">
        <div className="flex h-16 items-center px-5">
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className="font-display text-lg font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
          >
            Footy<span className="text-[var(--fp-accent)]">Predictor</span>
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Navigare principală">
          {APP_NAV_ITEMS.map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex min-h-[var(--fp-touch)] items-center gap-3 rounded-[var(--fp-radius-sm)] px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] ${
                  isActive
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                    : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <NavIcon id={item.id} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-[var(--fp-border)] p-4">
          {onPredict && (
            <Button className="w-full" loading={predictBusy} onClick={onPredict}>
              Predict
            </Button>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] text-[var(--fp-text-muted)]">{email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge tone="accent">{tier}</Badge>
                {dbMode && <Badge tone="success">DB</Badge>}
              </div>
            </div>
            {onLogout && (
              <Button variant="ghost" size="sm" onClick={onLogout} aria-label="Logout">
                Ieșire
              </Button>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-[var(--fp-border)] bg-[var(--fp-bg)]/95 px-3 backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => onNavigate("home")}
          className="font-display text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
        >
          Footy<span className="text-[var(--fp-accent)]">Predictor</span>
        </button>
        <div className="flex items-center gap-1">
          {onOpenCommand && (
            <button
              type="button"
              onClick={onOpenCommand}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--fp-radius-sm)] text-[var(--fp-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-label="Căutare"
            >
              ⌘K
            </button>
          )}
          {onOpenNotifications && (
            <button
              type="button"
              onClick={onOpenNotifications}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--fp-radius-sm)] text-[var(--fp-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-label="Notificări"
            >
              <NavIcon id="notifications" />
            </button>
          )}
          {onPredict && (
            <Button size="sm" loading={predictBusy} onClick={onPredict}>
              Predict
            </Button>
          )}
        </div>
      </header>

      <main className="min-h-screen pb-24 lg:ml-60 lg:pb-8">
        <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--fp-border)] bg-[var(--fp-bg-elevated)]/95 backdrop-blur-md lg:hidden"
        aria-label="Navigare mobil"
      >
        {MOBILE_TAB_ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                isActive ? "text-[var(--fp-accent)]" : "text-[var(--fp-text-muted)]"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <NavIcon id={item.id} />
              {item.short}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
