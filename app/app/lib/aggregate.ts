import type { UsageTypeCostRow } from "~/types/cost-data";

export interface AggregatedUsageTypeRow {
  usage_type: string;
  category: string;
  current: number;
  prev: number | null;
  yoy: number | null;
}

/**
 * Groups UsageTypeCostRow[] by usage_type, summing costs for each period,
 * and returns the result sorted by current cost descending.
 *
 * The category is taken from the first row encountered for each usage_type
 * (first-wins behavior).
 */
export function aggregateUsageTypes(
  rows: UsageTypeCostRow[],
  currentPeriod: string,
  prevPeriod: string,
  yoyPeriod: string,
): AggregatedUsageTypeRow[] {
  const byUsageType = new Map<string, AggregatedUsageTypeRow>();

  for (const row of rows) {
    let agg = byUsageType.get(row.usage_type);
    if (!agg) {
      agg = {
        usage_type: row.usage_type,
        category: row.category,
        current: 0,
        prev: null,
        yoy: null,
      };
      byUsageType.set(row.usage_type, agg);
    }
    if (row.period === currentPeriod) agg.current += row.cost_usd;
    else if (row.period === prevPeriod)
      agg.prev = (agg.prev ?? 0) + row.cost_usd;
    else if (row.period === yoyPeriod) agg.yoy = (agg.yoy ?? 0) + row.cost_usd;
  }

  return [...byUsageType.values()].sort((a, b) => b.current - a.current);
}
