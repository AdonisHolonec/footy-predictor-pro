import { useEffect, useMemo, useState } from "react";
import type { PredictionRow } from "../../types";
import type { AppNavView } from "./TopNav";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  matches: PredictionRow[];
  onSelectMatch: (m: PredictionRow) => void;
  onNavigate: (view: AppNavView) => void;
  onPredict?: () => void;
  showAdmin?: boolean;
};

export default function CommandPalette({
  open,
  onClose,
  onOpen,
  matches,
  onSelectMatch,
  onNavigate,
  onPredict,
  showAdmin
}: Props) {
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) onClose();
        else onOpen?.();
      }
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onOpen]);

  const actions = useMemo(() => {
    const list: { id: string; label: string; run: () => void }[] = [
      { id: "nav-today", label: "Go to Today", run: () => onNavigate("today") },
      { id: "nav-live", label: "Go to Live", run: () => onNavigate("live") },
      { id: "nav-watch", label: "Go to Watchlist", run: () => onNavigate("watchlist") },
      { id: "nav-history", label: "Go to History", run: () => onNavigate("history") },
      { id: "nav-settings", label: "Go to Settings", run: () => onNavigate("settings") }
    ];
    if (showAdmin) {
      list.push({ id: "nav-admin", label: "Go to Admin", run: () => onNavigate("admin") });
    }
    if (onPredict) {
      list.push({ id: "act-predict", label: "Run Warm + Predict", run: () => onPredict() });
    }
    const qq = q.trim().toLowerCase();
    const matchHits = matches
      .filter((m) => {
        if (!qq) return false;
        const hay = `${m.teams.home} ${m.teams.away} ${m.league} ${m.recommended?.pick || ""}`.toLowerCase();
        return hay.includes(qq);
      })
      .slice(0, 8)
      .map((m) => ({
        id: `m-${m.id}`,
        label: `Match: ${m.teams.home} vs ${m.teams.away}`,
        run: () => onSelectMatch(m)
      }));
    const filteredActions = qq
      ? list.filter((a) => a.label.toLowerCase().includes(qq))
      : list;
    return [...filteredActions, ...matchHits];
  }, [q, matches, onNavigate, onPredict, onSelectMatch, showAdmin]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search actions & matches…"
          className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text)] outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {actions.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex w-full px-4 py-2.5 text-left text-sm text-[var(--text)] hover:bg-[var(--bg-muted)]"
                onClick={() => {
                  a.run();
                  onClose();
                }}
              >
                {a.label}
              </button>
            </li>
          ))}
          {!actions.length && (
            <li className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">No results</li>
          )}
        </ul>
      </div>
    </div>
  );
}
