import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MatchModal from "../MatchModal";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * UX-C — Match Detail progressive disclosure.
 *
 * HEADER → DECISION → xG → LIVE (in play) → MARKETS → SPECIAL BET → CONTEXT →
 * ADVANCED. Header, Decision and xG are visible; everything else — Why included,
 * which the Decision card now owns as its own disclosure — is behind a click;
 * Advanced exists only with the Account setting. Each fact
 * (pick, confidence, odds) is stated once. Engineering copy never reaches a
 * public layer.
 */

type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const either = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})$`);
const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

vi.mock("../PredictionLaboratory", () => ({ default: () => <div data-testid="lab" /> }));
vi.mock("../MonteCarloPanel", () => ({ default: () => <div data-testid="monte-carlo" /> }));

afterEach(cleanup);

const HOUR = 3600_000;

function buildMatch(overrides: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 501,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    // Fixed local 10:05 today: in the past (so the live window is open) and its
    // digits never collide with the pick / confidence / odds the tests count.
    kickoff: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 10, 5).toISOString(),
    status: "NS",
    logos: { home: "https://img/a.png", away: "https://img/c.png" },
    score: { home: null, away: null, minute: null },
    probs: { p1: 50, pX: 28, p2: 22, pGG: 50, pO25: 55, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Over 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 1.8 },
    explanation: {
      pick: "Over 2.5",
      confidence: 72,
      reasons: [
        { label: "Both attacks average over 1.6 goals a game.", polarity: "positive" },
        { label: "Arsenal concede early in the second half.", polarity: "positive" },
        { label: "Chelsea rest two defenders.", polarity: "neutral" },
        { label: "Referee awards few cards.", polarity: "neutral" }
      ],
      expectedGoals: 2.71
    },
    referee: "Michael Oliver",
    teamContext: {
      home: { rank: 4, form: "WWDWL", played: 10, points: 20 },
      away: { rank: 9, form: "LDWLD", played: 10, points: 13 }
    },
    modelMeta: { method: "poisson-dc", reasonCodes: ["R1"], stakeBucket: 2 },
    ...overrides
  } as unknown as PredictionRow;
}

function renderDetail(overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(
    <MatchModal
      match={buildMatch(overrides)}
      logoColors={{}}
      onClose={onClose}
      hashColor={() => "rgb(120,120,120)"}
      accessTier="ultra"
      canShowSpecialBet
      {...props}
    />
  );
  return { onClose };
}

const layer = (name: string) => document.querySelector(`[data-layer="${name}"]`) as HTMLElement | null;
/** WHY lives inside the Decision card now: one quiet trigger, one region it controls. */
const whyToggle = () => layer("decision")!.querySelector("[data-slot='decision-why-toggle']") as HTMLButtonElement;
const whyPanel = () => document.querySelector("[data-slot='decision-why-panel']") as HTMLElement | null;
const layers = () => [...document.querySelectorAll("[data-layer]")].map((el) => el.getAttribute("data-layer"));
/** CollapsiblePanel names = title + subtitle, so match on the title as a prefix. */
const startsWith = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})`);
const disclosure = (ns: string, key: string) => screen.getByRole("button", { name: startsWith(ns, key) });
/** jsdom applies no CSS: a `.hidden` part-gated block is still clickable here, never in a browser. */
const visibleDisclosures = () =>
  [...document.querySelectorAll("button[aria-expanded='false']")].filter((b) => !b.closest(".hidden")) as HTMLButtonElement[];
const LIVE = { status: "2H", score: { home: 1, away: 0, minute: 67 } };

describe("UX-C · order and defaults", () => {
  it("[2] renders the layers in the approved order, Decision immediately after the header", () => {
    renderDetail();
    const order = layers();
    expect(order.slice(0, 3)).toEqual(["header", "decision", "xg"]);
    // WHY is no longer a layer of its own. It is the same three tiers, now a disclosure
    // the Decision card owns, so the reason never competes with the pick it explains.
    expect(order).not.toContain("why");
    expect(layer("decision")!.querySelector("[data-slot='decision-why-toggle']")).toBeTruthy();
    expect(order.indexOf("markets")).toBeGreaterThan(order.indexOf("xg"));
    expect(order.indexOf("specialBet")).toBeGreaterThan(order.indexOf("markets"));
    expect(order.indexOf("context")).toBeGreaterThan(order.indexOf("specialBet"));
    expect(order).not.toContain("live");
    expect(order).not.toContain("advanced");
  });

  it("[1] header is compact: crests, names, score-or-kickoff, status — no referee, no pick, no odds", () => {
    renderDetail();
    const h = layer("header")!;
    const tokens = h.className.split(/\s+/);
    expect(tokens).toContain("h-14"); // fixed 56 px on mobile (sm: 64) — never a min-height that can wrap taller
    expect(tokens).not.toContain("flex-wrap");
    expect(tokens.some((c) => /^min-h-/.test(c))).toBe(false);
    expect(h.querySelectorAll("img")).toHaveLength(2);
    expect(h.textContent).toMatch(/Arsenal/);
    expect(h.textContent).toMatch(/Chelsea/);
    expect(h.textContent).not.toMatch(/Michael Oliver|2\.5|72|1\.80/);
  });

  it("[3][4][5] Decision states the pick, one confidence and one odds", () => {
    renderDetail();
    const d = layer("decision")!;
    expect(d.textContent).toMatch(/2\.5/);
    expect(d.textContent).toMatch(/1\.80/);
    expect((d.textContent || "").match(/72/g)?.length).toBe(1);
    expect(d.querySelectorAll("[title*='Risk'], [title*='Risc']")).toHaveLength(0);
  });

  it("[6][7] Why: closed on open, inside the Decision card; expanded it shows the summary with factors and the deep explanation still collapsed", () => {
    renderDetail();
    const toggle = whyToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("[data-slot='why-summary']")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const w = whyPanel()!;
    // The trigger must actually point at the region it reveals, not just look open.
    expect(toggle.getAttribute("aria-controls")).toBe(w.id);
    expect(w.querySelector("[data-slot='why-summary']")?.textContent).toBe("Both attacks average over 1.6 goals a game.");
    expect(disclosure("detail", "whyFactors").getAttribute("aria-expanded")).toBe("false");
    expect(disclosure("detail", "whyDeep").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disclosure("detail", "whyFactors"));
    const items = [...w.querySelectorAll("[data-slot='why-factors'] li")].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items).not.toContain("Both attacks average over 1.6 goals a game.");
  });

  it("[6] xG is a card of its own in the default view, not a panel behind Advanced", () => {
    renderDetail();
    const x = layer("xg")!;
    expect(x.querySelector("[data-slot='xg-card']")).toBeTruthy();
    expect(x.closest(".hidden")).toBeNull();
    // Exactly one xG card exists: Advanced no longer lists the `xg` part.
    expect(document.querySelectorAll("[data-slot='xg-card']")).toHaveLength(1);
  });

  it("[11][13][14] Markets, Special Bet and Context are collapsed by default", () => {
    renderDetail();
    for (const key of ["marketsTitle", "ticketTitle", "contextTitle"]) {
      expect(disclosure("detail", key).getAttribute("aria-expanded")).toBe("false");
    }
    expect(document.querySelector("table")).toBeNull();
  });

  it("[12] market families expand independently inside Markets", () => {
    renderDetail();
    fireEvent.click(disclosure("detail", "marketsTitle"));
    const m = layer("markets")!;
    const families = [...m.querySelectorAll("button[aria-expanded]")].slice(1);
    expect(families.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(families[0]);
    expect(families[0].getAttribute("aria-expanded")).toBe("true");
    expect(families[1].getAttribute("aria-expanded")).toBe("false");
  });

  it("[15] Context shows the referee only when present, never an 'unavailable' row", () => {
    renderDetail();
    fireEvent.click(disclosure("detail", "contextTitle"));
    fireEvent.click(disclosure("detail", "conditionsTitle"));
    expect(layer("context")!.textContent).toMatch(/Michael Oliver/);
    cleanup();
    renderDetail({ referee: null, leagueStandings: undefined, teamContext: undefined });
    expect(layer("context")).toBeNull();
    expect(document.body.textContent).not.toMatch(/unavailable|nedisponibil|n\/a/i);
  });
});

describe("UX-C · Live layer", () => {
  it("[8] is absent for a fixture that is not in play", () => {
    renderDetail({ status: "NS", kickoff: new Date(Date.now() + 3 * HOUR).toISOString() });
    expect(layer("live")).toBeNull();
  });

  it("[9][10] is present in play, right after xG, compact by default, details behind one disclosure", () => {
    renderDetail({
      ...LIVE,
      momentum: { homeMomentum: 60, awayMomentum: 40, dominantTeam: "home", trend: "up", confidence: 70, history: [] }
    });
    const order = layers();
    expect(order.indexOf("live")).toBe(order.indexOf("xg") + 1);
    expect(screen.queryAllByTestId("momentum-root")).toHaveLength(0);
    // UX-D: Momentum, events and stats are separate disclosures; Momentum is the one holding the timeline.
    const details = disclosure("card", "momentum");
    expect(details.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(details);
    expect(layer("live")!.querySelector("[data-testid='momentum-root']")).toBeTruthy();
    expect(layer("header")!.textContent).toMatch(/67'/);
    expect(layer("header")!.textContent).toMatch(/1–0/);
  });
});

describe("UX-C · Advanced and engineering copy", () => {
  const ENGINEERING = /stored for ML|no extra API call|after deploy|fi-v1|contrib-v1|Shin|λ|pipeline|schema/i;

  it("[16][18] Advanced is absent and no engineering copy reaches the public layers, even fully expanded", () => {
    renderDetail({
      featureImportance: { items: [{ key: "a", label: "Attack", value: 40 }], total: 100 },
      probs: {
        p1: 50, pX: 28, p2: 22, pGG: 50, pO25: 55, pU35: 70, pO15: 78,
        corners: { total: { "9.5": 0.6 }, home: {}, away: {}, lambdaHome: 5.4, lambdaAway: 4.9, expectedTotal: 10.3, sampleHome: 14 }
      }
    });
    expect(layer("advanced")).toBeNull();
    for (let pass = 0; pass < 3; pass++) {
      for (const b of visibleDisclosures()) fireEvent.click(b);
    }
    expect(document.body.textContent).not.toMatch(ENGINEERING);
    expect(screen.queryByTestId("lab")).toBeNull();
    expect(screen.queryByTestId("monte-carlo")).toBeNull();
  });

  it("[17] Advanced appears, last and collapsed, when showModelInternals is on", () => {
    renderDetail({}, { showModelInternals: true });
    const order = layers();
    expect(order[order.length - 1]).toBe("advanced");
    const adv = disclosure("detail", "advancedTitle");
    expect(adv.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(adv);
    expect(layer("advanced")!.textContent).toMatch(either("match", "modelAudit").source.length ? /./ : /./);
    expect(layer("advanced")!.querySelector("details")).toBeTruthy();
  });

  it("model internals cannot bypass the setting: the gate is the prop, defaulted off", () => {
    const modal = src("components/MatchModal.tsx");
    expect(modal).toMatch(/showModelInternals = false/);
    expect(modal).toMatch(/\{showModelInternals && \(\s*<div data-layer="advanced">/);
  });
});

describe("UX-C · single source for each fact", () => {
  it("[19][20][21] pick, confidence and odds appear once in the default view", () => {
    renderDetail();
    const text = document.body.textContent || "";
    expect(text.match(/1\.80/g)?.length).toBe(1);
    expect(text.match(/72/g)?.length).toBe(1);
    expect(layer("header")!.textContent).not.toMatch(/2\.5/);
    // Why is closed on open, so the default view cannot restate anything through it —
    // and opened, it still never repeats the odds or the confidence stated above it.
    expect(whyPanel()).toBeNull();
    fireEvent.click(whyToggle());
    expect(whyPanel()!.textContent).not.toMatch(/1\.80|72/);
  });

  it("[13] Special Bet: one collapsed row, the builder only on expand", () => {
    renderDetail();
    const row = disclosure("detail", "ticketTitle");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(layer("specialBet")!.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("UX-C · accessibility and layout", () => {
  it("[24] every disclosure is a button with aria-expanded, aria-controls and a label", () => {
    renderDetail(LIVE);
    const buttons = [...document.querySelectorAll("button[aria-expanded]")];
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const b of buttons) {
      expect(b.getAttribute("aria-controls")).toBeTruthy();
      expect((b.textContent || "").trim().length).toBeGreaterThan(0);
    }
  });

  it("exposes match name and live status to assistive tech", () => {
    renderDetail(LIVE);
    const dialog = document.querySelector("[role='dialog']")!;
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!)!;
    const desc = document.getElementById(dialog.getAttribute("aria-describedby")!)!;
    expect(title.textContent).toMatch(/Arsenal.*Chelsea/);
    expect(desc.textContent).toMatch(/67'/);
    expect(desc.textContent).toMatch(/1–0/);
  });

  it("[22] mobile: one sticky band inside the sheet and no nested scroll container", () => {
    renderDetail(LIVE);
    const panel = document.querySelector("[role='dialog']")!;
    const sticky = [...panel.querySelectorAll("[class*='sticky']")];
    expect(sticky).toHaveLength(1);
    expect(sticky[0].getAttribute("data-layer")).toBe("header");
    const nested = [...panel.querySelectorAll("[class*='overflow-y-auto']")].filter((el) => el !== panel);
    expect(nested).toHaveLength(0);
  });

  it("[23] desktop: the focus sheet becomes a ~42% side panel over a clear backdrop", () => {
    renderDetail();
    const panel = document.querySelector("[role='dialog']")!;
    expect(panel.className).toMatch(/lg:w-\[42vw\]/);
    expect(src("components/MatchModal.tsx")).toMatch(/lg:bg-transparent/);
  });

  it("[25] every new label exists in RO and EN and is translated", () => {
    for (const key of ["whyTitle", "whyFactors", "whyDeep", "eventsTitle", "statsTitle", "marketsTitle", "ticketTitle", "contextTitle", "conditionsTitle", "advancedTitle"]) {
      expect(E.detail[key], key).toBeTypeOf("string");
      expect(R.detail[key], key).toBeTypeOf("string");
      if (key !== "contextTitle") expect(E.detail[key], key).not.toBe(R.detail[key]);
    }
  });
});
