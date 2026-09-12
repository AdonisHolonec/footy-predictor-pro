import { describe, expect, it, vi } from "vitest";
import { buildPredictAction, isPastDaySelection, resolvePredictState, type PredictQuota } from "./predictState";

/**
 * Predict on a past day. Browsing a day that is over is allowed (it reads like
 * Results); GENERATING for it is refused by the same gate as the quota, so no
 * quota is spent and no post-hoc prediction reaches settlement.
 */

const quota: PredictQuota = { quotaExempt: false, limit: 10, used: 0 };
const labels = {
  label: "Predict",
  hint: "Generate predictions",
  busy: "Generating…",
  quotaSpent: "Quota spent",
  pastDay: "Day is over"
};

describe("Predict on a past day", () => {
  it("recognises a selection that includes a day before today", () => {
    expect(isPastDaySelection(["2026-09-10"], "2026-09-11")).toBe(true);
    expect(isPastDaySelection(["2026-09-10", "2026-09-11"], "2026-09-11")).toBe(true);
    expect(isPastDaySelection(["2026-09-11", "2026-09-12"], "2026-09-11")).toBe(false);
    expect(isPastDaySelection([], "2026-09-11")).toBe(false);
  });

  it("blocks Predict on a past day even with quota left; a run in flight still reads as busy", () => {
    expect(resolvePredictState(false, quota, true)).toBe("blocked");
    expect(resolvePredictState(true, quota, true)).toBe("busy");
    expect(resolvePredictState(false, quota, false)).toBe("idle");
    expect(resolvePredictState(false, quota)).toBe("idle");
  });

  it("names the past-day reason and refuses to run", () => {
    const run = vi.fn();
    const action = buildPredictAction({ state: "blocked", blockedBy: "pastDay", labels, run });
    expect(action.reason).toBe("Day is over");
    expect(action.hint).toBe("Day is over");
    expect(action.disabled).toBe(true);
    action.onActivate();
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps the quota reason when the block is the quota", () => {
    const action = buildPredictAction({ state: "blocked", labels, run: vi.fn() });
    expect(action.reason).toBe("Quota spent");
  });
});
