import type { TaggingCoverage as TaggingCoverageData } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";
import { InfoTooltip } from "./InfoTooltip";

interface TaggingCoverageProps {
  data: TaggingCoverageData;
}

export function TaggingCoverage({ data }: TaggingCoverageProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          Tagging Coverage
          <InfoTooltip text="Proportion of spend attributed to tagged resources." />
        </span>
        <span className="text-sm text-gray-500">
          {data.tagged_percentage.toFixed(1)}% tagged (
          {formatUsd(data.tagged_cost_usd)}) ·{" "}
          {formatUsd(data.untagged_cost_usd)} untagged
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className="bg-primary-600 h-3 rounded-full transition-all duration-300"
          style={{ width: `${data.tagged_percentage}%` }}
        />
      </div>
    </div>
  );
}
