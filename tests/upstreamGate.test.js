import test from "node:test";
import assert from "node:assert/strict";

/**
 * RELIABILITY-005 — the upstream gate in isolation, on a fake clock.
 *
 * Every timing property is asserted against injected time, never wall time, so
 * these tests are exact and cannot flake on a slow CI runner.
 */

const { GATE_DEFAULTS, createUpstreamGate, isProviderRateLimited, readGateConfig } = await import(
  "../server-utils/upstreamGate.js"
);

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Deterministic clock + timers: `advance(ms)` fires due timers in order. */
function fakeClock() {
  let t = 1_000_000;
  let seq = 0;
  const timers = [];
  return {
    now: () => t,
    setTimeout: (fn, ms) => {
      const timer = { at: t + Math.max(0, ms), fn, seq: seq++, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (timer) timer.cleared = true;
    },
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = timers
          .filter((x) => !x.cleared && x.at <= target)
          .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        due.cleared = true;
        t = due.at;
        due.fn();
        await flush();
      }
      t = target;
      await flush();
    }
  };
}

function gateWith(config, clock = fakeClock()) {
  const gate = createUpstreamGate({ ...GATE_DEFAULTS, ...config }, clock);
  return { gate, clock };
}

/** Tracks when a pending acquire settles, without awaiting it. */
function track(promise) {
  const state = { settled: false, value: undefined };
  promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

test("an idle gate admits immediately", async () => {
  const { gate } = gateWith({ minIntervalMs: 250 });
  const slot = await gate.acquire();
  assert.equal(slot.ok, true);
  assert.equal(slot.waitedMs, 0);
  slot.release();
});

test("pacing: the next start waits exactly minIntervalMs after the previous start", async () => {
  const { gate, clock } = gateWith({ minIntervalMs: 250, maxConcurrency: 10 });
  const first = await gate.acquire();
  const second = track(gate.acquire());
  await flush();
  assert.equal(second.settled, false);
  await clock.advance(249);
  assert.equal(second.settled, false, "never early");
  await clock.advance(1);
  assert.equal(second.settled, true);
  assert.equal(second.value.waitedMs, 250);
  first.release();
  second.value.release();
});

test("concurrency: a request beyond maxConcurrency waits for a release", async () => {
  const { gate, clock } = gateWith({ minIntervalMs: 0, maxConcurrency: 2 });
  const a = await gate.acquire();
  const b = await gate.acquire();
  const c = track(gate.acquire());
  await clock.advance(10_000 - 1);
  assert.equal(c.settled, false, "a full gate never admits by time alone");
  assert.equal(gate.snapshot().inFlight, 2);
  a.release();
  await flush();
  assert.equal(c.settled, true);
  assert.equal(gate.snapshot().maxInFlight, 2);
  b.release();
  c.value.release();
});

test("admission is first-in, first-out", async () => {
  const { gate, clock } = gateWith({ minIntervalMs: 100, maxConcurrency: 10 });
  const order = [];
  const slots = ["a", "b", "c", "d"].map((label) =>
    gate.acquire().then((slot) => {
      order.push(label);
      return slot;
    })
  );
  await clock.advance(1_000);
  assert.deepEqual(order, ["a", "b", "c", "d"]);
  for (const slot of await Promise.all(slots)) slot.release();
});

test("a provider rate limit pauses every admission for cooldownMs, and only the first opens the pause", async () => {
  const { gate, clock } = gateWith({ minIntervalMs: 0, cooldownMs: 5_000 });
  assert.deepEqual(gate.noteRateLimited(), { startedCooldown: true, cooldownMs: 5_000 });
  await clock.advance(1_000);
  // A rejection inside the pause extends it to 1000 + 5000 = 6000 from the start.
  assert.equal(gate.noteRateLimited().startedCooldown, false, "a rejection inside the pause does not open a new one");
  const pending = track(gate.acquire());
  await clock.advance(4_999);
  assert.equal(pending.settled, false, "held until the (extended) pause ends");
  await clock.advance(1);
  assert.equal(pending.settled, true);
  const snap = gate.snapshot();
  assert.equal(snap.rateLimited, 2);
  assert.equal(snap.cooldowns, 1);
  pending.value.release();
});

test("a request that cannot be admitted within maxWaitMs is refused, and does not block the queue", async () => {
  const { gate, clock } = gateWith({ minIntervalMs: 0, maxConcurrency: 1, maxWaitMs: 1_000 });
  const holder = await gate.acquire();
  const starved = track(gate.acquire());
  await clock.advance(1_000);
  assert.equal(starved.settled, true);
  assert.deepEqual(starved.value, { ok: false, waitedMs: 1_000, reason: "queue_timeout" });
  assert.equal(gate.snapshot().refused, 1);
  assert.equal(gate.snapshot().queueDepth, 0);
  holder.release();
  const next = await gate.acquire();
  assert.equal(next.ok, true, "the refused waiter left no residue");
  next.release();
});

test("an expired lease frees its slot once; a late release cannot double-free", async () => {
  const expired = [];
  const clock = fakeClock();
  const gate = createUpstreamGate(
    { ...GATE_DEFAULTS, minIntervalMs: 0, maxConcurrency: 1, leaseMs: 2_000, maxWaitMs: 60_000 },
    { ...clock, onLeaseExpired: (info) => expired.push(info) }
  );
  const hung = await gate.acquire();
  const next = track(gate.acquire());
  await clock.advance(2_000);
  assert.equal(next.settled, true, "the hung request's slot was reclaimed");
  assert.equal(gate.snapshot().leaseExpired, 1);
  assert.deepEqual(expired, [{ leaseMs: 2_000 }]);
  hung.release();
  assert.equal(gate.snapshot().inFlight, 1, "the late release did not free the new holder's slot");
  next.value.release();
  next.value.release();
  assert.equal(gate.snapshot().inFlight, 0, "release is idempotent");
});

test("a disabled gate admits everything immediately", async () => {
  const { gate } = gateWith({ disabled: true, maxConcurrency: 1, minIntervalMs: 10_000 });
  const slots = await Promise.all([gate.acquire(), gate.acquire(), gate.acquire()]);
  assert.ok(slots.every((s) => s.ok && s.waitedMs === 0));
});

test("config: defaults, clamping and the emergency bypass", () => {
  assert.deepEqual(readGateConfig({}), { ...GATE_DEFAULTS });
  const clamped = readGateConfig({
    API_UPSTREAM_MIN_INTERVAL_MS: "-5",
    API_UPSTREAM_MAX_CONCURRENCY: "0",
    API_UPSTREAM_MAX_WAIT_MS: "999999",
    API_UPSTREAM_LEASE_MS: "not-a-number",
    API_UPSTREAM_RATE_LIMIT_COOLDOWN_MS: "   ",
    API_UPSTREAM_GATE_DISABLED: "1"
  });
  assert.equal(clamped.minIntervalMs, 0);
  assert.equal(clamped.maxConcurrency, 1, "concurrency can never reach zero");
  assert.equal(clamped.maxWaitMs, 120_000);
  assert.equal(clamped.leaseMs, GATE_DEFAULTS.leaseMs);
  assert.equal(clamped.cooldownMs, GATE_DEFAULTS.cooldownMs);
  assert.equal(clamped.disabled, true);
});

test("the default target stays below the advertised provider limit", () => {
  const perMinute = 60_000 / GATE_DEFAULTS.minIntervalMs;
  assert.ok(perMinute <= 240, `default pacing allows ${perMinute}/min; must stay <= 80% of 300`);
});

test("rate-limit detection matches only the observed per-minute signal", () => {
  const minute = { errors: { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." } };
  assert.equal(isProviderRateLimited(minute), true);
  // The DAILY quota must never be treated as a retryable minute limit.
  assert.equal(isProviderRateLimited({ errors: { requests: "You have reached the request limit for the day" } }), false);
  assert.equal(isProviderRateLimited({ errors: [] }), false);
  assert.equal(isProviderRateLimited({ errors: ["rateLimit"] }), false);
  assert.equal(isProviderRateLimited({ errors: "rateLimit" }), false);
  assert.equal(isProviderRateLimited({ response: [] }), false);
  assert.equal(isProviderRateLimited(null), false);
});
