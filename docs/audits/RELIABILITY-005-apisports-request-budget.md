# RELIABILITY-005 — API-Sports Request Budget / Burst Protection

Date: 2026-09-11. Branch `fix/reliability-005-apisports-request-budget`, worktree `scratchpad\wt-r005`, based on `origin/main` `200815ab` (the RELIABILITY-004 deploy). **Implemented and verified locally. Not committed, pushed or deployed.**

Evidence labels: **[PROD]** verified from production · **[CODE]** verified from code · **[INF]** inferred · **[UNK]** unknown.

---

## 1. Production facts used as inputs

- **[PROD]** The provider advertises 300 requests/minute and 7500/day. It sends no `x-ratelimit-reset` and no `retry-after`.
- **[PROD]** It signals its limit as HTTP 200 + `errors.rateLimit` ("Too many requests. You have exceeded the limit of requests per minute of your subscription."). This was seen on `/fixtures`, `/fixtures/lineups`, `/fixtures/headtohead` and `/injuries`.
- **[PROD]** Rejections arrived while successful responses still reported `minuteRemaining` 143–192, clustered within milliseconds (three within 2 ms at 10:26:23.107–.109).
- **[PROD]** One burst: Predicts at 10:25:22 (27 calls, 0 errors), 10:25:40 (50 fixtures, 144 calls, 15 errors, 31.6 s) and 10:26:13 (46 fixtures, ≥300 calls, ≥15 errors, 45 s). Minute and daily counters fell in lockstep, about 160 calls in 16 s.
- **[PROD]** On 2026-09-10, 7126 of 7500 daily requests were used.
- **[UNK]** The provider's actual enforcement mechanism: burst, per-second, or another layer. Nothing below depends on knowing it.

## 2. Request-path audit (before any change)

| # | Question | Finding |
|---|---|---|
| A/B | Central wrapper | **[CODE]** Every API-Sports call goes through `getWithCache` in `server-utils/fetcher.js`. No other code builds a provider request. There are 13 caller files. |
| C | Where concurrency comes from | **[CODE]** Fixtures run **sequentially** (`runFixtureStageLoop`: league → fixture → stage `for` loops). Fan-out is **inside** each fixture: `moduleInputs.collectModuleInputs` runs 5 requests at once (h2h, injuries, lineups, recent form ×2) and `Stage02FeatureCollection` runs 2 (team statistics). The warm and cron paths are sequential `for` loops. |
| D | Concurrent predictors / dates | **[CODE]** The client sends one `/api/predict` request per date, sequentially. Separate users, crons and warm requests can overlap, within one Fluid Compute instance or across several. |
| E | Deduplication | **[CODE]** A per-process `inflight` map collapses identical concurrent reads by cache key. |
| F | Retries | **[CODE]** Only one existed: the fallback provider on "not subscribed". A rate limit was **never** retried. |
| G | Timeout | **[CODE]** None. The provider `fetch` has no `AbortController`. |
| H | Cache | **[CODE]** KV response cache with per-endpoint TTLs. Failures are never cached. |
| I | Logging | **[CODE]** `api.upstream_failed` / `api.upstream_exception` per failure, and `predict.timing` for slow Predicts. |
| J/K | Rate-limit handling | **[CODE]** `errors.rateLimit` was handled like any provider error by the generic `hasErrors` branch: `ok:false`, not cached, logged, **no pause**. Callers treat `ok:false` as "no data" (`return null`), so every rejection silently dropped that fixture's feature. Later requests kept hitting the provider during the same window. |
| — | Daily quota | **[CODE]** Already protected by `apiBudgetCircuit` (C10). It soft-stops at 80% (Predict falls back to DB only, warm skips team stats) and hard-stops at ≥95% or ≤80 calls left (`getWithCache` refuses to go upstream). |

## 3. Requirement

The goal isn't to guarantee exactly 300 calls/minute. It is to stop application bursts from overwhelming API-Sports, stay under the observed quota, and keep as much Predict throughput as reasonable. It must also stay functional when the provider answers HTTP 200 + `errors.rateLimit`.

## 4. Design — one process-local gate at the single call site

`server-utils/upstreamGate.js` is new, pure, and clock-injectable. `getWithCache` passes **every** provider fetch through it: the primary call, the one rate-limit retry, and the existing fallback. It runs after the cache read, the daily hard stop and in-flight dedupe, so none of those change.

| Control | Default | Why this value |
|---|---|---|
| Pacing: minimum gap between request **starts** | 250 ms (≤4/s, ≤240/min) | 80% of the advertised 300/min, the same 80% margin the daily circuit already uses. Spreading requests evenly also limits any single second to 4, which directly targets the observed millisecond clusters without knowing the provider's real mechanism **[INF]**. The first Predict (27 calls, about 1.6/s) had 0 errors; the bursts at about 10–16/s were rejected **[PROD]**. |
| Concurrency cap | 3 in flight | At about 115 ms p50 latency and 250 ms pacing, one or two are normally in flight. The cap only bounds slow-response pile-ups. |
| Queue wait, then local refusal | 30 s | The platform's default function timeout is 300 s **[INF: Vercel platform default; only the crons set `maxDuration`]**. A request that can't start within 30 s is refused locally (`ok:false`, `reason:"api_local_rate_limit"`, no provider call). Callers degrade exactly as they do for a provider failure, instead of hanging the function. |
| Slot lease | 20 s | The fetch has no timeout, so a hung request must not hold a slot forever. The lease frees the slot and leaves the request itself unchanged. |
| Provider rate-limit pause | 5 s | No Retry-After exists, so the pause is set by the application. It holds back **every** admission, not just the rejected endpoint, so the next requests don't land in the window that just rejected us. |
| Retry after `errors.rateLimit` | exactly 1, through the gate | Recovers data that would otherwise be silently missing. It can't loop, and it waits for the pause. |

All values can be changed through env vars and are clamped: `API_UPSTREAM_MIN_INTERVAL_MS`, `API_UPSTREAM_MAX_CONCURRENCY`, `API_UPSTREAM_MAX_WAIT_MS`, `API_UPSTREAM_LEASE_MS`, `API_UPSTREAM_RATE_LIMIT_COOLDOWN_MS`, and `API_UPSTREAM_GATE_DISABLED=1` as an emergency bypass. A typo can't set concurrency to 0 or wait forever. **These are starting values, not a proven safe threshold. One production burst doesn't establish one.**

**Why not "allow while `minuteRemaining > 0`":** production rejected requests at 143–192 remaining.

**Why not a KV-backed cross-instance token bucket:** it needs a KV round trip for every provider call (about 225k extra commands/month at the daily cap). That's on the Upstash store whose monthly command cap was exhausted on 2026-08-18, and it adds latency to every call.

**The limitation, stated plainly:** the gate is **process-local**. Each concurrent function instance has its own budget. Fan-out within one Predict, which is the observed burst source, is fully governed. Overlapping Predicts on **different** instances are not.

### Rate-limit handling
- **Detection** (`isProviderRateLimited`) is deliberately narrow: an `errors` **object** with a `rateLimit` key.
  - The daily quota (`errors.requests`) is **never** retried.
  - HTTP 429 was never observed from API-Sports and keeps its existing behaviour, a plain failure. A test pins this.
- A rejection opens the pause, retries once after it, and a second rejection returns the existing failure result.
- The `api.upstream_failed` log gains `retriedAfterRateLimit: true`, only when a retry happened.
- Rejections inside an open pause extend it but don't produce extra log lines.

### Daily quota
No new daily cutoff. The existing C10 circuit already refuses upstream calls at ≥95% or ≤80 calls left, and degrades Predict at 80%. That is the observed behaviour on a 95% day. Adding a second, uncoordinated daily threshold would change Predict semantics, which is out of scope.

### Duplicate reads (§10 — reported, not fixed)
- `predictHelpers.js:187` (`/fixtures {team, last}`) and `moduleInputs.js:140` (`/fixtures {team, last, league, season}`) fetch team form under different cache keys.
- Merging them would change which data reaches feature collection, so it stays a separate, approved-and-validated follow-up.
- Identical concurrent reads were already collapsed by `inflight`, and that still works (tested).

## 5. Observability — rare events only, throttled, no KV writes

| Event | When | Rate |
|---|---|---|
| `api.rate_limit_cooldown` | a provider rejection **opens** a pause | at most once per pause. Includes the §12 diagnostic and a gate snapshot (`inFlight`, `queueDepth`, `admitted`, `delayed`, `maxWaitMs`, `refused`) |
| `api.limiter_delayed` | one admission waited ≥ 2 s | throttled, 1 per 10 s, with a `suppressedSinceLast` count |
| `api.limiter_refused` | local refusal (queue wait exceeded) | throttled, 1 per 10 s |
| `api.limiter_lease_expired` | a slot was reclaimed from a hung request | throttled, 1 per 10 s |
| `api.upstream_failed` (existing) | `+ retriedAfterRateLimit` when a retry happened | unchanged otherwise |

`getUpstreamGateStats()` exposes the process counters for diagnostics. There's no `bumpCounter`: `/api/predict` runs outside an observation scope, where each call would be a KV read-modify-write. `Stage12Response` and `predict.timing` are unchanged.

### §12 — headers on rejected responses (decision)
We add a **minimal** diagnostic: the cooldown log includes `headerMinuteLimit`, `headerMinuteRemaining` and `headerDailyRemaining`. These are parsed from the **rejected** response by the existing `parseRateLimitHeaders`, as numbers only; `null` means the header was absent. It appears once per pause and never includes raw headers, keys or bodies. That settles, in production, whether rejections carry usable headers.

## 6. Tests

- **`tests/upstreamGate.test.js`** (11 cases, fake clock, deterministic): immediate admission, exact pacing, the concurrency cap, FIFO, cooldown and its extension, queue-timeout refusal, lease expiry without double-free, the disabled bypass, config clamping, the default staying ≤240/min, and narrow rate-limit detection.
- **`tests/fetcherUpstreamGate.test.js`** (8 cases, real `getWithCache` with scripted KV and fetch):
  - rejection → pause → one retry → payload returned and cached;
  - rejected twice → existing failure after exactly 2 calls, `retriedAfterRateLimit`, nothing cached, header `null` when absent;
  - daily `errors.requests` → 1 call, no pause;
  - the fan-out of 5 → peak ≤2 in flight with starts ≥ interval apart;
  - a pause on one endpoint holds back other endpoints;
  - cache hits bypass the gate even during a pause;
  - identical concurrent reads → 1 call;
  - stats exposed.
- Both files are registered in the existing `test:fetcher` script. No other script changed.

## 7. Validation (local, patched tree vs. the verified `200815ab` baseline)

| Check | Baseline | Patch |
|---|---|---|
| `eslint . --max-warnings 0` | PASS | **PASS** |
| Typecheck (`tsconfig.ci.json` + default) | PASS | **PASS** |
| `validate:pkg` | PASS | **PASS** |
| Node tests | 2634 / 0 | **2656 / 0** (+22, including 3 bare-process liveness tests added after the CI finding in §9a) |
| Vitest | 1882 / 1883 | **1882 / 1883**. The same pre-existing `primitives.guard.test.ts`, a Windows path false positive that passes on CI. |
| `test:fetcher` / `test:provider-telemetry` | — | **50/50 · 12/12** (the existing 429 and daily-quota tests are unchanged) |

## 8. Diff and isolation

```
M package.json                    (test:fetcher registers the two new files)
M server-utils/fetcher.js         (+124 / −3: import, gate + helpers, gated calls, retry, one log field)
A server-utils/upstreamGate.js
A tests/upstreamGate.test.js
A tests/fetcherUpstreamGate.test.js
A docs/audits/RELIABILITY-005-apisports-request-budget.md
```

Frozen-area intersection: **NONE**. That covers Predictor V3, every stage, prediction math, recommendation, settlement, history, snapshots, auth, referral, Model Lab, calibration, market logic, cron schedules (`vercel.json`), the schema and subscriptions. The cache keys and TTLs, the daily circuit, in-flight dedupe, usage telemetry and the `getWithCache` result shape are all unchanged. The one addition is `reason: "api_local_rate_limit"` on local refusals.

## 9. Independent review

An ECC adversarial review found **no correctness, security or state-corruption defect: DOES NOT BLOCK.** Two LOW findings are accepted as known tradeoffs:

1. **Latency.** A cold Predict with 150–300 upstream calls now carries a pacing floor of about 37.5–75 s, within the 300 s default. This is the deliberate price of not bursting. Cache hits aren't paced, so warm runs are barely affected.
2. **Shared queue.** Two concurrent Predicts on one warm instance share a queue. A request waiting behind more than about 120 others (30 s ÷ 250 ms) is refused locally, which degrades like a provider failure.

## 9a. CI finding on PR #249 and the fix

**What CI caught.** On PR #249 (commit `b3206bbb`), the required `test` check failed on both the push run and the PR run (Node 22). Every `fetcherUpstreamGate` case and 12 existing `fetcherUsageTelemetry` cases were cancelled with "Promise resolution is still pending but the event loop has already resolved".

**Root cause, reproduced locally in a bare Node process:** `defaultSchedule` unref'd **every** timer, including the pacing/pause timer that a waiting `acquire()` depends on.
- When a request had to wait for its slot and nothing else held the event loop open, Node exited with the request still pending (exit code 13, "unsettled top-level await").
- HTTP handlers keep the loop alive, so production functions were likely unaffected **[INF]**.
- Any script or test runner making consecutive calls was affected.
- Both earlier reviews missed this; one called the unref a strength.

**Fix, in two parts:**
1. Timers are now ref'd by default. The pacing/pause timer and the queue-wait timer stand for a caller that is still waiting. Only the lease timer passes `{ unref: true }`: it is a safety net, and an in-flight request already holds the loop open through its socket.
2. A focused review of fix 1 found a second, bounded defect **[HIGH, reproduced by the reviewer]**. When a waiter was refused at `maxWaitMs`, the pacing/pause timer scheduled for it stayed armed, now ref'd, and held the process open for up to `cooldownMs` or `minIntervalMs`. The refusal callback now calls `pump()`, which cancels that timer or reschedules it for any remaining waiter.

**Tests that pin both parts,** each running a bare Node subprocess with no test runner holding the loop:
- a waiting request survives pacing and a pause (it failed with exit 13 before the fix);
- a refused waiter leaves no armed timer (the process exits well before an 8 s pause);
- a held slot's lease timer alone doesn't keep the process alive.

A re-review of the final state: **FIX CORRECT: YES.** No other path leaves a ref'd timer running after all work is done (last admission, `release()` with nobody waiting, the disabled gate, `noteRateLimited()` with nobody waiting).

**Test-run note.** One local full run on this branch hit three 5 s timeouts in file-scanning design-system guards. That run overlapped with lint and the review, and every solo re-run was clean.

## 10. Risks and follow-ups

1. **Process-local scope** (see §4). Watch `api.rate_limit_cooldown` for rejections that happen while `inFlight` is low; that would point to cross-instance overlap.
2. **Tuning, after deploy, from real events:**
   - If cooldowns still occur, raise `API_UPSTREAM_MIN_INTERVAL_MS` or the cooldown.
   - If `api.limiter_refused` or `api.limiter_delayed` are frequent and cooldowns are zero, lower the interval.
   - Compare `predict.timing.totalMs` before and after.
3. The §12 header diagnostic will answer whether rejected responses carry headers.
4. Separate follow-ups: the duplicate team-form reads; HTTP 429 handling if RapidAPI fallback traffic ever shows it; a fetch timeout (the lease only frees the slot).

## 11. Status

Not committed, not pushed, no PR, not deployed. The next step is review, then a PR from this branch when you authorise it.
