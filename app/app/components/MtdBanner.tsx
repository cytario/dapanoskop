import { Banner } from "@cytario/design";
import type { MtdComparison } from "~/types/cost-data";
import { formatPartialPeriodLabel } from "~/lib/format";

interface MtdBannerProps {
  collectedAt: string;
  mtdComparison?: MtdComparison;
}

export function MtdBanner({ collectedAt, mtdComparison }: MtdBannerProps) {
  const date = new Date(collectedAt);
  const throughDate = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const comparisonNote = mtdComparison
    ? ` Comparisons are against ${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)} of the prior month.`
    : "";
  return (
    <Banner variant="warning" title="Month-to-date">
      Data through {throughDate}. Figures will change as the month progresses.
      {comparisonNote}
    </Banner>
  );
}
