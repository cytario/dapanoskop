import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { CostSummary } from "~/types/cost-data";
import { discoverPeriods, fetchSummary } from "~/lib/data";
import {
  initAuth,
  isAuthenticated,
  login,
  handleCallback,
  logout,
} from "~/lib/auth";
import { PeriodSelector } from "~/components/PeriodSelector";
import { GlobalSummary } from "~/components/GlobalSummary";
import { TaggingCoverage } from "~/components/TaggingCoverage";
import { CostCenterCard } from "~/components/CostCenterCard";
import { StorageOverview } from "~/components/StorageOverview";
import { CostTrendSection } from "~/components/CostTrendSection";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { DeltaLogo } from "~/components/DeltaLogo";

export function meta() {
  return [
    { title: "Dapanoskop — Cost Report" },
    { name: "description", content: "AWS cloud cost monitoring" },
  ];
}

export default function Home() {
  const [searchParams] = useSearchParams();
  const urlPeriod = searchParams.get("period") ?? "";

  const [authenticated, setAuthenticated] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      await initAuth();
      // Handle callback if present
      const params = new URLSearchParams(window.location.search);
      if (params.has("code")) {
        await handleCallback();
      }
      if (isAuthenticated()) {
        setAuthenticated(true);
      } else {
        setLoading(false);
      }
    }
    checkAuth();
  }, []);

  // Load periods
  useEffect(() => {
    if (!authenticated) return;
    async function loadPeriods() {
      setError(null);
      try {
        const discovered = await discoverPeriods();
        if (discovered.length > 0) {
          setPeriods(discovered);
          // Use period from URL if valid, otherwise default to most recent
          const initial =
            urlPeriod && discovered.includes(urlPeriod)
              ? urlPeriod
              : discovered[0];
          setSelectedPeriod(initial);
        } else {
          setError("No cost data available.");
        }
      } catch {
        setError("Failed to discover periods.");
      }
      setLoading(false);
    }
    loadPeriods();
  }, [authenticated, urlPeriod]);

  // Load summary for selected period
  useEffect(() => {
    if (!selectedPeriod) return;
    async function loadSummary() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSummary(selectedPeriod);
        setSummary(data);
      } catch {
        setError(`Failed to load data for ${selectedPeriod}.`);
      }
      setLoading(false);
    }
    loadSummary();
  }, [selectedPeriod]);

  // Determine current month for MTD label
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!authenticated && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <DeltaLogo className="w-8 h-8" />
            <h1 className="text-2xl font-bold">Dapanoskop</h1>
          </div>
          <p className="text-gray-600 mb-6">
            Sign in to view your cost report.
          </p>
          <button
            onClick={login}
            className="bg-primary-600 text-white px-6 py-2 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <Header period={selectedPeriod} onLogout={logout} />

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Period Selector */}
        {periods.length > 0 && (
          <PeriodSelector
            periods={periods}
            selected={selectedPeriod}
            onSelect={setSelectedPeriod}
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

        {summary && !loading && (
          <>
            {/* Global Summary */}
            <GlobalSummary summary={summary} />

            {/* Cost Trend Chart */}
            <CostTrendSection />

            {/* Storage Overview */}
            <StorageOverview metrics={summary.storage_metrics} />

            {/* Tagging Coverage */}
            <TaggingCoverage data={summary.tagging_coverage} />

            {/* Cost Center Cards */}
            <div className="space-y-3">
              {summary.cost_centers.map((cc) => (
                <CostCenterCard
                  key={cc.name}
                  costCenter={cc}
                  period={selectedPeriod}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
