// /api/fixtures?view=leagues — full league catalog for „Selectează ligi”.
// One shared-cache upstream call (/leagues?current=true, 24h), trimmed + deduped + sorted.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const fetcherOrig = await import("../server-utils/fetcher.js");
const rlOrig = await import("../server-utils/anonymousRateLimit.js");

const upstreamCalls = [];
let upstreamResult = null;
mock.module("../server-utils/fetcher.js", {
  namedExports: {
    ...fetcherOrig,
    getWithCache: async (endpoint, params, ttl) => {
      upstreamCalls.push({ endpoint, params, ttl });
      return upstreamResult;
    }
  }
});
mock.module("../server-utils/anonymousRateLimit.js", {
  namedExports: { ...rlOrig, checkAnonymousRateLimit: async () => ({ ok: true }) }
});

const { default: handler } = await import("../api/fixtures.js");

function fakeRes() {
  return {
    statusCode: null, payload: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  };
}
const row = (id, name, country, type = "League", logo = `https://media/${id}.png`) => ({ league: { id, name, type, logo }, country: { name: country } });

test("view=leagues: one cached /leagues?current=true call, 24h TTL, trimmed/deduped/sorted payload", async () => {
  upstreamCalls.length = 0;
  upstreamResult = {
    ok: true, fromCache: false,
    data: { response: [row(351, "Super League", "Zambia"), row(39, "Premier League", "England"), row(39, "Premier League", "England"), row(5, "UEFA Nations League", "World", "Cup"), { league: { id: "x" } }, row(218, "Bundesliga", "Austria")] }
  };
  const res = fakeRes();
  await handler({ method: "GET", query: { view: "leagues" }, headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(upstreamCalls, [{ endpoint: "/leagues", params: { current: "true" }, ttl: 86400 }]);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.count, 4, "duplicate 39 collapsed, invalid id dropped");
  assert.deepEqual(res.payload.leagues.map((l) => l.id), [218, 39, 351, 5], "alphabetical by name");
  assert.deepEqual(Object.keys(res.payload.leagues[0]).sort(), ["country", "id", "logo", "name", "type"], "trimmed shape only");
  assert.equal(res.payload.leagues.find((l) => l.id === 5).type, "Cup");
  assert.match(res.headers["cache-control"], /max-age=3600/);
});

test("view=leagues: upstream failure surfaces as an error status, never an empty catalog", async () => {
  upstreamCalls.length = 0;
  upstreamResult = { ok: false, status: 429, data: null };
  const res = fakeRes();
  await handler({ method: "GET", query: { view: "leagues" }, headers: {}, socket: {} }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.payload.ok, false);
  assert.equal(upstreamCalls.length, 1);
});
