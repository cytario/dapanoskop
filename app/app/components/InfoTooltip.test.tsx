import { render, screen, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InfoTooltip } from "./InfoTooltip";

describe("InfoTooltip", () => {
  it("renders the info icon", () => {
    const { container } = render(<InfoTooltip text="Some help text" />);
    expect(container.textContent).toContain("i");
  });

  it("has aria-label for accessibility", () => {
    render(<InfoTooltip text="Help text here" />);
    const button = screen.getByRole("button", { name: "Help text here" });
    expect(button).toBeInTheDocument();
  });

  it("shows tooltip on focus", async () => {
    render(<InfoTooltip text="Explanation" />);
    const trigger = screen.getByRole("button", { name: "Explanation" });
    await act(async () => {
      trigger.focus();
    });
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.textContent).toBe("Explanation");
  });

  it("trigger is keyboard-focusable", () => {
    render(<InfoTooltip text="Focusable" />);
    const trigger = screen.getByRole("button", { name: "Focusable" });
    expect(trigger).toBeTruthy();
    trigger.focus();
    expect(trigger).toHaveFocus();
  });
});
