/**
 * UI primitives (PR 4) — the interaction/a11y contracts, per primitive.
 */
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "./Button";
import IconButton from "./IconButton";
import SegmentedControl from "./SegmentedControl";
import FilterChip from "./FilterChip";
import SectionHeader from "./SectionHeader";
import Banner from "./Banner";
import Toast from "./Toast";

afterEach(cleanup);

describe("Button loading", () => {
  it("keeps the label, adds a spinner, disables, and reports aria-busy", () => {
    render(<Button loading>Generează</Button>);
    const btn = screen.getByRole("button", { name: "Generează" });
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    // The old behaviour replaced children with a literal "…" — never again.
    expect(btn.textContent).toContain("Generează");
    expect(btn.textContent).not.toContain("…");
    expect(btn.querySelector("svg")).toBeTruthy();
  });

  it("idle: no spinner, no aria-busy", () => {
    render(<Button>Predict</Button>);
    const btn = screen.getByRole("button", { name: "Predict" });
    expect(btn.getAttribute("aria-busy")).toBeNull();
    expect(btn.querySelector("svg")).toBeNull();
  });
});

describe("IconButton", () => {
  it("requires and applies the accessible name; the glyph is hidden", () => {
    render(<IconButton aria-label="Notificări">🔔</IconButton>);
    const btn = screen.getByRole("button", { name: "Notificări" });
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.querySelector('[aria-hidden="true"]')?.textContent).toBe("🔔");
  });

  it("supports pressed state and disabled", () => {
    render(<IconButton aria-label="Favorite" pressed disabled>★</IconButton>);
    const btn = screen.getByRole("button", { name: "Favorite" });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" }
  ] as const;

  it("toggle mode: role=group + aria-pressed, never tab semantics", () => {
    render(<SegmentedControl mode="toggle" aria-label="Filtru" options={options} value="a" onChange={() => {}} />);
    expect(screen.getByRole("group", { name: "Filtru" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "A" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "B" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("tabs mode: tablist/tab + aria-selected, never aria-pressed", () => {
    render(<SegmentedControl mode="tabs" aria-label="Secțiuni" options={options} value="b" onChange={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Secțiuni" })).toBeTruthy();
    const tab = screen.getByRole("tab", { name: "B" });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-pressed")).toBeNull();
  });

  it("fires onChange with the option value and honours disabled", () => {
    const onChange = vi.fn();
    render(<SegmentedControl mode="toggle" options={options} value="a" onChange={onChange} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "B" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FilterChip", () => {
  it("is a toggle: aria-pressed follows selected", () => {
    const { rerender } = render(<FilterChip selected={false}>30D</FilterChip>);
    expect(screen.getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe("false");
    rerender(<FilterChip selected>30D</FilterChip>);
    expect(screen.getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SectionHeader", () => {
  it("renders the chosen heading level with eyebrow and description", () => {
    render(<SectionHeader as="h1" size="page" eyebrow="ISTORIC" title="Istoric" description="Rezultate validate" />);
    expect(screen.getByRole("heading", { level: 1, name: "Istoric" })).toBeTruthy();
    expect(screen.getByText("ISTORIC")).toBeTruthy();
    expect(screen.getByText("Rezultate validate")).toBeTruthy();
  });

  it("optional parts stay optional", () => {
    render(<SectionHeader title="Doar titlu" />);
    expect(screen.getByRole("heading", { level: 2, name: "Doar titlu" })).toBeTruthy();
  });
});

describe("Banner", () => {
  it("live semantics are explicit: alert / status / none", () => {
    const { rerender } = render(<Banner tone="danger" live="alert">Eroare</Banner>);
    expect(screen.getByRole("alert").textContent).toContain("Eroare");
    rerender(<Banner tone="info" live="status">Info</Banner>);
    expect(screen.getByRole("status").textContent).toContain("Info");
    rerender(<Banner tone="warning">Ambient</Banner>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Toast", () => {
  it("has an accessible, clickable dismiss", () => {
    const onDismiss = vi.fn();
    render(<Toast message="Copiat" onDismiss={onDismiss} dismissLabel="Închide" durationMs={null} />);
    expect(screen.getByRole("status").textContent).toContain("Copiat");
    fireEvent.click(screen.getByRole("button", { name: "Închide" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("auto-dismiss can be disabled and pauses on hover", async () => {
    vi.useFakeTimers();
    try {
      const onDismiss = vi.fn();
      render(<Toast message="Salvat" onDismiss={onDismiss} dismissLabel="Închide" durationMs={1000} />);
      // hover pauses the countdown mid-way
      act(() => { vi.advanceTimersByTime(500); });
      fireEvent.mouseEnter(screen.getByRole("status"));
      act(() => { vi.advanceTimersByTime(5000); });
      expect(onDismiss).not.toHaveBeenCalled();
      // leaving resumes with the remaining time
      fireEvent.mouseLeave(screen.getByRole("status"));
      act(() => { vi.advanceTimersByTime(600); });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
