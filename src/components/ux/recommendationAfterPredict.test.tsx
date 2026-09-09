import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocaleProvider } from "../../context/LocaleContext";
import { usePredictFlow } from "../../hooks/usePredictFlow";
import type { PredictionRow } from "../../types";
import PredictCta from "./PredictCta";
import { buildPredictAction, resolvePredictState } from "./predictState";
import RecommendationDialog, { shouldOpenRecommendationAfterPredict } from "./RecommendationDialog";

/**
 * The post-Predict recommendation is opened by the COMPLETION of a run.
 *
 * Pinned two ways, like the other consumer-shell tests:
 *
 *   1. A harness that composes the REAL pieces — usePredictFlow against a
 *      stubbed fetch, the real Predict CTA on the real action contract, the
 *      real dialog, and the same one-line rule the dashboard applies in
 *      onPredictCompleted. The click still runs the existing flow; the dialog
 *      opens only once the run has rows, and never while it is pending, after
 *      a 429, a failed status, a thrown fetch, or an empty run.
 *   2. Source pins on UserDashboard.tsx and HomeSection.tsx, so the wiring the
 *      harness mirrors is the wiring that ships: the trigger lives inside
 *      onPredictCompleted (not on the click), Home no longer renders the
 *      Featured card, and nothing opens the dialog from a floating button.
 */

const SRC = join(__dirname, "..", "..");
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function row(id: number, home: string): PredictionRow {
  return {
    id,
    leagueId: 39,
    league: "Premier League",
    teams: { home, away: `${home} Away` },
    kickoff: "2026-08-25T17:30:00.000Z",
    status: "NS",
    probs: { p1: 0.5, pX: 0.25, p2: 0.25 },
    recommended: { pick: "Over 2.5", family: "Over/Under", confidence: 80 - id, odd: 1.9 }
  } as unknown as PredictionRow;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const failed = (status: number) => ({ ok: false, status, json: async () => ({ error: `HTTP ${status}` }) });

/** Mirrors UserDashboard: completion → open, the click → the existing flow only. */
function Harness({ statuses }: { statuses: string[] }) {
  const [rows, setRows] = useState<PredictionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { predict } = usePredictFlow<PredictionRow>({
    accessToken: "token-1",
    selectedLeagueIds: [39],
    inferSeason: () => 2026,
    usageDay: "2026-08-25",
    setStatus: (m) => statuses.push(m),
    onPredictCompleted: (deduped) => {
      setRows(deduped);
      setOpen(shouldOpenRecommendationAfterPredict(deduped));
    }
  });
  const action = buildPredictAction({
    state: resolvePredictState(busy, { quotaExempt: true, limit: null, used: 0 }),
    labels: { label: "Predict", hint: "Generate", busy: "Running", quotaSpent: "Spent" },
    run: () => {
      setBusy(true);
      void predict(["2026-08-25"]).finally(() => setBusy(false));
    }
  });
  const strongest =
    [...rows].sort((a, b) => Number(b.recommended?.confidence || 0) - Number(a.recommended?.confidence || 0))[0] ??
    null;
  return (
    <LocaleProvider>
      <PredictCta action={action} />
      <RecommendationDialog open={open} onClose={() => setOpen(false)} match={strongest} onOpenAnalysis={() => {}} />
    </LocaleProvider>
  );
}

function mount() {
  const statuses: string[] = [];
  render(<Harness statuses={statuses} />);
  return { statuses, predictButton: () => screen.getByTestId("predict-cta") };
}

const flush = () => act(async () => {});

describe("Recommendation dialog after Predict", () => {
  it("clicking Predict still runs the existing flow: one /api/predict request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([row(1, "Arsenal")]));
    vi.stubGlobal("fetch", fetchMock);
    const { predictButton } = mount();
    fireEvent.click(predictButton());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/predict\?/);
  });

  it("does not open before the click, nor while the run is pending; opens once rows arrive", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((res) => (resolve = res))));
    const { predictButton } = mount();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(predictButton());
    await flush();
    expect(predictButton().getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();

    await act(async () => resolve(ok([row(2, "Leeds"), row(1, "Arsenal")])));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Arsenal/);
    await waitFor(() => expect(predictButton().getAttribute("aria-busy")).toBeNull());
  });

  it("does not open after a failed status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failed(500)));
    const { predictButton, statuses } = mount();
    fireEvent.click(predictButton());
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(statuses.some((s) => /500/.test(s))).toBe(true);
  });

  it("does not open after a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failed(429)));
    const { predictButton, statuses } = mount();
    fireEvent.click(predictButton());
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(statuses.length).toBeGreaterThan(0);
  });

  it("does not open when the request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { predictButton, statuses } = mount();
    fireEvent.click(predictButton());
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(statuses.some((s) => /network down/.test(s))).toBe(true);
  });

  it("does not open when the run produced no rows", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    const { predictButton } = mount();
    fireEvent.click(predictButton());
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from X and from Escape, and stays closed until the next completed run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([row(1, "Arsenal")]));
    vi.stubGlobal("fetch", fetchMock);
    const { predictButton } = mount();
    fireEvent.click(predictButton());
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(predictButton());
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Recommendation dialog — the wiring that ships", () => {
  const dashboard = src("pages/UserDashboard.tsx");
  const home = src("components/ux/HomeSection.tsx");

  it("the trigger lives inside onPredictCompleted, not on the click", () => {
    const start = dashboard.indexOf("onPredictCompleted: async (deduped, token) => {");
    const end = dashboard.indexOf("syncHistoryAfterPredict(token", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const completion = dashboard.slice(start, end);
    expect(completion).toMatch(/setRecommendationOpen\(shouldOpenRecommendationAfterPredict\(deduped\)\)/);
    // Exactly one writer of `true`, and it is the completion callback.
    expect((dashboard.match(/setRecommendationOpen\(shouldOpenRecommendationAfterPredict/g) || []).length).toBe(1);
    expect((dashboard.match(/setRecommendationOpen\(true\)/g) || []).length).toBe(0);
    const runStart = dashboard.indexOf("async function warmAndPredict()");
    const runEnd = dashboard.indexOf("useEffect(() => {", runStart);
    expect(dashboard.slice(runStart, runEnd)).not.toMatch(/setRecommendationOpen/);
  });

  it("the dialog is rendered once, fed the same strongest pick, and hands off to Match Detail", () => {
    expect((dashboard.match(/<RecommendationDialog/g) || []).length).toBe(1);
    expect(dashboard).toMatch(/<RecommendationDialog[\s\S]*?match=\{analysisMatch\}[\s\S]*?onOpenAnalysis=\{openMatch\}/);
  });

  it("Home no longer renders the Featured card and no floating button opens the dialog", () => {
    expect(home).not.toMatch(/FeaturedPredictionCard/);
    expect(home).not.toMatch(/analysisMatch/);
    expect(dashboard).not.toMatch(/analysisMatch=\{analysisMatch\}/);
    // The only opener is the completion callback; nothing in the render tree sets it open.
    expect(dashboard).not.toMatch(/onClick=\{[^}]*setRecommendationOpen\(true\)/);
  });
});
