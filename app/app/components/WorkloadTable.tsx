import { Link } from "react-router";
import type { Workload } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";

interface WorkloadTableProps {
  workloads: Workload[];
  period: string;
}

const ANOMALY_THRESHOLD = 0.1; // 10% MoM change

export function WorkloadTable({ workloads, period }: WorkloadTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          <th className="py-2 font-medium">Workload</th>
          <th className="py-2 font-medium text-right">Current</th>
          <th className="py-2 font-medium text-right">vs Last Month</th>
          <th className="py-2 font-medium text-right">vs Last Year</th>
        </tr>
      </thead>
      <tbody>
        {workloads.map((wl) => {
          const momPct =
            wl.prev_month_cost_usd !== 0
              ? (wl.current_cost_usd - wl.prev_month_cost_usd) /
                wl.prev_month_cost_usd
              : 0;
          const isAnomaly = Math.abs(momPct) >= ANOMALY_THRESHOLD;
          const isUntagged = wl.name === "Untagged";
          const highlight = isAnomaly || isUntagged;

          return (
            <tr
              key={wl.name}
              className={`border-b border-gray-100 ${highlight ? "bg-red-50" : ""}`}
            >
              <td className="py-2">
                {isUntagged ? (
                  <span className="font-medium text-red-700">{wl.name}</span>
                ) : (
                  <Link
                    to={`/workload/${encodeURIComponent(wl.name)}?period=${period}`}
                    className="text-primary-600 hover:underline"
                  >
                    {wl.name}
                  </Link>
                )}
              </td>
              <td className="py-2 text-right font-medium">
                {formatUsd(wl.current_cost_usd)}
              </td>
              <td className="py-2 text-right">
                <CostChange
                  current={wl.current_cost_usd}
                  previous={wl.prev_month_cost_usd}
                />
              </td>
              <td className="py-2 text-right">
                {wl.yoy_cost_usd > 0 ? (
                  <CostChange
                    current={wl.current_cost_usd}
                    previous={wl.yoy_cost_usd}
                  />
                ) : (
                  <span className="text-gray-400">N/A</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
