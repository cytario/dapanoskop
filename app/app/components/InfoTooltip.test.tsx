import { render, screen, act, fireEvent } from "@testing-library/react";
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
    // react-aria-components only shows the tooltip on :focus-visible, which
    // requires keyboard-originated focus. A bare programmatic `.focus()` in
    // jsdom doesn't qualify, so emulate the Tab keydown that would precede
    // focus in a real keyboard interaction.
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      trigger.focus();
    });
    const tooltip = await screen.findByRole("tooltip", {}, { timeout: 3000 });
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
