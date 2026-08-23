import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MatchCard from "./MatchCard";
import { LocaleProvider } from "../context/LocaleContext";
import type { PredictionRow } from "../types";

/**
 * MatchCard's running score follows the shared `hasRunningScore` predicate
 * (live-state consistency fix) — not the old inline window that had no upper
 * bound and excluded only FT/AET/PEN.
 */

const HOUR = 60 * 60 * 1000;
function row(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 901,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    kickoff: new Date(Date.now() - HOUR).toISOString(),
    status: "NS",
    score: { home: 1, away: 0 },
    probs: { p1: 50, pX: 28, p2: 22 },
    predictions: { oneXtwo: "1", gg: "GG", over25: "Peste 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 72, odd: 1.8 },
    ...overrides
  } as unknown as PredictionRow;
}

afterEach(cleanup);

function scoreText(r: PredictionRow): string {
  const { container } = render(
    <LocaleProvider>
      <MatchCard row={r} logoColors={{}} onClick={() => {}} hashColor={() => "rgb(1,1,1)"} />
    </LocaleProvider>
  );
  return container.textContent || "";
}

describe("MatchCard running score", () => {
  it("NS inside the kickoff window: score shown, labelled as a score, not as live", () => {
    const text = scoreText(row({ status: "NS" }));
    expect(text).toMatch(/1-0/);
    expect(text).toMatch(/Scor/);
    expect(text).not.toMatch(/Live\s*1-0/);
  });

  it("NS beyond kickoff + 4h: no running score", () => {
    const text = scoreText(row({ status: "NS", kickoff: new Date(Date.now() - 5 * HOUR).toISOString() }));
    expect(text).not.toMatch(/1-0/);
  });

  it.each(["CANC", "PST", "ABD", "AWD", "WO"])("%s with a score: no running score", (status) => {
    const text = scoreText(row({ status }));
    expect(text).not.toMatch(/1-0/);
  });

  it("in play: score shown as Live", () => {
    const text = scoreText(row({ status: "2H", score: { home: 1, away: 0, minute: 70 } }));
    expect(text).toMatch(/Live\s*1-0/);
  });

  it("final: FT score, never a running score", () => {
    const text = scoreText(row({ status: "FT" }));
    expect(text).toMatch(/FT 1-0/);
    expect(text).not.toMatch(/Scor|Live\s*1-0/);
  });
});
