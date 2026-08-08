import { expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers. Navigation always starts at "/" and proceeds through
 * clicks: direct GETs on client routes (/login, /track-record) return a
 * Vercel 404 because vercel.json has no SPA fallback rewrite — a real
 * production defect recorded in the Sprint 3 report, deliberately not fixed
 * here (out of sprint scope).
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

/** The Predict action button — only a logged-in workspace renders it. */
export function predictButton(page: Page) {
  return page.getByRole("button", { name: /generează predicții/i }).first();
}

/** Something only a logged-in workspace shows. */
export function loggedInMarker(page: Page) {
  return predictButton(page);
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
    await dialog.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return; // dialog not shown — selection already exists
  }
  await dialog.getByRole("button", { name: "Elite · toate" }).first().click();
  await dialog.getByRole("button", { name: "Închide", exact: true }).first().click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

/** Log in through the real UI, exactly like a user. */
export async function loginViaUi(page: Page, creds = CREDS) {
  await page.goto("/");
  await page.getByRole("link", { name: "Autentificare" }).first().click();
  await page.getByRole("textbox", { name: "Email" }).fill(creds.email);
  await page.getByRole("textbox", { name: "Parolă" }).fill(creds.password);
  await page.getByRole("button", { name: "Autentificare", exact: true }).click();
  await expect(loggedInMarker(page)).toBeVisible({ timeout: 30_000 });
  // Order matters: the league dialog (z-70) stacks ABOVE the onboarding
  // carousel (z-50), so it must be settled first or the skip click is
  // intercepted.
  await settleLeagueDialogIfPresent(page);
  await dismissOnboardingIfPresent(page);
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
