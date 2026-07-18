import type { ReactNode } from "react";

export type AdminSection =
  | "dashboard"
  | "engine"
  | "models"
  | "backtesting"
  | "calibration"
  | "feature-importance"
  | "users"
  | "subscriptions"
  | "monitoring"
  | "cache"
  | "api-usage"
  | "logs"
  | "security"
  | "settings"
  | "workspace";

const SECTIONS: { id: AdminSection; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "engine", label: "Prediction Engine" },
  { id: "models", label: "AI Models" },
  { id: "backtesting", label: "Backtesting" },
  { id: "calibration", label: "Calibration" },
  { id: "feature-importance", label: "Feature Importance" },
  { id: "users", label: "Users" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "monitoring", label: "Monitoring" },
  { id: "cache", label: "Cache" },
  { id: "api-usage", label: "API Usage" },
  { id: "logs", label: "Logs" },
  { id: "security", label: "Security" },
  { id: "settings", label: "Settings" },
  { id: "workspace", label: "← Workspace" }
];

type Props = {
  section: AdminSection;
  onSection: (s: AdminSection) => void;
  children: ReactNode;
};

export default function AdminShell({ section, onSection, children }: Props) {
  return (
    <div className="flex min-h-[70vh] flex-col gap-4 lg:flex-row">
      <aside className="w-full shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 lg:w-56">
        <div className="mb-3 px-2 font-display text-sm font-semibold text-[var(--text)]">Admin</div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Admin">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSection(s.id)}
              className={`shrink-0 rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                section === s.id
                  ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-muted)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
