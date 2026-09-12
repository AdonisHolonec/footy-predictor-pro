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

    /*
      Entries or a real empty state are both correct products of a working flow;
      an error banner is not.

      Asserted through STRUCTURE, not wording. The previous version waited for
      /win|loss|pending|cotă|nicio|istoric/ and passed for three weeks by
      accident: the English words never appear in a Romanian UI, "istoric" was
      the route's old name, "nicio" only exists in the empty state, and the one
      remaining anchor — "cotă" — was absent because MatchListRow asked for a
      key the dictionaries do not define. The test was green only while this
      account had no predictions for today, and went red the moment it had some.

      `results-summary` is the day's record block; it renders in BOTH content
      states, so it proves the section itself resolved rather than the route
      merely navigating. Then exactly one of the two terminal states must be on
      screen: a row in the list, or the empty state's own heading.
    */
    await expect(page.getByTestId("results-summary")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("results-controls")).toBeVisible();

    /*
      KNOWN GAP: a permanent LOAD is indistinguishable from a legitimately empty
      day here, because HistorySection receives no loading flag
      (UserDashboard.tsx renders `<HistorySection history={history} .../>`), so
      an unresolved history and "no predictions this day" render the same empty
      state. Closing that needs a production change and is deliberately out of
      scope; the old assertion had the same blind spot, and worse, since "nicio"
      matched the loading state too.
    */
    const anyEntry = page.getByRole("listitem").first();
    const emptyStateTitle = page.getByRole("heading", { level: 3 }).first();
    await expect(
      anyEntry.or(emptyStateTitle),
      "Results rendered neither a row nor an empty state"
    ).toBeVisible({ timeout: 20_000 });

    await expect(page.getByText(/eroare|a eșuat/i)).toHaveCount(0);
  });
});
