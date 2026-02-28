import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TaggingCoverage } from "./TaggingCoverage";

describe("TaggingCoverage", () => {
  const data = {
    tagged_cost_usd: 14000,
    untagged_cost_usd: 1000,
    tagged_percentage: 93.3,
  };

  it("renders the progress bar with correct aria value", () => {
    render(<TaggingCoverage data={data} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveAttribute("aria-valuenow", "93.3");
  });

  it("displays tagged percentage and cost text", () => {
    const { container } = render(<TaggingCoverage data={data} />);
    const text = container.textContent!;
    expect(text).toContain("93.3% tagged");
    expect(text).toContain("$14,000.00");
  });

  it("displays untagged cost", () => {
    const { container } = render(<TaggingCoverage data={data} />);
    const text = container.textContent!;
    expect(text).toContain("$1,000.00");
    expect(text).toContain("untagged");
  });
});
