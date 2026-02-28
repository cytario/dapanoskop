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
  const hasStorageLens = metrics.storage_lens_total_bytes != null;
  const gridCols = hasStorageLens ? "sm:grid-cols-4" : "sm:grid-cols-3";

  return (
    <div className={`grid grid-cols-1 ${gridCols} gap-4 items-stretch`}>
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
      {hasStorageLens && (
        <Link to={`/storage-detail?period=${period}`} className="block">
          <MetricCard
            className="h-full"
            label={
              <>
                Total Stored{" "}
                <InfoTooltip text="Actual total storage volume from S3 Storage Lens. This is the precise amount of data stored, measured at the time of the latest metrics snapshot." />
              </>
            }
            value={formatBytes(metrics.storage_lens_total_bytes!)}
          />
        </Link>
      )}
      <MetricCard
        className="h-full"
        label={
          <>
            Cost / TB{" "}
            <InfoTooltip text="Total storage cost divided by the total volume of data stored, measured in terabytes (TB). Lower values indicate better storage cost efficiency." />
          </>
        }
        value={formatUsd(metrics.cost_per_tb_usd)}
      />
      <MetricCard
        className="h-full"
        label={
          <>
            Hot Tier{" "}
            <InfoTooltip text="Percentage of stored data in frequently accessed tiers (e.g., S3 Standard, EFS Standard). High values may indicate optimization opportunities via lifecycle policies." />
          </>
        }
        value={`${metrics.hot_tier_percentage.toFixed(1)}%`}
      />
    </div>
  );
}
