import { ProgressBar, Card } from "@cytario/design";
import type { TaggingCoverage as TaggingCoverageData } from "~/types/cost-data";
import { formatUsd } from "~/lib/format";

interface TaggingCoverageProps {
  data: TaggingCoverageData;
}

export function TaggingCoverage({ data }: TaggingCoverageProps) {
  return (
    <Card padding="md">
      <ProgressBar
        value={data.tagged_percentage}
        label="Tagging Coverage"
        description={`${data.tagged_percentage.toFixed(1)}% tagged (${formatUsd(data.tagged_cost_usd)}) · ${formatUsd(data.untagged_cost_usd)} untagged`}
        variant="brand"
      />
    </Card>
  );
}
