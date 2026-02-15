import type { CostSummary } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";
import { InfoTooltip } from "./InfoTooltip";

interface GlobalSummaryProps {
  summary: CostSummary;
}

export function GlobalSummary({ summary }: GlobalSummaryProps) {
  const totalCurrent = summary.cost_centers.reduce(
    (sum, cc) => sum + cc.current_cost_usd,
    0,
  );
  const totalPrev = summary.cost_centers.reduce(
    (sum, cc) => sum + cc.prev_month_cost_usd,
    0,
  );
  const totalYoy = summary.cost_centers.reduce(
    (sum, cc) => sum + cc.yoy_cost_usd,
    0,
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Total Spend
          <InfoTooltip text="Sum of all cost center spend for this period." />
        </div>
        <div className="text-2xl font-semibold mt-1">
          {formatUsd(totalCurrent)}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          vs Last Month
          <InfoTooltip text="Change compared to the previous calendar month." />
        </div>
        <div className="text-lg font-medium mt-1">
          <CostChange current={totalCurrent} previous={totalPrev} />
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          vs Last Year
          <InfoTooltip text="Change compared to the same month one year ago." />
        </div>
        <div className="text-lg font-medium mt-1">
          {totalYoy > 0 ? (
            <CostChange current={totalCurrent} previous={totalYoy} />
          ) : (
            <span className="text-gray-400">N/A</span>
          )}
        </div>
      </div>
    </div>
  );
}
