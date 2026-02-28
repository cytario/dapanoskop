import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { MetricCard, DeltaIndicator, Banner, Card } from "@cytario/design";
import type { CostSummary } from "~/types/cost-data";
import { discoverPeriods, fetchSummary } from "~/lib/data";
import { initAuth, isAuthenticated, login, logout } from "~/lib/auth";
import { formatUsd, formatPartialPeriodLabel } from "~/lib/format";
import { WorkloadTable } from "~/components/WorkloadTable";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { PeriodSelector } from "~/components/PeriodSelector";
import { CostTrendSection } from "~/components/CostTrendSection";
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

  // Determine current month for MTD label and period default
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

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
          // Skip the MTD period (current month) as default — users can still select it.
          const defaultPeriod =
            discovered[0] === currentMonth && discovered.length > 1
              ? discovered[1]
              : discovered[0];
          const initial =
            urlPeriod && discovered.includes(urlPeriod)
              ? urlPeriod
              : defaultPeriod;
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
  }, [authenticated, urlPeriod, currentMonth]);

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

  // MTD detection and like-for-like comparison
  const isMtd = summary?.is_mtd;
  const mtdComparison = summary?.mtd_comparison;
  const mtdCostCenter =
    isMtd && mtdComparison && costCenter
      ? mtdComparison.cost_centers.find((mc) => mc.name === costCenter.name)
      : undefined;
  const momPrevious =
    mtdCostCenter !== undefined
      ? mtdCostCenter.prior_partial_cost_usd
      : (costCenter?.prev_month_cost_usd ?? 0);
  const momLabel =
    isMtd && mtdComparison
      ? `vs ${formatPartialPeriodLabel(mtdComparison.prior_partial_start, mtdComparison.prior_partial_end_exclusive)}`
      : "vs Last Month";

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

        {error && <Banner variant="danger">{error}</Banner>}

        {costCenter && !loading && (
          <>
            {/* Cost center header */}
            <div>
              <h2 className="text-2xl font-bold">{name}</h2>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard
                label="Total Spend"
                value={formatUsd(costCenter.current_cost_usd)}
              />
              <MetricCard
                label={momLabel}
                value={
                  <DeltaIndicator
                    current={costCenter.current_cost_usd}
                    previous={momPrevious}
                  />
                }
              />
              <MetricCard
                label="vs Last Year"
                value={
                  isMtd ? (
                    <DeltaIndicator
                      current={0}
                      previous={0}
                      unavailable
                      unavailableText="N/A (MTD)"
                    />
                  ) : costCenter.yoy_cost_usd != null ? (
                    <DeltaIndicator
                      current={costCenter.current_cost_usd}
                      previous={costCenter.yoy_cost_usd}
                    />
                  ) : (
                    <DeltaIndicator current={0} previous={0} unavailable />
                  )
                }
              />
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
            <Card padding="md">
              <h3 className="text-lg font-semibold mb-4">Workload Breakdown</h3>
              <WorkloadTable
                workloads={costCenter.workloads}
                period={selectedPeriod}
                isMtd={isMtd}
                mtdCostCenter={mtdCostCenter}
              />
            </Card>
          </>
        )}

        {!loading && !error && !costCenter && summary && (
          <Banner variant="warning">
            Cost center &ldquo;{name}&rdquo; not found in the selected period.
          </Banner>
        )}
      </main>

      <Footer />
    </div>
  );
}
