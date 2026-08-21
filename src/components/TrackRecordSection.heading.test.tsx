import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LocaleProvider } from "../context/LocaleContext";
import TrackRecordSection from "./TrackRecordSection";
import StatisticsSection from "./ux/StatisticsSection";
import { en } from "../i18n/en";
import { ro } from "../i18n/ro";

/**
 * UX-E polish: the Performance "Model Track Record" zone owns the heading and
 * the population label. TrackRecordSection, reused inside it, must not add a
 * second heading — while the standalone /track-record page keeps its own.
 */

vi.mock("../services/trackRecordService", () => ({
  loadPublicTrackRecord: vi.fn().mockResolvedValue({
    ok: true,
    public: true,
    source: "snapshots",
    days: 45,
    asOf: "2026-08-21",
    summary: { settled: 120, wins: 80, losses: 40, hitRate: 66.7, roi: 4.2, pnlUnits: 5.04, drawdown: -3.1, totalStake: 120, expectedValue: 0.04 },
    trend: [],
    byMarket: []
  })
}));
vi.mock("./ux/CalibrationChart", () => ({ default: () => null }));
vi.mock("./ux/HistoryTrustSection", () => ({ default: () => null }));

afterEach(cleanup);

const E = en as unknown as Record<string, Record<string, string>>;
const R = ro as unknown as Record<string, Record<string, string>>;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const settledPerf = new RegExp(`^(${esc(E.track.settledPerf).replace("\\{days\\}", "\\d+")}|${esc(R.track.settledPerf).replace("\\{days\\}", "\\d+")})$`);
const modelTitle = new RegExp(`^(${esc(E.perf.modelTitle)}|${esc(R.perf.modelTitle)})$`);

const wrap = (ui: React.ReactElement) => (
  <LocaleProvider>
    <MemoryRouter>{ui}</MemoryRouter>
  </LocaleProvider>
);

describe("TrackRecordSection heading ownership", () => {
  it("standalone: keeps its own eyebrow, title and note (the public page is unchanged)", async () => {
    render(wrap(<TrackRecordSection days={45} showLinkToFull={false} />));
    await waitFor(() => expect(screen.getByText("66.7%")).toBeTruthy());
    const headings = screen.getAllByRole("heading");
    expect(headings.filter((h) => settledPerf.test(h.textContent || "")).length).toBe(1);
    expect(screen.getByText(new RegExp(`^(${esc(E.track.verified)}|${esc(R.track.verified)})$`))).toBeTruthy();
    expect(screen.getByTestId("track-record-section").getAttribute("data-embedded")).toBeNull();
  });

  it("embedded: renders no heading of its own; the metrics and the window selector remain", async () => {
    render(wrap(<TrackRecordSection days={45} showLinkToFull compact embedded />));
    await waitFor(() => expect(screen.getByText("66.7%")).toBeTruthy());
    expect(screen.queryAllByRole("heading").length).toBe(0);
    expect(screen.queryByText(new RegExp(`^(${esc(E.track.verified)}|${esc(R.track.verified)})$`))).toBeNull();
    expect(screen.getByRole("button", { name: "45d" })).toBeTruthy();
    expect(screen.getByTestId("track-record-section").getAttribute("data-embedded")).toBe("true");
  });

  it("inside Performance: exactly ONE Model Track Record heading, population label present", async () => {
    render(wrap(<StatisticsSection trackerSlot={<div />} history={[]} />));
    await waitFor(() => expect(screen.getByText("66.7%")).toBeTruthy());
    const zone = screen.getByTestId("performance-model");
    const zoneHeadings = [...zone.querySelectorAll("h1, h2, h3")];
    expect(zoneHeadings.length).toBe(1);
    expect(zoneHeadings[0].textContent).toMatch(modelTitle);
    expect(zone.textContent).toMatch(new RegExp(`${esc(E.perf.modelEyebrow)}|${esc(R.perf.modelEyebrow)}`));
    expect(zone.textContent).not.toMatch(settledPerf);
  });
});
