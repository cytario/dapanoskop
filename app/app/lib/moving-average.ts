import type { TrendPoint } from "./useTrendData";

/**
 * Compute a simple moving average over aggregate totals across all cost centers.
 *
 * Returns an array of the same length as `points`.
 * Entries where fewer than `window` data points are available are `null`.
 */
export function computeMovingAverage(
  points: TrendPoint[],
  costCenterNames: string[],
  window: number = 3,
): (number | null)[] {
  return points.map((_pt, i) => {
    if (i < window - 1) return null;

    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const pt = points[j];
      // Use pre-computed _total if available; fall back to summing CC values
      const total =
        typeof pt._total === "number"
          ? pt._total
          : costCenterNames.reduce(
              (acc, name) => acc + (Number(pt[name]) || 0),
              0,
            );
      sum += total;
    }
    return sum / window;
  });
}
