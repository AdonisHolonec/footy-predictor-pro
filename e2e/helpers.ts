import { expect, type Page } from "@playwright/test";

/**
 * Shared E2E helpers. Navigation always starts at "/" and proceeds through
 * clicks: direct GETs on client routes (/login, /track-record) return a
 * Vercel 404 because vercel.json has no SPA fallback rewrite — a real
 * production defect recorded in the Sprint 3 report, deliberately not fixed
 * here (out of sprint scope).
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

/** Something only a logged-in workspace shows. */
export function loggedInMarker(page: Page) {
  return page
    .getByRole("button", { name: /^predict/i })
    .or(page.getByRole("button", { name: /deconectare/i }))
    .or(page.getByText("Deconectare"))
    .first();
}

/** Log in through the real UI, exactly like a user. */
export async function loginViaUi(page: Page, creds = CREDS) {
  await page.goto("/");
  await page.getByRole("link", { name: "Autentificare" }).first().click();
  await page.getByRole("textbox", { name: "Email" }).fill(creds.email);
  await page.getByRole("textbox", { name: "Parolă" }).fill(creds.password);
  await page.getByRole("button", { name: "Autentificare", exact: true }).click();
  await expect(loggedInMarker(page)).toBeVisible({ timeout: 30_000 });
}
