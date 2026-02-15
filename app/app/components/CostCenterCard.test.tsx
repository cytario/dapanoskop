import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, it, expect } from "vitest";
import { CostCenterCard } from "./CostCenterCard";
import type { CostCenter } from "~/types/cost-data";

function renderCard(costCenter: CostCenter) {
  return render(
    <MemoryRouter>
      <CostCenterCard costCenter={costCenter} period="2026-01" />
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
    expect(screen.queryByRole("table")).toBeNull();
    const expandBtns = screen.getAllByLabelText("Expand");
    fireEvent.click(expandBtns[0]);
    expect(screen.getAllByRole("table").length).toBeGreaterThanOrEqual(1);
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
    // Should show top mover with 0.0% (division by zero case)
    expect(container.textContent).toContain("Top mover:");
    expect(container.textContent).toContain("0.0% MoM");
  });
});
