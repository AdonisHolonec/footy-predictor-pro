import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dialog from "./Dialog";

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Dialog open onClose={onClose} title="Report a problem" {...overrides}>
      <p>Body copy</p>
    </Dialog>
  );
  return { onClose, ...utils };
}

describe("Dialog", () => {
  it("renders title and children when open", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Report a problem")).toBeTruthy();
    expect(screen.getByText("Body copy")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    const onClose = vi.fn();
    render(
      <Dialog open={false} onClose={onClose} title="Report a problem">
        <p>Body copy</p>
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Body copy")).toBeNull();
  });

  it("marks itself as a modal and names itself from the title", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Report a problem");
  });

  it("describes itself only when a description is given", () => {
    const { unmount } = renderDialog();
    expect(screen.getByRole("dialog").getAttribute("aria-describedby")).toBeNull();
    unmount();

    renderDialog({ description: "Tell us what went wrong" });
    const describedBy = screen.getByRole("dialog").getAttribute("aria-describedby");
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Tell us what went wrong");
  });

  it("calls onClose from the close button", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not react to Escape once closed", () => {
    const onClose = vi.fn();
    render(
      <Dialog open={false} onClose={onClose} title="Report a problem">
        <p>Body copy</p>
      </Dialog>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on backdrop click by default and not when opted out", () => {
    const { onClose, container, unmount } = renderDialog();
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    const second = renderDialog({ closeOnBackdrop: false });
    fireEvent.click(second.container.firstChild as HTMLElement);
    expect(second.onClose).not.toHaveBeenCalled();
  });

  it("does not close when the panel itself is clicked", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the panel on open and restores it on close", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = renderDialog();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it("renders a footer only when one is supplied", () => {
    const { unmount } = renderDialog();
    expect(screen.queryByText("Send")).toBeNull();
    unmount();

    renderDialog({ footer: <button type="button">Send</button> });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("locks background scroll while open and restores it after", () => {
    const { unmount } = renderDialog();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
