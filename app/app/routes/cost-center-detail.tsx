import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { CostSummary } from "~/types/cost-data";
import { discoverPeriods, fetchSummary } from "~/lib/data";
import { initAuth, isAuthenticated, login, logout } from "~/lib/auth";
import { formatUsd } from "~/lib/format";
import { CostChange } from "~/components/CostChange";
import { WorkloadTable } from "~/components/WorkloadTable";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { PeriodSelector } from "~/components/PeriodSelector";
import { CostTrendSection } from "~/components/CostTrendSection";
import { InfoTooltip } from "~/components/InfoTooltip";
import type { TrendPoint } from "~/lib/useTrendData";

export function meta() {
  return [{ title: "Dapanoskop — Cost Center Detail" }];
}

export default function CostCenterDetail() {
  const { name: encodedName } = useParams();
  const name = encodedName ? decodeURIComponent(encodedName) : "";
  const [searchParams, setSearchParams] = useSearchParams();
  const urlPeriod = searchParams.get("period") ?? "";

  const [authenticated, setAuthenticated] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trend data for this cost center
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      await initAuth();
      if (isAuthenticated()) {
        setAuthenticated(true);
      } else {
        login();
      }
    }
    checkAuth();
  }, []);

  // Load periods
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function loadPeriods() {
      setError(null);
      try {
        const discovered = await discoverPeriods();
        if (cancelled) return;
        if (discovered.length > 0) {
          setPeriods(discovered);
          const initial =
            urlPeriod && discovered.includes(urlPeriod)
              ? urlPeriod
              : discovered[0];
          setSelectedPeriod(initial);
        } else {
          setError("No cost data available.");
        }
      } catch {
        if (!cancelled) setError("Failed to discover periods.");
      }
      if (!cancelled) setLoading(false);
    }
    loadPeriods();
    return () => {
      cancelled = true;
    };
  }, [authenticated, urlPeriod]);

  // Load summary for selected period
  useEffect(() => {
    if (!selectedPeriod) return;
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSummary(selectedPeriod);
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setError(`Failed to load data for ${selectedPeriod}.`);
      }
      if (!cancelled) setLoading(false);
    }
    loadSummary();
    return () => {
      cancelled = true;
    };
  }, [selectedPeriod]);

  // Load trend data for this cost center across all periods
  useEffect(() => {
    if (!authenticated || periods.length === 0 || !name) return;
    let cancelled = false;

    async function loadTrend() {
      setTrendLoading(true);
      setTrendError(null);
      try {
        const results = await Promise.allSettled(
          periods.map((p) => fetchSummary(p)),
        );
        if (cancelled) return;

        const pts: TrendPoint[] = [];
        for (let i = 0; i < periods.length; i++) {
          const result = results[i];
          if (result.status !== "fulfilled") continue;
          const cc = result.value.cost_centers.find((c) => c.name === name);
          if (cc) {
            pts.push({ period: periods[i], [name]: cc.current_cost_usd });
          }
        }
        pts.sort((a, b) =>
          (a.period as string).localeCompare(b.period as string),
        );
        setTrendPoints(pts);
      } catch {
        if (!cancelled) setTrendError("Failed to load trend data.");
      } finally {
        if (!cancelled) setTrendLoading(false);
      }
    }
    loadTrend();
    return () => {
      cancelled = true;
    };
  }, [authenticated, periods, name]);

  // Handle period selection and update URL
  function handlePeriodSelect(period: string) {
    setSelectedPeriod(period);
    setSearchParams({ period });
  }

  // Find cost center in summary
  const costCenter = summary?.cost_centers.find((cc) => cc.name === name);

  // Determine current month for MTD label
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!authenticated && !loading) {
    return null; // Will redirect via login()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header period={selectedPeriod} onLogout={logout} />

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link
            to={`/?period=${selectedPeriod}`}
            className="text-primary-600 hover:underline text-sm"
          >
            &larr; Back to Report
          </Link>
        </div>

        {/* Period Selector */}
        {periods.length > 0 && (
          <PeriodSelector
            periods={periods}
            selected={selectedPeriod}
            onSelect={handlePeriodSelect}
            currentMonth={currentMonth}
          />
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-pulse text-primary-600 font-medium">
              Loading cost data...
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {costCenter && !loading && (
          <>
            {/* Cost center header */}
            <div>
              <h2 className="text-2xl font-bold">{name}</h2>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                <div className="text-sm text-gray-500">
                  Total Spend
                  <InfoTooltip text="Total cost for this cost center in the selected period." />
                </div>
                <div className="text-2xl font-semibold mt-1">
                  {formatUsd(costCenter.current_cost_usd)}
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                <div className="text-sm text-gray-500">
                  vs Last Month
                  <InfoTooltip text="Cost change from the previous calendar month." />
                </div>
                <div className="text-lg font-medium mt-1">
                  <CostChange
                    current={costCenter.current_cost_usd}
                    previous={costCenter.prev_month_cost_usd}
                  />
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                <div className="text-sm text-gray-500">
                  vs Last Year
                  <InfoTooltip text="Cost change compared to the same month one year ago." />
                </div>
                <div className="text-lg font-medium mt-1">
                  {costCenter.yoy_cost_usd > 0 ? (
                    <CostChange
                      current={costCenter.current_cost_usd}
                      previous={costCenter.yoy_cost_usd}
                    />
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </div>
              </div>
            </div>

            {/* Cost trend chart for this cost center */}
            <CostTrendSection
              points={trendPoints}
              costCenterNames={name ? [name] : []}
              loading={trendLoading}
              error={trendError}
              title={`${name} Cost Trend`}
            />

            {/* Workload breakdown */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4">Workload Breakdown</h3>
              <WorkloadTable
                workloads={costCenter.workloads}
                period={selectedPeriod}
              />
            </div>
          </>
        )}

        {!loading && !error && !costCenter && summary && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-700">
            Cost center &ldquo;{name}&rdquo; not found in the selected period.
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
