import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, it, expect } from "vitest";
import { WorkloadTable } from "./WorkloadTable";
import type { Workload } from "~/types/cost-data";

function renderTable(workloads: Workload[]) {
  return render(
    <MemoryRouter>
      <WorkloadTable workloads={workloads} period="2026-01" />
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

  it("highlights rows with MoM change exceeding threshold", () => {
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
    const spikingRow = screen.getByText("spiking-service").closest("tr");
    const stableRow = screen.getByText("stable-service").closest("tr");
    expect(spikingRow).toHaveClass("bg-red-50");
    expect(stableRow).not.toHaveClass("bg-red-50");
  });

  it("flags new workloads with significant cost as anomalies", () => {
    const newWorkload: Workload[] = [
      {
        name: "brand-new",
        current_cost_usd: 500,
        prev_month_cost_usd: 0, // new workload, above $100 threshold
        yoy_cost_usd: 0,
      },
    ];
    renderTable(newWorkload);
    const row = screen.getByText("brand-new").closest("tr");
    expect(row).toHaveClass("bg-red-50");
  });

  it("does not flag new workloads with trivial cost as anomalies", () => {
    const cheapNew: Workload[] = [
      {
        name: "tiny-new",
        current_cost_usd: 5,
        prev_month_cost_usd: 0, // new but below $100 threshold
        yoy_cost_usd: 0,
      },
    ];
    renderTable(cheapNew);
    const row = screen.getByText("tiny-new").closest("tr");
    expect(row).not.toHaveClass("bg-red-50");
  });

  it("renders Untagged row with highlight", () => {
    const withUntagged: Workload[] = [
      {
        name: "Untagged",
        current_cost_usd: 500,
        prev_month_cost_usd: 480,
        yoy_cost_usd: 400,
      },
    ];
    renderTable(withUntagged);
    const row = screen.getByText("Untagged").closest("tr");
    expect(row).toHaveClass("bg-red-50");
  });
});
