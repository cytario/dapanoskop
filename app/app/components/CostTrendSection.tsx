import { lazy, Suspense, useState } from "react";
import { Banner } from "@cytario/design";
import { useTrendData } from "~/lib/useTrendData";
import type { TrendPoint } from "~/lib/useTrendData";

const CostTrendChart = lazy(() => import("~/components/CostTrendChart"));

function LoadingSkeleton() {
  return <div className="h-80 animate-pulse bg-gray-100 rounded" />;
}

type TimeRange = "1y" | "all";

interface TimeRangeToggleProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

function TimeRangeToggle({ value, onChange }: TimeRangeToggleProps) {
  return (
    <div
      className="inline-flex rounded-md border border-gray-300 text-sm"
      role="radiogroup"
      aria-label="Time range"
    >
      <button
        role="radio"
        aria-checked={value === "1y"}
        onClick={() => onChange("1y")}
        className={`px-3 py-1 rounded-l-md transition-colors ${
          value === "1y"
            ? "bg-primary-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        1 Year
      </button>
      <button
        role="radio"
        aria-checked={value === "all"}
        onClick={() => onChange("all")}
        className={`px-3 py-1 rounded-r-md transition-colors ${
          value === "all"
            ? "bg-primary-600 text-white"
            : "bg-white text-gray-600 hover:bg-gray-50"
        }`}
      >
        All Time
      </button>
    </div>
  );
}

/** Filter points to the last 13 months when range is "1y". */
function filterPointsByRange(
  points: TrendPoint[],
  range: TimeRange,
): TrendPoint[] {
  if (range === "all" || points.length <= 13) return points;
  return points.slice(-13);
}

interface CostTrendSectionProps {
  /** Optional: provide pre-loaded trend data (for single cost center views). */
  points?: TrendPoint[];
  costCenterNames?: string[];
  loading?: boolean;
  error?: string | null;
  /** Title override. Defaults to "Cost Trend". */
  title?: string;
}

export function CostTrendSection({
  points: externalPoints,
  costCenterNames: externalNames,
  loading: externalLoading,
  error: externalError,
  title = "Cost Trend",
}: CostTrendSectionProps = {}) {
  const hookData = useTrendData();
  const points = externalPoints ?? hookData.points;
  const costCenterNames = externalNames ?? hookData.costCenterNames;
  const loading =
    externalLoading !== undefined ? externalLoading : hookData.loading;
  const error = externalError !== undefined ? externalError : hookData.error;

  const [timeRange, setTimeRange] = useState<TimeRange>("1y");
  const showToggle = points.length > 13;
  const filteredPoints = filterPointsByRange(points, timeRange);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {!loading && !error && showToggle && (
          <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
        )}
      </div>

      {loading && <LoadingSkeleton />}

      {error && <Banner variant="danger">{error}</Banner>}

      {!loading && !error && filteredPoints.length > 0 && (
        <Suspense fallback={<LoadingSkeleton />}>
          <CostTrendChart
            points={filteredPoints}
            costCenterNames={costCenterNames}
          />
        </Suspense>
      )}
    </div>
  );
}
