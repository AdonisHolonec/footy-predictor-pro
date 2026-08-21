import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MatchModal from "../components/MatchModal";
import MatchListRow from "../components/ux/MatchListRow";
import MatchList from "../components/ux/MatchList";
import { LocaleProvider } from "../context/LocaleContext";
import { __clearHistoryDetailCache } from "./useHistoryDetail";
import { useHistoryDetailSource } from "./useHistoryDetailSource";
import type { PredictionRow } from "../types";

/**
 * Integration of the dashboard's live-detail wiring (UserDashboard.tsx: the
 * selectedMatch state, its resync from preds on every poll, and
 * `modalMatch = useHistoryDetailSource(selectedMatch, history).match`), with
 * the real MatchListRow and MatchModal and a mocked /api/history?fixtureId=.
 *
 * Production forensic (Aug 21): the list said "57' 3–0 LIVE" while the modal
 * said "10:00 PM" and Momentum vanished once the detail request resolved.
 */

vi.mock("../utils/supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }
}));

const HOUR = 60 * 60 * 1000;
const MOMENTUM = { homeMomentum: 64, awayMomentum: 36, dominantTeam: "home", trend: "up", confidence: 80 } as const;
const EVENTS = [{ minute: 12, team: "home", type: "goal", player: "Saka" }];

function liveRow(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 1557367,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Coventry" },
    kickoff: new Date(Date.now() - HOUR).toISOString(),
    status: "2H",
    score: { home: 3, away: 0, minute: 57 },
    lambdas: { home: 1.6, away: 1.1 },
    momentum: MOMENTUM,
    liveEvents: EVENTS,
    probs: { p1: 50, pX: 28, p2: 22, pGG: 50, pO25: 55, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Peste 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 1.8 },
    ...overrides
  } as unknown as PredictionRow;
}

/** The persisted detail for the same fixture: DB status/score, no live fields. */
let detailItem: Record<string, unknown>;
let resolveDetail: (() => void) | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __clearHistoryDetailCache();
  detailItem = {
    id: 1557367,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Coventry" },
    kickoff: new Date(Date.now() - HOUR).toISOString(),
    status: "NS",
    score: { home: null, away: null },
    validation: "pending",
    cardMarketValidations: { goals: "pending", recommended: "pending" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 1.8 },
    probs: { p1: 50, pX: 28, p2: 22 }
  };
  fetchMock = vi.fn((url: string) => {
    if (!String(url).includes("fixtureId=")) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    return new Promise((res) => {
      resolveDetail = () => res({ ok: true, status: 200, json: async () => ({ ok: true, scope: "fixture_detail", item: detailItem }) });
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resolveDetail = null;
});

let setPredsExternal: ((rows: PredictionRow[]) => void) | null = null;

/** Mirrors UserDashboard: preds → list; click → selectedMatch; poll → resync; modal ← detail source. */
function Dashboard({ initial }: { initial: PredictionRow[] }) {
  const [preds, setPreds] = useState(initial);
  const [selectedMatch, setSelectedMatch] = useState<PredictionRow | null>(null);
  useEffect(() => {
    setPredsExternal = setPreds;
  }, []);
  useEffect(() => {
    setSelectedMatch((cur) => {
      if (!cur) return cur;
      const next = preds.find((p) => p.id === cur.id);
      return next ?? cur;
    });
  }, [preds]);
  const { match: modalMatch } = useHistoryDetailSource(selectedMatch, preds);
  return (
    <>
      <MatchList label="list">
        {preds.map((row) => (
          <MatchListRow key={String(row.id)} row={row} onOpen={() => setSelectedMatch(row)} />
        ))}
      </MatchList>
      {modalMatch && (
        <MatchModal match={modalMatch} logoColors={{}} onClose={() => setSelectedMatch(null)} hashColor={() => "rgb(1,1,1)"} />
      )}
    </>
  );
}

function mount(rows = [liveRow()]) {
  render(
    <LocaleProvider>
      <Dashboard initial={rows} />
    </LocaleProvider>
  );
}
const header = () => document.querySelector('[data-layer="header"]');
const centre = () => header()?.querySelector('[data-slot="centre"]')?.textContent || "";
const status = () => header()?.querySelector('[data-slot="status"]')?.textContent || "";
const openRow = () => fireEvent.click(document.querySelector("li[data-match-row] > button")!);
function openMomentum() {
  const btn = [...document.querySelectorAll('[data-layer="live"] button[aria-expanded]')][0] as HTMLElement | undefined;
  if (btn) fireEvent.click(btn);
}

describe("live detail integration", () => {
  it("14 · the list shows the live 57' 3–0", () => {
    mount();
    const li = document.querySelector("li[data-match-row]")!;
    expect(li.querySelector("[data-slot='time']")?.textContent).toMatch(/57'/);
    expect(li.querySelector("[data-slot='score']")?.textContent).toMatch(/3–0/);
  });

  it("15 · the modal still reads 57' 3–0 after the history detail resolves; 16/17 · Momentum and events remain", async () => {
    mount();
    openRow();
    await waitFor(() => expect(header()).toBeTruthy());
    expect(centre()).toMatch(/3–0/);
    expect(status()).toMatch(/57'/);
    await waitFor(() => expect(resolveDetail).toBeTruthy());
    await act(async () => {
      resolveDetail!();
    });
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("fixtureId=1557367"))).toBe(true));
    // After the detail is merged: live snapshot intact, Momentum + events still there.
    expect(centre()).toMatch(/3–0/);
    expect(status()).toMatch(/57'/);
    openMomentum();
    await waitFor(() => expect(screen.queryAllByTestId("momentum-root").length).toBe(1));
    expect(document.querySelector('[data-slot="live-recent"]')).toBeTruthy();
  });

  it("18 · a fresh poll after opening updates the modal's live state", async () => {
    mount();
    openRow();
    await waitFor(() => expect(resolveDetail).toBeTruthy());
    await act(async () => {
      resolveDetail!();
    });
    await act(async () => {
      setPredsExternal!([liveRow({ score: { home: 4, away: 0, minute: 63 } })]);
    });
    await waitFor(() => expect(centre()).toMatch(/4–0/));
    expect(status()).toMatch(/63'/);
  });

  it("19 · a FINAL detail transitions the modal to FT + outcome", async () => {
    detailItem = { ...detailItem, status: "FT", score: { home: 3, away: 0 }, validation: "win", cardMarketValidations: { goals: "win", recommended: "win" } };
    mount();
    openRow();
    await waitFor(() => expect(resolveDetail).toBeTruthy());
    await act(async () => {
      resolveDetail!();
    });
    await waitFor(() => expect(status()).toMatch(/FT/));
    expect(centre()).toMatch(/3–0/);
    expect(status()).toMatch(/Won|Câștigat/);
    expect(document.querySelector('[data-layer="live"]')).toBeNull();
  });

  it("the dashboard still routes the modal through the detail source (wiring guard)", () => {
    const src = readFileSync(join(__dirname, "..", "pages", "UserDashboard.tsx"), "utf8");
    expect(src).toMatch(/useHistoryDetailSource\(selectedMatch, history\)/);
    expect(src).toMatch(/match=\{modalMatch\}/);
    expect(src).toMatch(/preds\.find\(\(p\) => p\.id === cur\.id\)/);
  });
});
