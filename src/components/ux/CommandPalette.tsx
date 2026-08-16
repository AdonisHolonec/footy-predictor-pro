import { useEffect, useMemo, useRef, useState } from "react";
import type { PredictionRow } from "../../types";
import type { AppNavView } from "./appNav";
import { useLocale } from "../../context/LocaleContext";
import { APP_NAV_ITEMS } from "./appNav";
import Overlay from "../../design-system/Overlay";

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  matches: PredictionRow[];
  historyLabels?: string[];
  onSelectMatch: (m: PredictionRow) => void;
  onNavigate: (view: AppNavView) => void;
  onPredict?: () => void;
};

export default function CommandPalette({
  open,
  onClose,
  onOpen,
  matches,
  historyLabels = [],
  onSelectMatch,
  onNavigate,
  onPredict
}: Props) {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setActiveIndex(0);
    }
  }, [open]);

  /*
   * ⌘K / Ctrl+K is the palette's global OPENER, so this listener must live on
   * window — it is the one legitimate window keydown outside overlayInfra.
   * Escape handling moved to the shared overlay stack (PR 5).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) onClose();
        else onOpen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onOpen]);

  const actions = useMemo(() => {
    const list: { id: string; label: string; run: () => void }[] = APP_NAV_ITEMS.map((item) => ({
      id: `nav-${item.id}`,
      label: t(item.labelKey),
      run: () => onNavigate(item.id)
    }));
    if (onPredict) {
      list.push({ id: "act-predict", label: t("shell.predictTip"), run: () => onPredict() });
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
        label: `${m.teams.home} ${t("common.vs")} ${m.teams.away} · ${m.league}`,
        run: () => onSelectMatch(m)
      }));
    const historyHits = qq
      ? historyLabels
          .filter((h) => h.toLowerCase().includes(qq))
          .slice(0, 5)
          .map((h, i) => ({
            id: `h-${i}`,
            label: `${t("nav.history")}: ${h}`,
            run: () => onNavigate("history")
          }))
      : [];
    const filteredActions = qq ? list.filter((a) => a.label.toLowerCase().includes(qq)) : list;
    return [...filteredActions, ...matchHits, ...historyHits];
  }, [q, matches, historyLabels, onNavigate, onPredict, onSelectMatch, t]);

  useEffect(() => {
    setActiveIndex(0);
  }, [q, actions.length]);

  return (
    <Overlay
      open={open}
      onClose={onClose}
      presentation="palette"
      closeOnBackdrop
      zClassName="z-[var(--fp-z-palette)]"
      aria-label="Global search"
      initialFocusRef={inputRef}
      backdropClassName="bg-black/60"
      panelClassName="w-full max-w-lg overflow-hidden rounded-[var(--fp-radius-lg)] border border-[var(--fp-border)] bg-[var(--fp-bg-card)] shadow-xl"
    >
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, Math.max(actions.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && actions[activeIndex]) {
            e.preventDefault();
            actions[activeIndex].run();
            onClose();
          }
        }}
        placeholder="Search team, competition, prediction, history…"
        className="w-full border-b border-[var(--fp-border)] bg-transparent px-4 py-3 text-sm text-[var(--fp-text)] outline-none placeholder:text-[var(--fp-text-faint)]"
        aria-label="Search"
      />
      <ul className="max-h-72 overflow-y-auto py-2" role="listbox">
        {actions.map((a, idx) => (
          <li key={a.id} role="option" aria-selected={idx === activeIndex}>
            <button
              type="button"
              className={`flex min-h-[var(--fp-touch)] w-full items-center px-4 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                idx === activeIndex
                  ? "bg-[var(--fp-accent-muted)] text-[var(--fp-text)]"
                  : "text-[var(--fp-text)] hover:bg-[var(--fp-accent-muted)]"
              }`}
              onMouseEnter={() => setActiveIndex(idx)}
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
          <li className="px-4 py-3 text-sm text-[var(--fp-text-muted)]">No results — try another team or league.</li>
        )}
      </ul>
    </Overlay>
  );
}
