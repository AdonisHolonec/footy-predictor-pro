import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * RELIABILITY-006 — Stage10's persistence ordering and failure semantics, pinned.
 *
 * `user_prediction_fixtures` has a foreign key to `predictions_history`, so the
 * ownership link must never run ahead of (or without) the history write. After a
 * history failure Stage10 keeps its existing contract: the Predict response still
 * succeeds, `X-Persist-Warning` names the failure, and the dependent writes are
 * skipped. Every collaborator is a module mock, so only the ordering is under test.
 */

const state = { failHistory: false, calls: [] };
const TIMEOUT = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });

mock.module("../server-utils/supabaseAdmin.js", {
  namedExports: {
    assertSupabaseConfigured: () => ({ ok: true }),
    getSupabaseAdmin: () => ({
      from: (table) => ({
        insert: async () => {
          state.calls.push(table);
          return { error: null };
        }
      })
    })
  }
});
mock.module("../server-utils/predictionsHistory.js", {
  namedExports: {
    applyCanonicalPayloads: async (out) => out,
    upsertPredictionsHistory: async (rows) => {
      state.calls.push("history");
      if (state.failHistory) throw TIMEOUT;
      return { count: rows.length, skipped: 0, inserted: rows.length, updated: 0, skippedFinal: 0, skippedStale: 0 };
    }
  }
});
mock.module("../server-utils/importance/persistFeatureImportance.js", {
  namedExports: { persistFeatureImportanceRows: async () => state.calls.push("feature_importance") }
});
mock.module("../server-utils/context/persistContextSnapshots.js", {
  namedExports: { persistContextSnapshots: async () => state.calls.push("context_snapshots") }
});
mock.module("../server-utils/linkUserPredictionFixtures.js", {
  namedExports: {
    linkUserPredictionFixtures: async () => {
      state.calls.push("ownership_link");
      return { ok: true };
    }
  }
});
mock.module("../server-utils/accessTier.js", {
  namedExports: {
    decrementPredictCountBy: async () => 0,
    rememberUniquePredictFixtures: async () => 0,
    USER_TIERS: { FREE: "free", PRO: "pro", ULTRA: "ultra" }
  }
});

const { run } = await import("../server-utils/pipeline/stages/Stage10Persistence.js");

function context() {
  const headers = {};
  return {
    headers,
    ctx: {
      req: { method: "GET" },
      res: { setHeader: (k, v) => (headers[k] = v) },
      out: [{ id: 1 }, { id: 2 }],
      usageCtx: { userId: "user-1", usageDay: "2026-09-11" },
      tierContext: null,
      reservedTierUsage: 0
    }
  };
}

test("12. success: history first, then feature importance, context, ownership link, sync log — in that order", async () => {
  state.failHistory = false;
  state.calls = [];
  const { ctx, headers } = context();
  mock.method(console, "error", () => {});

  await run(ctx);

  assert.deepEqual(state.calls, ["history", "feature_importance", "context_snapshots", "ownership_link", "history_sync_log"]);
  assert.equal(headers["X-Persist-Warning"], undefined);
  mock.restoreAll();
});

test("12. a history failure skips every dependent write and keeps the existing warning, without failing the request", async () => {
  state.failHistory = true;
  state.calls = [];
  const { ctx, headers } = context();
  const errors = [];
  mock.method(console, "error", (...args) => errors.push(args.join(" ")));

  const result = await run(ctx);

  assert.deepEqual(state.calls, ["history"], "no ownership link can run ahead of, or without, its history rows");
  assert.equal(headers["X-Persist-Warning"], "predictions_history_upsert_failed");
  assert.ok(result.out.length === 2, "the computed predictions still reach the response stage");
  assert.ok(errors.some((line) => line.includes("[predict persist]") && line.includes("statement timeout")));
  mock.restoreAll();
});
