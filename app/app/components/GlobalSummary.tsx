import { MetricCard, DeltaIndicator } from "@cytario/design";
import type { CostSummary, MtdComparison } from "~/types/cost-data";
import { formatUsd, formatPartialPeriodLabel } from "~/lib/format";
import { deltaPair, grossDiffersFromNet } from "~/lib/gross";
import { InfoTooltip } from "./InfoTooltip";

interface GlobalSummaryProps {
  summary: CostSummary;
  isMtd?: boolean;
  mtdComparison?: MtdComparison;
}

const AFTER_CREDITS_TOOLTIP =
  "Net cost after AWS credits, RI/Savings Plan amortization, and discount programs. The difference from the headline figure is credits and discounts applied.";

export function GlobalSummary({
  summary,
  isMtd,
  mtdComparison,
}: GlobalSummaryProps) {
  const { totals } = summary;
  const totalCurrent = totals.current_cost_usd;
  const totalPrev = totals.prev_month_cost_usd;
  const totalYoy = totals.yoy_cost_usd;

  // Gross (pre-credit/discount) figures — fall back to net in older data.
  const totalGrossCurrent = totals.gross_current_cost_usd ?? totalCurrent;

  const mtdPriorTotal =
    isMtd && totals.mtd_prior_partial_cost_usd != null
      ? totals.mtd_prior_partial_cost_usd
      : null;

  // Compare like with like: gross-vs-gross when both sides carry gross,
  // net-to-net otherwise (old data, or gross only collected for one side).
  const momPreviousGross =
    mtdPriorTotal !== null
      ? totals.gross_mtd_prior_partial_cost_usd
      : totals.gross_prev_month_cost_usd;
  const momPreviousNet = mtdPriorTotal !== null ? mtdPriorTotal : totalPrev;
  const mom = deltaPair(
    totals.gross_current_cost_usd,
    totalCurrent,
    momPreviousGross,
    momPreviousNet,
  );
  const momLabel =
    isMtd && mtdComparison
      ? `vs ${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)}`
      : "vs Last Month";

  const yoy = deltaPair(
    totals.gross_current_cost_usd,
    totalCurrent,
    totals.gross_yoy_cost_usd,
    totalYoy,
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
      <MetricCard
        className="h-full"
        label={
          <>
            Total Spend{" "}
            {grossDiffersFromNet(totalGrossCurrent, totalCurrent) && (
              <InfoTooltip text={AFTER_CREDITS_TOOLTIP} />
            )}
          </>
        }
        value={formatUsd(totalGrossCurrent)}
        secondary={
          grossDiffersFromNet(totalGrossCurrent, totalCurrent)
            ? `After credits: ${formatUsd(totalCurrent)}`
            : undefined
        }
      />
      <MetricCard
        className="h-full"
        label={momLabel}
        value={<DeltaIndicator current={mom.current} previous={mom.previous} />}
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
              <DeltaIndicator current={yoy.current} previous={yoy.previous} />
            ) : (
              <DeltaIndicator current={0} previous={0} unavailable />
            )
          }
        />
      )}
    </div>
  );
}
