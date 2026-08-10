import { expect, type Page } from "@playwright/test";

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

export const hasCreds = Boolean(CREDS.email && CREDS.password);
export const hasAdminCreds = Boolean(ADMIN_CREDS.email && ADMIN_CREDS.password);

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

/** Shell icon buttons (aria-labels from i18n shell.*). */
export function openProfile(page: Page) {
  return page.getByRole("button", { name: "Profil și upgrade" }).first().click();
}

export function openSettings(page: Page) {
  return page.getByRole("button", { name: "Setări", exact: true }).first().click();
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
 * An account with no favorite leagues gets the league-filter dialog
 * (z-[70] full-screen overlay) auto-opened on login, which intercepts every
 * click. Give the account a real selection — "Elite · toate" persists to the
 * profile's favorites, so both the dialog stops re-opening AND Predict has
 * leagues to work with — then close it.
 */
async function settleLeagueDialogIfPresent(page: Page) {
  const dialog = page.getByRole("dialog", { name: "League filter" });
  try {
    await dialog.waitFor({ state: "visible", timeout: 3_000 });
  } catch {
    return; // dialog not shown — selection already exists
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
  await expect(loggedInMarker(page)).toBeVisible({ timeout: 30_000 });
  await settleWorkspaceOverlays(page);
}

/**
 * Enter the workspace on a context that already carries a stored session
 * (see auth.setup.ts) — no password login, no rate-limit exposure.
 *
 * "/" is always the marketing landing; the workspace lives at /workspace.
 * Entering through the landing's logged-in "Deschide aplicația" link keeps
 * this on the real user journey (and worked even before the SPA fallback).
 */
export async function gotoWorkspace(page: Page) {
  // Two bounded attempts: while the stored session is still hydrating, the
  // landing can render its logged-out state (no workspace link) or AuthGate can
  // bounce the entry to /login — the documented session-hydration race, and the
  // exact shape of the 2026-08-10 CI flake. One reload after the race settles
  // recovers, just like a real user pressing the link again; failing BOTH
  // attempts is a real bug and must fail the test.
  const attempts = [
    { linkTimeout: 10_000, markerTimeout: 12_000 },
    { linkTimeout: 10_000, markerTimeout: 20_000 }
  ];
  for (let i = 0; i < attempts.length; i++) {
    try {
      await page.goto("/");
      await page
        .getByRole("link", { name: /deschide (aplicația|workspace)/i })
        .first()
        .click({ timeout: attempts[i].linkTimeout });
      await expect(loggedInMarker(page)).toBeVisible({ timeout: attempts[i].markerTimeout });
      break;
    } catch (err) {
      if (i === attempts.length - 1) throw err;
    }
  }
  await settleWorkspaceOverlays(page);
}

/** Log out through the profile view and wait for the public site. */
export async function logoutViaUi(page: Page) {
  await openProfile(page);
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
