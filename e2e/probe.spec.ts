import { test } from "@playwright/test";

/** Temporary discovery probe #3 — login form via client-side navigation. Not committed. */
test("probe login form via SPA navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Autentificare" }).first().click();
  await page.waitForLoadState("networkidle");
  console.log("=== LOGIN FORM ARIA SNAPSHOT ===");
  console.log(await page.locator("body").ariaSnapshot());
});
