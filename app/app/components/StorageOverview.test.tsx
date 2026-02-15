import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StorageOverview } from "./StorageOverview";
import type { StorageMetrics } from "~/types/cost-data";

describe("StorageOverview", () => {
  const metrics: StorageMetrics = {
    total_cost_usd: 1234.56,
    prev_month_cost_usd: 1084.56,
    total_volume_bytes: 180000000000000,
    hot_tier_percentage: 62.3,
    cost_per_tb_usd: 23.33,
  };

  it("renders the storage cost card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    expect(container.textContent).toContain("Storage Cost");
    expect(container.textContent).toContain("$1,234.56");
  });

  it("renders the cost per TB card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    expect(container.textContent).toContain("Cost / TB");
    expect(container.textContent).toContain("$23.33");
  });

  it("renders the hot tier card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    expect(container.textContent).toContain("Hot Tier");
    expect(container.textContent).toContain("62.3%");
  });

  it("renders tooltip explanations for each metric card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    const tooltips = container.querySelectorAll('[role="tooltip"]');
    expect(tooltips.length).toBe(3);

    const tooltipTexts = Array.from(tooltips).map((t) => t.textContent);
    expect(tooltipTexts).toContain("Total cost of S3 storage for this period.");
    expect(tooltipTexts).toContain(
      "Total storage cost divided by the total volume of data stored, measured in terabytes (TB). Lower values indicate better storage cost efficiency.",
    );
    expect(tooltipTexts).toContain(
      "Percentage of stored data in frequently accessed tiers (e.g., S3 Standard, EFS Standard). High values may indicate optimization opportunities via lifecycle policies.",
    );
  });

  it("renders dynamic tooltip when storageConfig includes EFS and EBS", () => {
    const { container } = render(
      <StorageOverview
        metrics={metrics}
        storageConfig={{ include_efs: true, include_ebs: true }}
      />,
    );
    const tooltips = container.querySelectorAll('[role="tooltip"]');
    const tooltipTexts = Array.from(tooltips).map((t) => t.textContent);
    expect(tooltipTexts).toContain(
      "Total cost of S3, EFS, EBS storage for this period.",
    );
  });

  it("renders dynamic tooltip when storageConfig includes only EFS", () => {
    const { container } = render(
      <StorageOverview
        metrics={metrics}
        storageConfig={{ include_efs: true, include_ebs: false }}
      />,
    );
    const tooltips = container.querySelectorAll('[role="tooltip"]');
    const tooltipTexts = Array.from(tooltips).map((t) => t.textContent);
    expect(tooltipTexts).toContain(
      "Total cost of S3, EFS storage for this period.",
    );
  });

  it("renders dynamic tooltip when storageConfig includes only EBS", () => {
    const { container } = render(
      <StorageOverview
        metrics={metrics}
        storageConfig={{ include_efs: false, include_ebs: true }}
      />,
    );
    const tooltips = container.querySelectorAll('[role="tooltip"]');
    const tooltipTexts = Array.from(tooltips).map((t) => t.textContent);
    expect(tooltipTexts).toContain(
      "Total cost of S3, EBS storage for this period.",
    );
  });

  it("renders CostChange for storage cost month-over-month", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    // The CostChange component should show a delta between current and prev month
    expect(container.textContent).toContain("+$150.00");
  });
});
