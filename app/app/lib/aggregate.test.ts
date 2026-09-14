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

  test("handles rows with only current period (prev=null, yoy=null)", () => {
    const rows: UsageTypeCostRow[] = [
      makeRow({ usage_type: "S3-Requests", period: CURRENT, cost_usd: 250 }),
    ];

    const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
    expect(result).toHaveLength(1);
    expect(result[0].current).toBe(250);
    expect(result[0].prev).toBeNull();
    expect(result[0].yoy).toBeNull();
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

  describe("net handling (cost_usd is gross)", () => {
    test("old data without net_cost_usd: both figures are net, no secondary", () => {
      const rows: UsageTypeCostRow[] = [
        makeRow({ usage_type: "S3-Requests", period: CURRENT, cost_usd: 100 }),
        makeRow({ usage_type: "S3-Requests", period: PREV, cost_usd: 80 }),
        makeRow({ usage_type: "S3-Requests", period: YOY, cost_usd: 60 }),
      ];

      const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
      // cost_usd sums are the (only) figures — no net secondary surfaces
      expect(result[0].current).toBe(100);
      expect(result[0].prev).toBe(80);
      expect(result[0].yoy).toBe(60);
      expect(result[0].net).toBeNull();
    });

    test("net is surfaced only when it differs from gross by >= $0.01", () => {
      const rows: UsageTypeCostRow[] = [
        makeRow({
          usage_type: "S3-Requests",
          period: CURRENT,
          cost_usd: 110, // gross
          net_cost_usd: 100, // net
        }),
        makeRow({
          usage_type: "S3-Requests",
          period: PREV,
          cost_usd: 88,
          net_cost_usd: 80,
        }),
        makeRow({
          usage_type: "S3-Requests",
          period: YOY,
          cost_usd: 66,
          net_cost_usd: 60,
        }),
      ];

      const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
      // cost_usd (gross) sums are the primary figures
      expect(result[0].current).toBe(110);
      expect(result[0].prev).toBe(88);
      expect(result[0].yoy).toBe(66);
      // net differs by >= 0.01 => net secondary is surfaced
      expect(result[0].net).toBe(100);
    });

    test("surfaces net at exactly $0.01 difference", () => {
      const rows: UsageTypeCostRow[] = [
        makeRow({
          usage_type: "S3-Requests",
          period: CURRENT,
          cost_usd: 100.01,
          net_cost_usd: 100,
        }),
      ];

      const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
      expect(result[0].net).toBe(100);
    });

    test("suppresses net secondary when gross equals net within $0.01", () => {
      const rows: UsageTypeCostRow[] = [
        makeRow({
          usage_type: "S3-Requests",
          period: CURRENT,
          cost_usd: 100,
          net_cost_usd: 99.995,
        }),
      ];

      const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
      expect(result[0].net).toBeNull();
    });

    test("mixes old rows (no net) with new rows (net) per period", () => {
      const rows: UsageTypeCostRow[] = [
        // old-format row: no net_cost_usd — contributes cost_usd to net sum
        makeRow({ usage_type: "Mixed", period: CURRENT, cost_usd: 100 }),
        makeRow({ usage_type: "Mixed", period: PREV, cost_usd: 50 }),
        // new-format row: gross 120, net 80
        makeRow({
          usage_type: "Mixed",
          period: CURRENT,
          cost_usd: 120,
          net_cost_usd: 80,
        }),
      ];

      const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
      // gross sums
      expect(result[0].current).toBe(220);
      // net sum: 100 (old row falls back to cost_usd) + 80
      expect(result[0].net).toBe(180);
      // prev row has no net column => net falls back to gross 50, equals it
      expect(result[0].prev).toBe(50);
    });

    test("deltas on current/prev are gross-to-gross automatically", () => {
      const rows: UsageTypeCostRow[] = [
        makeRow({
          usage_type: "S3-Requests",
          period: CURRENT,
          cost_usd: 165, // gross current
          net_cost_usd: 100,
        }),
        makeRow({
          usage_type: "S3-Requests",
          period: PREV,
          cost_usd: 88, // gross prev
          net_cost_usd: 80,
        }),
      ];

      const result = aggregateUsageTypes(rows, CURRENT, PREV, YOY);
      // Consumers compute the MoM delta as current - prev (both gross sums)
      const delta = result[0].current - result[0].prev!;
      expect(delta).toBe(77); // 165 - 88, not 100 - 80
    });
  });
});
