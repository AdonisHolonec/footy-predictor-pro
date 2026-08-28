import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Navigate to a view, then put a specific element in front of the user.
 *
 * THE BUG THIS EXISTS FOR. The referral campaign strip under the header sent
 * the user to Account and stopped there: the referral card it was selling stayed
 * below the fold. Scrolling from inside the click handler cannot work — at that
 * moment the destination has not rendered, so `getElementById` returns null and
 * nothing happens, silently. The scroll needs a later turn of the loop than the
 * navigation that makes its target exist.
 *
 * So the request is state and an effect performs it after the render that
 * mounted the destination. No timer, no retry loop, no polling: React already
 * guarantees the ordering, provided the destination is not lazy-loaded. If a
 * caller's view ever becomes lazy, the honest fix is to await that chunk rather
 * than to guess with a delay.
 */
type Request<View> = { id: string; view: View; seq: number };

export type NavigateAndReveal<View> = {
  reveal: (view: View, id: string) => void;
};

export function useNavigateAndReveal<View>(
  currentView: View,
  setView: (view: View) => void
): NavigateAndReveal<View> {
  /*
    `seq` is load-bearing. Without it a second click while already on the
    destination would set an identical value, React would bail out of the
    re-render, and the effect would never re-run — the request would silently do
    nothing every time after the first.
  */
  const seq = useRef(0);
  const [request, setRequest] = useState<Request<View> | null>(null);

  const reveal = useCallback(
    (view: View, id: string) => {
      setView(view);
      seq.current += 1;
      setRequest({ id, view, seq: seq.current });
    },
    [setView]
  );

  useEffect(() => {
    if (!request || currentView !== request.view) return;
    const el = document.getElementById(request.id);
    /*
      Cleared whether or not the element was found, so one click is one attempt.
      A request left pending would fire again on the next unrelated navigation
      back to this view, scrolling the user somewhere they never asked to go.
    */
    setRequest(null);
    if (!el) return;
    /*
      `block: "start"` pairs with the target's own `scroll-mt-*`: scroll-margin
      applies to the start edge, so `block: "center"` would silently discard the
      offset and let the sticky header cover what we just revealed.

      Reduced motion reuses the matchMedia check the rest of the app already
      makes (MatchMomentumTimeline, Login) rather than introducing a second
      motion system.
    */
    const reduce =
      typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [request, currentView]);

  return { reveal };
}
