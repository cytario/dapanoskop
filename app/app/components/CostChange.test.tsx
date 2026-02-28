import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CostChange } from "./CostChange";

describe("CostChange (DeltaIndicator)", () => {
  it("shows decrease indicator for cost decrease", () => {
    render(<CostChange current={900} previous={1000} />);
    // DeltaIndicator renders an ArrowDown icon (lucide-react) for decrease
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    // The formatted text should show negative diff
    expect(screen.getByText(/-\$100/)).toBeInTheDocument();
  });

  it("shows increase indicator for cost increase", () => {
    render(<CostChange current={1100} previous={1000} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(screen.getByText(/\+\$100/)).toBeInTheDocument();
  });

  it("shows flat indicator for no change", () => {
    render(<CostChange current={1000} previous={1000} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(screen.getByText(/\+\$0/)).toBeInTheDocument();
  });

  it("renders optional label", () => {
    render(<CostChange current={1100} previous={1000} label="MoM" />);
    expect(screen.getByText("MoM")).toBeInTheDocument();
  });
});
