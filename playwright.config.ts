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
  // Headroom for the one expensive path: when a stored session has been revoked
  // mid-run, gotoWorkspace spends its hydration grace and then performs a real
  // UI login. At 45s the test died before that recovery could finish, which is
  // what turned one dead session into a wall of red (CI, 2026-08-10, PR #44).
  timeout: 90_000,
  retries: 1,
  // Smoke specs share one logged-in journey where noted; workers=1 keeps the
  // free-tier test account from racing its own rate limits.
  workers: 1,
  /*
    Redaction runs FIRST, on purpose. Playwright's error-context attachment is
    an ARIA snapshot that serialises input values, password fields included, and
    the html reporter copies attachments into playwright-report/ which CI
    uploads publicly. Scrubbing in onTestEnd rewrites the file before html
    copies it, so the artifact keeps the diagnostics and loses the secret.
    See e2e/secretRedaction.ts.
  */
  reporter: [["./e2e/secretRedaction.ts"], ["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://footy-predictor-pro.vercel.app",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "ro-RO",
    viewport: { width: 1366, height: 900 }
  },
  projects: [
    // One real UI login per account per run (auth.setup.ts); every spec then
    // reuses the saved storage state — off Supabase's password-login rate
    // limit and ~3× faster than per-test logins.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.spec\.ts/,
      use: { browserName: "chromium", storageState: "e2e/.auth/user.json" }
    },
    {
      // The logout journey runs on its own account (E2E_LOGOUT_*), so its
      // global signOut can no longer revoke the shared storage state. Ordering
      // it last stays as defence in depth — and as the fallback path, where no
      // dedicated account is configured and it reuses the shared one.
      name: "auth-journey",
      dependencies: ["chromium"],
      testMatch: /auth\.spec\.ts/,
      use: { browserName: "chromium" }
    }
  ]
});
