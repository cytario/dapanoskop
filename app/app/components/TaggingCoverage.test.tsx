import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { TaggingCoverage } from "./TaggingCoverage";

describe("TaggingCoverage", () => {
  const data = {
    tagged_cost_usd: 14000,
    untagged_cost_usd: 1000,
    tagged_percentage: 93.3,
  };

  it("renders the percentage bar with correct width", () => {
    const { container } = render(<TaggingCoverage data={data} />);
    const bar = container.querySelector(
      ".bg-primary-600",
    ) as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar!.style.width).toBe("93.3%");
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
