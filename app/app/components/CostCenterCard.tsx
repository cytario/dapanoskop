import { useState } from "react";
import type { CostCenter } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";
import { WorkloadTable } from "./WorkloadTable";

interface CostCenterCardProps {
  costCenter: CostCenter;
  period: string;
}

export function CostCenterCard({ costCenter, period }: CostCenterCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Find top mover (workload with highest absolute MoM change)
  const topMover = costCenter.workloads.reduce(
    (best, wl) => {
      const delta = Math.abs(wl.current_cost_usd - wl.prev_month_cost_usd);
      return delta > best.delta ? { name: wl.name, delta, wl } : best;
    },
    { name: "", delta: 0, wl: costCenter.workloads[0] },
  );

  const topMoverPct =
    topMover.wl && topMover.wl.prev_month_cost_usd !== 0
      ? (
          ((topMover.wl.current_cost_usd - topMover.wl.prev_month_cost_usd) /
            topMover.wl.prev_month_cost_usd) *
          100
        ).toFixed(1)
      : "0.0";

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden transition-shadow hover:shadow-md">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`transform transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              ▶
            </span>
            <span className="font-semibold text-lg">{costCenter.name}</span>
          </div>
          <span className="text-xl font-semibold">
            {formatUsd(costCenter.current_cost_usd)}
          </span>
        </div>
        <div className="flex items-center gap-6 mt-2 ml-7 text-sm">
          <CostChange
            current={costCenter.current_cost_usd}
            previous={costCenter.prev_month_cost_usd}
            label="MoM"
          />
          {costCenter.yoy_cost_usd > 0 ? (
            <CostChange
              current={costCenter.current_cost_usd}
              previous={costCenter.yoy_cost_usd}
              label="YoY"
            />
          ) : (
            <span className="text-gray-400 text-sm">YoY N/A</span>
          )}
        </div>
        <div className="mt-1 ml-7 text-xs text-gray-500">
          {costCenter.workloads.length} workloads · Top mover: {topMover.name} (
          {topMoverPct}% MoM)
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <WorkloadTable workloads={costCenter.workloads} period={period} />
        </div>
      )}
    </div>
  );
}
