import { useEffect, useMemo, useState } from "react";
import type { PredictionRow } from "../../types";
import type { AppNavView } from "./appNav";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  matches: PredictionRow[];
  onSelectMatch: (m: PredictionRow) => void;
  onNavigate: (view: AppNavView) => void;
  onPredict?: () => void;
};

export default function CommandPalette({
  open,
  onClose,
  onOpen,
  matches,
  onSelectMatch,
  onNavigate,
  onPredict
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
      { id: "nav-home", label: "Go to Home", run: () => onNavigate("home") },
      { id: "nav-matches", label: "Go to Matches", run: () => onNavigate("matches") },
      { id: "nav-history", label: "Go to History", run: () => onNavigate("history") },
      { id: "nav-stats", label: "Go to Statistics", run: () => onNavigate("statistics") },
      { id: "nav-notif", label: "Go to Notifications", run: () => onNavigate("notifications") },
      { id: "nav-profile", label: "Go to Profile", run: () => onNavigate("profile") }
    ];
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
    const filteredActions = qq ? list.filter((a) => a.label.toLowerCase().includes(qq)) : list;
    return [...filteredActions, ...matchHits];
  }, [q, matches, onNavigate, onPredict, onSelectMatch]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 px-4 pt-[12vh]" role="dialog" aria-modal>
      <div className="w-full max-w-lg overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-xl">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Caută meciuri sau navighează…"
          className="w-full border-b border-[var(--fp-border)] bg-transparent px-4 py-3 text-sm text-[var(--fp-text)] outline-none placeholder:text-[var(--fp-text-faint)]"
        />
        <ul className="max-h-72 overflow-y-auto py-2">
          {actions.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="flex min-h-[var(--fp-touch)] w-full items-center px-4 text-left text-sm text-[var(--fp-text)] hover:bg-[var(--fp-accent-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)]"
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
            <li className="px-4 py-3 text-sm text-[var(--fp-text-muted)]">Niciun rezultat</li>
          )}
        </ul>
      </div>
      <button type="button" className="absolute inset-0 -z-10" aria-label="Închide" onClick={onClose} />
    </div>
  );
}
