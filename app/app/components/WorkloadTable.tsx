import { Link } from "react-router";
import type { Workload, MtdCostCenter } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";

interface WorkloadTableProps {
  workloads: Workload[];
  period: string;
  isMtd?: boolean;
  mtdCostCenter?: MtdCostCenter;
}

const ANOMALY_THRESHOLD = 0.1; // 10% MoM change
const NEW_WORKLOAD_COST_THRESHOLD = 100; // Flag new workloads above $100

export function WorkloadTable({
  workloads,
  period,
  isMtd,
  mtdCostCenter,
}: WorkloadTableProps) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 text-left text-gray-500">
          <th className="py-2 font-medium">Workload</th>
          <th className="py-2 font-medium text-right">Current</th>
          <th className="py-2 font-medium text-right">
            {isMtd ? "vs Prior Partial" : "vs Last Month"}
          </th>
          <th className="py-2 font-medium text-right">vs Last Year</th>
        </tr>
      </thead>
      <tbody>
        {workloads.map((wl) => {
          // Use MTD prior partial cost if available
          const mtdWl = mtdCostCenter?.workloads.find(
            (mw) => mw.name === wl.name,
          );
          const momPrevious =
            mtdWl !== undefined
              ? mtdWl.prior_partial_cost_usd
              : wl.prev_month_cost_usd;

          const isNewWorkload =
            momPrevious === 0 &&
            wl.current_cost_usd >= NEW_WORKLOAD_COST_THRESHOLD;
          const momPct =
            momPrevious !== 0
              ? (wl.current_cost_usd - momPrevious) / momPrevious
              : 0;
          const isAnomaly =
            Math.abs(momPct) >= ANOMALY_THRESHOLD || isNewWorkload;
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
                  previous={momPrevious}
                />
              </td>
              <td className="py-2 text-right">
                {isMtd ? (
                  <span className="text-gray-400">N/A (MTD)</span>
                ) : wl.yoy_cost_usd > 0 ? (
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
