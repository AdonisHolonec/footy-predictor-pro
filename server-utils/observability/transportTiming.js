import { AsyncLocalStorage } from "node:async_hooks";
import diagnosticsChannel from "node:diagnostics_channel";
import { PerformanceObserver, performance } from "node:perf_hooks";

import { logWarn } from "./logger.js";

/**
 * Where a Supabase request from the Vercel runtime actually spends its time.
 *
 * D3 attributed 12,434 ms of a 12,435 ms `dbReadMs` to `supabaseRequestMs` — the
 * awaited PostgREST call itself — while `supabaseClientMs` measured 0 ms and the
 * identical query answered in 0.33-0.63 s from outside the runtime. That closes
 * the query, the projection and client construction as suspects and leaves one
 * span unexplained: the HTTP request. This module splits it.
 *
 * MEASUREMENT ONLY. The wrapper this module installs is the INNERMOST fetch
 * layer: supabase-js applies auth and headers in `fetchWithAuth` and only then
 * calls the injected fetch, so the wrapper receives an already-prepared
 * (input, init) pair, forwards both untouched, and returns the Response object
 * itself. It never reads, clones or buffers the body — the response is consumed
 * exactly once, by supabase-js, as before.
 *
 * The phase split does NOT come from the wrapper. It comes from undici's
 * diagnostics channels and Node's `dns`/`net` performance entries, both of which
 * are pure observation: undici publishes what it was going to do anyway, and no
 * dispatcher, agent, pool or keep-alive setting is created or changed here. The
 * wrapper's only jobs are to bracket the call and to give the channel events
 * something to attach to.
 *
 * SAFE BY CONSTRUCTION. Only durations, counts and enums leave this module. The
 * request URL, its query string, the headers, the service-role key and the
 * response body are all in scope of the wrapper and none of them are recorded.
 */

export const SUPABASE_TRANSPORT_EVENT = "supabase.transport";

/**
 * A single Supabase request is not a whole invocation, so `SLOW_REQUEST_MS`
 * (8,000 ms) is the wrong bar here: it would only ever show the pathology and
 * never a healthy request to compare it against. 2,000 ms still sits far above
 * the 0.33-0.63 s external control, so a well-behaved request stays silent,
 * while the 2-8 s band D3 could not explain becomes visible.
 *
 * DIAGNOSTIC. Raise it once the transport phase is identified.
 */
export const SLOW_SUPABASE_REQUEST_MS = 2000;

/** Perf entries are process-wide; keep only a recent window of them. */
const PERF_BUFFER_LIMIT = 64;

const transportScope = new AsyncLocalStorage();

/** Requests currently in flight through the wrapper, awaiting an undici create. */
const openClaims = new Set();
/** undici request object -> our claim, for the headers/trailers/error events. */
const claimByRequest = new WeakMap();

/** Recent dns lookups and tcp connects, newest last. */
const dnsEntries = [];
const netEntries = [];

let subscribed = false;
/**
 * Whether an undici request event was ever actually seen. Subscribing proves
 * nothing — only a delivered event proves the global fetch really is undici's
 * and that the phases below are being measured rather than silently skipped.
 */
let sawUndiciEvent = false;

function now() {
  return performance.now();
}

function pushBounded(list, entry) {
  list.push(entry);
  if (list.length > PERF_BUFFER_LIMIT) list.splice(0, list.length - PERF_BUFFER_LIMIT);
}

/**
 * DNS and TCP are attributed by identity, not by guessing from a time window:
 * a `dns` entry carries the hostname it resolved and the addresses it returned,
 * and a `net` entry carries the address it connected to. Matching one to the
 * other gives an exact attribution even while other sockets are opening.
 */
function observePerfEntries() {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const detail = entry.detail || {};
      if (entry.entryType === "dns" && entry.name === "lookup") {
        pushBounded(dnsEntries, {
          at: entry.startTime,
          durationMs: entry.duration,
          hostname: String(detail.hostname || ""),
          addresses: Array.isArray(detail.addresses)
            ? detail.addresses.map((a) => String(a?.address || "")).filter(Boolean)
            : []
        });
      } else if (entry.entryType === "net" && entry.name === "connect") {
        pushBounded(netEntries, {
          at: entry.startTime,
          durationMs: entry.duration,
          host: String(detail.host || "")
        });
      }
    }
  });
  observer.observe({ entryTypes: ["dns", "net"] });
  // Never hold the process open for telemetry.
  if (typeof observer.unref === "function") observer.unref();
}

function claimFor(origin, path) {
  for (const claim of openClaims) {
    if (!claim.request && claim.origin === origin && claim.path === path) return claim;
  }
  return null;
}

/**
 * Connection establishment is published per-CONNECTION, not per-request: undici
 * gives `beforeConnect`/`connected` a `connectParams`, never a request object.
 * So a connect is attributed to every claim that was open, on that host, while
 * it happened — and a claim that saw more than one records the ambiguity rather
 * than picking one.
 */
function recordConnect(connectParams, field, value) {
  const host = String(connectParams?.hostname || connectParams?.host || "");
  for (const claim of openClaims) {
    if (claim.hostname && host && claim.hostname !== host) continue;
    if (claim[field] !== null) claim.connectEvents += 1;
    claim[field] = value;
  }
}

function subscribeOnce() {
  if (subscribed) return;
  subscribed = true;

  diagnosticsChannel.subscribe("undici:request:create", (message) => {
    const request = message?.request;
    if (!request) return;
    sawUndiciEvent = true;
    const claim = claimFor(String(request.origin || ""), String(request.path || ""));
    if (!claim) return;
    claim.request = request;
    claim.createdAt = now();
    claimByRequest.set(request, claim);
  });

  diagnosticsChannel.subscribe("undici:client:beforeConnect", (message) => {
    recordConnect(message?.connectParams, "beforeConnectAt", now());
  });

  diagnosticsChannel.subscribe("undici:client:connected", (message) => {
    recordConnect(message?.connectParams, "connectedAt", now());
  });

  diagnosticsChannel.subscribe("undici:client:connectError", (message) => {
    recordConnect(message?.connectParams, "connectErrorAt", now());
  });

  diagnosticsChannel.subscribe("undici:request:headers", (message) => {
    const claim = claimByRequest.get(message?.request);
    if (!claim) return;
    claim.headersAt = now();
    const status = Number(message?.response?.statusCode);
    if (Number.isFinite(status)) claim.status = status;
  });

  diagnosticsChannel.subscribe("undici:request:trailers", (message) => {
    const claim = claimByRequest.get(message?.request);
    if (!claim) return;
    claim.trailersAt = now();
  });

  diagnosticsChannel.subscribe("undici:request:error", (message) => {
    const claim = claimByRequest.get(message?.request);
    if (!claim) return;
    claim.transportError = true;
  });

  observePerfEntries();
}

/**
 * @returns {object} A per-invocation collector. Records accumulate as Supabase
 * requests complete; nothing is emitted from here.
 */
export function createTransportCollector(route = null) {
  return { route: route ? String(route) : null, records: [] };
}

/** Binds `collector` to the async context so the shared client can find it. */
export function withTransportScope(collector, fn) {
  return transportScope.run(collector, fn);
}

/** Exposed for tests: is a collector currently bound? */
export function hasActiveTransportScope() {
  return Boolean(transportScope.getStore());
}

function toMs(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const delta = to - from;
  if (!Number.isFinite(delta) || delta < 0) return null;
  return Math.round(delta);
}

/**
 * Turn one claim into the phase breakdown. A phase that was not observed is
 * absent, never zero and never estimated — an unmeasured DNS lookup and a
 * genuinely instant one must not read the same.
 */
function summarizeClaim(claim) {
  const out = {
    fetchTotalMs: claim.fetchTotalMs,
    requestTotalMs: claim.requestTotalMs
  };
  if (Number.isFinite(claim.status)) out.httpStatus = claim.status;
  if (claim.transportError) out.transportError = true;

  const connectMs = toMs(claim.beforeConnectAt, claim.connectedAt);
  if (connectMs !== null) out.connectMs = connectMs;

  // The distinction the phase turns on: undici opens a connection only when it
  // has none to reuse, so the ABSENCE of a connect event is itself the finding.
  if (claim.connectErrorAt !== null) out.connection = "error";
  else if (claim.beforeConnectAt !== null) out.connection = "new";
  else if (claim.createdAt !== null) out.connection = "reused";
  else out.connection = "unknown";
  if (claim.connectEvents > 0) out.connectAmbiguous = true;

  const dns = claim.hostname
    ? dnsEntries.filter((e) => e.hostname === claim.hostname && e.at >= claim.startedAt)
    : [];
  if (dns.length === 1) {
    out.dnsMs = Math.round(dns[0].durationMs);
    const addresses = new Set(dns[0].addresses);
    const net = netEntries.filter((e) => addresses.has(e.host) && e.at >= claim.startedAt);
    if (net.length === 1) out.tcpMs = Math.round(net[0].durationMs);
    else if (net.length > 1) out.tcpAmbiguous = true;
  } else if (dns.length > 1) {
    out.dnsAmbiguous = true;
  }

  // TLS is not published anywhere: it is what the connection span cost beyond
  // resolving the name and opening the socket. Derived, and labelled as such.
  if (out.connectMs !== undefined && out.dnsMs !== undefined && out.tcpMs !== undefined) {
    out.tlsMsDerived = Math.max(0, out.connectMs - out.dnsMs - out.tcpMs);
  }

  const ttfbMs = toMs(claim.createdAt, claim.headersAt);
  if (ttfbMs !== null) out.ttfbMs = ttfbMs;
  const bodyMs = toMs(claim.headersAt, claim.trailersAt);
  if (bodyMs !== null) out.bodyMs = bodyMs;

  return out;
}

/**
 * The transport fields for an invocation, or null when it made no Supabase
 * request. The SLOWEST request is reported rather than the first: an invocation
 * that reads twice is explained by its dominant read, not by whichever happened
 * to go first.
 */
export function summarizeTransport(collector) {
  const records = collector?.records;
  if (!Array.isArray(records) || records.length === 0) return null;
  const slowest = records.reduce((worst, r) => (r.fetchTotalMs > worst.fetchTotalMs ? r : worst), records[0]);
  const out = { ...slowest };
  if (records.length > 1) out.supabaseRequests = records.length;
  return out;
}

/**
 * The runtime facts the phase asks for. Read, never derived: which Node this is,
 * whether a global fetch exists, and whether undici actually delivered an event
 * — because every channel above is undici's, and on any other fetch
 * implementation the phases would silently be absent rather than wrong.
 */
export function describeRuntime() {
  return {
    nodeVersion: String(process.version || ""),
    globalFetch: typeof globalThis.fetch === "function",
    undiciObserved: sawUndiciEvent
  };
}

function emitIfSlow(summary, route, slowMs) {
  if (!summary || summary.fetchTotalMs < slowMs) return;
  logWarn(SUPABASE_TRANSPORT_EVENT, { ...summary, route: route || "unscoped", ...describeRuntime() });
}

/**
 * Register a request the channel subscribers can attach to, or null when the
 * input is a shape we cannot parse — measuring nothing is always preferable to
 * throwing on the hot path.
 */
function openClaimFor(input, hostname) {
  let url;
  try {
    url = new URL(typeof input === "string" ? input : (input?.url ?? String(input)));
  } catch {
    return null;
  }
  const claim = {
    origin: url.origin,
    path: `${url.pathname}${url.search}`,
    hostname: hostname || url.hostname,
    startedAt: now(),
    request: null,
    createdAt: null,
    beforeConnectAt: null,
    connectedAt: null,
    connectErrorAt: null,
    headersAt: null,
    trailersAt: null,
    connectEvents: 0,
    status: null,
    transportError: false,
    fetchTotalMs: 0,
    requestTotalMs: 0
  };
  openClaims.add(claim);
  return claim;
}

/** Retire a claim, record it against the active scope, and emit if it was slow. */
function closeClaim(claim, slowMs) {
  openClaims.delete(claim);
  try {
    claim.requestTotalMs = Math.round(now() - claim.startedAt);
    const summary = summarizeClaim(claim);
    const collector = transportScope.getStore();
    if (collector && Array.isArray(collector.records)) collector.records.push(summary);
    emitIfSlow(summary, collector?.route, slowMs);
  } catch {
    /* telemetry must never break the request it is measuring */
  }
}

/**
 * Wrap `baseFetch` so a Supabase request can be attributed to transport phases.
 *
 * The wrapper forwards `input` and `init` by reference and returns the Response
 * untouched: no URL rewriting, no header mutation, no retry, no timeout, no
 * cache option, no body access. Instrumentation runs in try/catch so a failure
 * to MEASURE a request can never fail the request.
 *
 * `slowMs` exists so the emit threshold can be exercised without a test that
 * genuinely blocks for two seconds; production passes nothing and gets
 * SLOW_SUPABASE_REQUEST_MS.
 */
export function instrumentFetch(baseFetch, { hostname = "", slowMs = SLOW_SUPABASE_REQUEST_MS } = {}) {
  const fetchImpl = typeof baseFetch === "function" ? baseFetch : globalThis.fetch;
  subscribeOnce();

  return async function instrumentedFetch(input, init) {
    const claim = openClaimFor(input, hostname);
    const startedAt = now();
    try {
      const response = await fetchImpl(input, init);
      if (claim) claim.fetchTotalMs = Math.round(now() - startedAt);
      return response;
    } catch (error) {
      if (claim) {
        claim.fetchTotalMs = Math.round(now() - startedAt);
        claim.transportError = true;
      }
      throw error;
    } finally {
      if (claim) closeClaim(claim, slowMs);
    }
  };
}

export default {
  SUPABASE_TRANSPORT_EVENT,
  SLOW_SUPABASE_REQUEST_MS,
  createTransportCollector,
  withTransportScope,
  hasActiveTransportScope,
  summarizeTransport,
  describeRuntime,
  instrumentFetch
};
