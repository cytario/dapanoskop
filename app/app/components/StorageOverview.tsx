import type { StorageMetrics } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";
import { InfoTooltip } from "./InfoTooltip";

interface StorageOverviewProps {
  metrics: StorageMetrics;
}

export function StorageOverview({ metrics }: StorageOverviewProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Storage Cost
          <InfoTooltip text="Total cost of all storage services (S3, optionally EFS/EBS)." />
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
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Cost / TB
          <InfoTooltip text="Total storage cost divided by data volume in terabytes." />
        </div>
        <div className="text-xl font-semibold mt-1">
          {formatUsd(metrics.cost_per_tb_usd)}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
        <div className="text-sm text-gray-500">
          Hot Tier
          <InfoTooltip text="Percentage of volume in frequently accessed storage tiers." />
        </div>
        <div className="text-xl font-semibold mt-1">
          {metrics.hot_tier_percentage.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
