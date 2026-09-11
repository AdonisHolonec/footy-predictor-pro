/**
 * RELIABILITY-005 — the single admission point for outbound API-Sports requests.
 *
 * Production evidence (2026-09-11, after RELIABILITY-004 telemetry shipped):
 *   - the provider advertises 300 requests/minute and 7500/day;
 *   - it signals its limit as HTTP 200 + `errors.rateLimit`, with no Retry-After
 *     and no reset header;
 *   - it rejected requests while successful responses still reported 143-192 of
 *     the minute budget left, and the rejections clustered within milliseconds.
 *
 * So a minute counter is not a safe admission rule. The provider's actual
 * enforcement mechanism is unknown; this gate therefore limits the three things
 * the application controls, without relying on any of them being sufficient:
 *
 *   - pacing:      at most one request START per `minIntervalMs`
 *                  (default 250 ms: <= 4/s, <= 240/min = 80% of the advertised
 *                  300/min — the same 80% margin apiBudgetCircuit uses daily);
 *   - concurrency: at most `maxConcurrency` requests in flight;
 *   - feedback:    a provider rate-limit response pauses ALL admissions for
 *                  `cooldownMs`, so the next requests do not land in the same
 *                  window that just rejected us.
 *
 * Waiting is bounded (`maxWaitMs`): a request that cannot be admitted in time is
 * refused locally instead of stalling the function until its platform timeout.
 * A slot is leased (`leaseMs`), because the provider fetch has no timeout of its
 * own and a hung request must not hold a slot forever.
 *
 * Scope, stated rather than implied: this is PROCESS-LOCAL. Concurrent function
 * instances each have their own gate. A cross-instance limiter would need a KV
 * round trip per request, on the same Upstash store whose monthly command cap was
 * exhausted on 2026-08-18 — a worse failure mode than the one being fixed.
 */

export const GATE_DEFAULTS = Object.freeze({
  minIntervalMs: 250,
  maxConcurrency: 3,
  maxWaitMs: 30_000,
  leaseMs: 20_000,
  cooldownMs: 5_000,
  disabled: false
});

function clampInt(raw, fallback, min, max) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Gate configuration from the environment. Every value is clamped, so a typo can
 * neither disable pacing by accident nor stall requests indefinitely.
 *
 *   API_UPSTREAM_MIN_INTERVAL_MS         default 250    [0, 10000]
 *   API_UPSTREAM_MAX_CONCURRENCY         default 3      [1, 50]
 *   API_UPSTREAM_MAX_WAIT_MS             default 30000  [1000, 120000]
 *   API_UPSTREAM_LEASE_MS                default 20000  [1000, 300000]
 *   API_UPSTREAM_RATE_LIMIT_COOLDOWN_MS  default 5000   [0, 60000]
 *   API_UPSTREAM_GATE_DISABLED=1         emergency bypass
 */
export function readGateConfig(env = process.env) {
  return {
    minIntervalMs: clampInt(env.API_UPSTREAM_MIN_INTERVAL_MS, GATE_DEFAULTS.minIntervalMs, 0, 10_000),
    maxConcurrency: clampInt(env.API_UPSTREAM_MAX_CONCURRENCY, GATE_DEFAULTS.maxConcurrency, 1, 50),
    maxWaitMs: clampInt(env.API_UPSTREAM_MAX_WAIT_MS, GATE_DEFAULTS.maxWaitMs, 1_000, 120_000),
    leaseMs: clampInt(env.API_UPSTREAM_LEASE_MS, GATE_DEFAULTS.leaseMs, 1_000, 300_000),
    cooldownMs: clampInt(env.API_UPSTREAM_RATE_LIMIT_COOLDOWN_MS, GATE_DEFAULTS.cooldownMs, 0, 60_000),
    disabled: String(env.API_UPSTREAM_GATE_DISABLED || "").trim() === "1"
  };
}

/**
 * The provider's per-minute rejection, as observed in production: HTTP 200 with
 * an `errors` OBJECT carrying a `rateLimit` key. Deliberately narrow — the DAILY
 * quota arrives as `errors.requests` and must never be retried.
 *
 * @param {unknown} json provider response body
 */
export function isProviderRateLimited(json) {
  const errors = json && typeof json === "object" ? json.errors : null;
  return Boolean(
    errors && typeof errors === "object" && !Array.isArray(errors) && Object.prototype.hasOwnProperty.call(errors, "rateLimit")
  );
}

function defaultSchedule(fn, ms) {
  const timer = setTimeout(fn, ms);
  // Never keep a function instance (or a test runner) alive just for the gate.
  if (typeof timer?.unref === "function") timer.unref();
  return timer;
}

/**
 * @param {Partial<typeof GATE_DEFAULTS>} [config]
 * @param {{ now?: () => number, setTimeout?: Function, clearTimeout?: Function, onLeaseExpired?: Function }} [deps]
 *   injectable clock and timers, so tests can drive the gate deterministically
 */
export function createUpstreamGate(config = readGateConfig(), deps = {}) {
  const cfg = { ...GATE_DEFAULTS, ...config };
  const now = deps.now || Date.now;
  const schedule = deps.setTimeout || defaultSchedule;
  const cancel = deps.clearTimeout || clearTimeout;
  const onLeaseExpired = typeof deps.onLeaseExpired === "function" ? deps.onLeaseExpired : null;

  const waiters = [];
  let inFlight = 0;
  let nextStartAt = 0;
  let cooldownUntil = 0;
  let pumpTimer = null;
  const stats = {
    admitted: 0,
    delayed: 0,
    totalWaitMs: 0,
    maxWaitMs: 0,
    maxQueueDepth: 0,
    maxInFlight: 0,
    refused: 0,
    rateLimited: 0,
    cooldowns: 0,
    leaseExpired: 0
  };

  function admit(waiter, t) {
    if (waiter.timer) cancel(waiter.timer);
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    nextStartAt = t + cfg.minIntervalMs;
    const waitedMs = Math.max(0, t - waiter.enqueuedAt);
    stats.admitted += 1;
    if (waitedMs > 0) stats.delayed += 1;
    stats.totalWaitMs += waitedMs;
    stats.maxWaitMs = Math.max(stats.maxWaitMs, waitedMs);

    let released = false;
    let lease = null;
    const release = () => {
      if (released) return;
      released = true;
      if (lease) cancel(lease);
      inFlight -= 1;
      pump();
    };
    lease = schedule(() => {
      if (released) return;
      stats.leaseExpired += 1;
      if (onLeaseExpired) onLeaseExpired({ leaseMs: cfg.leaseMs });
      release();
    }, cfg.leaseMs);
    waiter.resolve({ ok: true, waitedMs, release });
  }

  function pump() {
    if (pumpTimer) {
      cancel(pumpTimer);
      pumpTimer = null;
    }
    while (waiters.length > 0 && inFlight < cfg.maxConcurrency) {
      const t = now();
      const startAt = Math.max(nextStartAt, cooldownUntil);
      if (t < startAt) {
        pumpTimer = schedule(pump, startAt - t);
        return;
      }
      admit(waiters.shift(), t);
    }
  }

  /**
   * Wait for a slot. Resolves `{ ok: true, waitedMs, release }` — call `release()`
   * exactly once when the request settles (extra calls are ignored) — or
   * `{ ok: false, waitedMs, reason: "queue_timeout" }` after `maxWaitMs`.
   */
  function acquire() {
    if (cfg.disabled) return Promise.resolve({ ok: true, waitedMs: 0, release: () => {} });
    return new Promise((resolve) => {
      const waiter = { resolve, enqueuedAt: now(), timer: null };
      waiter.timer = schedule(() => {
        const index = waiters.indexOf(waiter);
        if (index === -1) return;
        waiters.splice(index, 1);
        stats.refused += 1;
        resolve({ ok: false, waitedMs: Math.max(0, now() - waiter.enqueuedAt), reason: "queue_timeout" });
      }, cfg.maxWaitMs);
      waiters.push(waiter);
      stats.maxQueueDepth = Math.max(stats.maxQueueDepth, waiters.length);
      pump();
    });
  }

  /**
   * Record a provider rate-limit response: pause every admission for `cooldownMs`.
   * `startedCooldown` is true only for the rejection that opened the pause, so a
   * burst of rejections produces one log line, not one per request.
   */
  function noteRateLimited() {
    stats.rateLimited += 1;
    const t = now();
    const startedCooldown = cooldownUntil <= t;
    cooldownUntil = Math.max(cooldownUntil, t + cfg.cooldownMs);
    if (startedCooldown) stats.cooldowns += 1;
    return { startedCooldown, cooldownMs: cooldownUntil - t };
  }

  function snapshot() {
    return {
      ...stats,
      inFlight,
      queueDepth: waiters.length,
      cooldownRemainingMs: Math.max(0, cooldownUntil - now())
    };
  }

  return { acquire, noteRateLimited, snapshot, config: { ...cfg } };
}
