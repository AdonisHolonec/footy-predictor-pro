import { describe, expect, it } from "vitest";
import type { HealthDashboardBundle } from "../types";
import {
  buildDeliveryInsight,
  buildEdgeInsight,
  buildFreshnessInsight,
  buildHealthInsights,
  buildSettlementInsight,
  fmtAge
} from "./healthInsights";

/**
 * The insight builders read a handful of fields off a large bundle. Constructing a full
 * bundle per test would bury the one value each case is about, so fixtures carry only the
 * branch under test and are cast at the boundary.
 */
function bundleWith(partial: Partial<HealthDashboardBundle>): HealthDashboardBundle {
  return partial as HealthDashboardBundle;
}

function withEv(median: number): HealthDashboardBundle {
  return bundleWith({
    snapshot: {
      capturedAt: "2026-08-07T00:00:00.000Z",
      ageMinutes: 60,
      windowDays: 7,
      prediction: {
        avgConfidence: 62.4,
        avgOdds: 1.446,
        recommendedEv: {
          n: 98,
          median,
          p25: median - 8,
          p75: median + 9,
          mean: median + 6,
          negativePct: 60.2,
          unit: "percent"
        }
      },
      settlement: {},
      business: {},
      notifications: {},
      cron: {}
    }
  });
}

describe("buildEdgeInsight", () => {
  it("reads a slightly negative median as the healthy, calibrated case", () => {
    const insight = buildEdgeInsight(withEv(-2.1));

    expect(insight.tone).toBe("good");
    expect(insight.headline).toBe("-2.10%");
    expect(insight.verdict).toContain("bookmaker's margin");
  });

  it("keeps a median at the -6% boundary inside the healthy band", () => {
    expect(buildEdgeInsight(withEv(-6)).tone).toBe("good");
  });

  it("flags a deeply negative median as confidence outrunning the odds", () => {
    const insight = buildEdgeInsight(withEv(-9));

    expect(insight.tone).toBe("watch");
    expect(insight.verdict).toContain("priced well below the market");
  });

  it("escalates to bad once the median falls past twice the healthy floor", () => {
    expect(buildEdgeInsight(withEv(-13)).tone).toBe("bad");
  });

  it("treats an implausibly high median as suspicious rather than good news", () => {
    const insight = buildEdgeInsight(withEv(14));

    expect(insight.tone).toBe("bad");
    expect(insight.verdict).toContain("odds freshness");
  });

  it("reports the quartile spread as the typical range, not the mean", () => {
    const insight = buildEdgeInsight(withEv(-2.1));
    const range = insight.figures.find((f) => f.label === "Typical range");

    expect(range?.value).toBe("-10.1% to +6.9%");
  });

  it("falls back to unknown when no snapshot has been written", () => {
    const insight = buildEdgeInsight(bundleWith({}));

    expect(insight.tone).toBe("unknown");
    expect(insight.figures).toHaveLength(0);
  });
});

describe("buildSettlementInsight", () => {
  const totals = {
    finishedScanned: 246,
    recommendedSettled: 16,
    missingTotals: 0,
    skippedByBudget: 7
  };

  it("confirms a clear queue when nothing is left ungraded", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-07T10:00:00.000Z",
          ageMinutes: 30,
          runs: 4,
          totals,
          recommendedStillPending: 0
        }
      })
    );

    expect(insight.tone).toBe("good");
    expect(insight.headline).toBe("0");
    expect(insight.verdict).toContain("Nothing is stuck");
  });

  it("explains a small tail as missing provider stats rather than a fault", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-07T10:00:00.000Z",
          ageMinutes: 30,
          runs: 4,
          totals,
          recommendedStillPending: 4
        }
      })
    );

    expect(insight.tone).toBe("good");
    expect(insight.verdict).toContain("not a fault on our side");
  });

  it("uses singular wording for a single ungraded fixture", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-07T10:00:00.000Z",
          ageMinutes: 30,
          runs: 1,
          totals,
          recommendedStillPending: 1
        }
      })
    );

    expect(insight.verdict).toContain("1 finished fixture is");
  });

  it("escalates a large backlog to bad", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-07T10:00:00.000Z",
          ageMinutes: 30,
          runs: 4,
          totals,
          recommendedStillPending: 25
        }
      })
    );

    expect(insight.tone).toBe("bad");
  });

  it("blames grading fallback when the backlog coincides with missing families", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-07T10:00:00.000Z",
          ageMinutes: 30,
          runs: 4,
          totals,
          recommendedStillPending: 8
        },
        snapshot: {
          capturedAt: "2026-08-07T00:00:00.000Z",
          ageMinutes: 60,
          windowDays: 7,
          prediction: { unknownFamilyPct: 45 },
          settlement: {},
          business: {},
          notifications: {},
          cron: {}
        }
      })
    );

    expect(insight.tone).toBe("watch");
    expect(insight.verdict).toContain("line heuristics");
  });

  it("ranks a stopped sync above the backlog it reports", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-05T10:00:00.000Z",
          ageMinutes: 2000,
          runs: 1,
          totals,
          recommendedStillPending: 0
        }
      })
    );

    expect(insight.tone).toBe("bad");
    expect(insight.verdict).toContain("stopped running");
  });
});

describe("buildDeliveryInsight", () => {
  const healthy = {
    generatedToday: 40,
    servedLive: 12,
    servedFromCache: 28,
    cacheServedPct: 70,
    avgGenerationMs: 4200,
    p95GenerationMs: 8100,
    avgLatencyMs: 900,
    p95LatencyMs: 5200,
    avgCachedLatencyMs: 120,
    failures: 0,
    persistFailures: { history: 0, ownership: 0 },
    upstreamFallbacks: 0
  };

  it("puts a persist failure above every latency figure", () => {
    const insight = buildDeliveryInsight(
      bundleWith({
        predictionHealth: { ...healthy, persistFailures: { history: 2, ownership: 0 } }
      })
    );

    expect(insight.tone).toBe("bad");
    expect(insight.headline).toBe("2");
    expect(insight.verdict).toContain("disappear the moment the user reconnects");
  });

  it("counts ownership and history persist failures together", () => {
    const insight = buildDeliveryInsight(
      bundleWith({
        predictionHealth: { ...healthy, persistFailures: { history: 1, ownership: 3 } }
      })
    );

    expect(insight.headline).toBe("4");
  });

  it("reports outright failures once they cross the watch threshold", () => {
    const insight = buildDeliveryInsight(bundleWith({ predictionHealth: { ...healthy, failures: 4 } }));

    expect(insight.tone).toBe("watch");
    expect(insight.verdict).toContain("failing outright");
  });

  it("declines to read anything into latency on a day with no traffic", () => {
    const insight = buildDeliveryInsight(
      bundleWith({
        predictionHealth: { ...healthy, generatedToday: 0, servedLive: 0, servedFromCache: 0 }
      })
    );

    expect(insight.tone).toBe("unknown");
  });

  it("says nothing happened rather than claiming it has no data", () => {
    const insight = buildDeliveryInsight(
      bundleWith({
        predictionHealth: { ...healthy, generatedToday: 0, servedLive: 0, servedFromCache: 0 }
      })
    );

    expect(insight.statusLabel).toBe("Nothing yet");
    expect(insight.figures.length).toBeGreaterThan(0);
  });

  it("does not report a cached latency nobody measured", () => {
    const idle = buildDeliveryInsight(
      bundleWith({
        predictionHealth: {
          ...healthy,
          generatedToday: 0,
          servedLive: 0,
          servedFromCache: 0,
          avgCachedLatencyMs: 0
        }
      })
    );
    expect(idle.figures.find((f) => f.label === "Cached response")?.value).toBe("—");

    const busy = buildDeliveryInsight(bundleWith({ predictionHealth: healthy }));
    expect(busy.figures.find((f) => f.label === "Cached response")?.value).toBe("120ms");
  });

  it("leaves the tone label alone when the standing is judgeable", () => {
    expect(buildDeliveryInsight(bundleWith({ predictionHealth: healthy })).statusLabel).toBeUndefined();
  });

  it("summarises a clean day with the cache share", () => {
    const insight = buildDeliveryInsight(bundleWith({ predictionHealth: healthy }));

    expect(insight.tone).toBe("good");
    expect(insight.verdict).toContain("70%");
  });
});

describe("buildFreshnessInsight", () => {
  function snapshotWith(cron: Record<string, unknown>, ageMinutes = 60) {
    return bundleWith({
      snapshot: {
        capturedAt: "2026-08-07T00:00:00.000Z",
        ageMinutes,
        windowDays: 7,
        prediction: {},
        settlement: {},
        business: {},
        notifications: {},
        cron
      },
      benchmarkHealth: {
        ok: true,
        lastRunAt: "2026-08-07T09:00:00.000Z",
        ageMinutes: 90,
        runs: 3,
        totals: { fetched: 40, persisted: 40, errors: 0 },
        backlog: 12,
        coveragePct: 94.5
      }
    });
  }

  it("names the failing jobs and warns the other cards are stale", () => {
    const insight = buildFreshnessInsight(snapshotWith({ failingJobs: ["historySync"], staleJobs: [] }));

    expect(insight.tone).toBe("bad");
    expect(insight.verdict).toContain("historySync");
  });

  it("treats jobs that stopped being invoked as bad, not merely stale data", () => {
    const insight = buildFreshnessInsight(snapshotWith({ failingJobs: [], staleJobs: ["metaLearningRefresh"] }));

    expect(insight.tone).toBe("bad");
    expect(insight.verdict).toContain("not run in over a day");
  });

  it("downgrades to watch when only the snapshot itself is old", () => {
    const insight = buildFreshnessInsight(snapshotWith({}, 3000));

    expect(insight.tone).toBe("watch");
    expect(insight.headline).toBe("2d ago");
  });

  it("explains a large benchmark backlog as budget-bound rather than broken", () => {
    const base = snapshotWith({});
    const insight = buildFreshnessInsight({
      ...base,
      benchmarkHealth: { ...base.benchmarkHealth!, backlog: 240 }
    });

    expect(insight.tone).toBe("watch");
    expect(insight.verdict).toContain("API budget");
  });

  it("confirms current data when every job ran and succeeded", () => {
    expect(buildFreshnessInsight(snapshotWith({ failingJobs: [], staleJobs: [] })).tone).toBe("good");
  });

  it("reports the absence of any snapshot rather than inventing a verdict", () => {
    expect(buildFreshnessInsight(bundleWith({})).tone).toBe("unknown");
  });
});

describe("buildHealthInsights", () => {
  it("returns nothing when the bundle has not loaded", () => {
    expect(buildHealthInsights(null)).toEqual([]);
  });

  it("orders the cards worst-first so the problem is read before the reassurance", () => {
    const insights = buildHealthInsights(
      bundleWith({
        predictionHealth: {
          generatedToday: 5,
          servedLive: 5,
          servedFromCache: 0,
          cacheServedPct: 0,
          avgGenerationMs: 100,
          p95GenerationMs: 200,
          avgLatencyMs: 100,
          p95LatencyMs: 200,
          avgCachedLatencyMs: null,
          failures: 0,
          persistFailures: { history: 3, ownership: 0 },
          upstreamFallbacks: 0
        },
        settlementHealth: {
          ok: true,
          lastRunAt: "2026-08-07T10:00:00.000Z",
          ageMinutes: 30,
          runs: 1,
          totals: { finishedScanned: 10, recommendedSettled: 10, missingTotals: 0, skippedByBudget: 0 },
          recommendedStillPending: 0
        }
      })
    );

    expect(insights[0].id).toBe("delivery");
    expect(insights[0].tone).toBe("bad");
    expect(insights).toHaveLength(4);
  });
});

describe("published thresholds", () => {
  const settlement = {
    ok: true,
    lastRunAt: "2026-08-07T10:00:00.000Z",
    ageMinutes: 30,
    runs: 4,
    totals: { finishedScanned: 246, recommendedSettled: 16, missingTotals: 0, skippedByBudget: 7 },
    recommendedStillPending: 8
  };

  it("defers to the server's threshold over its own default", () => {
    // 8 pending clears the default warn of 5, so the card reads "watch". A server
    // configured with a warn of 12 must pull the identical figure back to good.
    const strict = buildSettlementInsight(bundleWith({ settlementHealth: settlement }));
    expect(strict.tone).toBe("watch");

    const relaxed = buildSettlementInsight(
      bundleWith({ settlementHealth: settlement, thresholds: { settlementPendingWarn: 12 } })
    );
    expect(relaxed.tone).toBe("good");
  });

  it("escalates when the server tightens the critical band", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: settlement,
        thresholds: { settlementPendingWarn: 2, settlementPendingCritical: 6 }
      })
    );

    expect(insight.tone).toBe("bad");
  });

  it("keeps its default when a published threshold is unusable", () => {
    const insight = buildSettlementInsight(
      bundleWith({
        settlementHealth: settlement,
        thresholds: { settlementPendingWarn: null, settlementPendingCritical: null }
      })
    );

    expect(insight.tone).toBe("watch");
  });

  it("applies a published snapshot staleness window", () => {
    const base = {
      capturedAt: "2026-08-07T00:00:00.000Z",
      ageMinutes: 200,
      windowDays: 7,
      prediction: {},
      settlement: {},
      business: {},
      notifications: {},
      cron: { failingJobs: [], staleJobs: [] }
    };

    expect(buildFreshnessInsight(bundleWith({ snapshot: base })).tone).toBe("good");
    expect(
      buildFreshnessInsight(bundleWith({ snapshot: base, thresholds: { snapshotStaleMinutes: 120 } })).tone
    ).toBe("watch");
  });
});

describe("fmtAge", () => {
  it("says never rather than showing a placeholder number", () => {
    expect(fmtAge(null)).toBe("never");
  });

  it("keeps minutes under an hour", () => {
    expect(fmtAge(45)).toBe("45m ago");
  });

  it("switches to hours past the hour boundary", () => {
    expect(fmtAge(90)).toBe("2h ago");
  });

  it("switches to days past 48h", () => {
    expect(fmtAge(4320)).toBe("3d ago");
  });
});
