import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Input from "./Input";
import Select from "./Select";
import Textarea from "./Textarea";

afterEach(cleanup);

const CATEGORIES = [
  { value: "technical", label: "Technical problem" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other", disabled: true }
];

describe("Input", () => {
  it("associates the label with the control", () => {
    render(<Input label="Subject" />);
    const field = screen.getByLabelText("Subject");
    expect(field.tagName).toBe("INPUT");
  });

  it("stays valid and undescribed with no error or description", () => {
    render(<Input label="Subject" />);
    const field = screen.getByLabelText("Subject");
    expect(field.getAttribute("aria-invalid")).toBeNull();
    expect(field.getAttribute("aria-describedby")).toBeNull();
  });

  it("marks itself invalid and points at the error text", () => {
    render(<Input label="Subject" error="Subject is required" />);
    const field = screen.getByLabelText("Subject");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toBe("Subject is required");
    expect(screen.getByRole("alert").textContent).toBe("Subject is required");
  });

  it("points at both description and error when both are present", () => {
    render(<Input label="Subject" description="Keep it short" error="Too long" />);
    const ids = (screen.getByLabelText("Subject").getAttribute("aria-describedby") as string).split(" ");
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual(["Keep it short", "Too long"]);
  });

  it("passes required and disabled through to the control", () => {
    const { unmount } = render(<Input label="Subject" required />);
    expect((screen.getByLabelText(/Subject/) as HTMLInputElement).required).toBe(true);
    unmount();

    render(<Input label="Subject" disabled />);
    expect((screen.getByLabelText("Subject") as HTMLInputElement).disabled).toBe(true);
  });

  it("keeps separate ids for two instances of the same label", () => {
    render(
      <>
        <Input label="Subject" error="a" />
        <Input label="Subject" error="b" />
      </>
    );
    const [first, second] = screen.getAllByLabelText("Subject");
    expect(first.id).not.toBe(second.id);
    expect(first.getAttribute("aria-describedby")).not.toBe(second.getAttribute("aria-describedby"));
  });

  it("reports typing through onChange", () => {
    const onChange = vi.fn();
    render(<Input label="Subject" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Broken odds" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("Textarea", () => {
  it("associates the label with the control", () => {
    render(<Textarea label="Message" />);
    expect(screen.getByLabelText("Message").tagName).toBe("TEXTAREA");
  });

  it("marks itself invalid and points at the error text", () => {
    render(<Textarea label="Message" error="Message is required" />);
    const field = screen.getByLabelText("Message");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby") as string;
    expect(document.getElementById(describedBy)?.textContent).toBe("Message is required");
  });

  it("applies maxLength and rows", () => {
    render(<Textarea label="Message" maxLength={500} rows={7} />);
    const field = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(field.maxLength).toBe(500);
    expect(field.rows).toBe(7);
  });

  it("defaults to four rows", () => {
    render(<Textarea label="Message" />);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).rows).toBe(4);
  });

  it("passes disabled through", () => {
    render(<Textarea label="Message" disabled />);
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe("Select", () => {
  it("associates the label with the control", () => {
    render(<Select label="Category" options={CATEGORIES} />);
    expect(screen.getByLabelText("Category").tagName).toBe("SELECT");
  });

  it("renders one option per entry", () => {
    render(<Select label="Category" options={CATEGORIES} />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["technical", "billing", "other"]);
    expect(options.map((o) => o.textContent)).toEqual(["Technical problem", "Billing", "Other"]);
  });

  it("disables an option that asks to be disabled", () => {
    render(<Select label="Category" options={CATEGORIES} />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => o.disabled)).toEqual([false, false, true]);
  });

  it("puts an unselectable placeholder first when asked", () => {
    render(<Select label="Category" options={CATEGORIES} placeholder="Choose one" value="" onChange={() => {}} />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options[0].textContent).toBe("Choose one");
    expect(options[0].disabled).toBe(true);
    expect(options[0].value).toBe("");
  });

  it("reflects value and reports selection through onChange", () => {
    const onChange = vi.fn();
    render(<Select label="Category" options={CATEGORIES} value="billing" onChange={onChange} />);
    const field = screen.getByLabelText("Category") as HTMLSelectElement;
    expect(field.value).toBe("billing");

    fireEvent.change(field, { target: { value: "technical" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("passes disabled through and marks itself invalid on error", () => {
    const { unmount } = render(<Select label="Category" options={CATEGORIES} disabled />);
    expect((screen.getByLabelText("Category") as HTMLSelectElement).disabled).toBe(true);
    unmount();

    render(<Select label="Category" options={CATEGORIES} error="Pick a category" />);
    const field = screen.getByLabelText("Category");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Pick a category");
  });

  it("renders no options for an empty list rather than failing", () => {
    render(<Select label="Category" options={[]} />);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
