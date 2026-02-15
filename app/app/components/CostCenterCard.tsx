import { useState } from "react";
import type { CostCenter } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";
import { WorkloadTable } from "./WorkloadTable";
import { InfoTooltip } from "./InfoTooltip";

interface CostCenterCardProps {
  costCenter: CostCenter;
  period: string;
}

export function CostCenterCard({ costCenter, period }: CostCenterCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Find top mover (workload with highest absolute MoM change)
  const topMover =
    costCenter.workloads.length > 0
      ? costCenter.workloads.reduce(
          (best, wl) => {
            const delta = Math.abs(
              wl.current_cost_usd - wl.prev_month_cost_usd,
            );
            return delta > best.delta ? { name: wl.name, delta, wl } : best;
          },
          { name: "", delta: 0, wl: costCenter.workloads[0] },
        )
      : null;

  const topMoverPct =
    topMover?.wl && topMover.wl.prev_month_cost_usd !== 0
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
          <span className="inline-flex items-center">
            <CostChange
              current={costCenter.current_cost_usd}
              previous={costCenter.prev_month_cost_usd}
              label="MoM"
            />
            <InfoTooltip text="Cost change from the previous calendar month, shown as absolute and percentage." />
          </span>
          {costCenter.yoy_cost_usd > 0 ? (
            <span className="inline-flex items-center">
              <CostChange
                current={costCenter.current_cost_usd}
                previous={costCenter.yoy_cost_usd}
                label="YoY"
              />
              <InfoTooltip text="Cost change compared to the same month last year. Helps identify long-term trends." />
            </span>
          ) : (
            <span className="text-gray-400 text-sm">YoY N/A</span>
          )}
        </div>
        <div className="mt-1 ml-7 text-xs text-gray-500">
          {costCenter.workloads.length} workloads
          {topMover && (
            <>
              {" "}
              · Top mover: {topMover.name} ({topMoverPct}% MoM)
              <InfoTooltip text="The workload with the largest absolute dollar change compared to last month. Identifies where costs shifted the most." />
            </>
          )}
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
