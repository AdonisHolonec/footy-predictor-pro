import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  SUPABASE_TRANSPORT_EVENT,
  createTransportCollector,
  describeRuntime,
  instrumentFetch,
  summarizeTransport,
  withTransportScope
} from "../server-utils/observability/transportTiming.js";

/**
 * The fetch wrapper must be invisible to the request it measures.
 *
 * D3 proved the 9-39 s lives inside the awaited PostgREST call: 12,434 ms of a
 * 12,435 ms `dbReadMs`, with client construction at 0 ms and the same query
 * answering in 0.33-0.63 s from outside the runtime. Splitting that span means
 * putting code on the hot path of every Supabase read the product makes, so the
 * wrapper's contract is stricter than its measurements: same arguments, same
 * response object, same number of calls, same failures.
 *
 * The phase tests run against a real loopback server rather than a stub,
 * because the phases do not come from the wrapper at all — they come from
 * undici's diagnostics channels, and a stub would prove nothing about whether
 * those channels actually fire.
 */

/** Silences and captures the structured warn lines the emitter writes. */
function captureWarnings(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (text) => lines.push(String(text));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.warn = original;
    })
    .then(() => lines);
}

function parseEvents(lines, event) {
  return lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.event === event);
}

/** A loopback PostgREST stand-in: real sockets, real undici, no network. */
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * undici hands a finished socket back to its pool on a later event-loop turn,
 * not in the microtask chain that resolves `.json()`. A second request issued
 * without yielding therefore finds no idle connection and opens another —
 * measured here, not assumed: after a cold connect, a microtask still reads NEW
 * while a macrotask reads REUSED. Real callers are never that tight (supabase-js
 * parses, maps and returns between reads), so yielding once reproduces ordinary
 * spacing rather than papering over anything.
 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const okServer = (_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify([{ validation: "win" }]));
};

/* -- the wrapper is transparent --------------------------------------------- */

test("the wrapper forwards input and init to the underlying fetch untouched", async () => {
  const seen = [];
  const init = { method: "GET", headers: { apikey: "secret-key", authorization: "Bearer secret" } };
  const fetchImpl = async (input, opts) => {
    seen.push({ input, opts });
    return new Response("[]", { status: 200 });
  };

  const wrapped = instrumentFetch(fetchImpl, { hostname: "db.example.co" });
  await wrapped("https://db.example.co/rest/v1/predictions_history?select=validation", init);

  assert.equal(seen.length, 1, "exactly one underlying call");
  assert.equal(seen[0].input, "https://db.example.co/rest/v1/predictions_history?select=validation");
  // Identity, not deep equality: a copied init would be a different object and
  // could silently drop a property the SDK set.
  assert.equal(seen[0].opts, init, "init must be passed by reference, unmodified");
  assert.deepEqual(Object.keys(init).sort(), ["headers", "method"], "no key added to init");
  assert.deepEqual(Object.keys(init.headers).sort(), ["apikey", "authorization"], "headers untouched");
});

test("the wrapper returns the very same Response object", async () => {
  const response = new Response("[]", { status: 200 });
  const wrapped = instrumentFetch(async () => response, { hostname: "db.example.co" });

  const out = await wrapped("https://db.example.co/rest/v1/x");

  assert.equal(out, response, "the caller must receive the original Response");
  assert.equal(out.bodyUsed, false, "the wrapper must not consume the body");
});

test("the body is still readable exactly once, by the caller", async () => {
  const wrapped = instrumentFetch(async () => new Response(JSON.stringify([{ validation: "win" }])), {
    hostname: "db.example.co"
  });

  const out = await wrapped("https://db.example.co/rest/v1/x");
  const parsed = await out.json();

  assert.deepEqual(parsed, [{ validation: "win" }], "response parsing is unchanged");
});

test("a failure propagates unchanged and is not retried", async () => {
  let calls = 0;
  const failure = new TypeError("fetch failed");
  const wrapped = instrumentFetch(async () => {
    calls += 1;
    throw failure;
  }, { hostname: "db.example.co" });

  await assert.rejects(() => wrapped("https://db.example.co/rest/v1/x"), (error) => error === failure);
  assert.equal(calls, 1, "the wrapper must never retry");
});

test("a non-2xx response is passed through, not turned into a throw", async () => {
  const wrapped = instrumentFetch(async () => new Response("{}", { status: 500 }), {
    hostname: "db.example.co"
  });

  const out = await wrapped("https://db.example.co/rest/v1/x");

  assert.equal(out.status, 500, "error-status handling belongs to supabase-js");
});

test("an unparseable input does not break the request", async () => {
  // The wrapper must degrade to measuring nothing rather than throwing on a
  // shape it did not anticipate.
  const wrapped = instrumentFetch(async () => new Response("[]"), { hostname: "db.example.co" });
  const out = await wrapped("not a url");
  assert.equal(out.status, 200);
});

/* -- what gets measured ----------------------------------------------------- */

test("a real request records the phases undici publishes", async () => {
  await withServer(okServer, async (origin) => {
    const collector = createTransportCollector("/api/history");
    const wrapped = instrumentFetch(undefined, { hostname: "127.0.0.1" });

    await withTransportScope(collector, async () => {
      const res = await wrapped(`${origin}/rest/v1/predictions_history?select=validation`);
      await res.json();
    });

    const summary = summarizeTransport(collector);
    assert.ok(summary, "a request inside a scope must be collected");
    assert.equal(summary.httpStatus, 200);
    assert.equal(typeof summary.ttfbMs, "number", "time to first byte must be observed");
    assert.equal(typeof summary.bodyMs, "number", "body transfer must be observed");
    assert.equal(typeof summary.fetchTotalMs, "number");
    assert.ok(summary.requestTotalMs >= summary.fetchTotalMs);
  });
});

test("a fresh connection reads as new and a second request reads as reused", async () => {
  await withServer(okServer, async (origin) => {
    const wrapped = instrumentFetch(undefined, { hostname: "127.0.0.1" });
    const first = createTransportCollector("/api/history");
    const second = createTransportCollector("/api/history");

    await withTransportScope(first, async () => {
      const res = await wrapped(`${origin}/rest/v1/a`);
      await res.json();
    });
    await settle();
    await withTransportScope(second, async () => {
      const res = await wrapped(`${origin}/rest/v1/b`);
      await res.json();
    });

    // The distinction the whole phase turns on: undici opens a socket only when
    // it has none to reuse, so "no connect event" is a finding, not a gap.
    assert.equal(summarizeTransport(first).connection, "new");
    assert.equal(summarizeTransport(second).connection, "reused");
  });
});

test("a reused connection reports no connection phases at all", async () => {
  await withServer(okServer, async (origin) => {
    const wrapped = instrumentFetch(undefined, { hostname: "127.0.0.1" });
    await wrapped(`${origin}/rest/v1/warm`).then((r) => r.json());
    await settle();

    const collector = createTransportCollector("/api/history");
    await withTransportScope(collector, async () => {
      const res = await wrapped(`${origin}/rest/v1/again`);
      await res.json();
    });

    const summary = summarizeTransport(collector);
    assert.equal(summary.connection, "reused");
    // Absent, not zero: nothing connected, so there is no duration to report.
    assert.equal(summary.connectMs, undefined);
    assert.equal(summary.tlsMsDerived, undefined);
  });
});

test("plain HTTP reports no derived TLS time", async () => {
  await withServer(okServer, async (origin) => {
    const collector = createTransportCollector("/api/history");
    const wrapped = instrumentFetch(undefined, { hostname: "127.0.0.1" });
    await withTransportScope(collector, async () => {
      const res = await wrapped(`${origin}/rest/v1/x`);
      await res.json();
    });

    // A handshake that never happened must not surface as 0 ms of handshake.
    assert.equal(summarizeTransport(collector).tlsMsDerived, undefined);
  });
});

test("phases that the stub never produces stay absent rather than zero", async () => {
  const collector = createTransportCollector("/api/history");
  const wrapped = instrumentFetch(async () => new Response("[]"), { hostname: "db.example.co" });

  await withTransportScope(collector, () => wrapped("https://db.example.co/rest/v1/x"));

  const summary = summarizeTransport(collector);
  // No undici involved, so there is nothing to report but the bracket.
  assert.equal(summary.connection, "unknown");
  for (const phase of ["dnsMs", "tcpMs", "tlsMsDerived", "ttfbMs", "bodyMs", "connectMs"]) {
    assert.equal(summary[phase], undefined, `${phase} must be UNKNOWN, not 0`);
  }
});

test("the slowest of several requests is the one reported", async () => {
  const collector = createTransportCollector("/api/history");
  const delays = [0, 40, 5];
  const wrapped = instrumentFetch(async (input) => {
    const ms = delays[Number(new URL(input).searchParams.get("i"))];
    await new Promise((r) => setTimeout(r, ms));
    return new Response("[]");
  }, { hostname: "db.example.co" });

  await withTransportScope(collector, async () => {
    for (let i = 0; i < delays.length; i += 1) await wrapped(`https://db.example.co/rest/v1/x?i=${i}`);
  });

  const summary = summarizeTransport(collector);
  assert.equal(summary.supabaseRequests, 3, "the count of reads must survive");
  assert.ok(summary.fetchTotalMs >= 30, `the dominant read must be the one reported (got ${summary.fetchTotalMs})`);
});

test("an invocation that made no Supabase request summarizes to nothing", () => {
  assert.equal(summarizeTransport(createTransportCollector("/api/history")), null);
  assert.equal(summarizeTransport(null), null);
  assert.equal(summarizeTransport({}), null);
});

test("a request outside any scope still runs and is simply not collected", async () => {
  const wrapped = instrumentFetch(async () => new Response("[]"), { hostname: "db.example.co" });
  const out = await wrapped("https://db.example.co/rest/v1/x");
  assert.equal(out.status, 200);
});

/* -- the claim registry must not accumulate ghosts --------------------------- */

test("a finished request stops matching, so the next one gets its own events", async () => {
  /*
    Claims wait in a shared registry for the undici event that identifies them.
    A request that never produces one — a stub, a DNS failure, an abort — would
    sit there forever if it were not retired, and because it is matched on
    origin and path it would then intercept the NEXT identical request's create
    event. That request would report `connection: "unknown"` and no first byte,
    on a warm Vercel instance that serves the same URL over and over.
  */
  await withServer(okServer, async (origin) => {
    const url = `${origin}/rest/v1/predictions_history?select=validation`;

    // A stubbed call: same origin and path, but undici never sees it.
    await instrumentFetch(async () => new Response("[]"), { hostname: "127.0.0.1" })(url);

    const collector = createTransportCollector("/api/history");
    await withTransportScope(collector, async () => {
      const res = await instrumentFetch(undefined, { hostname: "127.0.0.1" })(url);
      await res.json();
    });

    const summary = summarizeTransport(collector);
    assert.equal(typeof summary.ttfbMs, "number", "the real request must claim its own undici events");
    assert.notEqual(summary.connection, "unknown");
  });
});

test("a connection to another host is not attributed to a Supabase request", async () => {
  /*
    `beforeConnect` carries a host, never a request, so attribution is by host.
    The product opens sockets to Upstash and to the football API from the same
    instance; if one of those were counted here, the phase's headline finding —
    whether Supabase connections are being reused — would be read off the wrong
    socket entirely.
  */
  await withServer(okServer, async (loopback) => {
    const collector = createTransportCollector("/api/history");
    const wrapped = instrumentFetch(async () => {
      // A genuine cold connect to a DIFFERENT host, while this claim is open.
      await fetch(`${loopback}/unrelated`).then((r) => r.json());
      return new Response("[]");
    }, { hostname: "db.example.co" });

    await withTransportScope(collector, () => wrapped("https://db.example.co/rest/v1/x"));

    const summary = summarizeTransport(collector);
    assert.equal(summary.connection, "unknown", "another host's socket is not this request's");
    assert.equal(summary.connectMs, undefined);
  });
});

/* -- what gets logged ------------------------------------------------------- */

test("a fast request logs nothing", async () => {
  const wrapped = instrumentFetch(async () => new Response("[]"), {
    hostname: "db.example.co",
    slowMs: 2000
  });

  const lines = await captureWarnings(() => wrapped("https://db.example.co/rest/v1/x"));

  assert.equal(parseEvents(lines, SUPABASE_TRANSPORT_EVENT).length, 0);
});

test("a slow request logs one transport event carrying the route", async () => {
  const collector = createTransportCollector("/api/history");
  const wrapped = instrumentFetch(async () => new Response("[]"), {
    hostname: "db.example.co",
    slowMs: 0
  });

  const lines = await captureWarnings(() =>
    withTransportScope(collector, () => wrapped("https://db.example.co/rest/v1/x"))
  );

  const events = parseEvents(lines, SUPABASE_TRANSPORT_EVENT);
  assert.equal(events.length, 1, "exactly one event per slow request");
  assert.equal(events[0].route, "/api/history");
  assert.equal(events[0].level, "warn");
});

test("a slow request outside a route scope is still attributed, as unscoped", async () => {
  const wrapped = instrumentFetch(async () => new Response("[]"), {
    hostname: "db.example.co",
    slowMs: 0
  });

  const lines = await captureWarnings(() => wrapped("https://db.example.co/rest/v1/x"));

  // This is how /api/fixtures gets covered without touching /api/fixtures.
  assert.equal(parseEvents(lines, SUPABASE_TRANSPORT_EVENT)[0].route, "unscoped");
});

test("the event carries no URL, no query, no headers, no credentials, no rows", async () => {
  const collector = createTransportCollector("/api/history");
  const wrapped = instrumentFetch(
    async () => new Response(JSON.stringify([{ validation: "win", recommended_pick: "over 2.5" }])),
    { hostname: "db.example.co", slowMs: 0 }
  );

  const lines = await captureWarnings(() =>
    withTransportScope(collector, async () => {
      const res = await wrapped(
        "https://db.example.co/rest/v1/predictions_history?select=validation&kickoff_at=gte.2026-01-01",
        { headers: { apikey: "sb_secret_LEAKME", authorization: "Bearer eyJhbGciOi.LEAKME" } }
      );
      await res.json();
    })
  );

  const serialized = JSON.stringify(parseEvents(lines, SUPABASE_TRANSPORT_EVENT));
  for (const forbidden of [
    "LEAKME",
    "eyJ",
    "sb_secret",
    "apikey",
    "authorization",
    "over 2.5",
    "predictions_history",
    "kickoff_at",
    "db.example.co"
  ]) {
    assert.equal(serialized.includes(forbidden), false, `"${forbidden}" must never reach a log line`);
  }
});

test("a transport failure is recorded and logged without the error message", async () => {
  const collector = createTransportCollector("/api/history");
  const wrapped = instrumentFetch(async () => {
    throw new TypeError("connect ETIMEDOUT 11.22.33.44:5432");
  }, { hostname: "db.example.co", slowMs: 0 });

  const lines = await captureWarnings(async () => {
    await withTransportScope(collector, () => wrapped("https://db.example.co/rest/v1/x")).catch(() => null);
  });

  const event = parseEvents(lines, SUPABASE_TRANSPORT_EVENT)[0];
  assert.equal(event.transportError, true, "the failure must be visible");
  assert.equal(JSON.stringify(event).includes("11.22.33.44"), false, "but the address must not be");
  assert.equal(summarizeTransport(collector).transportError, true);
});

/* -- runtime facts ---------------------------------------------------------- */

test("the runtime is reported, not assumed", async () => {
  await withServer(okServer, async (origin) => {
    const wrapped = instrumentFetch(undefined, { hostname: "127.0.0.1" });
    await wrapped(`${origin}/rest/v1/x`).then((r) => r.json());

    const runtime = describeRuntime();
    assert.match(runtime.nodeVersion, /^v\d+\./, "the Node version must be read from the process");
    assert.equal(runtime.globalFetch, true);
    // Subscribing proves nothing; a delivered event proves the global fetch is
    // undici's and that the phases above are real measurements.
    assert.equal(runtime.undiciObserved, true);
  });
});
