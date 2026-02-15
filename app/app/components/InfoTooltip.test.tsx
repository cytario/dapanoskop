import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InfoTooltip } from "./InfoTooltip";

describe("InfoTooltip", () => {
  it("renders the info icon", () => {
    const { container } = render(<InfoTooltip text="Some help text" />);
    expect(container.textContent).toContain("i");
  });

  it("contains the tooltip text in the DOM", () => {
    const { container } = render(
      <InfoTooltip text="Total storage cost divided by volume." />,
    );
    expect(container.textContent).toContain(
      "Total storage cost divided by volume.",
    );
  });

  it("has aria-label for accessibility", () => {
    const { container } = render(<InfoTooltip text="Help text here" />);
    const icon = container.querySelector('[aria-label="Help text here"]');
    expect(icon).not.toBeNull();
  });

  it("has role=tooltip on the tooltip element", () => {
    const { container } = render(<InfoTooltip text="Explanation" />);
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toBe("Explanation");
  });

  it("wrapper is keyboard-focusable via tabIndex", () => {
    const { container } = render(<InfoTooltip text="Focusable" />);
    const wrapper = container.querySelector('[tabindex="0"]');
    expect(wrapper).not.toBeNull();
  });
});
