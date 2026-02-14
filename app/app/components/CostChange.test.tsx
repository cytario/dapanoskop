import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CostChange } from "./CostChange";

describe("CostChange", () => {
  it("shows green with down arrow for cost decrease", () => {
    const { container } = render(<CostChange current={900} previous={1000} />);
    const span = container.querySelector("span")!;
    expect(span).toHaveClass("text-green-600");
    expect(span.textContent).toContain("▼");
  });

  it("shows red with up arrow for cost increase", () => {
    const { container } = render(<CostChange current={1100} previous={1000} />);
    const span = container.querySelector("span")!;
    expect(span).toHaveClass("text-red-600");
    expect(span.textContent).toContain("▲");
  });

  it("shows gray with no arrow for flat cost", () => {
    const { container } = render(<CostChange current={1000} previous={1000} />);
    const span = container.querySelector("span")!;
    expect(span).toHaveClass("text-gray-500");
    expect(span.textContent).not.toContain("▲");
    expect(span.textContent).not.toContain("▼");
  });

  it("renders optional label", () => {
    render(<CostChange current={1100} previous={1000} label="MoM" />);
    expect(screen.getByText("MoM")).toBeInTheDocument();
  });
});
