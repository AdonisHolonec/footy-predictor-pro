import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HistoryEntry } from "../types";
import {
  MAX_LIVE_AGE_MS,
  STALE_LIVE_STATUS,
  applyLiveStateCarryForward,
  demoteStaleLiveStatus,
  demoteStaleLiveStatuses
} from "./liveState";
import { isFixtureInPlay } from "./appUtils";
import HistorySection from "../components/ux/HistorySection";
import { LocaleProvider } from "../context/LocaleContext";
import { en } from "../i18n/en";
import { ro } from "../i18n/ro";

/**
 * LIVE STATE FRESHNESS — the read boundary.
 *
 * predictions_history keeps the LAST OBSERVED provider status; a sync that ran
 * at 35' leaves "1H" in the table for hours. The boundary decides whether that
 * old status may be read as CURRENT live UI — and nothing else: no FT, no
 * score, no validation, no mutation.
 */

const HOUR = 60 * 60 * 1000;
const KO = Date.parse("2026-08-21T17:30:00Z");
const at = (offsetMs: number) => KO + offsetMs;

function row(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: 1565227,
    leagueId: 283,
    league: "Liga I",
    teams: { home: "Home", away: "Away" },
    kickoff: new Date(KO).toISOString(),
    status: "1H",
    score: { home: 0, away: 0 },
    validation: "pending",
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 70, odd: 1.9 },
    ...overrides
  } as unknown as HistoryEntry;
}

afterEach(cleanup);

describe("demoteStaleLiveStatus — contract", () => {
  it("1 · fresh 1H within the live age stays 1H", () => {
    expect(demoteStaleLiveStatus(row(), at(30 * 60 * 1000)).status).toBe("1H");
    expect(demoteStaleLiveStatus(row(), at(2 * HOUR)).status).toBe("1H");
  });

  it("2 · exactly kickoff + 3h is still fresh (boundary is inclusive)", () => {
    const r = demoteStaleLiveStatus(row(), at(MAX_LIVE_AGE_MS));
    expect(r.status).toBe("1H");
    expect(r.rawStatus).toBeUndefined();
    expect(MAX_LIVE_AGE_MS).toBe(3 * HOUR);
  });

  it("3 · kickoff + 3h + 1ms is demoted", () => {
    const r = demoteStaleLiveStatus(row(), at(MAX_LIVE_AGE_MS + 1));
    expect(r.status).toBe(STALE_LIVE_STATUS);
    expect(isFixtureInPlay(r.status)).toBe(false);
  });

  it("4 · fresh 2H stays 2H; 5 · stale 2H is demoted", () => {
    expect(demoteStaleLiveStatus(row({ status: "2H" }), at(HOUR)).status).toBe("2H");
    expect(demoteStaleLiveStatus(row({ status: "2H" }), at(4 * HOUR)).status).toBe(STALE_LIVE_STATUS);
  });

  it("6 · a stale 1H with a score keeps the stored score — it is neither invented nor erased", () => {
    const r = demoteStaleLiveStatus(row({ score: { home: 1, away: 0 } }), at(4 * HOUR));
    expect(r.score).toEqual({ home: 1, away: 0 });
    expect(r.status).not.toMatch(/^(FT|AET|PEN)$/);
  });

  it("7–10 · FT / PST / ABD / CANC are untouched however old", () => {
    for (const status of ["FT", "AET", "PEN", "PST", "ABD", "CANC", "AWD", "WO"]) {
      const r = demoteStaleLiveStatus(row({ status }), at(48 * HOUR));
      expect(r.status, status).toBe(status);
      expect(r.rawStatus, status).toBeUndefined();
    }
  });

  it("11 · pre-kickoff NS is untouched", () => {
    const r = demoteStaleLiveStatus(row({ status: "NS", kickoff: new Date(at(3 * HOUR)).toISOString() }), at(0));
    expect(r.status).toBe("NS");
  });

  it("15 · missing kickoff never demotes; 16 · invalid kickoff never demotes", () => {
    expect(demoteStaleLiveStatus(row({ kickoff: undefined as unknown as string }), at(48 * HOUR)).status).toBe("1H");
    expect(demoteStaleLiveStatus(row({ kickoff: "not-a-date" }), at(48 * HOUR)).status).toBe("1H");
  });

  it("17 · the original row is never mutated", () => {
    const original = row();
    const frozen = Object.freeze({ ...original, score: Object.freeze({ ...original.score }) }) as HistoryEntry;
    const r = demoteStaleLiveStatus(frozen, at(4 * HOUR));
    expect(r).not.toBe(frozen);
    expect(frozen.status).toBe("1H");
    expect(frozen.rawStatus).toBeUndefined();
  });

  it("18 · validation is untouched; 19 · rawStatus preserves the provider status", () => {
    const r = demoteStaleLiveStatus(row({ validation: "pending" }), at(4 * HOUR));
    expect(r.validation).toBe("pending");
    expect(r.rawStatus).toBe("1H");
    const input = row();
    const fresh = demoteStaleLiveStatus(input, at(HOUR));
    expect(fresh).toBe(input); // fresh rows pass through by identity — no copy, no rawStatus
    expect(fresh.rawStatus).toBeUndefined();
  });

  it("batch helper maps every row with the same clock", () => {
    const out = demoteStaleLiveStatuses([row(), row({ status: "FT" }), row({ status: "HT" })], at(4 * HOUR));
    expect(out.map((r) => r.status)).toEqual([STALE_LIVE_STATUS, "FT", STALE_LIVE_STATUS]);
  });
});

describe("freshness normalization before carry-forward", () => {
  it("12 · in-memory 2H beats a stale DB 1H", () => {
    const previous = [row({ status: "2H", score: { home: 1, away: 0, minute: 70 } })];
    const hydrated = [demoteStaleLiveStatus(row(), at(4 * HOUR))];
    const out = applyLiveStateCarryForward(previous, hydrated);
    expect(out[0].status).toBe("2H");
    expect(out[0].score).toEqual({ home: 1, away: 0, minute: 70 });
  });

  it("13 · in-memory FT beats a stale DB 1H", () => {
    const previous = [row({ status: "FT", score: { home: 2, away: 1 } })];
    const out = applyLiveStateCarryForward(previous, [demoteStaleLiveStatus(row(), at(4 * HOUR))]);
    expect(out[0].status).toBe("FT");
  });

  it("14 · a fresher persisted FT still wins over in-memory 1H (final-status escape)", () => {
    const previous = [row({ status: "1H" })];
    const out = applyLiveStateCarryForward(previous, [demoteStaleLiveStatus(row({ status: "FT", score: { home: 2, away: 1 } }), at(4 * HOUR))]);
    expect(out[0].status).toBe("FT");
    expect(out[0].score).toEqual({ home: 2, away: 1 });
  });

  it("stale DB 1H with NO previous state does not become current LIVE on first paint", () => {
    const out = applyLiveStateCarryForward([], [demoteStaleLiveStatus(row(), at(4 * HOUR))]);
    expect(isFixtureInPlay(out[0].status)).toBe(false);
    expect(out[0].rawStatus).toBe("1H");
  });
});

describe("counters read the normalized rows", () => {
  it("a stale persisted 1H contributes to no live count; a fresh one does", () => {
    const rows = demoteStaleLiveStatuses([row(), row({ id: 2, status: "2H" }), row({ id: 3, status: "FT" })], at(4 * HOUR));
    // The same predicate Home / Matches Live / the nav badge use (useDerivedPredictions.homeLiveCount).
    expect(rows.filter((r) => isFixtureInPlay(r.status)).length).toBe(0);
    const fresh = demoteStaleLiveStatuses([row(), row({ id: 2, status: "2H" })], at(HOUR));
    expect(fresh.filter((r) => isFixtureInPlay(r.status)).length).toBe(2);
  });
});

describe("Results surface — a stale persisted 1H row", () => {
  type Leaves = Record<string, Record<string, string>>;
  const E = en as unknown as Leaves;
  const R = ro as unknown as Leaves;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const either = (ns: string, key: string) => new RegExp(`${esc(E[ns][key])}|${esc(R[ns][key])}`);

  it("shows no LIVE, no running score, no Momentum, and does not claim final", () => {
    const stale = demoteStaleLiveStatus(row(), at(4 * HOUR));
    render(
      <LocaleProvider>
        <HistorySection history={[stale]} today="2026-08-21" onOpenMatch={() => {}} />
      </LocaleProvider>
    );
    const li = document.querySelector("li[data-match-row]")!;
    expect(li).toBeTruthy();
    expect(li.textContent).not.toMatch(either("card", "live"));
    expect(li.querySelector("[data-slot='score']")?.textContent).not.toMatch(/\d+–\d+/);
    expect(li.querySelector("[data-slot='score']")?.textContent).toMatch(either("common", "vs"));
    expect(li.textContent).not.toMatch(either("list", "fullTimeShort"));
    expect(screen.queryAllByTestId("momentum-root").length).toBe(0);
    // Still an unresolved record: the pending filter keeps it.
    expect(stale.validation).toBe("pending");
  });

  it("the same row while fresh still reads as live", () => {
    const fresh = demoteStaleLiveStatus(row({ score: { home: 0, away: 0, minute: 35 } }), at(35 * 60 * 1000));
    render(
      <LocaleProvider>
        <HistorySection history={[fresh]} today="2026-08-21" onOpenMatch={() => {}} />
      </LocaleProvider>
    );
    const li = document.querySelector("li[data-match-row]")!;
    // Live grammar: the time slot carries the minute and the score slot the running score.
    expect(li.querySelector("[data-slot='time']")?.textContent).toMatch(/35'/);
    expect(li.querySelector("[data-slot='score']")?.textContent).toMatch(/0–0/);
    expect(li.getAttribute("data-live") ?? li.textContent).toBeTruthy();
  });
});
