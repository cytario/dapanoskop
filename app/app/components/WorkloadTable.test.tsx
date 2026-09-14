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

  describe("gross vs net", () => {
    it("shows muted gross secondary under Current when gross differs", () => {
      const wl: Workload[] = [
        {
          name: "data-pipeline",
          current_cost_usd: 5000,
          prev_month_cost_usd: 4800,
          yoy_cost_usd: 3200,
          gross_current_cost_usd: 5400,
        },
      ];
      const { container } = renderTable(wl);
      // Current stays net, gross shown as small secondary
      expect(container.textContent).toContain("$5,000.00");
      expect(container.textContent).toContain("Gross: $5,400.00");
    });

    it("shows no gross secondary when gross equals net within $0.01", () => {
      const wl: Workload[] = [
        {
          name: "data-pipeline",
          current_cost_usd: 5000,
          prev_month_cost_usd: 4800,
          yoy_cost_usd: 3200,
          gross_current_cost_usd: 5000.005,
        },
      ];
      const { container } = renderTable(wl);
      expect(container.textContent).not.toContain("Gross:");
    });

    it("shows no gross secondary when gross absent (old data)", () => {
      const { container } = renderTable(workloads);
      expect(container.textContent).not.toContain("Gross:");
    });

    it("uses gross-vs-gross MoM delta when both sides have gross", () => {
      const wl: Workload[] = [
        {
          name: "data-pipeline",
          current_cost_usd: 5000,
          prev_month_cost_usd: 4900, // net delta: +$100
          yoy_cost_usd: 3200,
          gross_current_cost_usd: 5500,
          gross_prev_month_cost_usd: 5200, // gross delta: +$300
        },
      ];
      const { container } = renderTable(wl);
      expect(container.textContent).toContain("+$300.00");
      expect(container.textContent).not.toContain("+$100.00");
    });

    it("falls back to net MoM delta when gross prev is absent", () => {
      const wl: Workload[] = [
        {
          name: "data-pipeline",
          current_cost_usd: 5000,
          prev_month_cost_usd: 4900, // net delta: +$100
          yoy_cost_usd: 3200,
          gross_current_cost_usd: 5500,
          // no gross_prev_month_cost_usd
        },
      ];
      const { container } = renderTable(wl);
      expect(container.textContent).toContain("+$100.00");
    });

    it("uses gross-vs-gross YoY delta when both sides have gross", () => {
      const wl: Workload[] = [
        {
          name: "data-pipeline",
          current_cost_usd: 5000,
          prev_month_cost_usd: 4800,
          yoy_cost_usd: 4000, // net delta: +$1,000
          gross_current_cost_usd: 5500,
          gross_yoy_cost_usd: 5000, // gross delta: +$500
        },
      ];
      const { container } = renderTable(wl);
      expect(container.textContent).toContain("+$500.00");
      expect(container.textContent).not.toContain("+$1,000.00");
    });

    it("uses gross prior partial for MTD MoM when available", () => {
      const wl: Workload[] = [
        {
          name: "data-pipeline",
          current_cost_usd: 5000,
          prev_month_cost_usd: 14000,
          yoy_cost_usd: 3200,
          gross_current_cost_usd: 5400,
        },
      ];
      const mtdCostCenter: MtdCostCenter = {
        name: "Engineering",
        prior_partial_cost_usd: 4200,
        workloads: [
          {
            name: "data-pipeline",
            prior_partial_cost_usd: 4000,
            gross_prior_partial_cost_usd: 5000,
          },
        ],
      };
      const { container } = renderTable(wl, {
        isMtd: true,
        mtdCostCenter,
      });
      // Gross pair: 5400 vs 5000 = +$400 (net pair would be +$1,000)
      expect(container.textContent).toContain("+$400.00");
    });
  });
});
