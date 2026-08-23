import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MatchModal from "../MatchModal";
import MatchDecisionBlock from "./MatchDecisionBlock";
import MatchListRow from "../ux/MatchListRow";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * UX-I — mobile match actions and the fixed metric grid.
 *
 * Narrow screens: the favourite star leaves MatchListRow and the report flag
 * leaves the modal header; both live in the recommendation card, on the SAME
 * handlers and state. From `sm` the row and header keep their own controls
 * and the card's cluster is hidden. The decision row is a fixed/flexible/fixed
 * grid so the pick's length can never move confidence or odds.
 *
 * jsdom applies no stylesheet, so responsive behaviour is asserted through the
 * Tailwind classes that carry it (hidden / sm:flex / sm:hidden / sm:inline-flex)
 * and the geometry invariant through the grid tracks; the pixel measurements
 * live in the browser QA (see PR).
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})$`);

vi.mock("../ux/FeaturedPredictionCard", () => ({ default: () => null }));
vi.mock("../PredictionLaboratory", () => ({ default: () => null }));
vi.mock("../MonteCarloPanel", () => ({ default: () => null }));

afterEach(cleanup);

const PICKS = [
  "DC 1X · FT",
  "Shots Under 26.5 · FT",
  "Peste 7.5 Cornere · FT",
  "Peste 8.5 Cornere · FT",
  "Shots Under 30.5 · FT",
  "An intentionally very long prediction label that keeps going and going for the fixture · FT"
];

function row(overrides: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 1,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Hull City", away: "Manchester United" },
    kickoff: "2026-08-25T17:30:00.000Z",
    status: "NS",
    logos: { home: "https://img/a.png", away: "https://img/b.png" },
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 83, odd: 1.25 },
    ...overrides
  } as unknown as PredictionRow;
}

const noop = () => {};

function renderCard(pickLabel: string, actions?: Record<string, unknown>) {
  const { container } = render(
    <MatchDecisionBlock
      pickLabel={pickLabel}
      familyKey="CORNERS"
      odd={1.25}
      confidencePct={83}
      confidenceCategory={null}
      evPct={39}
      dataQuality={0.9}
      rationale={null}
      actions={actions as never}
    />
  );
  const slot = (name: string) => container.querySelector(`[data-slot="${name}"]`) as HTMLElement | null;
  return { container, slot };
}

function renderModal(props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(<MatchModal match={row()} logoColors={{}} onClose={onClose} hashColor={() => "#888"} accessTier="ultra" {...props} />);
  const slot = (name: string) => document.querySelector(`[data-slot="${name}"]`) as HTMLElement | null;
  return { slot, onClose };
}

const isHiddenBelowSm = (el: HTMLElement | null) => Boolean(el && /\bhidden\b/.test(el.className) && /\bsm:(flex|inline-flex|block)\b/.test(el.className));
const isHiddenFromSm = (el: HTMLElement | null) => Boolean(el && /\bsm:hidden\b/.test(el.className) && !/(^|\s)hidden(\s|$)/.test(el.className));

describe("A · favourite", () => {
  it("1/2. MatchListRow: the star is hidden below sm and present from sm, on the same handler", () => {
    const onToggleWatch = vi.fn();
    const { container } = render(
      <ul>
        <MatchListRow row={row()} watched={false} onToggleWatch={onToggleWatch} onOpen={noop} />
      </ul>
    );
    const star = container.querySelector("li > button[aria-pressed]") as HTMLElement;
    expect(star).toBeTruthy();
    expect(isHiddenBelowSm(star)).toBe(true);
    expect(star.className).toMatch(/\bh-11\b.*\bw-11\b|\bw-11\b.*\bh-11\b/);
    fireEvent.click(star);
    expect(onToggleWatch).toHaveBeenCalledTimes(1);
    // No placeholder: the only other child of the row is the row button itself.
    expect(container.querySelectorAll("li > *")).toHaveLength(2);
  });

  it("3/4/5/17/18. Match Detail: the card's favourite reflects `watched` and calls the modal's `onToggleWatch`; cluster hidden from sm", () => {
    const onToggleWatch = vi.fn();
    const { slot } = renderModal({ watched: true, onToggleWatch, onReport: noop });
    const fav = slot("decision-favorite")!;
    expect(fav).toBeTruthy();
    expect(fav.getAttribute("aria-pressed")).toBe("true");
    expect(fav.getAttribute("aria-label")).toMatch(either("card", "removeFavorite"));
    fireEvent.click(fav);
    expect(onToggleWatch).toHaveBeenCalledTimes(1);
    const cluster = slot("decision-actions")!;
    expect(cluster.contains(fav)).toBe(true);
    expect(isHiddenFromSm(cluster)).toBe(true);
    // Inside the recommendation card, in its header, not in the decision row.
    expect(slot("decision-header")!.contains(cluster)).toBe(true);
    expect(slot("decision-row")!.contains(cluster)).toBe(false);
    cleanup();
    const off = renderModal({ watched: false, onToggleWatch, onReport: noop });
    expect(off.slot("decision-favorite")!.getAttribute("aria-pressed")).toBe("false");
    expect(off.slot("decision-favorite")!.getAttribute("aria-label")).toMatch(either("card", "addFavorite"));
  });

  it("without a toggle handler the card renders no favourite (admin workspace shape)", () => {
    const { slot } = renderModal({ onReport: noop });
    expect(slot("decision-favorite")).toBeNull();
    expect(slot("decision-report")).toBeTruthy();
  });
});

describe("B · report", () => {
  it("6/8/9. the header report is hidden below sm, kept from sm, and still fires the existing handler", () => {
    const onReport = vi.fn();
    const { slot } = renderModal({ onReport, onToggleWatch: noop });
    const header = slot("header-report")!;
    expect(header).toBeTruthy();
    expect(isHiddenBelowSm(header)).toBe(true);
    fireEvent.click(header);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("7/9. the card's report is the same handler", () => {
    const onReport = vi.fn();
    const { slot } = renderModal({ onReport, onToggleWatch: noop });
    const report = slot("decision-report")!;
    expect(report.getAttribute("aria-label")).toMatch(either("predictionReport", "cardAction"));
    fireEvent.click(report);
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(slot("decision-actions")!.contains(report)).toBe(true);
  });

  it("close stays in the header at every width and is not responsive-hidden", () => {
    const { onClose } = renderModal({ onReport: noop });
    const close = screen.getByRole("button", { name: either("match", "close") });
    expect(close.className).not.toMatch(/\bhidden\b|sm:hidden/);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("C · fixed metric grid", () => {
  it("10/11/12/13/14/15. confidence and odds sit in fixed tracks; the pick owns the only flexible track", () => {
    for (const pick of PICKS) {
      cleanup();
      const { slot } = renderCard(pick, { onToggleWatch: noop, onReport: noop });
      const rowEl = slot("decision-row")!;
      expect(rowEl.className, pick).toMatch(/\bgrid\b/);
      expect(rowEl.className, pick).toMatch(/grid-cols-\[3\.25rem_minmax\(0,1fr\)_3\.75rem\]/);
      expect(rowEl.className, pick).toMatch(/sm:grid-cols-\[3\.25rem_minmax\(0,1fr\)_4\.5rem\]/);
      const [c, p, o] = [...rowEl.children].map((el) => el.getAttribute("data-slot"));
      expect([c, p, o], pick).toEqual(["decision-confidence", "decision-pick", "decision-odds"]);
      expect(slot("decision-confidence")!.className, pick).toMatch(/w-\[3\.25rem\]/);
      expect(slot("decision-odds")!.className, pick).toMatch(/\bw-full\b.*\btext-right\b|\btext-right\b.*\bw-full\b/);
      expect(slot("decision-pick")!.className, pick).toMatch(/\bmin-w-0\b/);
      expect(slot("decision-pick")!.textContent, pick).toContain(pick);
    }
  });

  it("16. the pick truncates only inside its own column", () => {
    const { slot } = renderCard(PICKS[5]);
    const label = slot("decision-pick")!.querySelector("span.line-clamp-2") as HTMLElement;
    expect(label).toBeTruthy();
    expect(label.className).toMatch(/\bmin-w-0\b/);
    expect(label.className).toMatch(/\bbreak-words\b/);
    expect(slot("decision-odds")!.className).not.toMatch(/line-clamp|truncate/);
  });

  it("no arbitrary offsets: the decision row uses no margins, transforms or absolute positioning", () => {
    const src = readFileSync(join(__dirname, "MatchDecisionBlock.tsx"), "utf8");
    const rowSrc = src.slice(src.indexOf('data-slot="decision-row"') - 400, src.indexOf('data-slot="decision-odds"') + 600);
    expect(rowSrc).not.toMatch(/\b(ml|mr|pl|pr)-\[|translate-|absolute|left-\[|right-\[/);
  });
});

describe("D · responsive + E · accessibility", () => {
  it("17/18/20. the cluster is its own header row outside the decision grid, hidden from sm", () => {
    const { slot } = renderCard("Peste 7.5 Cornere · FT", { onToggleWatch: noop, onReport: noop });
    const cluster = slot("decision-actions")!;
    expect(isHiddenFromSm(cluster)).toBe(true);
    expect(slot("decision-header")!.contains(cluster)).toBe(true);
    expect(slot("decision-row")!.contains(cluster)).toBe(false);
    expect(slot("decision-header")!.nextElementSibling).toBe(slot("decision-row"));
    // Header reserves the touch height on narrow screens so buttons never overlap the row below.
    expect(slot("decision-header")!.className).toMatch(/min-h-\[var\(--fp-touch\)\]/);
  });

  it("21/22. both actions are labelled IconButtons with the 44px token, and no label is duplicated", () => {
    const { slot, container } = renderCard("DC 1X · FT", { watched: false, onToggleWatch: noop, onReport: noop });
    for (const name of ["decision-favorite", "decision-report"]) {
      const b = slot(name)!;
      expect(b.tagName).toBe("BUTTON");
      expect(b.className).toMatch(/h-\[var\(--fp-touch\)\]/);
      expect(b.className).toMatch(/min-w-\[var\(--fp-touch\)\]/);
      expect(b.className).toMatch(/focus-visible:outline/);
      expect(b.getAttribute("aria-label")).toBeTruthy();
      // The glyph is decorative; the name comes from aria-label only.
      expect(b.querySelector("[aria-hidden='true']")).toBeTruthy();
    }
    const labels = [...container.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label"));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("RO and EN labels exist for every string the cluster can show", () => {
    for (const [ns, key] of [["card", "addFavorite"], ["card", "removeFavorite"], ["predictionReport", "cardAction"], ["match", "close"]]) {
      expect(R[ns][key], `${ns}.${key}`).toBeTruthy();
      expect(E[ns][key], `${ns}.${key}`).toBeTruthy();
    }
  });

  it("19. nothing in the card forces width: no nowrap on the pick", () => {
    const { slot } = renderCard(PICKS[5], { onToggleWatch: noop, onReport: noop });
    expect(slot("decision-pick")!.className).not.toMatch(/whitespace-nowrap/);
    expect(slot("decision-pick")!.querySelector("span.line-clamp-2")!.className).not.toMatch(/whitespace-nowrap/);
  });
});
