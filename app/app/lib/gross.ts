/**
 * Helpers for gross vs net cost presentation.
 *
 * "Gross" is the pre-credit/discount (on-demand) cost; "net" is the cost
 * after AWS credits, RI/Savings Plan amortization, and discount programs.
 * Gross fields are optional — older data only carries net values, in which
 * case gross falls back to net.
 */

/** Minimum gross-vs-net difference (USD) that is surfaced in the UI. */
export const GROSS_NET_DIFF_THRESHOLD = 0.01;

/**
 * True when the gross figure differs from the net figure enough to show
 * the secondary "after credits" presentation. Equal (or absent, e.g. old
 * data where both figures are the same value) never differs, so nothing
 * extra is rendered.
 */
export function grossDiffersFromNet(
  gross: number,
  net: number | null | undefined,
): boolean {
  if (net == null) return false;
  return gross - net >= GROSS_NET_DIFF_THRESHOLD;
}

/**
 * Picks the (current, previous) pair for a like-for-like delta between two
 * summary.json figures: gross-vs-gross when both sides carry gross, else
 * net-to-net. Used by the summary-based components (GlobalSummary,
 * CostCenterCard top mover, WorkloadTable); the usage-type path needs no
 * pair selection since its cost_usd figures are already gross.
 */
export function deltaPair(
  currentGross: number | null | undefined,
  currentNet: number,
  previousGross: number | null | undefined,
  previousNet: number,
): { current: number; previous: number } {
  if (currentGross != null && previousGross != null) {
    return { current: currentGross, previous: previousGross };
  }
  return { current: currentNet, previous: previousNet };
}
