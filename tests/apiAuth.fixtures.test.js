import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostAllowlisted,
  hostnameFromBaseUrl,
  resolveTrustedAppOrigin,
  buildInternalApiUrl,
  corsOriginIfAllowed
} from "../server-utils/publicBaseUrl.js";

test("hostnameFromBaseUrl parses https and bare hosts", () => {
  assert.equal(hostnameFromBaseUrl("https://footy-predictor-pro.vercel.app"), "footy-predictor-pro.vercel.app");
  assert.equal(hostnameFromBaseUrl("footy.example.com"), "footy.example.com");
  assert.equal(hostnameFromBaseUrl(""), null);
});

test("assertHostAllowlisted rejects unknown hosts", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://footy-predictor-pro.vercel.app";
  assert.equal(assertHostAllowlisted("footy-predictor-pro.vercel.app").ok, true);
  assert.equal(assertHostAllowlisted("evil.com").ok, false);
  assert.equal(assertHostAllowlisted("evil.com/@x").ok, false);
  process.env.PUBLIC_BASE_URL = prev;
});

test("resolveTrustedAppOrigin never uses forged Host in production", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevVercel = process.env.VERCEL_ENV;
  const prevPublic = process.env.PUBLIC_BASE_URL;
  const prevApp = process.env.APP_BASE_URL;
  const prevVercelUrl = process.env.VERCEL_URL;

  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_BASE_URL;
  delete process.env.VERCEL_URL;

  const forged = {
    headers: {
      host: "evil.com",
      "x-forwarded-host": "evil.com",
      "x-forwarded-proto": "https"
    }
  };
  const failed = resolveTrustedAppOrigin(forged);
  assert.equal(failed.ok, false);

  process.env.PUBLIC_BASE_URL = "https://footy-predictor-pro.vercel.app";
  const ok = resolveTrustedAppOrigin(forged);
  assert.equal(ok.ok, true);
  assert.equal(ok.origin, "https://footy-predictor-pro.vercel.app");
  assert.ok(!ok.origin.includes("evil.com"));

  process.env.NODE_ENV = prevEnv;
  process.env.VERCEL_ENV = prevVercel;
  process.env.PUBLIC_BASE_URL = prevPublic;
  process.env.APP_BASE_URL = prevApp;
  process.env.VERCEL_URL = prevVercelUrl;
});

test("buildInternalApiUrl uses trusted origin only", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://footy-predictor-pro.vercel.app";
  const url = buildInternalApiUrl("/api/history", { sync: 1, days: 30 });
  assert.ok(url.startsWith("https://footy-predictor-pro.vercel.app/api/history"));
  assert.ok(url.includes("sync=1"));
  process.env.PUBLIC_BASE_URL = prev;
});

test("corsOriginIfAllowed only allows allowlisted origins", () => {
  const prev = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://footy-predictor-pro.vercel.app";
  assert.equal(
    corsOriginIfAllowed({ headers: { origin: "https://footy-predictor-pro.vercel.app" } }),
    "https://footy-predictor-pro.vercel.app"
  );
  assert.equal(corsOriginIfAllowed({ headers: { origin: "https://evil.com" } }), null);
  process.env.PUBLIC_BASE_URL = prev;
});
