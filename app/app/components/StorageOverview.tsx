import { Link } from "react-router";
import type { StorageMetrics, CostSummary } from "~/types/cost-data";
import { formatUsd, formatBytes } from "~/lib/format";
import { CostChange } from "./CostChange";
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
    <div className={`grid grid-cols-1 ${gridCols} gap-4`}>
      <Link
        to={`/storage-cost?period=${period}`}
        className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md block"
      >
        <div className="text-sm text-gray-500">
          Storage Cost
          <InfoTooltip text={buildStorageCostTooltip(storageConfig)} />
        </div>
        <div className="text-xl font-semibold mt-1">
          {formatUsd(metrics.total_cost_usd)}
        </div>
        <div className="mt-1 text-sm">
          <CostChange
            current={metrics.total_cost_usd}
            previous={metrics.prev_month_cost_usd}
          />
        </div>
      </Link>
      {hasStorageLens && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
          <div className="text-sm text-gray-500">
            Total Stored
            <InfoTooltip text="Actual total storage volume from S3 Storage Lens. This is the precise amount of data stored, measured at the time of the latest metrics snapshot." />
          </div>
          <div className="text-xl font-semibold mt-1">
            {formatBytes(metrics.storage_lens_total_bytes!)}
          </div>
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Cost / TB
          <InfoTooltip text="Total storage cost divided by the total volume of data stored, measured in terabytes (TB). Lower values indicate better storage cost efficiency." />
        </div>
        <div className="text-xl font-semibold mt-1">
          {formatUsd(metrics.cost_per_tb_usd)}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Hot Tier
          <InfoTooltip text="Percentage of stored data in frequently accessed tiers (e.g., S3 Standard, EFS Standard). High values may indicate optimization opportunities via lifecycle policies." />
        </div>
        <div className="text-xl font-semibold mt-1">
          {metrics.hot_tier_percentage.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
