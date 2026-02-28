import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { CostSummary } from "~/types/cost-data";

vi.mock("~/lib/data", () => ({
  discoverPeriods: vi.fn(),
  fetchSummary: vi.fn(),
}));

import { useTrendData } from "./useTrendData";
import { discoverPeriods, fetchSummary } from "./data";

const mockDiscoverPeriods = vi.mocked(discoverPeriods);
const mockFetchSummary = vi.mocked(fetchSummary);

function makeSummary(
  period: string,
  costs: Record<string, number>,
  totalOverride?: number,
): CostSummary {
  const ccSum = Object.values(costs).reduce((s, v) => s + v, 0);
  return {
    collected_at: "2026-01-01T00:00:00Z",
    period,
    periods: { current: period, prev_month: "", yoy: "" },
    totals: {
      current_cost_usd: totalOverride ?? ccSum,
      prev_month_cost_usd: 0,
      yoy_cost_usd: 0,
    },
    storage_config: { include_efs: false, include_ebs: false },
    storage_metrics: {
      total_cost_usd: 0,
      prev_month_cost_usd: 0,
      total_volume_bytes: 0,
      hot_tier_percentage: 0,
      cost_per_tb_usd: 0,
    },
    cost_centers: Object.entries(costs).map(([name, cost]) => ({
      name,
      current_cost_usd: cost,
      prev_month_cost_usd: 0,
      yoy_cost_usd: 0,
      workloads: [],
    })),
    tagging_coverage: {
      tagged_cost_usd: 0,
      untagged_cost_usd: 0,
      tagged_percentage: 100,
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useTrendData", () => {
  it("returns loading state initially", () => {
    mockDiscoverPeriods.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTrendData());
    expect(result.current.loading).toBe(true);
    expect(result.current.points).toEqual([]);
  });

  it("pivots cost centers into chart data points sorted chronologically", async () => {
    mockDiscoverPeriods.mockResolvedValue(["2025-12", "2025-11"]);
    mockFetchSummary.mockImplementation((period) =>
      Promise.resolve(
        makeSummary(period, { Engineering: 14000, "Data Science": 6800 }),
      ),
    );

    const { result } = renderHook(() => useTrendData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.points).toHaveLength(2);
    expect(result.current.points[0].period).toBe("2025-11");
    expect(result.current.points[1].period).toBe("2025-12");
    expect(result.current.points[0].Engineering).toBe(14000);
    expect(result.current.points[0]["Data Science"]).toBe(6800);
  });

  it("sorts cost center names by total descending", async () => {
    mockDiscoverPeriods.mockResolvedValue(["2025-12"]);
    mockFetchSummary.mockResolvedValue(
      makeSummary("2025-12", { Small: 100, Large: 10000, Medium: 5000 }),
    );

    const { result } = renderHook(() => useTrendData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.costCenterNames).toEqual([
      "Large",
      "Medium",
      "Small",
    ]);
  });

  it("handles failed period fetches gracefully", async () => {
    mockDiscoverPeriods.mockResolvedValue(["2025-12", "2025-11"]);
    mockFetchSummary.mockImplementation((period) =>
      period === "2025-11"
        ? Promise.reject(new Error("Not found"))
        : Promise.resolve(makeSummary(period, { Eng: 1000 })),
    );

    const { result } = renderHook(() => useTrendData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.points).toHaveLength(1);
    expect(result.current.points[0].period).toBe("2025-12");
    expect(result.current.error).toBeNull();
  });

  it("sets error when discoverPeriods fails", async () => {
    mockDiscoverPeriods.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useTrendData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to load trend data.");
  });

  it("populates _total from summary.totals rather than summing CC values", async () => {
    mockDiscoverPeriods.mockResolvedValue(["2025-12"]);
    // Total override (25000) differs from CC sum (14000 + 6800 = 20800)
    mockFetchSummary.mockResolvedValue(
      makeSummary(
        "2025-12",
        { Engineering: 14000, "Data Science": 6800 },
        25000,
      ),
    );

    const { result } = renderHook(() => useTrendData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.points[0]._total).toBe(25000);
  });

  it("handles empty periods list", async () => {
    mockDiscoverPeriods.mockResolvedValue([]);

    const { result } = renderHook(() => useTrendData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("No periods available.");
    expect(result.current.points).toEqual([]);
  });
});
