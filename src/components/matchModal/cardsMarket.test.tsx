import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatchModal from "../MatchModal";
import PredictionFocusCard from "../ux/PredictionFocusCard";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import { resolveCardMarketOutcome, officialTotalFor } from "../../utils/cardMarketOutcome";
import type { PredictionRow } from "../../types";

/**
 * Cards C3 — Cards as a peer market in Match Detail.
 *
 * The panel reuses PoissonMarketSection next to Corners / Shots, the actual total comes
 * from marketResults.cardsTotal (never cardsPoints, never 0 for NULL), status comes from
 * the same client grader the other markets use, and visibility follows the existing
 * access-tier masking (probs.cards survives on Ultra only).
 */
type Leaves = Record<string, Record<string, string>>;
const E = en as unknown as Leaves;
const R = ro as unknown as Leaves;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const startsWith = (ns: string, key: string) => new RegExp(`^(${esc(E[ns][key])}|${esc(R[ns][key])})`);
const anyOf = (ns: string, key: string) => new RegExp(`(${esc(E[ns][key])}|${esc(R[ns][key])})`);

vi.mock("../PredictionLaboratory", () => ({ default: () => <div data-testid="lab" /> }));
vi.mock("../MonteCarloPanel", () => ({ default: () => <div data-testid="monte-carlo" /> }));
afterEach(cleanup);

const CARDS = {
  total: { o4_5: 68, o5_5: 40 },
  home: {},
  away: {},
  lambdaHome: 2.3,
  lambdaAway: 2.2,
  lambdaTotal: 4.5,
  expectedTotal: 4.5,
  sampleHome: 10,
  sampleAway: 10,
  leagueBaseline: 4.4
};
const CORNERS = { total: { o9_5: 60 }, home: {}, away: {}, lambdaHome: 5.4, lambdaAway: 4.9, expectedTotal: 10.3, sampleHome: 14 };

function buildMatch(overrides: Record<string, unknown> = {}): PredictionRow {
  return {
    id: 777,
    leagueId: 135,
    league: "Serie A",
    teams: { home: "Sassuolo", away: "Napoli" },
    kickoff: new Date(Date.now() - 4 * 3600_000).toISOString(),
    status: "NS",
    logos: { home: "https://img/s.png", away: "https://img/n.png" },
    score: { home: null, away: null, minute: null },
    probs: { p1: 30, pX: 28, p2: 42, pGG: 50, pO25: 55, pU35: 70, pO15: 78, corners: CORNERS, cards: CARDS },
    predictions: { oneXtwo: "2", gg: "GG", over25: "Over 2.5", correctScore: "0-2" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 62, odd: 1.8 },
    explanation: { pick: "Over 2.5", confidence: 62, reasons: [], expectedGoals: 2.6 },
    marketOdds: { cards: { pick: "Over 4.5", line: 4.5, odd: 1.65, probabilityLine: 4.5, probabilityPct: 68, tradable: true, over: 1.65, under: 2.2, bookmaker: "median(5)" } },
    referee: "Giovanni Ayroldi",
    modelMeta: { method: "poisson-dc", reasonCodes: ["R1"], stakeBucket: 2 },
    ...overrides
  } as unknown as PredictionRow;
}

function renderDetail(overrides: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  render(
    <MatchModal
      match={buildMatch(overrides)}
      logoColors={{}}
      onClose={vi.fn()}
      hashColor={() => "rgb(120,120,120)"}
      accessTier="ultra"
      canShowSpecialBet
      {...props}
    />
  );
}
const layer = (name: string) => document.querySelector(`[data-layer="${name}"]`) as HTMLElement | null;
const open = (ns: string, key: string) => fireEvent.click(screen.getByRole("button", { name: startsWith(ns, key) }));
const openMarkets = () => open("detail", "marketsTitle");
/** The Cards family disclosure inside Markets (title "Cartonașe" / "Cards"). */
const cardsDisclosure = () =>
  [...layer("markets")!.querySelectorAll("button[aria-expanded]")].filter((b) =>
    startsWith("match", "featCards").test(b.textContent || "")
  ) as HTMLButtonElement[];
const openCards = () => {
  openMarkets();
  const d = cardsDisclosure();
  expect(d).toHaveLength(1);
  fireEvent.click(d[0]);
  return d[0].parentElement as HTMLElement;
};
const FT = (cardsTotal: number | null) => ({
  status: "FT",
  score: { home: 0, away: 2, minute: 90 },
  marketResults: { cornersTotal: 9, shotsOnTargetTotal: 7, shotsTotal: 21, cardsTotal, cardsPoints: cardsTotal == null ? null : cardsTotal + 1 }
});

describe("C3 · Cards market panel", () => {
  it("[1][5][11][18] pre-match: exactly one Cards family sits inside Markets, after Corners, with pick + probability + odd", () => {
    renderDetail();
    const panel = openCards();
    const text = panel.textContent || "";
    expect(text).toMatch(/Over 4\.5|Peste 4\.5/);
    expect(text).toMatch(/68%/);
    expect(text).toMatch(/1\.65/);
    // placement: the Cards disclosure comes after the Corners one, inside the same layer
    const titles = [...layer("markets")!.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent || "");
    const iCorners = titles.findIndex((t) => startsWith("match", "featCorners").test(t));
    const iCards = titles.findIndex((t) => startsWith("match", "featCards").test(t));
    expect(iCorners).toBeGreaterThan(-1);
    expect(iCards).toBeGreaterThan(iCorners);
    expect(text).not.toMatch(anyOf("match", "finalTotal"));
  });

  it("[3][7] FT with a numeric cardsTotal shows the actual total; 0 is shown as 0", () => {
    renderDetail(FT(7));
    const panel = openCards();
    expect(panel.textContent).toMatch(new RegExp(`${esc(R.match.finalTotal)}\\s*7|${esc(E.match.finalTotal)}\\s*7`));
    cleanup();
    renderDetail(FT(0));
    const zero = openCards();
    expect(zero.textContent).toMatch(new RegExp(`(${esc(R.match.finalTotal)}|${esc(E.match.finalTotal)})\\s*0`));
  });

  it("[4] FT with NULL cardsTotal shows no actual total and never a 0", () => {
    renderDetail(FT(null));
    const panel = openCards();
    expect(panel.textContent).not.toMatch(anyOf("match", "finalTotal"));
    expect(panel.textContent).not.toMatch(/(Total final:|Final total:)\s*0/);
  });

  it("[6] live: a running card count is never presented as a final total", () => {
    renderDetail({ status: "2H", score: { home: 0, away: 1, minute: 61 }, marketResults: { cardsTotal: 3, cornersTotal: 4 } });
    const panel = openCards();
    expect(panel.textContent).not.toMatch(anyOf("match", "finalTotal"));
  });

  it("[12] non-Ultra: probs.cards is masked server-side, so no Cards panel renders and nothing is invented", () => {
    renderDetail({ probs: { p1: 30, pX: 28, p2: 42, pGG: 50, pO25: 55, pU35: 70, pO15: 78, corners: CORNERS } }, { accessTier: "premium" });
    openMarkets();
    expect(cardsDisclosure()).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/Over 4\.5|Peste 4\.5/);
  });

  it("[13] Ultra sees Cards", () => {
    renderDetail();
    openCards();
    expect(document.body.textContent).toMatch(/68%/);
  });

  it("[21] Goals / Corners stay exactly where they were", () => {
    renderDetail(FT(7));
    openMarkets();
    const titles = [...layer("markets")!.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent || "");
    expect(titles.some((t) => startsWith("match", "featCorners").test(t))).toBe(true);
    expect(layer("decision")!.textContent).toMatch(/Over 2\.5|Peste 2\.5/);
  });
});

describe("C3 · status semantics (same grader as Corners / Shots)", () => {
  const row = (cardsTotal: number | null, status = "FT", extra: Record<string, unknown> = {}) =>
    buildMatch({ ...FT(cardsTotal), status, ...extra });

  it("[8] WIN: Over 4.5 with 7 cards", () => expect(resolveCardMarketOutcome("cards", row(7))).toBe("win"));
  it("[9] LOSS: Over 4.5 with 3 cards", () => expect(resolveCardMarketOutcome("cards", row(3))).toBe("loss"));
  it("[10] PENDING: FT without a total stays pending; pre-match is not settled", () => {
    expect(resolveCardMarketOutcome("cards", row(null))).toBe("pending");
    expect(resolveCardMarketOutcome("cards", row(null, "NS"))).toBeNull();
    expect(resolveCardMarketOutcome("cards", row(7, "2H"))).toBeNull();
  });
  it("[2][4] the official total is cardsTotal — never cardsPoints, never 0 for NULL", () => {
    expect(officialTotalFor("cards", row(7))).toBe(7);
    expect(officialTotalFor("cards", row(0))).toBe(0);
    expect(officialTotalFor("cards", row(null))).toBeNull();
    // points present, count absent → still unknown
    const pointsOnly = buildMatch({ status: "FT", score: { home: 0, away: 2, minute: 90 }, marketResults: { cardsPoints: 9 } });
    expect(officialTotalFor("cards", pointsOnly)).toBeNull();
    expect(resolveCardMarketOutcome("cards", pointsOnly)).toBe("pending");
    // and cards never reads the corners total
    const cornersOnly = buildMatch({ status: "FT", score: { home: 0, away: 2, minute: 90 }, marketResults: { cornersTotal: 12 } });
    expect(resolveCardMarketOutcome("cards", cornersOnly)).toBe("pending");
    expect(resolveCardMarketOutcome("corners", cornersOnly)).toBe("win");
  });
});

describe("C3 · FocusCard row + referee context + i18n", () => {
  const renderFocus = (overrides: Record<string, unknown> = {}, tier: "free" | "premium" | "ultra" = "ultra") => {
    render(<PredictionFocusCard row={buildMatch(overrides)} accessTier={tier} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: startsWith("card", "showDetails") }));
  };

  it("[11][13] Ultra FocusCard lists Cards as a market row with pick and confidence", () => {
    renderFocus(FT(7));
    const text = document.body.textContent || "";
    expect(text).toMatch(anyOf("match", "featCards"));
    expect(text).toMatch(/Over 4\.5|Peste 4\.5/);
    expect(text).toMatch(/68%/);
  });

  it("[12] non-Ultra FocusCard shows Cards as locked (upgrade), not as a value", () => {
    renderFocus({ probs: { p1: 30, pX: 28, p2: 42, pGG: 50, pO25: 55, pU35: 70, pO15: 78, corners: CORNERS } }, "premium");
    const text = document.body.textContent || "";
    expect(text).toMatch(anyOf("match", "featCards"));
    expect(text).not.toMatch(/Over 4\.5|Peste 4\.5/);
  });

  it("[14] referee discipline context renders under the referee name when the server supplies it", () => {
    renderDetail({ refereeCards: { avgCards: 5.06, sampleSize: 17, unit: "cardsTotal" } });
    open("detail", "contextTitle");
    open("detail", "conditionsTitle");
    const ctx = screen.getByTestId("referee-cards-context");
    expect(ctx.textContent).toMatch(/5\.1/);
    expect(ctx.textContent).toMatch(/17/);
    expect(ctx.getAttribute("title")).toMatch(anyOf("match", "refereeCardsNote"));
  });

  it("[15] missing referee context is safe: name only, no fabricated average", () => {
    renderDetail({ refereeCards: null });
    open("detail", "contextTitle");
    open("detail", "conditionsTitle");
    expect(screen.queryByTestId("referee-cards-context")).toBeNull();
    expect(layer("context")!.textContent).toMatch(/Giovanni Ayroldi/);
    cleanup();
    renderDetail({ refereeCards: { avgCards: Number.NaN, sampleSize: 0, unit: "cardsTotal" } });
    open("detail", "contextTitle");
    open("detail", "conditionsTitle");
    expect(screen.queryByTestId("referee-cards-context")).toBeNull();
  });

  it("[16][17] RO and EN vocabularies exist and match in shape", () => {
    for (const key of ["featCards", "cardsSub", "finalTotal", "refereeCardsAvg", "refereeCardsNote"]) {
      expect(typeof R.match[key]).toBe("string");
      expect(typeof E.match[key]).toBe("string");
    }
    expect(R.match.refereeCardsAvg).toMatch(/\{avg\}.*\{n\}/);
    expect(E.match.refereeCardsAvg).toMatch(/\{avg\}.*\{n\}/);
    expect(R.match.featCards).toBe("Cartonașe");
    expect(E.match.featCards).toBe("Cards");
  });
});
