import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MatchModal from "../MatchModal";
import { resolveModalMatch } from "../../hooks/useHistoryDetailSource";
import { demoteStaleLiveStatus, MAX_LIVE_AGE_MS, STALE_LIVE_STATUS } from "../../utils/liveState";
import { en } from "../../i18n/en";
import { ro } from "../../i18n/ro";
import type { PredictionRow } from "../../types";

/**
 * Udinese–Como (fixture 1550095, 2026-08-22): predictions_history still held the
 * half-time snapshot of the 17:38 sync (`match_status: "HT"`, 1–0, everything
 * pending, totals NULL) long after full time. The read boundary correctly
 * demotes that status to `TBD` ("unresolved — neither live nor final"), but the
 * modal's `hasLiveScore` re-promoted any non-final status with a numeric score
 * after kickoff to LIVE: the header read "1–0 · ● LIVE" for a finished match.
 *
 * The contract pinned here: a demoted (stale) status is never rendered as live
 * — not in the header, not in the Live strip — while a genuinely in-play row
 * and a pre-match row keep today's behaviour exactly.
 */

vi.mock("../PredictionLaboratory", () => ({ default: () => null }));
vi.mock("../MonteCarloPanel", () => ({ default: () => null }));

afterEach(cleanup);

const HOUR = 3600_000;
const leaf = (key: string) => [(en.card as Record<string, string>)[key], (ro.card as unknown as Record<string, string>)[key]];
const LIVE_LABELS = leaf("live").filter(Boolean);

function row(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    id: 1550095,
    leagueId: 135,
    league: "Serie A",
    teams: { home: "Udinese", away: "Como" },
    kickoff: new Date(Date.now() - 4 * HOUR).toISOString(),
    status: "HT",
    score: { home: 1, away: 0 },
    probs: { p1: 48, pX: 27, p2: 25, pGG: 50, pO25: 55, pU35: 70, pO15: 78 },
    predictions: { oneXtwo: "1", gg: "NG", over25: "Sub 2.5", correctScore: "1-0" },
    recommended: { pick: "Over 7.25", family: "Corners", confidence: 77, odd: 1.29 },
    validation: "pending",
    cardMarketValidations: { goals: "pending", shots: "pending", corners: "pending", recommended: "pending" },
    ...overrides
  } as unknown as PredictionRow;
}

const renderModal = (match: PredictionRow) =>
  render(<MatchModal match={match} logoColors={{}} onClose={() => {}} hashColor={() => "#888"} accessTier="ultra" presentation="focus" />);
const header = () => document.querySelector("[data-layer='header']") as HTMLElement;
const statusSlot = () => header().querySelector("[data-slot='status']") as HTMLElement;
const saysLive = () => LIVE_LABELS.some((l) => statusSlot().textContent?.includes(l)) || Boolean(statusSlot().querySelector(".animate-pulse, .motion-safe\\:animate-pulse"));

describe("MatchModal · a stale persisted in-play status is never rendered as LIVE", () => {
  it("reproduces the production chain: demoted list row + HT detail snapshot → modal, and the header is NOT live", () => {
    // Read boundary: the list row (DB "HT", 4 h after kickoff) is demoted to TBD.
    const listRow = demoteStaleLiveStatus(row());
    expect(listRow.status).toBe(STALE_LIVE_STATUS);
    expect(listRow.rawStatus).toBe("HT");
    // Detail: the same snapshot straight from /api/history?fixtureId= (not final → list status wins the merge).
    const modalMatch = resolveModalMatch(listRow, row())!;
    expect(modalMatch.status).toBe(STALE_LIVE_STATUS);

    renderModal(modalMatch);
    expect(saysLive()).toBe(false);
    expect(document.querySelector("[data-layer='live']")).toBeNull();
  });

  it("a demoted row with a numeric score does not claim a live score, however old", () => {
    renderModal(demoteStaleLiveStatus(row({ kickoff: new Date(Date.now() - (MAX_LIVE_AGE_MS + HOUR)).toISOString() })));
    expect(saysLive()).toBe(false);
  });

  it("a provider TBD (kick-off time unconfirmed, no rawStatus) past kickoff keeps the existing live-score fallback", () => {
    renderModal(row({ status: "TBD", kickoff: new Date(Date.now() - HOUR).toISOString(), score: { home: 0, away: 0 } }));
    expect(saysLive()).toBe(true);
  });

  it("the demotion survives the list↔detail merge in both directions", () => {
    const stale = demoteStaleLiveStatus(row());
    // Results: demoted list row + raw HT detail — the provenance rides along with the status.
    expect(resolveModalMatch(stale, row())!.rawStatus).toBe("HT");
    // Matches: the live poll already says FT — the fresh in-memory row wins and is not stale.
    const merged = resolveModalMatch(row({ status: "FT", score: { home: 1, away: 0, minute: 90 } }), demoteStaleLiveStatus(row()))!;
    expect(merged.status).toBe("FT");
    renderModal(merged);
    expect(saysLive()).toBe(false);
    expect(header().textContent).toMatch(/1–0/);
  });

  it("a genuinely in-play row still renders live (status + minute)", () => {
    renderModal(row({ status: "2H", kickoff: new Date(Date.now() - HOUR).toISOString(), score: { home: 1, away: 0, minute: 57 } }));
    expect(statusSlot().textContent).toMatch(/57/);
    expect(document.querySelector("[data-layer='live']")).toBeTruthy();
  });

  it("a pre-match row after the poll window (NS, numeric score from the poll) still renders live — the existing fallback is untouched", () => {
    renderModal(row({ status: "NS", kickoff: new Date(Date.now() - 10 * 60_000).toISOString(), score: { home: 0, away: 0 } }));
    expect(saysLive()).toBe(true);
  });

  it("a final row renders FT with its score, never live", () => {
    renderModal(row({ status: "FT", score: { home: 1, away: 0 } }));
    expect(saysLive()).toBe(false);
    expect(header().textContent).toMatch(/1–0/);
    expect(statusSlot().textContent).toMatch(new RegExp(`${(en.list as unknown as Record<string, string>).fullTimeShort}|${(ro.list as unknown as Record<string, string>).fullTimeShort}`));
  });
});
