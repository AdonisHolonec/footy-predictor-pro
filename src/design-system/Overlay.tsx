import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, MutableRefObject, ReactNode, RefObject } from "react";
import {
  acquireBackgroundIsolation,
  acquireScrollLock,
  focusablesIn,
  getOverlayRoot,
  pushOverlay
} from "./overlayInfra";

export type OverlayPresentation = "center" | "sheet" | "drawer" | "palette";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /**
   * Presentation is LAYOUT ONLY. Accessibility, stacking, focus, ESC and
   * scroll-lock are identical across all four — that is the whole point.
   */
  presentation?: OverlayPresentation;
  /** Defaults mirror today's shipped behaviour per surface, set by callers. */
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  /**
   * While busy (a submit in flight that cannot be cancelled), every close
   * path — X, ESC, backdrop — is refused together. Callers decide; the
   * primitive only guarantees consistency.
   */
  busy?: boolean;
  /** Element to focus on open; falls back to the first focusable, then panel. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Optional external ref to the panel element, for callers that need the
   * scroll container (e.g. MatchModal's momentum-strip scroll-to-top).
   */
  panelRef?: MutableRefObject<HTMLDivElement | null>;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /** Backdrop classes (opacity/blur stay per-surface, as shipped today). */
  backdropClassName?: string;
  /** Panel classes — the migrated surfaces keep their exact chrome. */
  panelClassName?: string;
  /** z-index token class; every layer token comes from tokens.css (PR 3). */
  zClassName?: string;
};

const presentationClass: Record<OverlayPresentation, string> = {
  center: "flex items-center justify-center p-3 sm:p-4",
  sheet: "flex items-end justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4",
  drawer: "flex items-end justify-end pb-[env(safe-area-inset-bottom)] sm:items-stretch sm:pb-0",
  palette: "flex items-start justify-center px-3 pt-[12vh]"
};

/**
 * The unified overlay engine (PR 5). One portal root, one ESC stack (only the
 * TOP overlay consumes Escape), one ref-counted scroll lock, one focus
 * trap/restore, one background-isolation mechanism (#root goes inert while
 * anything is open). Dialog composes this for the classic titled modal; the
 * bespoke surfaces (MatchModal, Auth, palette, onboarding…) use it directly
 * and keep their own inner chrome.
 */
export default function Overlay({
  open,
  onClose,
  children,
  presentation = "center",
  closeOnEscape = true,
  closeOnBackdrop = false,
  busy = false,
  initialFocusRef,
  panelRef: externalPanelRef,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  backdropClassName = "bg-fp-navy/60 backdrop-blur-sm",
  panelClassName = "",
  zClassName = "z-[var(--fp-z-modal)]"
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setPanelRef = (node: HTMLDivElement | null) => {
    panelRef.current = node;
    if (externalPanelRef) externalPanelRef.current = node;
  };
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /* Stack + scroll lock + background isolation share one lifecycle. */
  useEffect(() => {
    if (!open) return;
    const popStack = pushOverlay({
      closeOnEscape,
      isBusy: () => busyRef.current,
      onClose: () => onCloseRef.current()
    });
    const releaseLock = acquireScrollLock();
    const releaseIsolation = acquireBackgroundIsolation();
    return () => {
      popStack();
      releaseLock();
      releaseIsolation();
    };
  }, [open, closeOnEscape]);

  /* Initial focus + restore. */
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = initialFocusRef?.current ?? panelRef.current;
    target?.focus?.();
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus only on open/close transitions
  }, [open]);

  if (!open) return null;

  /* Tab wraps INSIDE the panel — one trap, owned here, never copy-pasted. */
  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = focusablesIn(panelRef.current);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (closeOnBackdrop && !busy) onClose();
  };

  return createPortal(
    <div
      className={`fixed inset-0 ${zClassName} ${presentationClass[presentation]} ${backdropClassName}`}
      onClick={onBackdropClick}
    >
      <div
        ref={setPanelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={`outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    getOverlayRoot()
  );
}
