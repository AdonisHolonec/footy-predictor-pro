import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LocaleProvider } from "../../context/LocaleContext";
import { usePredictFlow } from "../../hooks/usePredictFlow";
import type { PredictionRow } from "../../types";
import PredictCta from "./PredictCta";
import PredictPromoDialog from "./PredictPromoDialog";
import { buildPredictAction, resolvePredictState } from "./predictState";

/**
 * The referral promo opens on the EXPLICIT Predict press, in the same tick the
 * request starts, and never waits for — or depends on — the run's outcome.
 *
 * Pinned two ways, like the other consumer-shell tests:
 *
 *   1. A harness composing the REAL pieces: usePredictFlow against a stubbed
 *      fetch, the real Predict CTA on the real action contract, the real
 *      dialog, and the same `run` wiring the dashboard uses — promo first,
 *      request second. A direct (background) call to the run function, as the
 *      onboarding effect and Refresh make, never opens it.
 *   2. Source pins on UserDashboard.tsx, HomeSection.tsx and the shell, so the
 *      wiring the harness mirrors is the wiring that ships, the campaign strip
 *      is no longer rendered anywhere in the product, and the Featured card is
 *      back on Today where it belongs.
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

/** Mirrors UserDashboard: the explicit press opens the promo and starts the run; a direct run does not. */
function Harness({ statuses, onRecommend }: { statuses: string[]; onRecommend: () => void }) {
  const [rows, setRows] = useState<PredictionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  const { predict } = usePredictFlow<PredictionRow>({
    accessToken: "token-1",
    selectedLeagueIds: [39],
    inferSeason: () => 2026,
    usageDay: "2026-08-25",
    setStatus: (m) => statuses.push(m),
    onPredictCompleted: (deduped) => setRows(deduped)
  });
  async function warmAndPredict() {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      await predict(["2026-08-25"]);
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }
  const action = buildPredictAction({
    state: resolvePredictState(busy, { quotaExempt: true, limit: null, used: 0 }),
    labels: { label: "Predict", hint: "Generate", busy: "Running", quotaSpent: "Spent" },
    run: () => {
      setOpen(true);
      void warmAndPredict();
    }
  });
  return (
    <LocaleProvider>
      <PredictCta action={action} />
      <button type="button" data-testid="background-predict" onClick={() => void warmAndPredict()}>
        background
      </button>
      <span data-testid="rows">{rows.length}</span>
      <PredictPromoDialog
        open={open}
        onClose={() => setOpen(false)}
        onRecommend={() => {
          setOpen(false);
          onRecommend();
        }}
      />
    </LocaleProvider>
  );
}

function mount() {
  const statuses: string[] = [];
  const onRecommend = vi.fn();
  render(<Harness statuses={statuses} onRecommend={onRecommend} />);
  return {
    statuses,
    onRecommend,
    predictButton: () => screen.getByTestId("predict-cta"),
    rows: () => Number(screen.getByTestId("rows").textContent)
  };
}

const flush = () => act(async () => {});

describe("Predict promo — the explicit press", () => {
  it("opens the promo immediately on the press, before the request has answered, and starts exactly one request", async () => {
    let resolve!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((res) => (resolve = res)));
    vi.stubGlobal("fetch", fetchMock);
    const { predictButton, rows } = mount();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(predictButton());
    // Synchronous: no await between the press and the dialog.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(rows()).toBe(0);

    // The request starts in the same task (the flow resolves its token first,
    // one microtask) — the promo did not delay it, and it is still pending.
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/predict\?/);
    expect(predictButton().getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => resolve(ok([row(1, "Arsenal")])));
    await waitFor(() => expect(rows()).toBe(1));
    // The result arriving neither opens nor closes it.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not wait for success: a failed status still had its promo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failed(500)));
    const { predictButton, statuses } = mount();
    fireEvent.click(predictButton());
    expect(screen.getByRole("dialog")).toBeTruthy();
    await flush();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(statuses.some((s) => /500/.test(s))).toBe(true);
  });

  it("a thrown fetch still had its promo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { predictButton, statuses } = mount();
    fireEvent.click(predictButton());
    expect(screen.getByRole("dialog")).toBeTruthy();
    await flush();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(statuses.some((s) => /network down/.test(s))).toBe(true);
  });

  it("dismissing the promo cancels nothing: the run finishes and the rows arrive", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((res) => (resolve = res))));
    const { predictButton, rows } = mount();
    fireEvent.click(predictButton());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush();
    expect(predictButton().getAttribute("aria-busy")).toBe("true");

    await act(async () => resolve(ok([row(1, "Arsenal"), row(2, "Leeds")])));
    await waitFor(() => expect(rows()).toBe(2));
    await waitFor(() => expect(predictButton().getAttribute("aria-busy")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the CTA invokes the referral action once and closes the promo; the run is untouched", async () => {
    let resolve!: (v: unknown) => void;
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise((res) => (resolve = res))));
    const { predictButton, onRecommend, rows } = mount();
    fireEvent.click(predictButton());
    fireEvent.click(screen.getByTestId("predict-promo-cta"));
    expect(onRecommend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => resolve(ok([row(1, "Arsenal")])));
    await waitFor(() => expect(rows()).toBe(1));
  });

  it("Escape, backdrop and 'Later' each close it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok([])));
    const { predictButton } = mount();

    fireEvent.click(predictButton());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush();

    fireEvent.click(predictButton());
    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush();

    fireEvent.click(predictButton());
    fireEvent.click(screen.getByTestId("predict-promo-later"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await flush();
  });

  it("a background run (onboarding, Refresh) never shows the promo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([row(1, "Arsenal")]));
    vi.stubGlobal("fetch", fetchMock);
    const { rows } = mount();
    fireEvent.click(screen.getByTestId("background-predict"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(rows()).toBe(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("two presses in one tick: one request, one promo", async () => {
    let resolve!: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((res) => (resolve = res)));
    vi.stubGlobal("fetch", fetchMock);
    const { predictButton } = mount();
    fireEvent.click(predictButton());
    fireEvent.click(predictButton());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolve(ok([])));
  });
});

describe("Predict promo — the wiring that ships", () => {
  const dashboard = src("pages/UserDashboard.tsx");
  const home = src("components/ux/HomeSection.tsx");
  const shell = src("components/ux/ConsumerShell.tsx");

  it("the trigger is the explicit press: inside the Predict action's run, before the request", () => {
    const start = dashboard.indexOf("const predictAction = buildPredictAction({");
    const end = dashboard.indexOf("async function warmAndPredict()", start);
    expect(start).toBeGreaterThan(0);
    const run = dashboard.slice(start, end);
    expect(run).toMatch(/run: \(\) => \{\s*\/\*[\s\S]*?\*\/\s*setPredictPromoOpen\(true\);\s*void warmAndPredict\(\);\s*\}/);
    // Only the press opens it: never the completion callback, never the run itself.
    expect((dashboard.match(/setPredictPromoOpen\(true\)/g) || []).length).toBe(1);
    const completionStart = dashboard.indexOf("onPredictCompleted: async (deduped, token) => {");
    const completion = dashboard.slice(completionStart, dashboard.indexOf("loadHistory();", completionStart));
    expect(completion).not.toMatch(/PredictPromo/);
    const runBody = dashboard.slice(end, dashboard.indexOf("useEffect(() => {", end));
    expect(runBody).not.toMatch(/PredictPromo/);
  });

  it("the CTA reuses the existing referral action: navigate to Account and reveal the referral card", () => {
    expect(dashboard).toMatch(
      /<PredictPromoDialog[\s\S]*?onRecommend=\{\(\) => \{\s*setPredictPromoOpen\(false\);\s*navigateAndReveal\("profile", REFERRAL_CARD_ID\);\s*\}\}/
    );
    expect((dashboard.match(/<PredictPromoDialog/g) || []).length).toBe(1);
  });

  it("the old bar under the header is gone from the product, and no floating CTA replaced it", () => {
    expect(dashboard).not.toMatch(/ReferralCampaignStrip|campaignSlot=/);
    // The shell's slot may still exist as an API; nothing feeds it.
    expect(shell).not.toMatch(/ReferralCampaignStrip/);
    for (const rel of ["pages/UserDashboard.tsx", "components/ux/PredictPromoDialog.tsx", "components/ux/HomeSection.tsx"]) {
      expect(src(rel)).not.toMatch(/className="[^"]*\bfixed\b[^"]*\bbottom-/);
    }
  });

  it("the day's Featured recommendation is back on Today and not inside the promo", () => {
    expect(home).toMatch(/<FeaturedPredictionCard/);
    expect(src("components/ux/PredictPromoDialog.tsx")).not.toMatch(/FeaturedPredictionCard/);
  });
});
