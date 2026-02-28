import { MetricCard, DeltaIndicator } from "@cytario/design";
import type { CostSummary, MtdComparison } from "~/types/cost-data";
import { formatUsd, formatPartialPeriodLabel } from "~/lib/format";

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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
      <MetricCard
        className="h-full"
        label="Total Spend"
        value={formatUsd(totalCurrent)}
      />
      <MetricCard
        className="h-full"
        label={momLabel}
        value={<DeltaIndicator current={totalCurrent} previous={momPrevious} />}
      />
      <MetricCard
        className="h-full"
        label="vs Last Year"
        value={
          isMtd ? (
            <DeltaIndicator
              current={0}
              previous={0}
              unavailable
              unavailableText="N/A (MTD)"
            />
          ) : totalYoy > 0 ? (
            <DeltaIndicator current={totalCurrent} previous={totalYoy} />
          ) : (
            <DeltaIndicator current={0} previous={0} unavailable />
          )
        }
      />
    </div>
  );
}
