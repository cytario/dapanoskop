import type { CostSummary, MtdComparison } from "~/types/cost-data";
import { formatUsd, formatPartialPeriodLabel } from "~/lib/format";
import { CostChange } from "./CostChange";
import { InfoTooltip } from "./InfoTooltip";

interface GlobalSummaryProps {
  summary: CostSummary;
  isMtd?: boolean;
  mtdComparison?: MtdComparison;
}

export function GlobalSummary({
  summary,
  isMtd,
  mtdComparison,
}: GlobalSummaryProps) {
  const activeCenters = summary.cost_centers.filter(
    (cc) => !cc.is_split_charge,
  );
  const totalCurrent = activeCenters.reduce(
    (sum, cc) => sum + cc.current_cost_usd,
    0,
  );
  const totalPrev = activeCenters.reduce(
    (sum, cc) => sum + cc.prev_month_cost_usd,
    0,
  );
  const totalYoy = activeCenters.reduce((sum, cc) => sum + cc.yoy_cost_usd, 0);

  // MTD like-for-like comparison: sum prior_partial_cost_usd from mtd_comparison
  const mtdPriorTotal =
    isMtd && mtdComparison
      ? mtdComparison.cost_centers
          .filter((mc) => !mc.is_split_charge)
          .reduce((sum, mc) => sum + mc.prior_partial_cost_usd, 0)
      : null;

  const momPrevious = mtdPriorTotal !== null ? mtdPriorTotal : totalPrev;
  const momLabel =
    isMtd && mtdComparison
      ? `vs ${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)}`
      : "vs Last Month";
  const momTooltip =
    isMtd && mtdComparison
      ? `Like-for-like comparison against the same number of days in the prior month (${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)}).`
      : "Change in total spend from the previous calendar month. Shows both the absolute dollar difference and the percentage change.";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Total Spend
          <InfoTooltip text="Total AWS spend across all cost centers for this period." />
        </div>
        <div className="text-2xl font-semibold mt-1">
          {formatUsd(totalCurrent)}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          {momLabel}
          <InfoTooltip text={momTooltip} />
        </div>
        <div className="text-lg font-medium mt-1">
          <CostChange current={totalCurrent} previous={momPrevious} />
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          vs Last Year
          <InfoTooltip text="Change in total spend compared to the same month one year ago. Useful for identifying seasonal trends and long-term cost trajectory." />
        </div>
        <div className="text-lg font-medium mt-1">
          {isMtd ? (
            <span className="text-gray-400">N/A (MTD)</span>
          ) : totalYoy > 0 ? (
            <CostChange current={totalCurrent} previous={totalYoy} />
          ) : (
            <span className="text-gray-400">N/A</span>
          )}
        </div>
      </div>
    </div>
  );
}
