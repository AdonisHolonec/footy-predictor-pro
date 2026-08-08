import fs from "node:fs";
import { test as setup } from "@playwright/test";
import { ADMIN_CREDS, ADMIN_STATE, USER_STATE, hasAdminCreds, hasCreds, loginViaUi } from "./helpers";

/**
 * One real UI login per account per run; every spec after this reuses the
 * saved storage state. Keeps the suite off Supabase's password-login rate
 * limit (the failure mode that made per-test logins flaky) and ~3× faster.
 */

const EMPTY_STATE = JSON.stringify({ cookies: [], origins: [] });

setup("ensure storage-state files exist", async () => {
  // Without creds the login setups skip; empty states keep the projects
  // bootable so credential-less runs still execute the public specs.
  fs.mkdirSync("e2e/.auth", { recursive: true });
  for (const file of [USER_STATE, ADMIN_STATE]) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, EMPTY_STATE, "utf8");
  }
});

setup("authenticate the free-tier account", async ({ page }) => {
  setup.skip(!hasCreds, "E2E_EMAIL / E2E_PASSWORD not configured");
  await loginViaUi(page);
  await page.context().storageState({ path: USER_STATE });
});

setup("authenticate the admin account", async ({ page }) => {
  setup.skip(!hasAdminCreds, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not configured");
  await loginViaUi(page, ADMIN_CREDS);
  await page.context().storageState({ path: ADMIN_STATE });
});
