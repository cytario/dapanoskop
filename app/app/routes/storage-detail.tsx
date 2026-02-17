import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CostSummary } from "~/types/cost-data";
import { fetchSummary } from "~/lib/data";
import { initAuth, isAuthenticated, login } from "~/lib/auth";
import { getConfig } from "~/lib/config";
import { getAwsCredentials } from "~/lib/credentials";
import { buildS3ConfigStatements } from "~/lib/duckdb-config";
import { formatUsd, formatBytes } from "~/lib/format";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";
import { InfoTooltip } from "~/components/InfoTooltip";

export function meta() {
  return [{ title: "Dapanoskop — Storage Volume Breakdown" }];
}

/** Mapping from usage_type suffix to friendly tier name. */
const TIER_MAP: Record<string, string> = {
  "TimedStorage-ByteHrs": "S3 Standard",
  "TimedStorage-INT-FA-ByteHrs": "IT Frequent Access",
  "TimedStorage-INT-IA-ByteHrs": "IT Infrequent Access",
  "TimedStorage-INT-AIA-ByteHrs": "IT Archive Instant",
  "TimedStorage-INT-DAA-ByteHrs": "IT Deep Archive",
  "TimedStorage-SIA-ByteHrs": "One Zone-IA",
  "TimedStorage-GlacierByteHrs": "Glacier Flexible",
  "TimedStorage-GIR-ByteHrs": "Glacier Instant",
  "TimedStorage-GDA-ByteHrs": "Glacier Deep Archive",
};

/** Color palette ordered warm-to-cool (hot-to-cold tiers). */
const TIER_COLORS: Record<string, string> = {
  "S3 Standard": "#ef4444",
  "IT Frequent Access": "#f97316",
  "Glacier Instant": "#eab308",
  "IT Infrequent Access": "#22c55e",
  "One Zone-IA": "#14b8a6",
  "IT Archive Instant": "#3b82f6",
  "Glacier Flexible": "#8b5cf6",
  "IT Deep Archive": "#6366f1",
  "Glacier Deep Archive": "#1e3a5f",
};

const DEFAULT_COLOR = "#94a3b8"; // slate-400

interface TierRow {
  tier: string;
  gb_months: number;
  cost_usd: number;
}

function resolveTierName(usageType: string): string {
  for (const [suffix, name] of Object.entries(TIER_MAP)) {
    if (usageType.endsWith(suffix)) return name;
  }
  return usageType;
}

function formatVolume(gbMonths: number): string {
  if (gbMonths >= 1000) return `${(gbMonths / 1000).toFixed(1)} TB`;
  return `${gbMonths.toFixed(1)} GB`;
}

interface PieTooltipPayload {
  name: string;
  value: number;
  payload: { tier: string; gb_months: number; cost_usd: number };
}

function CustomPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: PieTooltipPayload[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium">{entry.name}</p>
      <p>Volume: {formatVolume(entry.payload.gb_months)}</p>
      <p>Cost: {formatUsd(entry.payload.cost_usd)}</p>
    </div>
  );
}

export default function StorageDetail() {
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period") ?? "";

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [tierRows, setTierRows] = useState<TierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let worker: Worker | undefined;
    let db: import("@duckdb/duckdb-wasm").AsyncDuckDB | undefined;

    async function loadData() {
      try {
        const summaryData = await fetchSummary(period);
        if (cancelled) return;
        setSummary(summaryData);

        const cfg = await getConfig();
        const duckdb = await import("@duckdb/duckdb-wasm");
        if (cancelled) return;

        const DUCKDB_BUNDLES = {
          mvp: {
            mainModule: `${window.location.origin}/duckdb/duckdb-eh.wasm`,
            mainWorker: `${window.location.origin}/duckdb/duckdb-browser-eh.worker.js`,
          },
          eh: {
            mainModule: `${window.location.origin}/duckdb/duckdb-eh.wasm`,
            mainWorker: `${window.location.origin}/duckdb/duckdb-browser-eh.worker.js`,
          },
        };

        const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
        if (!bundle.mainWorker) throw new Error("DuckDB bundle has no worker");
        worker = new Worker(bundle.mainWorker);
        const logger = new duckdb.VoidLogger();
        db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule);
        if (cancelled) return;

        let parquetSource: string;
        const conn = await db.connect();

        if (cfg.authBypass) {
          const dataBase = import.meta.env.VITE_DATA_BASE_URL ?? "/data";
          const parquetUrl = `${dataBase}/${period}/cost-by-usage-type.parquet`;
          const response = await fetch(parquetUrl);
          if (!response.ok)
            throw new Error(`Failed to fetch parquet: ${response.status}`);
          const buffer = new Uint8Array(await response.arrayBuffer());
          await db.registerFileBuffer("usage.parquet", buffer);
          parquetSource = "'usage.parquet'";
        } else {
          await conn.query("SET builtin_httpfs = false");
          await conn.query("LOAD httpfs");
          await conn.query("SET enable_object_cache = true");
          await conn.query("SET http_keep_alive = true");
          const creds = await getAwsCredentials();
          const stmts = buildS3ConfigStatements({
            region: cfg.awsRegion,
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
          });
          for (const stmt of stmts) {
            await conn.query(stmt);
          }
          parquetSource = `'s3://${cfg.dataBucketName}/${period}/cost-by-usage-type.parquet'`;
        }

        try {
          const result = await conn.query(`
            SELECT usage_type, SUM(usage_quantity) as gb_months, SUM(cost_usd) as cost_usd
            FROM read_parquet(${parquetSource})
            WHERE usage_type LIKE '%TimedStorage%'
            AND period = '${period}'
            GROUP BY usage_type
            ORDER BY gb_months DESC
          `);

          const rows: TierRow[] = [];
          for (let i = 0; i < result.numRows; i++) {
            rows.push({
              tier: resolveTierName(String(result.getChildAt(0)?.get(i) ?? "")),
              gb_months: Number(result.getChildAt(1)?.get(i) ?? 0),
              cost_usd: Number(result.getChildAt(2)?.get(i) ?? 0),
            });
          }

          if (!cancelled) setTierRows(rows);
        } finally {
          await conn.close();
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            import.meta.env.DEV
              ? `Failed to load storage detail: ${e}`
              : "Failed to load storage detail. Please try again later.",
          );
        }
      } finally {
        if (db) await db.terminate().catch(() => {});
        if (worker) worker.terminate();
        if (!cancelled) setLoading(false);
      }
    }

    async function init() {
      await initAuth();
      if (cancelled) return;
      if (!isAuthenticated()) {
        login();
        return;
      }
      if (!period) return;
      if (!/^\d{4}-\d{2}$/.test(period)) return;
      await loadData();
    }
    init();

    return () => {
      cancelled = true;
    };
  }, [period]);

  const storageMetrics = summary?.storage_metrics;
  const totalGbMonths = tierRows.reduce((sum, r) => sum + r.gb_months, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header period={period} />

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center gap-4">
          <Link
            to={`/?period=${period}`}
            className="text-primary-600 hover:underline text-sm"
          >
            ← Back to Report
          </Link>
          {summary && (
            <span className="text-sm text-gray-500">
              {new Date(
                parseInt(period.split("-")[0]),
                parseInt(period.split("-")[1]) - 1,
              ).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </span>
          )}
        </div>

        <div>
          <h2 className="text-2xl font-bold">Storage Volume Breakdown</h2>
          <p className="text-sm text-gray-500 mt-1">
            Distribution of stored data across S3 storage tiers
          </p>
        </div>

        {storageMetrics && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
              <div className="text-sm text-gray-500">
                Total Stored
                <InfoTooltip text="Total storage volume from S3 Storage Lens, measured at the time of the latest metrics snapshot." />
              </div>
              <div className="text-xl font-semibold mt-1">
                {storageMetrics.storage_lens_total_bytes != null
                  ? formatBytes(storageMetrics.storage_lens_total_bytes)
                  : "N/A"}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
              <div className="text-sm text-gray-500">
                Hot Tier
                <InfoTooltip text="Percentage of stored data in frequently accessed tiers (e.g., S3 Standard). High values may indicate optimization opportunities via lifecycle policies." />
              </div>
              <div className="text-xl font-semibold mt-1">
                {storageMetrics.hot_tier_percentage.toFixed(1)}%
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
              <div className="text-sm text-gray-500">
                Cost / TB
                <InfoTooltip text="Total storage cost divided by total volume stored, in terabytes. Lower values indicate better cost efficiency." />
              </div>
              <div className="text-xl font-semibold mt-1">
                {formatUsd(storageMetrics.cost_per_tb_usd)}
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-pulse text-primary-600 font-medium">
              Loading storage tier data...
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

        {!loading && tierRows.length > 0 && (
          <>
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">
                Tier Distribution by Volume
              </h3>
              <ResponsiveContainer width="100%" height={360}>
                <PieChart>
                  <Pie
                    data={tierRows}
                    dataKey="gb_months"
                    nameKey="tier"
                    cx="50%"
                    cy="50%"
                    outerRadius={130}
                    label={(props: { name?: string; percent?: number }) =>
                      `${props.name ?? ""} (${((props.percent ?? 0) * 100).toFixed(1)}%)`
                    }
                  >
                    {tierRows.map((row) => (
                      <Cell
                        key={row.tier}
                        fill={TIER_COLORS[row.tier] ?? DEFAULT_COLOR}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-700">
                      Tier
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">
                      Volume
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">
                      Cost
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-gray-700">
                      % of Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tierRows.map((row) => {
                    const pct =
                      totalGbMonths > 0
                        ? (row.gb_months / totalGbMonths) * 100
                        : 0;
                    return (
                      <tr key={row.tier} className="hover:bg-gray-50">
                        <td className="px-4 py-3 flex items-center gap-2">
                          <span
                            className="inline-block w-3 h-3 rounded-full"
                            style={{
                              backgroundColor:
                                TIER_COLORS[row.tier] ?? DEFAULT_COLOR,
                            }}
                          />
                          {row.tier}
                        </td>
                        <td className="text-right px-4 py-3 font-mono">
                          {formatVolume(row.gb_months)}
                        </td>
                        <td className="text-right px-4 py-3 font-mono">
                          {formatUsd(row.cost_usd)}
                        </td>
                        <td className="text-right px-4 py-3 font-mono">
                          {pct.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr className="font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="text-right px-4 py-3 font-mono">
                      {formatVolume(totalGbMonths)}
                    </td>
                    <td className="text-right px-4 py-3 font-mono">
                      {formatUsd(
                        tierRows.reduce((sum, r) => sum + r.cost_usd, 0),
                      )}
                    </td>
                    <td className="text-right px-4 py-3 font-mono">100.0%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        {!loading && tierRows.length === 0 && !error && (
          <div className="text-center py-12 text-gray-500">
            No storage tier data available for this period.
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
