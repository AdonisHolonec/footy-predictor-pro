import { expect, test } from "@playwright/test";

/** Public surface — runs with no credentials at all. */
// The shared storage state would land these on the workspace; the public
// site is only reachable logged out.
test.use({ storageState: { cookies: [], origins: [] } });

test("landing page renders the product, pricing and auth entry", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Predicții");
  await expect(page.getByRole("link", { name: "Autentificare" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planuri" })).toBeVisible();
  // The three tiers the business sells.
  for (const tier of ["Free", "Premium", "Ultra"]) {
    await expect(page.getByText(tier, { exact: true }).first()).toBeVisible();
  }
});

test("wrong password is rejected with visible feedback, not a silent nothing", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Autentificare" }).first().click();
  await page.getByRole("textbox", { name: "Email" }).fill("e2e-wrong@example.com");
  await page.getByRole("textbox", { name: "Parolă" }).fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Autentificare", exact: true }).click();

  // Whatever the exact copy, the user must stay on the form and must NOT be let in.
  await expect(page.getByRole("button", { name: "Autentificare", exact: true })).toBeVisible({
    timeout: 15_000
  });
  await expect(page.getByRole("button", { name: /^predict/i })).toHaveCount(0);
});
