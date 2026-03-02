import { Link } from "react-router";
import { MetricCard, DeltaIndicator } from "@cytario/design";
import type { StorageMetrics, CostSummary } from "~/types/cost-data";
import { formatUsd, formatBytes } from "~/lib/format";
import { InfoTooltip } from "./InfoTooltip";

interface StorageOverviewProps {
  metrics: StorageMetrics;
  storageConfig?: CostSummary["storage_config"];
  period: string;
}

function buildStorageCostTooltip(
  config?: CostSummary["storage_config"],
): string {
  const services = ["S3"];
  if (config?.include_efs) services.push("EFS");
  if (config?.include_ebs) services.push("EBS");
  return `Total cost of ${services.join(", ")} storage for this period.`;
}

export function StorageOverview({
  metrics,
  storageConfig,
  period,
}: StorageOverviewProps) {
  const totalBytes =
    metrics.storage_lens_total_bytes ?? metrics.total_volume_bytes;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-stretch">
      <Link to={`/storage-cost?period=${period}`} className="block">
        <MetricCard
          className="h-full"
          label={
            <>
              Storage Cost{" "}
              <InfoTooltip text={buildStorageCostTooltip(storageConfig)} />
            </>
          }
          value={formatUsd(metrics.total_cost_usd)}
          secondary={
            <DeltaIndicator
              current={metrics.total_cost_usd}
              previous={metrics.prev_month_cost_usd}
            />
          }
        />
      </Link>
      <MetricCard
        className="h-full"
        label={
          <>
            Cost / TiB{" "}
            <InfoTooltip text="Total storage cost divided by the total volume of data stored, measured in tebibytes (TiB). Lower values indicate better storage cost efficiency." />
          </>
        }
        value={formatUsd(metrics.cost_per_tb_usd)}
        secondary={
          metrics.prev_month_cost_per_tb_usd != null ? (
            <DeltaIndicator
              current={metrics.cost_per_tb_usd}
              previous={metrics.prev_month_cost_per_tb_usd}
            />
          ) : undefined
        }
      />
      <Link to={`/storage-detail?period=${period}`} className="block">
        <MetricCard
          className="h-full"
          label={
            <>
              Storage Volume{" "}
              <InfoTooltip text="Total storage volume and hot tier percentage. Hot tier shows data in frequently accessed storage classes." />
            </>
          }
          value={
            <>
              {formatBytes(totalBytes)}
              {metrics.prev_month_total_volume_bytes != null && (
                <span className="ml-2 align-baseline">
                  <DeltaIndicator
                    current={metrics.total_volume_bytes}
                    previous={metrics.prev_month_total_volume_bytes}
                    format="percentage"
                  />
                </span>
              )}
            </>
          }
          secondary={
            <>
              <span className="text-sm text-gray-500">
                Hot Tier: {metrics.hot_tier_percentage.toFixed(1)}%
              </span>
              {metrics.prev_month_hot_tier_percentage != null && (
                <span className="ml-1">
                  <DeltaIndicator
                    current={metrics.hot_tier_percentage}
                    previous={metrics.prev_month_hot_tier_percentage}
                    format="percentage"
                  />
                </span>
              )}
            </>
          }
        />
      </Link>
    </div>
  );
}
