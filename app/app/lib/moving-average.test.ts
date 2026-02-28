import { describe, it, expect } from "vitest";
import { computeMovingAverage } from "./moving-average";
import type { TrendPoint } from "./useTrendData";

describe("computeMovingAverage", () => {
  it("returns all nulls when fewer than 3 points", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", Eng: 100 },
      { period: "2025-02", Eng: 200 },
    ];
    const result = computeMovingAverage(points, ["Eng"]);
    expect(result).toEqual([null, null]);
  });

  it("returns null for first two, average for third with exactly 3 points", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", Eng: 100, DS: 50 },
      { period: "2025-02", Eng: 200, DS: 50 },
      { period: "2025-03", Eng: 300, DS: 50 },
    ];
    const result = computeMovingAverage(points, ["Eng", "DS"]);
    expect(result).toEqual([null, null, 250]);
    // (150 + 250 + 350) / 3 = 250
  });

  it("computes rolling averages for a normal case", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100 },
      { period: "2025-02", A: 200 },
      { period: "2025-03", A: 300 },
      { period: "2025-04", A: 400 },
      { period: "2025-05", A: 500 },
    ];
    const result = computeMovingAverage(points, ["A"]);
    expect(result).toEqual([null, null, 200, 300, 400]);
  });

  it("treats missing cost center keys as 0 (sparse data)", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100 },
      { period: "2025-02", A: 200, B: 50 },
      { period: "2025-03", B: 300 },
    ];
    // Totals: 100, 250, 300
    // MA at index 2: (100 + 250 + 300) / 3 = 216.67
    const result = computeMovingAverage(points, ["A", "B"]);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeCloseTo(216.67, 1);
  });

  it("returns empty array for empty input", () => {
    expect(computeMovingAverage([], ["A"])).toEqual([]);
  });

  it("handles single cost center", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", Solo: 10 },
      { period: "2025-02", Solo: 20 },
      { period: "2025-03", Solo: 30 },
    ];
    const result = computeMovingAverage(points, ["Solo"]);
    expect(result).toEqual([null, null, 20]);
  });

  it("handles custom window size of 1 (no smoothing)", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100 },
      { period: "2025-02", A: 200 },
      { period: "2025-03", A: 300 },
    ];
    const result = computeMovingAverage(points, ["A"], 1);
    expect(result).toEqual([100, 200, 300]);
  });

  it("returns all nulls when window exceeds point count", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100 },
      { period: "2025-02", A: 200 },
    ];
    const result = computeMovingAverage(points, ["A"], 5);
    expect(result).toEqual([null, null]);
  });

  it("handles empty cost center names (totals are zero)", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100 },
      { period: "2025-02", A: 200 },
      { period: "2025-03", A: 300 },
    ];
    const result = computeMovingAverage(points, []);
    expect(result).toEqual([null, null, 0]);
  });

  it("uses _total field when available instead of summing CC values", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100, _total: 500 },
      { period: "2025-02", A: 200, _total: 600 },
      { period: "2025-03", A: 300, _total: 700 },
    ];
    // MA at index 2: (500 + 600 + 700) / 3 = 600
    const result = computeMovingAverage(points, ["A"]);
    expect(result).toEqual([null, null, 600]);
  });

  it("falls back to summing CC values when _total is absent", () => {
    const points: TrendPoint[] = [
      { period: "2025-01", A: 100 },
      { period: "2025-02", A: 200 },
      { period: "2025-03", A: 300 },
    ];
    const result = computeMovingAverage(points, ["A"]);
    expect(result).toEqual([null, null, 200]);
  });
});
