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

  it("renders N/A when previous period cost is zero", () => {
    const rows = [makeRow({ period: currentPeriod, cost_usd: 100 })];
    // No prev period row => prev aggregates to 0 => N/A
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

  it.each([
    ["Storage", "bg-primary-100"],
    ["Compute", "bg-secondary-100"],
    ["Support", "bg-yellow-100"],
    ["Other", "bg-gray-100"],
  ] as const)(
    "renders correct badge class for %s category",
    (category, expectedClass) => {
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
      const badge = container.querySelector("span");
      expect(badge?.className).toContain(expectedClass);
      expect(badge?.textContent).toBe(category);
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
});
