import { useEffect, useState } from "react";
import type { CostSummary } from "~/types/cost-data";
import { discoverPeriods, fetchSummary } from "~/lib/data";
import { isAuthenticated, login, handleCallback, logout } from "~/lib/auth";
import { PeriodSelector } from "~/components/PeriodSelector";
import { GlobalSummary } from "~/components/GlobalSummary";
import { TaggingCoverage } from "~/components/TaggingCoverage";
import { CostCenterCard } from "~/components/CostCenterCard";
import { StorageOverview } from "~/components/StorageOverview";

export function meta() {
  return [
    { title: "Dapanoskop — Cost Report" },
    { name: "description", content: "AWS cloud cost monitoring" },
  ];
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      // Handle callback if present
      if (window.location.search.includes("code=")) {
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
      try {
        const discovered = await discoverPeriods();
        if (discovered.length > 0) {
          setPeriods(discovered);
          // Default to most recent complete month (second in list if first is current)
          setSelectedPeriod(discovered[0]);
        } else {
          setError("No cost data available.");
        }
      } catch {
        setError("Failed to discover periods.");
      }
      setLoading(false);
    }
    loadPeriods();
  }, [authenticated]);

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
          <h1 className="text-2xl font-bold mb-4">Dapanoskop</h1>
          <p className="text-gray-600 mb-6">
            Sign in to view your cost report.
          </p>
          <button
            onClick={login}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
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
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold">Dapanoskop</h1>
        <button
          onClick={logout}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Logout
        </button>
      </header>

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
          <div className="text-center py-12 text-gray-500">
            Loading cost data...
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

            {/* Storage Overview */}
            <div>
              <h2 className="text-lg font-semibold mb-3">Storage</h2>
              <StorageOverview metrics={summary.storage_metrics} />
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-gray-400">
        Dapanoskop v0.1.0
      </footer>
    </div>
  );
}
