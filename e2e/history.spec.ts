import { expect, test } from "@playwright/test";
import { gotoWorkspace, hasCreds, openResults } from "./helpers";

test.describe("history", () => {
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("the history section renders entries or an honest empty state", async ({ page }) => {
    await gotoWorkspace(page);

    // Every viewport must expose a route into the history: the bottom tab bar
    // below `lg`, the shell's destination icons above it. The old route was a
    // Home card that hides itself on a first run, which is why a fresh account
    // could not get here at all.
    await openResults(page);

    // Entries or a real empty state are both correct products of a working
    // flow; an error banner is not.
    await expect(page.getByText(/win|loss|pending|cotă|nicio|istoric/i).first()).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText(/eroare|a eșuat/i)).toHaveCount(0);
  });
});
