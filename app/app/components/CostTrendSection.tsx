import { lazy, Suspense } from "react";
import { useTrendData } from "~/lib/useTrendData";

const CostTrendChart = lazy(() => import("~/components/CostTrendChart"));

function LoadingSkeleton() {
  return <div className="h-80 animate-pulse bg-gray-100 rounded" />;
}

export function CostTrendSection() {
  const { points, costCenterNames, loading, error } = useTrendData();

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-4">Cost Trend</h2>

      {loading && <LoadingSkeleton />}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && points.length > 0 && (
        <Suspense fallback={<LoadingSkeleton />}>
          <CostTrendChart points={points} costCenterNames={costCenterNames} />
        </Suspense>
      )}
    </div>
  );
}
