import { useEffect, useState } from "react";
import { discoverPeriods, fetchSummary } from "~/lib/data";

export interface TrendPoint {
  period: string;
  _isMtd?: boolean;
  [costCenter: string]: string | number | boolean | undefined;
}

export interface TrendData {
  points: TrendPoint[];
  costCenterNames: string[];
  loading: boolean;
  error: string | null;
}

export function useTrendData(): TrendData {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [costCenterNames, setCostCenterNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const periods = await discoverPeriods();
        if (periods.length === 0) {
          if (!cancelled) {
            setLoading(false);
            setError("No periods available.");
          }
          return;
        }

        const results = await Promise.allSettled(
          periods.map((p) => fetchSummary(p)),
        );

        if (cancelled) return;

        const totals = new Map<string, number>();
        const pts: TrendPoint[] = [];

        for (let i = 0; i < periods.length; i++) {
          const result = results[i];
          if (result.status !== "fulfilled") continue;

          const summary = result.value;
          const point: TrendPoint = { period: periods[i] };

          if (summary.is_mtd) {
            point._isMtd = true;
          }

          for (const cc of summary.cost_centers) {
            point[cc.name] = cc.current_cost_usd;
            totals.set(
              cc.name,
              (totals.get(cc.name) ?? 0) + cc.current_cost_usd,
            );
          }

          // Use pre-computed total from backend; fall back to sum of CC values
          point._total =
            summary.totals?.current_cost_usd ??
            summary.cost_centers.reduce(
              (sum, cc) => sum + cc.current_cost_usd,
              0,
            );

          pts.push(point);
        }

        // Sort chronologically (oldest first)
        pts.sort((a, b) =>
          (a.period as string).localeCompare(b.period as string),
        );

        // Sort cost center names by total descending (largest at bottom of stack)
        const names = [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([name]) => name);

        setPoints(pts);
        setCostCenterNames(names);
      } catch {
        if (!cancelled) setError("Failed to load trend data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { points, costCenterNames, loading, error };
}
