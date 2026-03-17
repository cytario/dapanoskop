import { MetricCard, DeltaIndicator } from "@cytario/design";
import type { CostSummary, MtdComparison } from "~/types/cost-data";
import { formatUsd, formatPartialPeriodLabel } from "~/lib/format";
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
      {isMtd ? (
        <MetricCard
          className="h-full"
          label={
            <>
              Forecast Month End{" "}
              <InfoTooltip text="Forecasted month-end total based on AWS Cost Explorer's ML-based forecast model. Compares the projected total against the previous completed month." />
            </>
          }
          value={
            totals.forecast_total_usd != null
              ? formatUsd(totals.forecast_total_usd)
              : "Forecast unavailable"
          }
          secondary={
            totals.forecast_total_usd != null &&
            totals.prev_complete_total_usd != null ? (
              <DeltaIndicator
                current={totals.forecast_total_usd}
                previous={totals.prev_complete_total_usd}
              />
            ) : undefined
          }
        />
      ) : (
        <MetricCard
          className="h-full"
          label="vs Last Year"
          value={
            totalYoy != null ? (
              <DeltaIndicator current={totalCurrent} previous={totalYoy} />
            ) : (
              <DeltaIndicator current={0} previous={0} unavailable />
            )
          }
        />
      )}
    </div>
  );
}
