import { describe, expect, test } from "vitest";
import { aggregateUsageTypes } from "./aggregate";
import type { UsageTypeCostRow } from "~/types/cost-data";

const CURRENT = "2026-01";
const PREV = "2025-12";
const YOY = "2025-01";

function makeRow(
  overrides: Partial<UsageTypeCostRow> & {
    usage_type: string;
    period: string;
    cost_usd: number;
  },
): UsageTypeCostRow {
  return {
    workload: "test-app",
    category: "Storage",
    usage_quantity: 0,
    ...overrides,
  };
}

describe("aggregateUsageTypes", () => {
  test("groups rows by usage_type correctly", () => {
    const rows: UsageTypeCostRow[] = [
      makeRow({ usage_type: "S3-Requests", period: CURRENT, cost_usd: 100 }),
      makeRow({
        usage_type: "EBS:VolumeUsage",
        period: CURRENT,
        cost_usd: 200,
      }),
    ];

    const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.usage_type)).toEqual([
      "EBS:VolumeUsage",
      "S3-Requests",
    ]);
  });

  test("sums current/prev/yoy periods independently", () => {
    const rows: UsageTypeCostRow[] = [
      makeRow({ usage_type: "S3-Requests", period: CURRENT, cost_usd: 100 }),
      makeRow({ usage_type: "S3-Requests", period: CURRENT, cost_usd: 50 }),
      makeRow({ usage_type: "S3-Requests", period: PREV, cost_usd: 80 }),
      makeRow({ usage_type: "S3-Requests", period: PREV, cost_usd: 30 }),
      makeRow({ usage_type: "S3-Requests", period: YOY, cost_usd: 60 }),
    ];

    const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(150);
    expect(result[0].prev).toBe(110);
    expect(result[0].yoy).toBe(60);
  });

  test("handles rows with only current period (prev=0, yoy=0)", () => {
    const rows: UsageTypeCostRow[] = [
      makeRow({ usage_type: "S3-Requests", period: CURRENT, cost_usd: 250 }),
    ];

    const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(250);
    expect(result[0].prev).toBe(0);
    expect(result[0].yoy).toBe(0);
  });

  test("sorts by current cost descending", () => {
    const rows: UsageTypeCostRow[] = [
      makeRow({ usage_type: "Small", period: CURRENT, cost_usd: 10 }),
      makeRow({ usage_type: "Large", period: CURRENT, cost_usd: 1000 }),
      makeRow({ usage_type: "Medium", period: CURRENT, cost_usd: 500 }),
    ];

    const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
    expect(result.map((r) => r.usage_type)).toEqual([
      "Large",
      "Medium",
      "Small",
    ]);
  });

  test("handles empty input", () => {
    const result = aggregateUsageTypes([], CURRENT, PREV, YOY);
    expect(result).toEqual([]);
  });

  test("handles same usage_type with different category across periods (first-wins)", () => {
    const rows: UsageTypeCostRow[] = [
      makeRow({
        usage_type: "DataTransfer",
        period: CURRENT,
        cost_usd: 100,
        category: "Compute",
      }),
      makeRow({
        usage_type: "DataTransfer",
        period: PREV,
        cost_usd: 80,
        category: "Other",
      }),
    ];

    const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
    expect(result).toHaveLength(1);
    // First row encountered sets the category
    expect(result[0].category).toBe("Compute");
    expect(result[0].current).toBe(100);
    expect(result[0].prev).toBe(80);
  });
});
