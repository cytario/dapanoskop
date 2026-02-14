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

  it("shows workload count", () => {
    renderCard(costCenter);
    const matches = screen.getAllByText(/2 workloads/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("expands to show workload table on click", () => {
    renderCard(costCenter);
    expect(screen.queryByRole("table")).toBeNull();
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
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
});
