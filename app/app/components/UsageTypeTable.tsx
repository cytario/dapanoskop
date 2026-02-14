import type { UsageTypeCostRow } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { aggregateUsageTypes } from "~/lib/aggregate";
import { CostChange } from "./CostChange";

interface UsageTypeTableProps {
  rows: UsageTypeCostRow[];
  currentPeriod: string;
  prevPeriod: string;
  yoyPeriod: string;
}

export function UsageTypeTable({
  rows,
  currentPeriod,
  prevPeriod,
  yoyPeriod,
}: UsageTypeTableProps) {
  const sorted = aggregateUsageTypes(
    rows,
    currentPeriod,
    prevPeriod,
    yoyPeriod,
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
                    ? "bg-primary-100 text-primary-700"
                    : row.category === "Compute"
                      ? "bg-secondary-100 text-secondary-700"
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
