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
  const { totals } = summary;
  const totalCurrent = totals.current_cost_usd;
  const totalPrev = totals.prev_month_cost_usd;
  const totalYoy = totals.yoy_cost_usd;

  const mtdPriorTotal =
    isMtd && totals.mtd_prior_partial_cost_usd != null
      ? totals.mtd_prior_partial_cost_usd
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
          ) : totalYoy != null ? (
            <DeltaIndicator current={totalCurrent} previous={totalYoy} />
          ) : (
            <DeltaIndicator current={0} previous={0} unavailable />
          )
        }
      />
    </div>
  );
}
