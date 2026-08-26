import { expect, test } from "@playwright/test";
import { ensureLeagueSelected, gotoWorkspace, hasCreds, predictButton } from "./helpers";

test.describe("predict flow", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("pressing Predict produces predictions or an explicit quota message", async ({ page }) => {
    await gotoWorkspace(page);
    // Predict validates client-side before it calls anything: with no league
    // selected it renders "Selecteaza o liga." and issues NO request, so waiting
    // on the response times out against a perfectly healthy app. The auto-opening
    // drawer usually settles this, but it is a 3s race on a restored context --
    // so the journey establishes its own precondition instead of trusting it.
    await ensureLeagueSelected(page);

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/predict") || r.url().includes("/api/warm"),
      { timeout: 60_000 }
    );
    await predictButton(page).click();
    const response = await responsePromise;

    // The warm cron pre-heats the visible day, so a healthy run is served from
    // cache and burns no upstream quota. A free-tier account may also hit its
    // daily cap — an explicit limit message is a PASS (the wired path worked);
    // a blank screen is the failure.
    if (response.ok()) {
      await expect(
        page.getByText(/vs|încredere|cotă|nicio predicție|niciun meci|lipsă meciuri/i).first()
      ).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/limit|cotă|încearcă|upgrade/i).first()).toBeVisible({
        timeout: 15_000
      });
    }
  });
});
