import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, it, expect } from "vitest";
import { WorkloadTable } from "./WorkloadTable";
import type { Workload, MtdCostCenter } from "~/types/cost-data";

function renderTable(
  workloads: Workload[],
  opts?: { isMtd?: boolean; mtdCostCenter?: MtdCostCenter },
) {
  return render(
    <MemoryRouter>
      <WorkloadTable
        workloads={workloads}
        period="2026-01"
        isMtd={opts?.isMtd}
        mtdCostCenter={opts?.mtdCostCenter}
      />
    </MemoryRouter>,
  );
}

describe("WorkloadTable", () => {
  const workloads: Workload[] = [
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
  ];

  it("renders workload rows", () => {
    renderTable(workloads);
    expect(screen.getByText("data-pipeline")).toBeInTheDocument();
    expect(screen.getByText("web-app")).toBeInTheDocument();
  });

  it("renders workload names as links", () => {
    renderTable(workloads);
    const links = screen.getAllByText("data-pipeline");
    const link = links[0].closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/workload/data-pipeline?period=2026-01",
    );
  });

  it("renders anomalous workload rows", () => {
    const anomalous: Workload[] = [
      {
        name: "spiking-service",
        current_cost_usd: 2000,
        prev_month_cost_usd: 1000, // +100% change
        yoy_cost_usd: 800,
      },
      {
        name: "stable-service",
        current_cost_usd: 1000,
        prev_month_cost_usd: 990, // ~1% change
        yoy_cost_usd: 900,
      },
    ];
    renderTable(anomalous);
    expect(screen.getByText("spiking-service")).toBeInTheDocument();
    expect(screen.getByText("stable-service")).toBeInTheDocument();
  });

  it("renders new workload rows", () => {
    const newWorkload: Workload[] = [
      {
        name: "brand-new",
        current_cost_usd: 500,
        prev_month_cost_usd: 0,
        yoy_cost_usd: 0,
      },
    ];
    renderTable(newWorkload);
    expect(screen.getByText("brand-new")).toBeInTheDocument();
  });

  it("renders Untagged row with danger styling", () => {
    const withUntagged: Workload[] = [
      {
        name: "Untagged",
        current_cost_usd: 500,
        prev_month_cost_usd: 480,
        yoy_cost_usd: 400,
      },
    ];
    renderTable(withUntagged);
    const untaggedSpan = screen.getByText("Untagged");
    expect(untaggedSpan).toHaveClass("text-red-700");
  });

  it("shows MTD prior partial comparison when mtdCostCenter is provided", () => {
    const workloads: Workload[] = [
      {
        name: "data-pipeline",
        current_cost_usd: 5000,
        prev_month_cost_usd: 14000,
        yoy_cost_usd: 3200,
      },
    ];
    const mtdCostCenter: MtdCostCenter = {
      name: "Engineering",
      prior_partial_cost_usd: 4200,
      workloads: [{ name: "data-pipeline", prior_partial_cost_usd: 4200 }],
    };
    const { container } = renderTable(workloads, {
      isMtd: true,
      mtdCostCenter,
    });
    // Should use MTD partial cost ($4200), not full month ($14000)
    // Delta = $5000 - $4200 = $800, so should show +$800.00
    expect(container.textContent).toContain("+$800.00");
  });

  it("suppresses YoY and shows N/A (MTD) when isMtd is true", () => {
    const workloads: Workload[] = [
      {
        name: "data-pipeline",
        current_cost_usd: 5000,
        prev_month_cost_usd: 4800,
        yoy_cost_usd: 3200,
      },
    ];
    const { container } = renderTable(workloads, { isMtd: true });
    expect(container.textContent).toContain("N/A (MTD)");
  });

  it("falls back to standard MoM when isMtd but no mtdCostCenter", () => {
    const workloads: Workload[] = [
      {
        name: "data-pipeline",
        current_cost_usd: 5000,
        prev_month_cost_usd: 4800,
        yoy_cost_usd: 3200,
      },
    ];
    const { container } = renderTable(workloads, { isMtd: true });
    // Should use prev_month_cost_usd ($4800): delta = +$200.00
    expect(container.textContent).toContain("+$200.00");
  });

  it("shows vs Prior Partial header when isMtd", () => {
    const workloads: Workload[] = [
      {
        name: "data-pipeline",
        current_cost_usd: 5000,
        prev_month_cost_usd: 4800,
        yoy_cost_usd: 3200,
      },
    ];
    const { container } = renderTable(workloads, { isMtd: true });
    const headers = container.querySelectorAll("th");
    const texts = Array.from(headers).map((h) => h.textContent);
    expect(texts).toContain("vs Prior Partial");
  });
});
