import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StorageOverview } from "./StorageOverview";
import type { StorageMetrics } from "~/types/cost-data";

describe("StorageOverview", () => {
  const metrics: StorageMetrics = {
    total_cost_usd: 1234.56,
    prev_month_cost_usd: 1084.56,
    total_volume_bytes: 5497558138880,
    hot_tier_percentage: 62.3,
    cost_per_tb_usd: 23.45,
  };

  it("renders the storage cost card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    expect(container.textContent).toContain("Storage Cost");
    expect(container.textContent).toContain("$1,234.56");
  });

  it("renders the cost per TB card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    expect(container.textContent).toContain("Cost / TB");
    expect(container.textContent).toContain("$23.45");
  });

  it("renders the hot tier card", () => {
    const { container } = render(<StorageOverview metrics={metrics} />);
    expect(container.textContent).toContain("Hot Tier");
    expect(container.textContent).toContain("62.3%");
  });
});
