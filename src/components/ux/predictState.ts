/**
 * ONE Predict state, for every surface that can start a prediction run.
 *
 * WHY THIS EXISTS. The quota gate used to live in the header's props, so the
 * header CTA blocked while HomeSection, MatchesSection, the Banner retry, the
 * onboarding effect and the command palette all still reached
 * `warmAndPredict` — seven entry points, one of them gated. A user out of
 * predictions saw a dead button in the chrome and live ones on the same screen.
 *
 * The rule is here, once. `warmAndPredict` consults it before it does anything,
 * which is what makes the invariant hold for callers that render no state at
 * all; the surfaces that CAN show state derive their appearance from the same
 * value rather than recomputing it.
 *
 * It re-derives no entitlement. `quotaExempt`, `limit` and `used` are the
 * server's own fields, combined the way ProfileView already combines them.
 */
export type PredictState = "idle" | "busy" | "blocked";

export type PredictQuota = {
  /** Server verdict: this account ignores the daily limit entirely. */
  quotaExempt: boolean;
  /** Daily allowance, or null for "no limit" — never a number meaning zero. */
  limit: number | null;
  /** Predictions already spent today. */
  used: number;
};

/**
 * Can a run be started at all?
 *
 * Separate from `resolvePredictState` because the authoritative gate has to
 * answer this while a run is already in flight too: "busy" is not "available".
 */
export function isPredictBlocked({ quotaExempt, limit, used }: PredictQuota): boolean {
  if (quotaExempt) return false;
  // null is "no limit", never "a limit of zero".
  if (limit === null) return false;
  return used >= limit;
}

/**
 * The single state every Predict surface renders from.
 *
 * Busy outranks blocked deliberately: the run already in flight is what the
 * user is waiting on, and the class, the accessible name and both tooltips have
 * to agree on which state they describe. Spending the last prediction makes
 * both inputs true at once, and this is the one place that is resolved.
 */
export function resolvePredictState(busy: boolean, quota: PredictQuota): PredictState {
  if (busy) return "busy";
  return isPredictBlocked(quota) ? "blocked" : "idle";
}

/**
 * THE PREDICT ACTION CONTRACT.
 *
 * One object, built once per render, consumed by every surface that offers
 * Predict — the header CTA, the Banner retry, the Home and Matches empty
 * states, the Matches refresh and the command palette.
 *
 * It exists because patching surfaces one at a time kept producing the same
 * class of bug in a new place: one surface gated and four not, a click guarded
 * and its Enter not, a reason shown here and withheld there. A surface that
 * consumes this cannot disagree with the others about what state Predict is in,
 * what it should say, or whether activating it does anything — because none of
 * those are its own decision any more.
 *
 * `onActivate` is the ONLY way a surface should start a run. It is safe to call
 * in any state; when the action is unavailable it does nothing.
 */
export type PredictActionLabels = {
  /** The visible action word, e.g. "Generează Predicții". */
  label: string;
  /** What the action does, shown when it is available. */
  hint: string;
  /** Announced and shown while a run is in flight. */
  busy: string;
  /** Announced and shown when the daily allowance is spent. */
  quotaSpent: string;
};

export type PredictAction = {
  state: PredictState;
  /**
   * The visible action word. Exposed so a surface can RENDER the name without
   * reaching back into i18n for a string the contract was already given — the
   * command palette used `t("shell.predict")` for exactly this and drifted:
   * its row showed the long hint when idle and a composed label when blocked.
   */
  label: string;
  busy: boolean;
  blocked: boolean;
  /** Cannot be activated right now — busy OR blocked. */
  disabled: boolean;
  /** Why it cannot be activated, or null when it can. */
  reason: string | null;
  /** The single string a surface should show: the reason if any, else the hint. */
  hint: string;
  /** Accessible name; always opens with the visible label (WCAG 2.5.3). */
  accessibleName: string;
  /** Starts a run, or does nothing. Never call the underlying function directly. */
  onActivate: () => void;
};

export function buildPredictAction(input: {
  state: PredictState;
  labels: PredictActionLabels;
  run: () => void;
}): PredictAction {
  const { state, labels, run } = input;
  const busy = state === "busy";
  const blocked = state === "blocked";
  const reason = busy ? labels.busy : blocked ? labels.quotaSpent : null;
  return {
    state,
    label: labels.label,
    busy,
    blocked,
    disabled: busy || blocked,
    reason,
    hint: reason ?? labels.hint,
    /*
      Busy and blocked append the reason to the visible label rather than
      replacing it: a voice-control user saying the button's name must still
      match it, which swapping the whole string breaks.
    */
    accessibleName: reason ? `${labels.label} — ${reason}` : labels.hint,
    onActivate: () => {
      if (busy || blocked) return;
      run();
    }
  };
}

/**
 * THE SHARED PREDICT SURFACE.
 *
 * Spread this onto any control that starts a prediction run and the correct
 * behaviour is the default rather than something each surface has to remember:
 * the activation guard, the inert semantics, the truthful name, the truthful
 * tooltip, and the state hook the stylesheet keys off.
 *
 * It exists because a contract alone was not enough. Every round that patched
 * surfaces individually left one behind — a Banner that re-derived `disabled`
 * from a raw state and never showed the reason, a palette row whose keyboard
 * path refused differently from its pointer path. Those were not oversights of
 * understanding; they were things you had to remember five times. This is the
 * thing you spread once.
 *
 * `aria-disabled` rather than the native attribute, deliberately: the control
 * stays focusable so a keyboard user can land on it and hear WHY it is
 * unavailable. Consumers that render a natively-disabled primitive instead must
 * carry the reason visibly, because a control out of the tab order can explain
 * itself to nobody.
 */
export type PredictSurfaceProps = {
  "aria-disabled": true | undefined;
  "aria-busy": true | undefined;
  "aria-label": string | undefined;
  title: string;
  onClick: () => void;
  "data-predict-state": PredictState;
};

export function predictSurfaceProps(action: PredictAction): PredictSurfaceProps {
  return {
    "aria-disabled": action.disabled || undefined,
    "aria-busy": action.busy || undefined,
    /*
      A name ONLY when there is state to add.

      When idle, the control's own visible text is the better accessible name —
      overriding it with the longer hint masks the words the user can actually
      see and says nothing extra. When busy or blocked the name carries the
      reason, and still opens with the visible label so voice control keeps
      working (WCAG 2.5.3).
    */
    "aria-label": action.reason ? action.accessibleName : undefined,
    /* Never the idle promise on a control that will refuse. */
    title: action.hint,
    onClick: action.onActivate,
    "data-predict-state": action.state
  };
}
