import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { CostSummary } from "~/types/cost-data";
import { discoverPeriods, fetchSummary } from "~/lib/data";
import { initAuth, isAuthenticated, login, logout } from "~/lib/auth";
import { formatBytes, formatUsd } from "~/lib/format";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { PeriodSelector } from "~/components/PeriodSelector";
import { InfoTooltip } from "~/components/InfoTooltip";

export function meta() {
  return [{ title: "Dapanoskop — Storage Deep Dive" }];
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export default function StorageDeepDive() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlPeriod = searchParams.get("period") ?? "";

  const [authenticated, setAuthenticated] = useState(false);
  const [periods, setPeriods] = useState<string[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  function handlePeriodSelect(period: string) {
    setSelectedPeriod(period);
    setSearchParams({ period });
  }

  const inventory = summary?.storage_inventory;
  const metrics = summary?.storage_metrics;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!authenticated && !loading) {
    return null;
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
              Loading storage data...
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
            <h2 className="text-2xl font-bold">Storage Deep Dive</h2>

            {/* Summary cards */}
            {metrics && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                  <div className="text-sm text-gray-500">
                    Total Stored
                    <InfoTooltip text="Total storage volume from S3 Inventory. This is the precise amount of data stored at the time of the latest inventory snapshot." />
                  </div>
                  <div className="text-2xl font-semibold mt-1">
                    {metrics.inventory_total_bytes != null
                      ? formatBytes(metrics.inventory_total_bytes)
                      : "N/A"}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                  <div className="text-sm text-gray-500">
                    Storage Cost
                    <InfoTooltip text="Total storage cost for this period from Cost Explorer." />
                  </div>
                  <div className="text-2xl font-semibold mt-1">
                    {formatUsd(metrics.total_cost_usd)}
                  </div>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                  <div className="text-sm text-gray-500">
                    Cost / TB
                    <InfoTooltip text="Storage cost divided by total volume." />
                  </div>
                  <div className="text-2xl font-semibold mt-1">
                    {formatUsd(metrics.cost_per_tb_usd)}
                  </div>
                </div>
              </div>
            )}

            {/* Bucket breakdown table */}
            {inventory && inventory.buckets.length > 0 ? (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold">
                    S3 Buckets
                    <InfoTooltip text="Storage breakdown by S3 bucket from the latest inventory snapshot. Shows total size and object count per bucket." />
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2 font-medium text-gray-600">
                          Bucket
                        </th>
                        <th className="text-right px-4 py-2 font-medium text-gray-600">
                          Size
                        </th>
                        <th className="text-right px-4 py-2 font-medium text-gray-600">
                          Objects
                        </th>
                        <th className="text-right px-4 py-2 font-medium text-gray-600">
                          % of Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.buckets.map((bucket) => {
                        const totalBytes = inventory.buckets.reduce(
                          (sum, b) => sum + b.total_bytes,
                          0,
                        );
                        const pct =
                          totalBytes > 0
                            ? ((bucket.total_bytes / totalBytes) * 100).toFixed(
                                1,
                              )
                            : "0.0";
                        return (
                          <tr
                            key={bucket.source_bucket}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="px-4 py-2 font-mono text-xs">
                              {bucket.source_bucket}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {formatBytes(bucket.total_bytes)}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">
                              {formatCount(bucket.object_count)}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-600">
                              {pct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-semibold">
                        <td className="px-4 py-2">Total</td>
                        <td className="px-4 py-2 text-right">
                          {formatBytes(
                            inventory.buckets.reduce(
                              (sum, b) => sum + b.total_bytes,
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {formatCount(
                            inventory.buckets.reduce(
                              (sum, b) => sum + b.object_count,
                              0,
                            ),
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">100%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-700">
                No S3 Inventory data available. Configure S3 Inventory and set
                the <code className="text-sm">inventory_bucket</code> and{" "}
                <code className="text-sm">inventory_prefix</code> variables to
                enable storage deep dive.
              </div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}
