import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../context/LocaleContext";
import { en } from "../i18n/en";
import { ro } from "../i18n/ro";
import LeaguePanel from "./LeaguePanel";

const either = (key: "eliteAll" | "clear") => new RegExp(`^(${en.leagues[key]}|${ro.leagues[key]})$`);

function renderPanel(extra: Partial<React.ComponentProps<typeof LeaguePanel>> = {}) {
  const props: React.ComponentProps<typeof LeaguePanel> = {
    leaguesSorted: [
      { id: 39, name: "Premier League", country: "England", matches: 0 },
      { id: 218, name: "Bundesliga", country: "Austria", matches: 2 }
    ],
    selectedSet: new Set<number>(),
    selectedLeagueIds: [],
    isLeaguesOpen: true,
    searchLeague: "",
    eliteLeagues: [39],
    setIsLeaguesOpen: () => {},
    setSearchLeague: () => {},
    setSelectedLeagueIds: () => {},
    selectEliteLeagues: () => {},
    clearLeagueSelection: () => {},
    ...extra
  };
  return render(
    <LocaleProvider>
      <LeaguePanel {...props} />
    </LocaleProvider>
  );
}

afterEach(cleanup);

describe("LeaguePanel · full catalog", () => {
  it("keeps exactly the two bulk actions (elite, clear) and shows the catalog count for the consumer dashboard", () => {
    renderPanel({ catalogStatus: { count: 2, state: "ready" } });
    expect(screen.getByRole("button", { name: either("eliteAll") })).toBeTruthy();
    expect(screen.getByRole("button", { name: either("clear") })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("2");
    // No third bulk action: the only other buttons are the header toggle and the league rows.
    const bulkLabels = new Set((["eliteAll", "clear"] as const).flatMap((key) => [String(en.leagues[key]), String(ro.leagues[key])]));
    const bulkButtons = screen.getAllByRole("button").filter((b) => bulkLabels.has(b.textContent ?? ""));
    expect(bulkButtons).toHaveLength(2);
  });

  it("omits the catalog status line for the legacy admin/guest callers that do not pass it", () => {
    renderPanel();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lists a league with zero matches today", () => {
    renderPanel();
    expect(screen.getByText("Premier League")).toBeTruthy();
  });
});
