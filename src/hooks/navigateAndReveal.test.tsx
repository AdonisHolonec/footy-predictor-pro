/**
 * The referral campaign navigated to Account and stopped there — the card it
 * was selling stayed below the fold.
 *
 * These drive the REAL hook and the REAL campaign strip through a miniature of
 * the app's own composition: a click that navigates, and a destination that
 * mounts the referral card only once that navigation has happened. That
 * ordering IS the bug, so a test that rendered the destination up front would
 * pass against the broken code and prove nothing.
 *
 * jsdom implements no scrollIntoView, so it is mocked explicitly and every
 * assertion checks WHICH element it was called on and with WHAT options.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../context/LocaleContext";
import ReferralCampaignStrip from "../components/ux/ReferralCampaignStrip";
import { REFERRAL_CARD_ID } from "../components/ux/ReferralCard";
import { useNavigateAndReveal } from "./useNavigateAndReveal";

type View = "home" | "profile";

const scrollIntoView = vi.fn();

/** The composition under test: navigate, mount, then reveal. */
function Harness({ startOn = "home" as View }: { startOn?: View }) {
  const [view, setView] = useState<View>(startOn);
  const { reveal } = useNavigateAndReveal<View>(view, setView);
  return (
    <LocaleProvider>
      <ReferralCampaignStrip onOpenReferral={() => reveal("profile", REFERRAL_CARD_ID)} />
      <div data-testid="view">{view}</div>
      {/* The destination mounts only after navigation — as ProfileView does. */}
      {view === "profile" ? (
        <div id={REFERRAL_CARD_ID} className="scroll-mt-28" data-testid="account-referral">
          referral card
        </div>
      ) : null}
    </LocaleProvider>
  );
}

const cta = () => screen.getByTestId("referral-cta");
const view = () => screen.getByTestId("view").textContent;

beforeEach(() => {
  scrollIntoView.mockReset();
  // jsdom has no implementation; mock it so the target and options are checkable.
  Element.prototype.scrollIntoView = scrollIntoView;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
});

afterEach(cleanup);

describe("A + B + C + D — clicking the campaign reveals the referral card", () => {
  it("A — navigates to Account", () => {
    render(<Harness />);
    expect(view()).toBe("home");
    fireEvent.click(cta());
    expect(view()).toBe("profile");
  });

  it("B — the referral card is mounted after the navigation", () => {
    render(<Harness />);
    expect(screen.queryByTestId("account-referral")).toBeNull();
    fireEvent.click(cta());
    expect(screen.getByTestId("account-referral")).toBeTruthy();
  });

  it("C — scrollIntoView is called ON the referral card, not on something else", () => {
    render(<Harness />);
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // `this` is the element the method was invoked on.
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId("account-referral"));
    expect((scrollIntoView.mock.instances[0] as HTMLElement).id).toBe(REFERRAL_CARD_ID);
  });

  it("D — uses block:start, which is what the target's scroll-mt-28 needs", () => {
    render(<Harness />);
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("the bug itself: the scroll does NOT happen before the target exists", () => {
    /*
      Guards the ordering rather than the call. If the implementation ever moves
      the scroll back into the click handler, the element is not mounted yet and
      the call lands on nothing — which is exactly how this shipped broken.
    */
    render(<Harness />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(cta());
    expect(scrollIntoView.mock.instances[0]).toBeTruthy();
  });
});

describe("E — keyboard activation behaves identically", () => {
  it("a native button activates through the same click path Enter and Space reach", () => {
    render(<Harness />);
    cta().focus();
    expect(document.activeElement).toBe(cta());
    fireEvent.click(cta());
    expect(view()).toBe("profile");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId("account-referral"));
  });

  it("does not steal focus away from the control the user activated", () => {
    render(<Harness />);
    cta().focus();
    fireEvent.click(cta());
    expect(document.activeElement).toBe(cta());
  });
});

describe("F — repeated activation does not accumulate scrolls or handlers", () => {
  it("three clicks produce exactly three scrolls, never a multiplying count", () => {
    render(<Harness />);
    fireEvent.click(cta());
    fireEvent.click(cta());
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  });

  it("the request does not linger and re-fire on a later unrelated re-render", () => {
    render(<Harness />);
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Any later commit must not replay the consumed request.
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("G — already on Account, the campaign still reveals the card", () => {
  it("scrolls even though no view change occurs", () => {
    render(<Harness startOn="profile" />);
    expect(view()).toBe("profile");
    expect(screen.getByTestId("account-referral")).toBeTruthy();
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId("account-referral"));
  });

  it("a SECOND click while already there scrolls again — the seq guard", () => {
    /*
      Without the sequence number the second request is value-identical, React
      bails out of the re-render, the effect never re-runs, and the button goes
      dead after its first use.
    */
    render(<Harness startOn="profile" />);
    fireEvent.click(cta());
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe("reduced motion", () => {
  it("jumps instead of animating when the user asked for less motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    render(<Harness />);
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("animates otherwise", () => {
    render(<Harness />);
    fireEvent.click(cta());
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});

describe("a missing target fails quietly instead of wedging the request", () => {
  it("does not throw, and does not retry forever, when the card is absent", () => {
    function NoCard() {
      const [v, setV] = useState<View>("home");
      const { reveal } = useNavigateAndReveal<View>(v, setV);
      return (
        <LocaleProvider>
          <ReferralCampaignStrip onOpenReferral={() => reveal("profile", REFERRAL_CARD_ID)} />
          <div data-testid="view">{v}</div>
        </LocaleProvider>
      );
    }
    render(<NoCard />);
    expect(() => fireEvent.click(screen.getByTestId("referral-cta"))).not.toThrow();
    expect(screen.getByTestId("view").textContent).toBe("profile");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
