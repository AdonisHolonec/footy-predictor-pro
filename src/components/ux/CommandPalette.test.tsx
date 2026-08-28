/**
 * CommandPalette — keyboard and Predict-state regressions, in real DOM.
 *
 * This file exists because a keyboard "parity" fix was added to the palette's
 * SEARCH INPUT: `Space` was intercepted and `preventDefault()`ed so it could
 * refuse a disabled row the way the pointer path did. The rows are native
 * buttons, so Space already worked on them — what the change actually did was
 * make a space impossible to type into the query box, killing every multi-word
 * search in the product. It reached a final critique because no test had ever
 * rendered this component.
 *
 * Everything below drives the DOM. No source strings.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../context/LocaleContext";
import CommandPalette from "./CommandPalette";
import { buildPredictAction, type PredictState } from "./predictState";

const LABELS = {
  label: "Generează Predicții",
  hint: "Generează predicții pentru zilele selectate",
  busy: "Se generează predicțiile…",
  quotaSpent: "Ai folosit toate predicțiile de azi"
};

function open(state: PredictState = "idle") {
  const run = vi.fn();
  const onClose = vi.fn();
  render(
    <LocaleProvider>
      <CommandPalette
        open
        onClose={onClose}
        matches={[]}
        onSelectMatch={() => {}}
        onNavigate={() => {}}
        predictAction={buildPredictAction({ state, labels: LABELS, run })}
      />
    </LocaleProvider>
  );
  return { run, onClose, input: screen.getByLabelText("Search") as HTMLInputElement };
}

/** The Predict row, found by its own name rather than by index. */
function predictRow(): HTMLButtonElement {
  const row = screen
    .getAllByRole("button")
    .find((b) => /Generează [Pp]redicți/.test(b.textContent ?? ""));
  if (!row) throw new Error("Predict row not found");
  return row as HTMLButtonElement;
}

/** Walk the highlight onto the Predict row. */
function highlightPredict(input: HTMLInputElement) {
  for (let i = 0; i < 20; i += 1) {
    const li = predictRow().closest("li");
    if (li?.getAttribute("aria-selected") === "true") return;
    fireEvent.keyDown(input, { key: "ArrowDown" });
  }
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("A — the search field still accepts spaces", () => {
  it("does not preventDefault a Space typed into the query", () => {
    const { input } = open();
    const ev = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("holds a multi-word query", () => {
    const { input } = open();
    fireEvent.keyDown(input, { key: " " });
    fireEvent.change(input, { target: { value: "Premier League" } });
    expect(input.value).toBe("Premier League");
  });
});

describe("B — Space in the search input never activates Predict", () => {
  it("leaves the action untouched", () => {
    const { run, input } = open("idle");
    fireEvent.keyDown(input, { key: " " });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("C + D — an idle Predict row activates", () => {
  it("Enter on the highlighted row runs it and closes the palette", () => {
    const { run, onClose, input } = open("idle");
    highlightPredict(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("the row is a native button, so the browser activates it on Space via click", () => {
    const { run } = open("idle");
    const row = predictRow();
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("type")).toBe("button");
    // jsdom does not synthesise click from Space; the guarded click path is the
    // one the browser routes Space through, so that is what is asserted.
    fireEvent.click(row);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("E + F — a blocked Predict row cannot be activated by any input", () => {
  it("click does nothing and does not close", () => {
    const { run, onClose } = open("blocked");
    fireEvent.click(predictRow());
    expect(run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter on the highlighted row does nothing", () => {
    const { run, input } = open("blocked");
    highlightPredict(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("G — a busy Predict row cannot start a second run", () => {
  it("refuses click and Enter alike", () => {
    const { run, input } = open("busy");
    fireEvent.click(predictRow());
    highlightPredict(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("H — the row reflects the canonical state", () => {
  it("idle: no inert semantics, and the row's own text is its name", () => {
    open("idle");
    const row = predictRow();
    expect(row.getAttribute("aria-disabled")).toBeNull();
    // No aria-label when idle — the visible words are the better name.
    expect(row.getAttribute("aria-label")).toBeNull();
    expect(row.textContent ?? "").toMatch(/generează predicți/i);
  });

  it("blocked: aria-disabled, and the name carries the reason AND the label", () => {
    open("blocked");
    const row = predictRow();
    expect(row.getAttribute("aria-disabled")).toBe("true");
    const name = row.getAttribute("aria-label") ?? "";
    expect(name).toContain(LABELS.quotaSpent);
    // WCAG 2.5.3 — the name still opens with the visible label.
    expect(name.toLowerCase()).toContain("generează predicții");
  });

  it("busy: aria-disabled and the busy reason", () => {
    open("busy");
    const row = predictRow();
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.getAttribute("aria-label") ?? "").toContain(LABELS.busy);
  });

  it("stays findable by its own name when blocked", () => {
    const { input } = open("blocked");
    fireEvent.change(input, { target: { value: "generează" } });
    expect(predictRow()).toBeTruthy();
  });
});

describe("I — the row carries the WHOLE contract, not two attributes copied out of it", () => {
  it("exposes the tooltip and the state hook, not just the name", () => {
    open("blocked");
    const row = predictRow();
    /*
      This row used to call predictSurfaceProps(action)["aria-label"] to pull a
      single string and re-implement the rest by hand, so it had the right name
      and neither a tooltip nor the state attribute every other Predict surface
      exposes. Spreading is what makes that impossible to get half-right.
    */
    expect(row.getAttribute("title")).toBe(LABELS.quotaSpent);
    expect(row.getAttribute("data-predict-state")).toBe("blocked");
  });

  it("idle rows get the state hook too", () => {
    open("idle");
    expect(predictRow().getAttribute("data-predict-state")).toBe("idle");
    expect(predictRow().getAttribute("title")).toBe(LABELS.hint);
  });
});

describe("J — the visible row label leads with the action in every state", () => {
  it("idle shows the action, not the long hint", () => {
    open("idle");
    const text = (predictRow().textContent ?? "").trim();
    expect(text).toBe(LABELS.label);
    // The hint is a tooltip, never the row's own words.
    expect(text).not.toContain("zilele selectate");
  });

  it("blocked leads with the same action and appends the reason", () => {
    open("blocked");
    const text = (predictRow().textContent ?? "").trim();
    expect(text.startsWith(LABELS.label)).toBe(true);
    expect(text).toContain(LABELS.quotaSpent);
  });

  it("stays findable by the action word in both states", () => {
    for (const state of ["idle", "blocked"] as const) {
      const { input } = open(state);
      fireEvent.change(input, { target: { value: "generează" } });
      expect(predictRow(), `not findable when ${state}`).toBeTruthy();
      cleanup();
    }
  });
});
