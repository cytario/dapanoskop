import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UsageTypeTable } from "./UsageTypeTable";
import type { UsageTypeCostRow } from "~/types/cost-data";

/**
 * Component tests for UsageTypeTable.
 *
 * Verifies rendering of the usage-type cost table including:
 * - Column headers and row data
 * - Category badge rendering for all 4 categories
 * - CostChange vs N/A fallback logic for prev/yoy columns
 * - Correct aggregation integration (rows sorted by current cost desc)
 * - Gross (cost_usd) primary display with optional net (net_cost_usd)
 *   secondary "after credits" figure
 *
 * Used by both workload-detail and storage-cost-detail routes.
 */

describe("UsageTypeTable", () => {
  const currentPeriod = "2026-01";
  const prevPeriod = "2025-12";
  const yoyPeriod = "2025-01";

  const makeRow = (
    overrides: Partial<UsageTypeCostRow> = {},
  ): UsageTypeCostRow => ({
    workload: "web-app",
    usage_type: "APN1-TimedStorage-ByteHrs",
    category: "Storage",
    period: currentPeriod,
    cost_usd: 100,
    usage_quantity: 500,
    ...overrides,
  });

  it("renders column headers", () => {
    const { container } = render(
      <UsageTypeTable
        rows={[makeRow()]}
        currentPeriod={currentPeriod}
        prevPeriod={prevPeriod}
        yoyPeriod={yoyPeriod}
      />,
    );
    const headers = Array.from(container.querySelectorAll("th")).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual([
      "Usage Type",
      "Category",
      "Current",
      "vs Last Month",
      "vs Last Year",
    ]);
  });

  it("renders usage type name and formatted cost", () => {
    const { container } = render(
      <UsageTypeTable
        rows={[makeRow({ cost_usd: 1234.56 })]}
        currentPeriod={currentPeriod}
        prevPeriod={prevPeriod}
        yoyPeriod={yoyPeriod}
      />,
    );
    expect(container.textContent).toContain("APN1-TimedStorage-ByteHrs");
    expect(container.textContent).toContain("$1,234.56");
  });

  it("renders N/A when previous period data is missing", () => {
    const rows = [makeRow({ period: currentPeriod, cost_usd: 100 })];
    // No prev period row => prev aggregates to null => N/A
    const { container } = render(
      <UsageTypeTable
        rows={rows}
        currentPeriod={currentPeriod}
        prevPeriod={prevPeriod}
        yoyPeriod={yoyPeriod}
      />,
    );
    const cells = container.querySelectorAll("td");
    // Columns: usage_type, category, current, vs last month, vs last year
    const vsLastMonth = cells[3]?.textContent;
    const vsLastYear = cells[4]?.textContent;
    expect(vsLastMonth).toBe("N/A");
    expect(vsLastYear).toBe("N/A");
  });

  it("renders delta (not N/A) when previous period cost is zero", () => {
    const rows = [
      makeRow({ period: currentPeriod, cost_usd: 100 }),
      makeRow({ period: prevPeriod, cost_usd: 0 }),
    ];
    const { container } = render(
      <UsageTypeTable
        rows={rows}
        currentPeriod={currentPeriod}
        prevPeriod={prevPeriod}
        yoyPeriod={yoyPeriod}
      />,
    );
    const cells = container.querySelectorAll("td");
    const vsLastMonth = cells[3]?.textContent;
    // Zero cost previous period is valid data — should show delta, not N/A
    expect(vsLastMonth).not.toBe("N/A");
    expect(vsLastMonth).toContain("+$100.00");
  });

  it("renders CostChange when previous period data exists", () => {
    const rows = [
      makeRow({ period: currentPeriod, cost_usd: 150 }),
      makeRow({ period: prevPeriod, cost_usd: 100 }),
    ];
    const { container } = render(
      <UsageTypeTable
        rows={rows}
        currentPeriod={currentPeriod}
        prevPeriod={prevPeriod}
        yoyPeriod={yoyPeriod}
      />,
    );
    const cells = container.querySelectorAll("td");
    const vsLastMonth = cells[3]?.textContent;
    // CostChange should show +$50.00 (+50.0%)
    expect(vsLastMonth).toContain("+$50.00");
  });

  it.each(["Storage", "Compute", "Support", "Other"] as const)(
    "renders badge for %s category",
    (category) => {
      const rows = [
        makeRow({
          category: category as UsageTypeCostRow["category"],
          period: currentPeriod,
        }),
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      // The cytario Badge renders the category text
      expect(container.textContent).toContain(category);
    },
  );

  it("renders rows sorted by current cost descending", () => {
    const rows = [
      makeRow({
        usage_type: "Cheap-Type",
        period: currentPeriod,
        cost_usd: 10,
      }),
      makeRow({
        usage_type: "Expensive-Type",
        period: currentPeriod,
        cost_usd: 500,
      }),
      makeRow({
        usage_type: "Mid-Type",
        period: currentPeriod,
        cost_usd: 100,
      }),
    ];
    const { container } = render(
      <UsageTypeTable
        rows={rows}
        currentPeriod={currentPeriod}
        prevPeriod={prevPeriod}
        yoyPeriod={yoyPeriod}
      />,
    );
    const usageTypeCells = container.querySelectorAll("tbody td:first-child");
    const order = Array.from(usageTypeCells).map((td) => td.textContent);
    expect(order).toEqual(["Expensive-Type", "Mid-Type", "Cheap-Type"]);
  });

  describe("gross vs net", () => {
    it("shows gross (cost_usd) as the primary Current value", () => {
      const rows = [
        makeRow({
          period: currentPeriod,
          cost_usd: 115, // gross
          net_cost_usd: 100, // net
        }),
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      // Gross primary
      expect(container.textContent).toContain("$115.00");
      // Net secondary "after credits"
      expect(container.textContent).toContain("After credits: $100.00");
    });

    it("shows no net secondary when net equals gross within $0.01", () => {
      const rows = [
        makeRow({
          period: currentPeriod,
          cost_usd: 100,
          net_cost_usd: 99.995,
        }),
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      expect(container.textContent).toContain("$100.00");
      expect(container.textContent).not.toContain("After credits");
    });

    it("falls back to cost_usd alone when net absent (old data)", () => {
      const rows = [makeRow({ period: currentPeriod, cost_usd: 100 })];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      expect(container.textContent).toContain("$100.00");
      expect(container.textContent).not.toContain("After credits");
    });

    it("shows net secondary at exactly $0.01 gross/net difference", () => {
      const rows = [
        makeRow({
          period: currentPeriod,
          cost_usd: 100.01,
          net_cost_usd: 100,
        }),
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      expect(container.textContent).toContain("After credits: $100.00");
    });

    it("computes the MoM delta gross-to-gross (cost_usd sums)", () => {
      const rows = [
        makeRow({
          period: currentPeriod,
          cost_usd: 170, // gross
          net_cost_usd: 150,
        }),
        makeRow({
          period: prevPeriod,
          cost_usd: 100, // gross prev
          net_cost_usd: 100,
        }),
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      // Gross delta: 170 - 100 = +$70 (net delta would be +$50)
      expect(container.textContent).toContain("+$70.00");
      expect(container.textContent).not.toContain("+$50.00");
    });

    it("computes the YoY delta gross-to-gross (cost_usd sums)", () => {
      const rows = [
        makeRow({
          period: currentPeriod,
          cost_usd: 170,
          net_cost_usd: 150,
        }),
        makeRow({
          period: yoyPeriod,
          cost_usd: 110,
          net_cost_usd: 120,
        }),
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      // Gross delta: 170 - 110 = +$60 (net delta would be +$30)
      expect(container.textContent).toContain("+$60.00");
      expect(container.textContent).not.toContain("+$30.00");
    });

    it("mixes rows with and without net across periods", () => {
      const rows = [
        makeRow({
          period: currentPeriod,
          cost_usd: 120,
          net_cost_usd: 100,
        }),
        makeRow({ period: prevPeriod, cost_usd: 80 }), // old-format row
      ];
      const { container } = render(
        <UsageTypeTable
          rows={rows}
          currentPeriod={currentPeriod}
          prevPeriod={prevPeriod}
          yoyPeriod={yoyPeriod}
        />,
      );
      // Gross MoM: 120 - 80 = +$40
      expect(container.textContent).toContain("+$40.00");
      // Net secondary: old row contributes its cost_usd, so net = 100
      expect(container.textContent).toContain("After credits: $100.00");
    });
  });
});
