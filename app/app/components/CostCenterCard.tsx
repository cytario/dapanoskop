import { useState } from "react";
import { Link } from "react-router";
import type { CostCenter, MtdComparison } from "~/types/cost-data";
import { formatUsd, formatPartialPeriodLabel } from "~/lib/format";
import { CostChange } from "./CostChange";
import { WorkloadTable } from "./WorkloadTable";
import { InfoTooltip } from "./InfoTooltip";

interface CostCenterCardProps {
  costCenter: CostCenter;
  period: string;
  isMtd?: boolean;
  mtdComparison?: MtdComparison;
}

export function CostCenterCard({
  costCenter,
  period,
  isMtd,
  mtdComparison,
}: CostCenterCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Find MTD like-for-like prior cost for this cost center
  const mtdCostCenter =
    isMtd && mtdComparison
      ? mtdComparison.cost_centers.find((mc) => mc.name === costCenter.name)
      : undefined;
  const momPrevious =
    mtdCostCenter !== undefined
      ? mtdCostCenter.prior_partial_cost_usd
      : costCenter.prev_month_cost_usd;

  // Find top mover (workload with highest absolute MoM change)
  const topMover =
    costCenter.workloads.length > 0
      ? costCenter.workloads.reduce(
          (best, wl) => {
            // Use MTD prior partial cost if available
            const mtdWl = mtdCostCenter?.workloads.find(
              (mw) => mw.name === wl.name,
            );
            const prev =
              mtdWl !== undefined
                ? mtdWl.prior_partial_cost_usd
                : wl.prev_month_cost_usd;
            const delta = Math.abs(wl.current_cost_usd - prev);
            return delta > best.delta
              ? { name: wl.name, delta, wl, prev }
              : best;
          },
          {
            name: "",
            delta: 0,
            wl: costCenter.workloads[0],
            prev: costCenter.workloads[0].prev_month_cost_usd,
          },
        )
      : null;

  const topMoverPct =
    topMover && topMover.prev !== 0
      ? (
          ((topMover.wl.current_cost_usd - topMover.prev) / topMover.prev) *
          100
        ).toFixed(1)
      : "0.0";

  const momLabel =
    isMtd && mtdComparison
      ? `vs ${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)}`
      : "MoM";

  const detailUrl = `/cost-center/${encodeURIComponent(costCenter.name)}?period=${period}`;

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden transition-shadow hover:shadow-md">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="hover:bg-gray-100 rounded p-0.5 transition-colors"
              aria-label={expanded ? "Collapse" : "Expand"}
              aria-expanded={expanded}
            >
              <span
                className={`transform transition-transform inline-block ${expanded ? "rotate-90" : ""}`}
              >
                ▶
              </span>
            </button>
            <Link
              to={detailUrl}
              className="font-semibold text-lg text-primary-600 hover:underline"
            >
              {costCenter.name}
            </Link>
            {costCenter.is_split_charge && (
              <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                Split Charge
              </span>
            )}
          </div>
          <span className="text-xl font-semibold">
            {costCenter.is_split_charge ? (
              <span className="text-sm font-normal text-gray-400">
                Allocated
              </span>
            ) : (
              formatUsd(costCenter.current_cost_usd)
            )}
          </span>
        </div>
        {costCenter.is_split_charge ? (
          <div className="mt-2 ml-7 text-sm text-gray-400">
            Costs allocated to other cost centers
          </div>
        ) : (
          <div className="flex items-center gap-6 mt-2 ml-7 text-sm">
            <span className="inline-flex items-center">
              <CostChange
                current={costCenter.current_cost_usd}
                previous={momPrevious}
                label={momLabel}
              />
              <InfoTooltip
                text={
                  isMtd && mtdComparison
                    ? `Like-for-like comparison against the same number of days in the prior month (${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)}).`
                    : "Cost change from the previous calendar month, shown as absolute and percentage."
                }
              />
            </span>
            {isMtd ? (
              <span className="text-gray-400 text-sm">YoY N/A (MTD)</span>
            ) : costCenter.yoy_cost_usd > 0 ? (
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
        )}
        <div className="mt-1 ml-7 text-xs text-gray-500">
          {costCenter.workloads.length} workloads
          {topMover && (
            <>
              {" "}
              · Top mover: {topMover.name} ({topMoverPct}%{" "}
              {isMtd && mtdComparison ? "partial" : "MoM"})
              <InfoTooltip text="The workload with the largest absolute dollar change compared to last month. Identifies where costs shifted the most." />
            </>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4">
          <WorkloadTable
            workloads={costCenter.workloads}
            period={period}
            isMtd={isMtd}
            mtdCostCenter={mtdCostCenter}
          />
        </div>
      )}
    </div>
  );
}
