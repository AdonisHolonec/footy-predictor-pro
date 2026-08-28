/**
 * The Predict surfaces that are BUILT FROM PRIMITIVES — the Banner retry and
 * the two empty states — driven through every state, in real DOM.
 *
 * These exist because both shipped broken in ways no test could see:
 *
 *  - The Banner retry was handed `predictSurfaceProps`, which sets only
 *    `aria-disabled`. `design-system/Button` had styling for the NATIVE
 *    `:disabled` pseudo-class and nothing for `[aria-disabled]`, so a blocked
 *    retry rendered at full primary fill with a normal cursor and a working
 *    press animation while its onClick did nothing. A dead control that looks
 *    alive is the exact defect the Predict contract exists to remove, and it
 *    had been reintroduced one altitude below the contract, in the primitive.
 *
 *  - EmptyState was handed BOTH the native `disabled` attribute and
 *    `aria-disabled` plus an accessible name carrying the reason. Those are two
 *    different interaction models and the pair cancels out: the native
 *    attribute pulls the control from the tab order, so the reason became
 *    unreachable by exactly the users it was added for.
 *
 * Every assertion below reads the DOM. None reads source text.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Banner from "./Banner";
import Button from "./Button";
import EmptyState from "./EmptyState";
import {
  buildPredictAction,
  predictSurfaceProps,
  type PredictState
} from "../components/ux/predictState";

const LABELS = {
  label: "Generează Predicții",
  hint: "Generează predicții pentru zilele selectate",
  busy: "Se generează predicțiile…",
  quotaSpent: "Ai folosit toate predicțiile de azi"
};

const IDLE_COPY = "Apasă pentru a genera predicții.";

function build(state: PredictState) {
  const run = vi.fn();
  return { act: buildPredictAction({ state, labels: LABELS, run }), run };
}

/** The Banner retry exactly as UserDashboard composes it. */
function renderBanner(state: PredictState) {
  const { act, run } = build(state);
  render(
    <Banner
      tone="neutral"
      action={
        <Button size="sm" loading={act.busy} {...predictSurfaceProps(act)}>
          {LABELS.label}
        </Button>
      }
    >
      <span>{act.reason ?? "Generează pentru a vedea piețele"}</span>
    </Banner>
  );
  const btn = screen.getByRole("button", { name: /generează/i }) as HTMLButtonElement;
  return { btn, run, act };
}

/** The empty state exactly as HomeSection composes it. */
function renderEmpty(state: PredictState) {
  const { act, run } = build(state);
  render(
    <EmptyState
      title="Nicio predicție"
      description={act.reason ?? IDLE_COPY}
      actionLabel={LABELS.label}
      onAction={act.onActivate}
      actionProps={predictSurfaceProps(act)}
    />
  );
  const btn = screen.getByRole("button", { name: /generează/i }) as HTMLButtonElement;
  return { btn, run, act };
}

afterEach(cleanup);

describe("A + B — the Banner retry", () => {
  it("A — blocked: refuses activation and is marked inert, not merely silent", () => {
    const { btn, run } = renderBanner("blocked");
    fireEvent.click(btn);
    expect(run).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("data-predict-state")).toBe("blocked");
  });

  it("A — blocked: carries a real blocked SKIN, so it does not read as enabled", () => {
    /*
      `aria-disabled` matched none of Button's `disabled:` utilities, so a
      blocked retry was painted exactly like an enabled one.

      What this can and cannot prove: Tailwind emits the `aria-disabled:*`
      utilities into the class string unconditionally — the ATTRIBUTE is what
      selects them — so the class list is identical in every state by design,
      and jsdom applies no stylesheet at all. This asserts the recipe is present
      and keyed on the right selector; that it actually repaints is measured
      against computed style in the browser QA, where a stylesheet exists.
    */
    const blocked = renderBanner("blocked").btn.className;
    for (const token of [
      "aria-disabled:bg-[var(--fp-disabled-surface)]",
      "aria-disabled:text-[var(--fp-disabled-ink)]",
      "aria-disabled:border-[var(--fp-disabled-border)]",
      "aria-disabled:cursor-not-allowed"
    ]) {
      expect(blocked, `missing ${token}`).toContain(token);
    }
  });

  it("A — blocked: cannot look pressed", () => {
    const { btn } = renderBanner("blocked");
    expect(btn.className).toContain("aria-disabled:active:scale-100");
    expect(btn.className).toContain("aria-disabled:active:opacity-100");
  });

  it("A — blocked: stays focusable so the reason is reachable", () => {
    const { btn } = renderBanner("blocked");
    expect(btn.disabled).toBe(false);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-label")).toContain(LABELS.quotaSpent);
    expect(btn.getAttribute("title")).toBe(LABELS.quotaSpent);
  });

  it("A — blocked: the banner copy states the reason in visible words", () => {
    renderBanner("blocked");
    expect(screen.getByText(LABELS.quotaSpent)).toBeTruthy();
  });

  it("B — busy: ONE inertness model, so the busy reason stays reachable", () => {
    /*
      `loading` used to set the native attribute as well as the caller's
      aria-disabled, so a busy Banner left the tab order — silencing the busy
      reason — and faded to 0.5 while a busy empty state, differing only in
      passing `loading`, did not. Same class as the EmptyState defect, arriving
      through a different prop.
    */
    const { btn } = renderBanner("busy");
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-label")).toContain(LABELS.busy);
  });

  it("B — busy: a caller that does NOT declare aria-disabled still disables natively", () => {
    // The behaviour every non-Predict Button in the app relies on, unchanged.
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("B — busy: refuses a second run and announces busy, not blocked", () => {
    const { btn, run } = renderBanner("busy");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(run).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-label")).toContain(LABELS.busy);
    expect(btn.getAttribute("aria-label")).not.toContain(LABELS.quotaSpent);
  });

  it("idle: activates exactly once and keeps its visible words as its name", () => {
    const { btn, run } = renderBanner("idle");
    fireEvent.click(btn);
    expect(run).toHaveBeenCalledTimes(1);
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn.getAttribute("aria-label")).toBeNull();
    expect(btn.textContent).toContain(LABELS.label);
  });
});

describe("C + D + E — the empty-state Predict action", () => {
  it("D — idle: runs, is focusable, and instructs", () => {
    const { btn, run } = renderEmpty("idle");
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByText(IDLE_COPY)).toBeTruthy();
  });

  it("C — blocked: does not instruct an action the system will refuse", () => {
    const { run } = renderEmpty("blocked");
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText(LABELS.quotaSpent)).toBeTruthy();
    expect(screen.queryByText(IDLE_COPY)).toBeNull();
  });

  it("C — blocked: ONE interaction model, not native-disabled AND aria-disabled", () => {
    /*
      Both were applied at once. The native attribute takes the control out of
      the tab order, which makes the accessible name carrying the reason
      unreachable — so the two signals cancelled rather than reinforced.
    */
    const { btn } = renderEmpty("blocked");
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute("aria-label")).toContain(LABELS.quotaSpent);
  });

  it("C — blocked: refuses activation", () => {
    const { btn, run } = renderEmpty("blocked");
    fireEvent.click(btn);
    expect(run).not.toHaveBeenCalled();
  });

  it("E — busy: truthful busy state, and no second run", () => {
    const { btn, run } = renderEmpty("busy");
    fireEvent.click(btn);
    expect(run).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-label")).toContain(LABELS.busy);
    expect(screen.getByText(LABELS.busy)).toBeTruthy();
  });

  it("the reason is stated once in visible copy, not twice", () => {
    renderEmpty("blocked");
    expect(screen.getAllByText(LABELS.quotaSpent).length).toBe(1);
  });
});

describe("the blocked skin never leaks onto a control that is not blocked", () => {
  it("only an ACTIVATABLE state is free of aria-disabled", () => {
    /*
      Busy is deliberately aria-disabled too: `disabled` on the contract means
      "cannot be activated right now", which busy satisfies. Idle is the only
      state that must carry none.
    */
    expect(renderBanner("idle").btn.getAttribute("aria-disabled")).toBeNull();
    cleanup();
    for (const state of ["busy", "blocked"] as const) {
      const { btn } = renderBanner(state);
      expect(btn.getAttribute("aria-disabled"), state).toBe("true");
      cleanup();
    }
  });

  it("a natively disabled Button keeps opacity-50 — the two models coexist", () => {
    /*
      DESIGN.md documents these as distinct, and the aria-disabled skin must not
      have replaced the native one: a control the browser removed from the tab
      order IS an inactive component and may legitimately fade.
    */
    render(<Button disabled>Nope</Button>);
    const btn = screen.getByRole("button", { name: "Nope" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("disabled:opacity-50");
  });
});
