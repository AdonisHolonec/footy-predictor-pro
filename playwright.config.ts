import { defineConfig } from "@playwright/test";

/**
 * E2E smoke configuration (audit remediation, Sprint 3).
 *
 * Targets a DEPLOYED environment — production by default — because the local
 * dev server serves no /api (no proxy in vite.config.js, serverless functions
 * live on Vercel). A smoke that never touches the real revenue path proves
 * nothing about it.
 *
 * Chromium only, on purpose: this is a smoke layer, and one engine keeps it
 * fast enough to run on every push to main. Cross-browser coverage is a
 * different program with a different budget.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: 1,
  // Smoke specs share one logged-in journey where noted; workers=1 keeps the
  // free-tier test account from racing its own rate limits.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://footy-predictor-pro.vercel.app",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "ro-RO",
    viewport: { width: 1366, height: 900 }
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }]
});
