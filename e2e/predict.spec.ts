import { expect, test } from "@playwright/test";
import { hasCreds, loginViaUi } from "./helpers";

test.describe("predict flow", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("pressing Predict produces predictions or an explicit quota message", async ({ page }) => {
    await loginViaUi(page);

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/predict") || r.url().includes("/api/warm"),
      { timeout: 60_000 }
    );
    await page.getByRole("button", { name: /^predict/i }).first().click();
    const response = await responsePromise;

    // The warm cron pre-heats the visible day, so a healthy run is served from
    // cache and burns no upstream quota. A free-tier account may also hit its
    // daily cap — an explicit limit message is a PASS (the wired path worked);
    // a blank screen is the failure.
    if (response.ok()) {
      await expect(
        page.getByText(/vs|încredere|cotă|nicio predicție|niciun meci/i).first()
      ).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/limit|cotă|încearcă|upgrade/i).first()).toBeVisible({
        timeout: 15_000
      });
    }
  });
});
