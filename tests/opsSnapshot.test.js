/**
 * S3 observability: the snapshot's derived sections and the alerts they feed.
 *
 * The SQL aggregates live in migration 041 and are not exercised here — what is tested
 * is the JS that composes them, plus Cron Health, which replaced the brief's "Queue
 * Health" because this system has no queue: its crons are scheduled HTTP invocations.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { buildCronHealth, buildNotificationHealth } from "../server-utils/observability/opsSnapshot.js";
import { buildOpsAlerts } from "../server-utils/observability/healthBundle.js";

const HOUR = 60 * 60 * 1000;

/** Supabase client double: only the call shapes these two builders use. */
function fakeSupabase({ syncStatus = null, metaRuns = [], notifications = [], notificationError = null }) {
  return {
    from(table) {
      if (table === "history_sync_status") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: syncStatus }) }) }) };
      }
      if (table === "meta_learning_runs") {
        return { select: () => ({ order: () => ({ limit: async () => ({ data: metaRuns }) }) }) };
      }
      if (table === "notification_dispatch_log") {
        return {
          select: () => ({
            gte: () => ({ limit: async () => ({ data: notifications, error: notificationError }) })
          })
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

const QUIET = {
  metrics: { routes: {}, failures: { prediction: 0, api: 0, cache: 0 } },
  usage: { count: 0, limit: 100 },
  cache: { hitRatio: 0.9, hits: 100, misses: 10 },
  checks: { kv: { ok: true }, supabase: { ok: true } }
};

test("cron health reports each job's age and success", async () => {
  const recent = new Date(Date.now() - 2 * HOUR).toISOString();
  const health = await buildCronHealth(
    fakeSupabase({
      syncStatus: { last_ran_at: recent, last_ok: true, last_scanned: 40, last_updated: 3 },
      metaRuns: [{ started_at: recent, ok: true }]
    })
  );

  assert.equal(health.jobs.historySync.ok, true);
  assert.equal(health.jobs.historySync.scanned, 40);
  assert.ok(health.jobs.historySync.ageMinutes >= 115 && health.jobs.historySync.ageMinutes <= 125);
  assert.deepEqual(health.staleJobs, []);
  assert.deepEqual(health.failingJobs, []);
});

test("a job that stopped running is stale; a job that ran and failed is failing", async () => {
  const old = new Date(Date.now() - 40 * HOUR).toISOString();
  const recent = new Date(Date.now() - 1 * HOUR).toISOString();
  const health = await buildCronHealth(
    fakeSupabase({
      syncStatus: { last_ran_at: old, last_ok: true },
      metaRuns: [{ started_at: recent, ok: false, error: "boom" }]
    })
  );

  // Distinct failure modes: silence is not the same as an error, and only one of the
  // two is visible in a run's result.
  assert.deepEqual(health.staleJobs, ["historySync"]);
  assert.deepEqual(health.failingJobs, ["metaLearningRefresh"]);
});

test("cron health degrades to an empty job set rather than throwing", async () => {
  const health = await buildCronHealth(fakeSupabase({}));
  assert.equal(health.ok, true);
  assert.deepEqual(health.jobs, {});
});

test("notification health summarises dispatch outcomes", async () => {
  const health = await buildNotificationHealth(
    fakeSupabase({
      notifications: [
        { status: "sent", notification_type: "safe", created_at: "2026-08-06T10:00:00.000Z" },
        { status: "sent", notification_type: "value", created_at: "2026-08-07T10:00:00.000Z" },
        { status: "error", notification_type: "safe", created_at: "2026-08-05T10:00:00.000Z" },
        { status: "skipped", notification_type: "safe", created_at: "2026-08-04T10:00:00.000Z" }
      ]
    }),
    7
  );

  assert.equal(health.total, 4);
  assert.equal(health.byStatus.sent, 2);
  assert.equal(health.byType.safe, 3);
  assert.equal(health.successPct, 50);
  assert.equal(health.errorPct, 25);
  assert.equal(health.lastDispatchAt, "2026-08-07T10:00:00.000Z");
});

test("a notification read error degrades rather than aborting the snapshot", async () => {
  const health = await buildNotificationHealth(
    fakeSupabase({ notificationError: { message: "permission denied" } }),
    7
  );
  assert.equal(health.ok, false);
  assert.match(health.error, /permission denied/);
});

test("a stale snapshot and failing crons raise alerts", () => {
  const alerts = buildOpsAlerts({
    ...QUIET,
    snapshot: {
      ageMinutes: 4000,
      cron: { failingJobs: ["metaLearningRefresh"], staleJobs: ["historySync"] }
    }
  });
  const ids = alerts.alerts.map((a) => a.id);
  assert.ok(ids.includes("ops_snapshot_stale"));
  assert.ok(ids.includes("cron_failing"));
  assert.ok(ids.includes("cron_stale"));
  assert.equal(alerts.severity, "high");
});

test("a fresh snapshot with healthy crons is silent, and no snapshot is not an alert", () => {
  const fresh = buildOpsAlerts({
    ...QUIET,
    snapshot: { ageMinutes: 60, cron: { failingJobs: [], staleJobs: [] } }
  });
  assert.equal(fresh.severity, "none");

  // Before the first cron run there is no snapshot at all; that must not alarm.
  const none = buildOpsAlerts({ ...QUIET, snapshot: null });
  assert.equal(none.severity, "none");
});
