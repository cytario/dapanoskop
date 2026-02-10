import type { StorageMetrics } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { CostChange } from "./CostChange";

interface StorageOverviewProps {
  metrics: StorageMetrics;
}

export function StorageOverview({ metrics }: StorageOverviewProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-500">Storage Cost</div>
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
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-500">Cost / TB</div>
        <div className="text-xl font-semibold mt-1">
          {formatUsd(metrics.cost_per_tb_usd)}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm text-gray-500">Hot Tier</div>
        <div className="text-xl font-semibold mt-1">
          {metrics.hot_tier_percentage.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
