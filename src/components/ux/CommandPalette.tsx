import { useEffect, useMemo, useRef, useState } from "react";
import type { PredictionRow } from "../../types";
import type { AppNavView } from "./appNav";
import { useLocale } from "../../context/LocaleContext";
import { APP_NAV_ITEMS } from "./appNav";
import Overlay from "../../design-system/Overlay";
import { predictSurfaceProps, type PredictAction, type PredictSurfaceProps } from "./predictState";

/** One palette row. `disabled` keeps the row visible but unrunnable. */
type Cmd = {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
  /*
    The whole surface contract for rows that have one, spread onto the row —
    not two attributes copied out of it by hand. This row used to call
    `predictSurfaceProps(action)["aria-label"]` to pull a single string and
    then re-implement the rest itself, which is how it ended up with the right
    name, no tooltip and no state hook.
  */
  surfaceProps?: PredictSurfaceProps;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onOpen?: () => void;
  matches: PredictionRow[];
  historyLabels?: string[];
  onSelectMatch: (m: PredictionRow) => void;
  onNavigate: (view: AppNavView) => void;
  /** The shared Predict contract — the palette must not offer what the header refuses. */
  predictAction?: PredictAction;
};

export default function CommandPalette({
  open,
  onClose,
  onOpen,
  matches,
  historyLabels = [],
  onSelectMatch,
  onNavigate,
  predictAction
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

  const actions = useMemo<Cmd[]>(() => {
    const list: Cmd[] = APP_NAV_ITEMS.map((item) => ({
      id: `nav-${item.id}`,
      label: t(item.labelKey),
      run: () => onNavigate(item.id)
    }));
    if (predictAction) {
      /*
        The palette showed an unmarked "Generate predictions" while the header
        showed a blocked button — the fastest path to the action was the one
        with the least state. It now names the reason and cannot be run; the
        gate in warmAndPredict already made it a no-op, so this is the visible
        half of a refusal that was previously silent.
      */
      /*
        The row keeps its NAME so it stays findable by search — the palette
        filters on the label, and swapping it for the reason made "generate"
        match nothing at the moment the user was hunting for it. The state is
        appended instead.

        VISIBLE text, always built the same way. It used to show the long hint
        when idle and `label · reason` when blocked, so the row changed what
        KIND of string it was between states — and the idle version came from
        `t("shell.predictTip")` rather than from the action it represents. The
        label now leads in both, and the reason is what varies.

        This is the row's display string, not its accessible name: the name
        comes wholly from the contract below, and is the only one that has to
        satisfy Label in Name.
      */
      list.push({
        id: "act-predict",
        label: predictAction.reason
          ? `${predictAction.label} · ${predictAction.reason}`
          : predictAction.label,
        run: predictAction.onActivate,
        disabled: predictAction.disabled,
        surfaceProps: predictSurfaceProps(predictAction)
      });
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
  }, [q, matches, historyLabels, onNavigate, onSelectMatch, predictAction, t]);

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
            /*
              ENTER ONLY. This handler is on the SEARCH INPUT, and a previous
              pass added Space here for "parity" with the row's click path —
              which meant every space typed into the query was swallowed and
              multi-word search ("premier league") became impossible. The rows
              are native <button>s, so Space already activates the focused row
              through the browser and lands on the same guarded onClick. There
              was no parity to add, only a keystroke the input needed.

              The refusal itself still matches the pointer path exactly.
            */
            if (actions[activeIndex].disabled) return;
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
              /*
                aria-disabled, not the attribute: the row keeps its place in the
                listbox so the reason is still reachable and readable. It arrives
                with the rest of the contract rather than being restated here.
              */
              {...a.surfaceProps}
              className={`flex min-h-[var(--fp-touch)] w-full items-center px-4 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fp-accent)] ${
                a.disabled
                  ? "cursor-not-allowed text-[var(--fp-text-muted)]"
                  : idx === activeIndex
                    ? "bg-[var(--fp-accent-muted)] text-[var(--fp-text)]"
                    : "text-[var(--fp-text)] hover:bg-[var(--fp-accent-muted)]"
              }`}
              onMouseEnter={() => setActiveIndex(idx)}
              /*
                Overrides the contract's own onClick deliberately, and must stay
                BELOW the spread to do so: the palette has to close after a run,
                which `onActivate` alone cannot do. The guard is kept because
                this handler wraps the run — `a.run` IS `onActivate` for the
                Predict row, so a blocked row would already be a no-op, but
                without the guard it would still close the palette on a refusal.
              */
              onClick={() => {
                if (a.disabled) return;
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
