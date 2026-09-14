import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, it, expect } from "vitest";
import { CostCenterCard } from "./CostCenterCard";
import type { CostCenter, MtdComparison } from "~/types/cost-data";

function renderCard(
  costCenter: CostCenter,
  opts?: { isMtd?: boolean; mtdComparison?: MtdComparison },
) {
  return render(
    <MemoryRouter>
      <CostCenterCard
        costCenter={costCenter}
        period="2026-01"
        isMtd={opts?.isMtd}
        mtdComparison={opts?.mtdComparison}
      />
    </MemoryRouter>,
  );
}

describe("CostCenterCard", () => {
  const costCenter: CostCenter = {
    name: "Engineering",
    current_cost_usd: 15000,
    prev_month_cost_usd: 14200,
    yoy_cost_usd: 11000,
    workloads: [
      {
        name: "data-pipeline",
        current_cost_usd: 5000,
        prev_month_cost_usd: 4800,
        yoy_cost_usd: 3200,
      },
      {
        name: "web-app",
        current_cost_usd: 3000,
        prev_month_cost_usd: 2900,
        yoy_cost_usd: 2500,
      },
    ],
  };

  it("renders cost center name and total cost", () => {
    renderCard(costCenter);
    expect(screen.getByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("$15,000.00")).toBeInTheDocument();
  });

  it("renders cost center name as a link to detail page", () => {
    renderCard(costCenter);
    const links = screen.getAllByRole("link", { name: "Engineering" });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].getAttribute("href")).toBe(
      "/cost-center/Engineering?period=2026-01",
    );
  });

  it("URL-encodes cost center names with special characters", () => {
    const specialCC: CostCenter = {
      name: "R&D / Labs",
      current_cost_usd: 5000,
      prev_month_cost_usd: 4000,
      yoy_cost_usd: 3000,
      workloads: [],
    };
    renderCard(specialCC);
    const link = screen.getByRole("link", { name: "R&D / Labs" });
    expect(link.getAttribute("href")).toBe(
      "/cost-center/R%26D%20%2F%20Labs?period=2026-01",
    );
  });

  it("shows workload count", () => {
    renderCard(costCenter);
    const matches = screen.getAllByText(/2 workloads/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("expands to show workload table on chevron click", () => {
    renderCard(costCenter);
    // React Aria Table renders as role="grid"
    expect(screen.queryByRole("grid")).toBeNull();
    const expandBtns = screen.getAllByLabelText("Expand");
    fireEvent.click(expandBtns[0]);
    expect(screen.getAllByRole("grid").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("data-pipeline").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("does NOT crash with empty workloads array", () => {
    const empty: CostCenter = {
      name: "Empty Center",
      current_cost_usd: 0,
      prev_month_cost_usd: 0,
      yoy_cost_usd: 0,
      workloads: [],
    };
    expect(() => renderCard(empty)).not.toThrow();
    expect(screen.getByText("Empty Center")).toBeInTheDocument();
    const matches = screen.getAllByText(/0 workloads/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("handles top mover when all workloads have zero MoM change", () => {
    const flatCC: CostCenter = {
      name: "Stable Center",
      current_cost_usd: 10000,
      prev_month_cost_usd: 10000,
      yoy_cost_usd: 8000,
      workloads: [
        {
          name: "workload-a",
          current_cost_usd: 5000,
          prev_month_cost_usd: 5000,
          yoy_cost_usd: 4000,
        },
        {
          name: "workload-b",
          current_cost_usd: 5000,
          prev_month_cost_usd: 5000,
          yoy_cost_usd: 4000,
        },
      ],
    };
    const { container } = renderCard(flatCC);
    // Should still render top mover with 0.0% change
    expect(container.textContent).toContain("Top mover:");
    expect(container.textContent).toContain("0.0% MoM");
  });

  it("handles top mover when prev_month_cost_usd is zero", () => {
    const newWorkloadCC: CostCenter = {
      name: "New Workload Center",
      current_cost_usd: 5000,
      prev_month_cost_usd: 0,
      yoy_cost_usd: 0,
      workloads: [
        {
          name: "brand-new-workload",
          current_cost_usd: 5000,
          prev_month_cost_usd: 0,
          yoy_cost_usd: 0,
        },
      ],
    };
    const { container } = renderCard(newWorkloadCC);
    // Should show top mover with "New" when prev is 0 and current > 0
    expect(container.textContent).toContain("Top mover:");
    expect(container.textContent).toContain("New MoM");
  });

  it("shows MTD like-for-like comparison label when isMtd with mtdComparison", () => {
    const mtdComparison: MtdComparison = {
      prior_partial_start: "2025-12-01",
      prior_partial_end_exclusive: "2025-12-08",
      cost_centers: [
        {
          name: "Engineering",
          prior_partial_cost_usd: 4200,
          workloads: [
            { name: "data-pipeline", prior_partial_cost_usd: 2000 },
            { name: "web-app", prior_partial_cost_usd: 1500 },
          ],
        },
      ],
    };
    const { container } = renderCard(costCenter, {
      isMtd: true,
      mtdComparison,
    });
    // Should show "vs Dec 1-7" label instead of "MoM"
    expect(container.textContent).toContain("vs Dec 1\u20137");
  });

  it("suppresses YoY and shows N/A (MTD) when isMtd", () => {
    const { container } = renderCard(costCenter, { isMtd: true });
    expect(container.textContent).toContain("YoY N/A (MTD)");
  });

  it("uses MTD partial cost for comparison when mtdComparison provided", () => {
    const mtdComparison: MtdComparison = {
      prior_partial_start: "2025-12-01",
      prior_partial_end_exclusive: "2025-12-08",
      cost_centers: [
        {
          name: "Engineering",
          prior_partial_cost_usd: 10000,
          workloads: [
            { name: "data-pipeline", prior_partial_cost_usd: 4000 },
            { name: "web-app", prior_partial_cost_usd: 2500 },
          ],
        },
      ],
    };
    const { container } = renderCard(costCenter, {
      isMtd: true,
      mtdComparison,
    });
    // Cost center: current=$15000, MTD prior=$10000, delta=+$5000
    expect(container.textContent).toContain("+$5,000");
  });

  it("falls back to standard MoM when isMtd but no mtdComparison", () => {
    const { container } = renderCard(costCenter, { isMtd: true });
    // Should use prev_month_cost_usd ($14200): delta = $15000-$14200 = +$800
    expect(container.textContent).toContain("+$800.00");
  });

  describe("gross vs net", () => {
    it("shows secondary gross line when gross exceeds net by >= $0.01", () => {
      const grossCC: CostCenter = {
        ...costCenter,
        gross_current_cost_usd: 16500,
        gross_prev_month_cost_usd: 15500,
        gross_yoy_cost_usd: 12000,
      };
      const { container } = renderCard(grossCC);
      // Main figure stays net (allocated total)
      expect(container.textContent).toContain("$15,000.00");
      // Secondary gross line
      expect(container.textContent).toContain(
        "Gross: $16,500.00 (before credits)",
      );
    });

    it("shows no gross line when gross equals net within $0.01", () => {
      const grossCC: CostCenter = {
        ...costCenter,
        gross_current_cost_usd: 15000.005,
      };
      const { container } = renderCard(grossCC);
      expect(container.textContent).not.toContain("before credits");
    });

    it("shows no gross line when gross absent (old data)", () => {
      const { container } = renderCard(costCenter);
      expect(container.textContent).not.toContain("before credits");
      expect(container.textContent).toContain("$15,000.00");
    });

    it("does not show gross line for split charge cost centers", () => {
      const splitCC: CostCenter = {
        name: "Split Charges",
        current_cost_usd: 2000,
        prev_month_cost_usd: 1800,
        yoy_cost_usd: 1500,
        gross_current_cost_usd: 2500,
        workloads: [],
        is_split_charge: true,
      };
      const { container } = renderCard(splitCC);
      expect(container.textContent).not.toContain("before credits");
    });

    it("prefers gross-based top mover delta when gross fields present", () => {
      const grossCC: CostCenter = {
        name: "Engineering",
        current_cost_usd: 15000,
        prev_month_cost_usd: 14200,
        yoy_cost_usd: 11000,
        workloads: [
          {
            name: "data-pipeline",
            current_cost_usd: 5000,
            prev_month_cost_usd: 4900, // net delta: 100
            yoy_cost_usd: 3200,
            gross_current_cost_usd: 5500,
            gross_prev_month_cost_usd: 5200, // gross delta: 300
            gross_yoy_cost_usd: 3500,
          },
          {
            name: "web-app",
            current_cost_usd: 3000,
            prev_month_cost_usd: 2950, // net delta: 50
            yoy_cost_usd: 2500,
          },
        ],
      };
      const { container } = renderCard(grossCC);
      // Top mover: data-pipeline with gross-based +300/5200 = 5.8%
      expect(container.textContent).toContain("Top mover: data-pipeline");
      expect(container.textContent).toContain("5.8% MoM");
    });

    it("uses gross prior partial in top mover when MTD gross available", () => {
      const grossCC: CostCenter = {
        name: "Engineering",
        current_cost_usd: 15000,
        prev_month_cost_usd: 14200,
        yoy_cost_usd: 11000,
        workloads: [
          {
            name: "data-pipeline",
            current_cost_usd: 5000,
            prev_month_cost_usd: 4800,
            yoy_cost_usd: 3200,
            gross_current_cost_usd: 5400,
          },
        ],
      };
      const mtdComparison: MtdComparison = {
        prior_partial_start: "2025-12-01",
        prior_partial_end_exclusive: "2025-12-08",
        cost_centers: [
          {
            name: "Engineering",
            prior_partial_cost_usd: 4500,
            workloads: [
              {
                name: "data-pipeline",
                prior_partial_cost_usd: 4000,
                // gross prior: pair becomes 5400 vs 5000 = 8.0%
                gross_prior_partial_cost_usd: 5000,
              },
            ],
          },
        ],
      };
      const { container } = renderCard(grossCC, {
        isMtd: true,
        mtdComparison,
      });
      // Net pair would be 5000/4000 = 25.0%; gross pair is 5400/5000 = 8.0%
      expect(container.textContent).toContain("8.0% partial");
    });
  });
});
