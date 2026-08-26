import { expect, test, type Page } from "@playwright/test";

/**
 * Shared E2E helpers. Navigation starts at "/" and proceeds through clicks —
 * the real user journey. (Deep links work since the SPA-fallback rewrite in
 * vercel.json; landing.spec guards that regression explicitly.)
 *
 * Selectors target the shell's aria-labels (i18n `shell.*` keys) rather than
 * visible copy where the copy is short or duplicated — those labels are the
 * accessibility contract, so tests break only when the contract does.
 */

export const CREDS = {
  email: process.env.E2E_EMAIL || "",
  password: process.env.E2E_PASSWORD || ""
};

export const ADMIN_CREDS = {
  email: process.env.E2E_ADMIN_EMAIL || "",
  password: process.env.E2E_ADMIN_PASSWORD || ""
};

/**
 * The logout journey gets its own account. Supabase's signOut is global — it
 * revokes EVERY session of the account it runs on — so performing it on the
 * account the rest of the suite depends on is a session-destroying operation
 * pointed at ourselves. Project ordering keeps that safe within one run, but
 * nothing protects a run from ANOTHER run's logout: on 2026-08-10 a main-push
 * run and a PR run started 12 seconds apart and killed each other's sessions.
 *
 * Falls back to the shared account when unset, so the suite still works before
 * the E2E_LOGOUT_* secrets exist — just without the isolation.
 */
export const LOGOUT_CREDS = {
  email: process.env.E2E_LOGOUT_EMAIL || CREDS.email,
  password: process.env.E2E_LOGOUT_PASSWORD || CREDS.password
};

export const hasCreds = Boolean(CREDS.email && CREDS.password);
export const hasAdminCreds = Boolean(ADMIN_CREDS.email && ADMIN_CREDS.password);
export const hasDedicatedLogoutAccount = Boolean(
  process.env.E2E_LOGOUT_EMAIL && process.env.E2E_LOGOUT_PASSWORD
);

/** Saved storage-state files written by auth.setup.ts (gitignored). */
export const USER_STATE = "e2e/.auth/user.json";
export const ADMIN_STATE = "e2e/.auth/admin.json";

/** The Predict action button — only a logged-in workspace renders it. */
export function predictButton(page: Page) {
  return page.getByRole("button", { name: /generează predicții/i }).first();
}

/**
 * Something only a logged-in session shows. Regular accounts land in the
 * consumer workspace (Predict button); admin accounts land in the Admin
 * Observatory (its "Admin" navigation rail).
 */
export function loggedInMarker(page: Page) {
  return predictButton(page).or(page.getByRole("navigation", { name: "Admin" })).first();
}

/** The league-filter drawer, matched on the aria-label the workspace gives it. */
function leagueDialog(page: Page) {
  return page.getByRole("dialog", { name: "League filter" });
}

/**
 * Proof we reached the workspace, whether or not an overlay is covering it.
 *
 * Every overlay now renders in a portal outside #root and marks #root `inert`
 * + `aria-hidden` while it is open (PR #88). The league drawer auto-opens at
 * desktop widths, so on this suite's 1366px viewport the workspace — Predict
 * button included — is absent from the accessibility tree that getByRole
 * queries the instant we arrive. Waiting on loggedInMarker alone therefore
 * timed out against a session that had authenticated perfectly (CI, run
 * 31973348576). The open drawer is itself evidence we landed, so accept either,
 * settle the overlays, and only then assert the workspace proper.
 */
function workspaceEntered(page: Page) {
  return loggedInMarker(page).or(leagueDialog(page)).first();
}

/*
  Workspace navigation.

  The shell used to carry icon buttons — "Profil și upgrade", "Setări", an
  RO/EN toggle — and the specs drove the app through them. That shell is gone:
  the workspace now has one primary nav (Azi · Meciuri · Rezultate ·
  Performanță · Cont, plus Bilete) and everything those icons opened lives on a
  dedicated /workspace/account route. Verified against production on
  2026-08-26: the old names return zero nodes, at 1366px and at 390px alike.

  Two consequences, and they are what actually broke the suite rather than the
  renames:

    - identity and tier are NO LONGER in the persistent shell. The email and
      the plan render on the account route only, so a spec asserting them from
      the workspace asserts something the product stopped promising.
    - there is no "Mai mult" menu. Nothing routes through one.

  Navigation asserts the URL as well as the landmark, so a spec fails where the
  journey actually broke instead of 90 seconds later on a missing element.
*/

/** The account route: identity, plan, billing, language, preferences. */
export async function openAccount(page: Page) {
  await page.getByRole("button", { name: "Cont", exact: true }).first().click();
  await page.waitForURL(/\/workspace\/account/, { timeout: 20_000 });
  await accountReady(page);
}

/** The account route has painted its own heading, not merely changed URL. */
export async function accountReady(page: Page) {
  await expect(page.getByRole("heading", { name: /^Cont$/ }).first()).toBeVisible({ timeout: 20_000 });
}

/** The results route — what "Istoric" used to reach. */
export async function openResults(page: Page) {
  await page.getByRole("button", { name: "Rezultate", exact: true }).first().click();
  await page.waitForURL(/\/workspace\/results/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /^Rezultate$/ }).first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Switch the interface language.
 *
 * The RO/EN controls live on the account route, so this navigates there first
 * unless we are already on it — the toggle is no longer reachable from the
 * workspace, which is why the old global-toggle journey could not work.
 */
export async function setLanguage(page: Page, language: "RO" | "EN") {
  if (!/\/workspace\/account/.test(page.url())) await openAccount(page);
  await page.getByRole("button", { name: language, exact: true }).first().click();
}

/**
 * A first-login account gets the OnboardingCarousel overlay, which intercepts
 * every click in the workspace. Skipping marks onboarding complete server-side,
 * so this fires at most once per account — but the guard must stay, because a
 * freshly rotated E2E account is exactly the account that sees it.
 */
async function dismissOnboardingIfPresent(page: Page) {
  const skip = page.getByRole("button", { name: "Sari peste" }).first();
  try {
    await skip.click({ timeout: 5_000 });
  } catch {
    // no onboarding — nothing to dismiss
  }
}

/**
 * The league-filter drawer opens by VIEWPORT, not by account state: the
 * workspace seeds its open flag from `isDesktopViewport()` (>= 1024px) on every
 * mount, so at this suite's 1366px it is open on every arrival, favorites or
 * not — and it comes back on the next mount however we dismiss it. It is a
 * drawer (--fp-z-drawer), and while it is up the workspace behind it is inert
 * and hidden from the accessibility tree, so nothing else is clickable or even
 * findable until it is closed.
 *
 * "Elite · toate" is still the right way to close it: the selection persists to
 * the profile's favorites, so Predict has leagues to work with. Closing is what
 * this buys us; not re-opening is not something it can promise.
 */
async function settleLeagueDialogIfPresent(page: Page) {
  const dialog = leagueDialog(page);
  try {
    await dialog.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return; // no drawer here — narrow viewport, or a shell that has none (admin)
  }
  await dialog.getByRole("button", { name: "Elite · toate" }).first().click();
  await dialog.getByRole("button", { name: "Închide", exact: true }).first().click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

/**
 * The workspace opens its first-run overlays per browser context, not per
 * account — a fresh storage-state context can still get the league dialog.
 * Order matters: the league dialog (z-70) stacks ABOVE the onboarding
 * carousel (z-50), so it must be settled first.
 */
async function settleWorkspaceOverlays(page: Page) {
  await settleLeagueDialogIfPresent(page);
  await dismissOnboardingIfPresent(page);
}

/** Log in through the real UI, exactly like a user. */
export async function loginViaUi(page: Page, creds = CREDS) {
  await page.goto("/");
  await page.getByRole("link", { name: "Autentificare" }).first().click();
  await page.getByRole("textbox", { name: "Email" }).fill(creds.email);
  await page.getByRole("textbox", { name: "Parolă" }).fill(creds.password);
  await page.getByRole("button", { name: "Autentificare", exact: true }).click();
  // Either the workspace or the overlay hiding it — see workspaceEntered.
  await expect(workspaceEntered(page)).toBeVisible({ timeout: 30_000 });
  await settleWorkspaceOverlays(page);
  await expect(loggedInMarker(page)).toBeVisible({ timeout: 15_000 });
}

/** How long the landing gets to hydrate a stored session before we treat it as gone. */
const HYDRATION_GRACE_MS = 8_000;

/**
 * Recovery logins are real password logins on the shared account, and Supabase
 * rate-limits those per ACCOUNT. Left uncapped, one early session death makes
 * every remaining spec log in again — 10+ logins in a run — which trips the
 * limit and takes the suite fully red for 30-60 minutes, main-push runs
 * included. Observed on 2026-08-10: recoveries began working, then started
 * failing inside loginViaUi with the limit's signature (the login screen simply
 * never resolves). Two is enough to survive a normal late session death; past
 * that, failing loudly is cheaper than poisoning the account.
 */
const MAX_SESSION_RECOVERIES = 2;
let sessionRecoveries = 0;

/**
 * Enter the workspace on a context that already carries a stored session
 * (see auth.setup.ts) — no password login, no rate-limit exposure.
 *
 * "/" is always the marketing landing; the workspace lives at /workspace.
 * Entering through the landing's logged-in "Deschide aplicația" link keeps
 * this on the real user journey (and worked even before the SPA fallback).
 */
export async function gotoWorkspace(page: Page) {
  // Budget matters as much as the retry ladder here. The previous version spent
  // up to 52s across two attempts before it could even try recovering, which is
  // more than the 45s per-test timeout — so the fallback below never ran and
  // every affected test died at the timeout instead (CI, 2026-08-10, PR #44).
  //
  // Now: wait only for the workspace link. Its absence IS the signal that the
  // stored session is gone, and waiting on a marker that will never appear buys
  // nothing. Two short attempts cover the hydration race, where the landing
  // paints its logged-out state before the session hydrates.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto("/");
    try {
      const link = page.getByRole("link", { name: /deschide (aplicația|workspace)/i }).first();
      await link.waitFor({ state: "visible", timeout: HYDRATION_GRACE_MS });
      await link.click({ timeout: 5_000 });
      // Same ordering as loginViaUi: the drawer auto-opens on every workspace
      // mount at this viewport, so it hides the marker here too.
      await expect(workspaceEntered(page)).toBeVisible({ timeout: 15_000 });
      await settleWorkspaceOverlays(page);
      await expect(loggedInMarker(page)).toBeVisible({ timeout: 15_000 });
      return;
    } catch {
      // logged-out landing, or the entry bounced — try once more, then recover
    }
  }

  // The stored session is gone rather than slow: Supabase rotates refresh
  // tokens, and every spec opens a fresh context replaying the SAME saved
  // token, so one late rotation revokes the family and every spec after it
  // lands logged out. That is why this looked like a flake landing on a
  // different test each run.
  //
  // Entering the workspace is a PRECONDITION here, not the assertion — so
  // recover the way a user would, by logging in again. Whether login itself
  // works stays auth.spec's job, and the annotation keeps the recovery visible
  // in the report instead of silently green.
  if (!hasCreds) throw new Error("gotoWorkspace: no stored session and no credentials to recover with");
  if (sessionRecoveries >= MAX_SESSION_RECOVERIES) {
    throw new Error(
      `gotoWorkspace: the stored session is gone and ${MAX_SESSION_RECOVERIES} recovery logins have already been ` +
        "used this run. Refusing to log in again — repeated password logins trip Supabase's account-scoped rate " +
        "limit, which would take the whole suite red for 30-60 minutes instead of just this spec."
    );
  }
  sessionRecoveries += 1;
  test.info().annotations.push({
    type: "session-recovered",
    description: "stored session did not open the workspace; fell back to a UI login"
  });
  await loginViaUi(page);
}

/** Log out through the account view and wait for the public site. */
export async function logoutViaUi(page: Page) {
  await openAccount(page);
  await page.getByRole("button", { name: /deconectare/i }).first().click();
  // Logout may land on the public landing (auth link) or straight on the
  // login form (auth submit button) — both are logged-out states.
  await expect(
    page
      .getByRole("link", { name: "Autentificare" })
      .or(page.getByRole("button", { name: "Autentificare", exact: true }))
      .first()
  ).toBeVisible({ timeout: 15_000 });
}
