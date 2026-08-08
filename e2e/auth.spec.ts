import { test } from "@playwright/test";
import { hasCreds, loginViaUi, logoutViaUi } from "./helpers";

test.describe("authentication", () => {
  // This IS the login journey — it must start logged out, not from the
  // shared storage state.
  test.use({ storageState: { cookies: [], origins: [] } });
  test.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");

  test("login lands in the workspace, logout returns to the public site", async ({ page }) => {
    await loginViaUi(page);
    // Logout now lives in the profile view (👤 "Profil și upgrade"), not the shell.
    await logoutViaUi(page);
  });
});
