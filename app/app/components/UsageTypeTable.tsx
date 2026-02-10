import type { UsageTypeCostRow } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";

interface UsageTypeTableProps {
  rows: UsageTypeCostRow[];
  currentPeriod: string;
  prevPeriod: string;
  yoyPeriod: string;
}

interface AggregatedRow {
  usage_type: string;
  category: string;
  current: number;
  prev: number;
  yoy: number;
}

export function UsageTypeTable({
  rows,
  currentPeriod,
  prevPeriod,
  yoyPeriod,
}: UsageTypeTableProps) {
  // Aggregate by usage_type across periods
  const byUsageType = new Map<string, AggregatedRow>();

  for (const row of rows) {
    let agg = byUsageType.get(row.usage_type);
    if (!agg) {
      agg = {
        usage_type: row.usage_type,
        category: row.category,
        current: 0,
        prev: 0,
        yoy: 0,
      };
      byUsageType.set(row.usage_type, agg);
    }
    if (row.period === currentPeriod) agg.current += row.cost_usd;
    else if (row.period === prevPeriod) agg.prev += row.cost_usd;
    else if (row.period === yoyPeriod) agg.yoy += row.cost_usd;
  }

  const sorted = [...byUsageType.values()].sort(
    (a, b) => b.current - a.current,
  );

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          <th className="py-2 font-medium">Usage Type</th>
          <th className="py-2 font-medium">Category</th>
          <th className="py-2 font-medium text-right">Current</th>
          <th className="py-2 font-medium text-right">vs Last Month</th>
          <th className="py-2 font-medium text-right">vs Last Year</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => (
          <tr key={row.usage_type} className="border-b border-gray-100">
            <td className="py-2 font-mono text-xs">{row.usage_type}</td>
            <td className="py-2">
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  row.category === "Storage"
                    ? "bg-purple-100 text-purple-700"
                    : row.category === "Compute"
                      ? "bg-blue-100 text-blue-700"
                      : row.category === "Support"
                        ? "bg-yellow-100 text-yellow-700"
                        : "bg-gray-100 text-gray-700"
                }`}
              >
                {row.category}
              </span>
            </td>
            <td className="py-2 text-right font-medium">
              {formatUsd(row.current)}
            </td>
            <td className="py-2 text-right">
              {row.prev > 0 ? (
                <CostChange current={row.current} previous={row.prev} />
              ) : (
                <span className="text-gray-400">N/A</span>
              )}
            </td>
            <td className="py-2 text-right">
              {row.yoy > 0 ? (
                <CostChange current={row.current} previous={row.yoy} />
              ) : (
                <span className="text-gray-400">N/A</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
