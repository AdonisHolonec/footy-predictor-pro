import type { ReactNode } from "react";
import { useLocale } from "../../context/LocaleContext";
import Button from "../../design-system/Button";
import Badge from "../../design-system/Badge";
import { APP_NAV_ITEMS, MOBILE_TAB_ITEMS, type AppNavView } from "./appNav";
import { NavIcon } from "./navIcons";

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
  const { t } = useLocale();

  return (
    <div className="min-h-screen bg-[var(--fp-bg)] text-[var(--fp-text)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-[var(--fp-border)] bg-[var(--fp-bg-elevated)] lg:flex">
        <div className="flex h-16 items-center gap-2 px-5">
          <button
            type="button"
            onClick={() => onNavigate("home")}
            className="font-display text-lg font-semibold tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)]"
          >
            Footy<span className="text-[var(--fp-accent)]">Predictor</span>
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-2" aria-label={t("nav.home")}>
          {APP_NAV_ITEMS.map((item) => {
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`flex min-h-[var(--fp-touch)] items-center gap-3 rounded-[var(--fp-radius-sm)] px-3 text-sm font-semibold transition-[background-color,color] duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--fp-accent)] ${
                  isActive
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-accent)]"
                    : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <NavIcon id={item.id} />
                {t(item.labelKey)}
                {item.id === "live" && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--fp-danger)]" aria-hidden />
                )}
              </button>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-[var(--fp-border)] p-4">
          {onOpenCommand && (
            <Button variant="secondary" className="w-full" onClick={onOpenCommand} aria-label={t("shell.search")}>
              {t("shell.search")} ⌘K
            </Button>
          )}
          {onPredict && (
            <Button className="w-full" loading={predictBusy} onClick={onPredict} aria-busy={predictBusy || undefined}>
              {t("shell.refresh")}
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
              <Button variant="ghost" size="sm" onClick={onLogout}>
                Log out
              </Button>
            )}
          </div>
        </div>
      </aside>

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
              className="flex h-11 w-11 items-center justify-center rounded-[var(--fp-radius-sm)] text-[var(--fp-text-muted)] transition-[background-color,color] duration-[var(--fp-ease)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-label={t("shell.search")}
            >
              ⌘K
            </button>
          )}
          {onOpenNotifications && (
            <button
              type="button"
              onClick={onOpenNotifications}
              className="flex h-11 w-11 items-center justify-center rounded-[var(--fp-radius-sm)] text-[var(--fp-text-muted)] transition-[background-color,color] duration-[var(--fp-ease)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
              aria-label={t("shell.notifications")}
            >
              <NavIcon id="notifications" />
            </button>
          )}
          {onPredict && (
            <Button size="sm" loading={predictBusy} onClick={onPredict} aria-busy={predictBusy || undefined}>
              {t("shell.refresh")}
            </Button>
          )}
        </div>
      </header>

      <main className="min-h-screen pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:ml-60 lg:pb-8">
        <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">{children}</div>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--fp-border)] bg-[var(--fp-bg-elevated)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label={t("nav.home")}
      >
        {MOBILE_TAB_ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-[color,background-color] duration-[var(--fp-ease)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                isActive
                  ? "text-[var(--fp-accent)]"
                  : "text-[var(--fp-text-muted)] hover:bg-[var(--fp-bg-muted)] hover:text-[var(--fp-text)]"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <NavIcon id={item.id} />
              {t(item.shortKey)}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
