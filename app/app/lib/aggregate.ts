import type { UsageTypeCostRow } from "~/types/cost-data";
import { grossDiffersFromNet } from "./gross";

export interface AggregatedUsageTypeRow {
  usage_type: string;
  category: string;
  /** Gross (pre-credit/discount) current cost — sum of cost_usd. */
  current: number;
  /** Gross (pre-credit/discount) previous-month cost — sum of cost_usd. */
  prev: number | null;
  /** Gross (pre-credit/discount) same-month-last-year cost — sum of cost_usd. */
  yoy: number | null;
  /**
   * Net current cost — sum of net_cost_usd (falling back to cost_usd for rows
   * from older data). Populated only when it differs from the gross current
   * by >= $0.01, so the table shows a secondary "after credits" figure only
   * where credits/discounts actually apply.
   */
  net: number | null;
}

/**
 * Groups UsageTypeCostRow[] by usage_type, summing costs for each period,
 * and returns the result sorted by current cost descending.
 *
 * The category is taken from the first row encountered for each usage_type
 * (first-wins behavior).
 *
 * cost_usd is the GROSS (pre-credit/discount) figure — the primary one — so
 * current/prev/yoy are gross sums and deltas computed on them are
 * gross-to-gross automatically. Net (net_cost_usd, falling back to cost_usd
 * for rows from older data) is accumulated alongside and surfaced as `net`
 * only when it differs from gross by >= $0.01.
 */
export function aggregateUsageTypes(
  rows: UsageTypeCostRow[],
  currentPeriod: string,
  prevPeriod: string,
  yoyPeriod: string,
): AggregatedUsageTypeRow[] {
  const byUsageType = new Map<
    string,
    {
      usage_type: string;
      category: string;
      current: number;
      prev: number | null;
      yoy: number | null;
      netCurrent: number;
      netPrev: number | null;
      netYoy: number | null;
    }
  >();

  for (const row of rows) {
    let agg = byUsageType.get(row.usage_type);
    if (!agg) {
      agg = {
        usage_type: row.usage_type,
        category: row.category,
        current: 0,
        prev: null,
        yoy: null,
        netCurrent: 0,
        netPrev: null,
        netYoy: null,
      };
      byUsageType.set(row.usage_type, agg);
    }
    // net_cost_usd is optional (older parquet files lack it); rows without
    // it contribute their gross cost so the net sum still works (old data:
    // both figures are the same net value).
    const net = row.net_cost_usd ?? row.cost_usd;
    if (row.period === currentPeriod) {
      agg.current += row.cost_usd;
      agg.netCurrent += net;
    } else if (row.period === prevPeriod) {
      agg.prev = (agg.prev ?? 0) + row.cost_usd;
      agg.netPrev = (agg.netPrev ?? 0) + net;
    } else if (row.period === yoyPeriod) {
      agg.yoy = (agg.yoy ?? 0) + row.cost_usd;
      agg.netYoy = (agg.netYoy ?? 0) + net;
    }
  }

  return [...byUsageType.values()]
    .map((agg) => ({
      usage_type: agg.usage_type,
      category: agg.category,
      current: agg.current,
      prev: agg.prev,
      yoy: agg.yoy,
      // Only surface the net secondary when it actually differs from gross.
      net: grossDiffersFromNet(agg.current, agg.netCurrent)
        ? agg.netCurrent
        : null,
    }))
    .sort((a, b) => b.current - a.current);
}
