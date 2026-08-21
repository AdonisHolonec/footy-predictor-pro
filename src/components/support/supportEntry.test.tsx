import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupportEntry from "./SupportEntry";
import { contextFromRow } from "./ReportPredictionDialog";
import type { PredictionRow } from "../../types";

/**
 * SupportEntry exists because the first Support UI was mounted in one of the two
 * authenticated trees, and the accounts that own the product land in the other —
 * so the feature shipped invisible to the people who shipped it.
 *
 * The behavioural tests below cover the component. The structural ones cover the
 * thing that actually went wrong: a working component nobody mounts. Reading the
 * host files is unusual for a unit test, and deliberate — no amount of testing
 * SupportEntry in isolation would have caught the original gap.
 */

const submitSupportTicket = vi.fn();
const submitFeedback = vi.fn();

vi.mock("../../services/supportService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/supportService")>();
  return {
    ...actual,
    submitSupportTicket: (...args: unknown[]) => submitSupportTicket(...args),
    submitFeedback: (...args: unknown[]) => submitFeedback(...args),
    submitPredictionReport: vi.fn()
  };
});

vi.mock("../../context/LocaleContext", () => ({
  useLocale: () => ({ t: (key: string) => key, locale: "en", setLocale: () => {} })
}));

beforeEach(() => {
  submitSupportTicket.mockReset().mockResolvedValue(undefined);
  submitFeedback.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const src = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src", rel), "utf8");

describe("SupportEntry", () => {
  it("[1] renders both entry points in either shape", () => {
    const { unmount } = render(<SupportEntry />);
    expect(screen.getByRole("button", { name: "support.openSupport" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "support.openFeedback" })).toBeTruthy();
    expect(screen.getByText("support.sectionTitle")).toBeTruthy();
    unmount();

    render(<SupportEntry variant="inline" />);
    expect(screen.getByRole("button", { name: "support.openSupport" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "support.openFeedback" })).toBeTruthy();
    // The inline shape is for a toolbar: no heading competing with the page title.
    expect(screen.queryByText("support.sectionTitle")).toBeNull();
  });

  it("[2] opens the Support dialog", () => {
    render(<SupportEntry />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "support.openSupport" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/support\.subject/)).toBeTruthy();
  });

  it("[3] opens the Feedback dialog — the shorter one, with no subject", () => {
    render(<SupportEntry />);
    fireEvent.click(screen.getByRole("button", { name: "support.openFeedback" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
    expect(screen.queryByLabelText(/support\.subject/)).toBeNull();
  });

  it("[4] takes no role, tier or user — it cannot behave differently per tree", () => {
    const source = src("components/support/SupportEntry.tsx");
    for (const forbidden of ["role:", "isAdmin", "tier:", "user:"]) {
      expect(source.includes(forbidden)).toBe(false);
    }
    // Same component, same buttons, whichever host mounted it.
    const { unmount } = render(<SupportEntry />);
    const card = screen.getAllByRole("button").map((b) => b.textContent);
    unmount();
    render(<SupportEntry variant="inline" />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(card);
  });

  it("[12] mounts exactly one dialog at a time, never two", () => {
    render(<SupportEntry />);
    fireEvent.click(screen.getByRole("button", { name: "support.openSupport" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "support.openFeedback" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("[13] a busy submit disables the controls, so it cannot be sent twice", async () => {
    let release: () => void = () => {};
    submitSupportTicket.mockImplementation(() => new Promise<void>((r) => (release = () => r())));
    render(<SupportEntry />);
    fireEvent.click(screen.getByRole("button", { name: "support.openSupport" }));
    fireEvent.change(screen.getByLabelText(/support\.category/), { target: { value: "general" } });
    fireEvent.change(screen.getByLabelText(/support\.subject/), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText(/support\.message/), { target: { value: "A long enough message." } });

    const sendButton = screen.getByRole("button", { name: "support.send" });
    fireEvent.click(sendButton);
    await waitFor(() => expect(submitSupportTicket).toHaveBeenCalledTimes(1));
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sendButton);
    expect(submitSupportTicket).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(screen.getByText("support.successMessage")).toBeTruthy());
  });

  it("[14] the dialogs keep the accessibility the primitives give them", () => {
    render(<SupportEntry />);
    fireEvent.click(screen.getByRole("button", { name: "support.openSupport" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby") as string)?.textContent).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reports the confirmation key so a host can raise its own toast", async () => {
    const onSubmitted = vi.fn();
    render(<SupportEntry onSubmitted={onSubmitted} />);
    fireEvent.click(screen.getByRole("button", { name: "support.openFeedback" }));
    fireEvent.change(screen.getByLabelText(/feedback\.category/), { target: { value: "ux" } });
    fireEvent.change(screen.getByLabelText(/feedback\.message/), { target: { value: "Nicer charts." } });
    fireEvent.click(screen.getByRole("button", { name: "feedback.send" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("feedback.successMessage"));
  });
});

describe("both authenticated trees mount it", () => {
  // RootRouter sends role === "admin" to App.tsx and everyone else to
  // UserDashboard. Each of these asserts one half of that fork.
  it("[5][6] the workspace tree reaches SupportEntry through SettingsView", () => {
    const settings = src("pages/userDashboard/SettingsView.tsx");
    expect(settings).toMatch(/import SupportEntry from ".*support\/SupportEntry"/);
    expect(settings).toMatch(/<SupportEntry/);
    const dashboard = src("pages/UserDashboard.tsx");
    expect(dashboard).toMatch(/<SettingsView/);
    // The dialogs moved into SupportEntry; leaving copies here would double them.
    expect(dashboard.includes("<SupportDialog")).toBe(false);
    expect(dashboard.includes("<FeedbackDialog")).toBe(false);
  });

  it("[7][8] the admin tree mounts SupportEntry directly", () => {
    const app = src("App.tsx");
    expect(app).toMatch(/import SupportEntry from ".*support\/SupportEntry"/);
    expect(app).toMatch(/<SupportEntry/);
  });

  it("neither tree re-implements a dialog of its own", () => {
    for (const file of ["App.tsx", "pages/UserDashboard.tsx", "pages/userDashboard/SettingsView.tsx"]) {
      const source = src(file);
      expect(source.includes("submitSupportTicket")).toBe(false);
      expect(source.includes("submitFeedback")).toBe(false);
    }
  });
});

describe("prediction report reaches both prediction trees", () => {
  const row = {
    id: 4242,
    leagueId: 39,
    league: "Premier League",
    teams: { home: "Arsenal", away: "Chelsea" },
    kickoff: "2026-08-22T14:00:00Z",
    recommended: { pick: "BTTS Yes", family: "BTTS" }
  } as unknown as PredictionRow;

  it("[9] the workspace tree is wired through Match Detail", () => {
    // UX-A: the list row carries no secondary actions, so the report entry
    // moved from the card flag to the detail sheet the row opens. The list
    // must not grow it back, and the sheet must keep it.
    expect(src("components/ux/MatchListRow.tsx")).not.toMatch(/onReport/);
    expect(src("components/ux/MatchesSection.tsx")).not.toMatch(/onReportMatch/);
    expect(src("components/MatchModal.tsx")).toMatch(/onReport &&/);
    expect(src("pages/UserDashboard.tsx")).toMatch(/onReport=\{\(\) => setReportRow\(modalMatch\)\}/);
  });

  it("[10] the admin card is wired through the whole chain", () => {
    expect(src("App.tsx")).toMatch(/onReportMatch=\{setReportRow\}/);
    expect(src("components/layout/ObservatoryBody.tsx")).toMatch(/onReportMatch=\{rest\.onReportMatch\}/);
    expect(src("components/cards/PredictionList.tsx")).toMatch(/onReport=\{onReportMatch/);
    expect(src("components/cards/PredictionCard.tsx")).toMatch(/onReport\?: \(\) => void/);
    expect(src("components/MatchCard.tsx")).toMatch(/onReport &&/);
  });

  it("[11] both paths build the context with the same function", () => {
    // One implementation, so the two trees cannot drift into reporting
    // different things about the same fixture.
    expect(contextFromRow(row)).toEqual({
      fixtureId: 4242,
      leagueId: 39,
      recommendation: "BTTS Yes",
      family: "BTTS",
      kickoffAt: "2026-08-22T14:00:00Z"
    });
    for (const file of ["App.tsx", "pages/UserDashboard.tsx"]) {
      expect(src(file)).toMatch(/<ReportPredictionDialog/);
      // Neither host maps the row itself — the dialog owns that.
      expect(src(file).includes("contextFromRow")).toBe(false);
    }
  });
});
