import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { GlobalSummary } from "./GlobalSummary";
import type { CostSummary, MtdComparison } from "~/types/cost-data";

function makeSummary(overrides?: Partial<CostSummary>): CostSummary {
  return {
    collected_at: "2026-01-08T03:00:00Z",
    period: "2026-01",
    periods: { current: "2026-01", prev_month: "2025-12", yoy: "2025-01" },
    totals: {
      current_cost_usd: 20000,
      prev_month_cost_usd: 19000,
      yoy_cost_usd: 14500,
    },
    storage_config: { include_efs: true, include_ebs: false },
    storage_metrics: {
      total_cost_usd: 100,
      prev_month_cost_usd: 90,
      total_volume_bytes: 1_099_511_627_776,
      hot_tier_percentage: 60,
      cost_per_tb_usd: 23,
    },
    cost_centers: [
      {
        name: "Engineering",
        current_cost_usd: 15000,
        prev_month_cost_usd: 14200,
        yoy_cost_usd: 11000,
        workloads: [],
      },
      {
        name: "Marketing",
        current_cost_usd: 5000,
        prev_month_cost_usd: 4800,
        yoy_cost_usd: 3500,
        workloads: [],
      },
    ],
    tagging_coverage: {
      tagged_cost_usd: 18000,
      untagged_cost_usd: 2000,
      tagged_percentage: 90,
    },
    ...overrides,
  };
}

describe("GlobalSummary", () => {
  it("renders total spend from totals", () => {
    const summary = makeSummary();
    render(<GlobalSummary summary={summary} />);
    expect(screen.getByText("$20,000.00")).toBeInTheDocument();
  });

  it("renders vs Last Month label by default", () => {
    const summary = makeSummary();
    const { container } = render(<GlobalSummary summary={summary} />);
    expect(container.textContent).toContain("vs Last Month");
  });

  it("renders vs Last Year label by default", () => {
    const summary = makeSummary();
    const { container } = render(<GlobalSummary summary={summary} />);
    expect(container.textContent).toContain("vs Last Year");
  });

  it("shows MTD like-for-like label when isMtd with mtdComparison", () => {
    const summary = makeSummary({
      totals: {
        current_cost_usd: 20000,
        prev_month_cost_usd: 19000,
        yoy_cost_usd: 14500,
        mtd_prior_partial_cost_usd: 5500,
      },
    });
    const mtdComparison: MtdComparison = {
      prior_partial_start: "2025-12-01",
      prior_partial_end_exclusive: "2025-12-08",
      cost_centers: [
        {
          name: "Engineering",
          prior_partial_cost_usd: 4000,
          workloads: [],
        },
        {
          name: "Marketing",
          prior_partial_cost_usd: 1500,
          workloads: [],
        },
      ],
    };
    const { container } = render(
      <GlobalSummary
        summary={summary}
        isMtd={true}
        mtdComparison={mtdComparison}
      />,
    );
    // Should show "vs Dec 1–7" instead of "vs Last Month"
    expect(container.textContent).toContain("vs Dec 1\u20137");
    expect(container.textContent).not.toContain("vs Last Month");
  });

  it("uses MTD partial costs from totals for comparison", () => {
    const summary = makeSummary({
      totals: {
        current_cost_usd: 20000,
        prev_month_cost_usd: 19000,
        yoy_cost_usd: 14500,
        mtd_prior_partial_cost_usd: 13000,
      },
    });
    const mtdComparison: MtdComparison = {
      prior_partial_start: "2025-12-01",
      prior_partial_end_exclusive: "2025-12-08",
      cost_centers: [],
    };
    const { container } = render(
      <GlobalSummary
        summary={summary}
        isMtd={true}
        mtdComparison={mtdComparison}
      />,
    );
    // Total current = 20000, MTD prior from totals = 13000, delta = +7000
    expect(container.textContent).toContain("+$7,000");
  });

  it("suppresses YoY and shows N/A (MTD) when isMtd", () => {
    const summary = makeSummary();
    const { container } = render(
      <GlobalSummary summary={summary} isMtd={true} />,
    );
    expect(container.textContent).toContain("N/A (MTD)");
  });

  it("falls back to standard MoM when isMtd but no mtd_prior_partial_cost_usd", () => {
    const summary = makeSummary();
    const { container } = render(
      <GlobalSummary summary={summary} isMtd={true} />,
    );
    // No mtd_prior_partial_cost_usd in totals, uses prev_month: 19000, delta = 20000 - 19000 = +1000
    expect(container.textContent).toContain("+$1,000");
  });

  it("treats zero-cost YoY as valid data, not unavailable", () => {
    const summary = makeSummary({
      totals: {
        current_cost_usd: 15000,
        prev_month_cost_usd: 14200,
        yoy_cost_usd: 0,
      },
    });
    const { container } = render(<GlobalSummary summary={summary} />);
    // YoY of $0 is valid — should show a delta, not "N/A"
    expect(container.textContent).toContain("vs Last Year");
    expect(container.textContent).not.toContain("N/A");
  });

  it("uses totals independent of cost center values", () => {
    const summary = makeSummary({
      totals: {
        current_cost_usd: 25000,
        prev_month_cost_usd: 22000,
        yoy_cost_usd: 18000,
      },
      cost_centers: [
        {
          name: "Engineering",
          current_cost_usd: 15000,
          prev_month_cost_usd: 14200,
          yoy_cost_usd: 11000,
          workloads: [],
        },
        {
          name: "Split Charges",
          current_cost_usd: 2000,
          prev_month_cost_usd: 1800,
          yoy_cost_usd: 1500,
          workloads: [],
          is_split_charge: true,
        },
      ],
    });
    const { container } = render(<GlobalSummary summary={summary} />);
    // Should use totals ($25,000), not sum of cost centers
    expect(container.textContent).toContain("$25,000.00");
    expect(container.textContent).not.toContain("$15,000.00");
    expect(container.textContent).not.toContain("$17,000.00");
  });
});
