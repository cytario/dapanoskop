import { useEffect, useState, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router";
import { MetricCard, DeltaIndicator, Banner } from "@cytario/design";
import type { CostSummary, UsageTypeCostRow } from "~/types/cost-data";
import { fetchSummary } from "~/lib/data";
import { initAuth, isAuthenticated, login } from "~/lib/auth";
import { getConfig } from "~/lib/config";
import { getAwsCredentials } from "~/lib/credentials";
import { buildS3ConfigStatements } from "~/lib/duckdb-config";
import { formatUsd } from "~/lib/format";
import { Header } from "~/components/Header";
import { Footer } from "~/components/Footer";

const UsageTypeTable = lazy(() =>
  import("~/components/UsageTypeTable").then((m) => ({
    default: m.UsageTypeTable,
  })),
);

export function meta() {
  return [{ title: "Dapanoskop — Storage Cost Breakdown" }];
}

export default function StorageCostDetail() {
  const [searchParams] = useSearchParams();
  const period = searchParams.get("period") ?? "";

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [usageRows, setUsageRows] = useState<UsageTypeCostRow[]>([]);
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

        // Self-hosted DuckDB bundles copied to public/duckdb/ by Vite plugin.
        // Using stable paths that bypass Vite content-hashing.
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

        // Set up connection — for S3, configure httpfs on the same connection
        // that will run the query (matches cytario-web's working pattern)
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
          // Load experimental httpfs for S3 protocol support (see duckdb/duckdb-wasm#2107)
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
            SELECT workload, usage_type, category, period, cost_usd, usage_quantity
            FROM read_parquet(${parquetSource})
            WHERE category = 'Storage'
            ORDER BY cost_usd DESC
          `);

          const rows: UsageTypeCostRow[] = [];
          for (let i = 0; i < result.numRows; i++) {
            rows.push({
              workload: String(result.getChildAt(0)?.get(i) ?? ""),
              usage_type: String(result.getChildAt(1)?.get(i) ?? ""),
              category: String(
                result.getChildAt(2)?.get(i) ?? "",
              ) as UsageTypeCostRow["category"],
              period: String(result.getChildAt(3)?.get(i) ?? ""),
              cost_usd: Number(result.getChildAt(4)?.get(i) ?? 0),
              usage_quantity: Number(result.getChildAt(5)?.get(i) ?? 0),
            });
          }

          if (!cancelled) setUsageRows(rows);
        } finally {
          await conn.close();
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            import.meta.env.DEV
              ? `Failed to load storage cost detail: ${e}`
              : "Failed to load storage cost detail. Please try again later.",
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
          <h2 className="text-2xl font-bold">Storage Cost Breakdown</h2>
          <p className="text-sm text-gray-500 mt-1">
            All storage usage types across all workloads
          </p>
        </div>

        {storageMetrics && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <MetricCard
              label="Total Storage Cost"
              value={formatUsd(storageMetrics.total_cost_usd)}
            />
            <MetricCard
              label="vs Last Month"
              value={
                <DeltaIndicator
                  current={storageMetrics.total_cost_usd}
                  previous={storageMetrics.prev_month_cost_usd}
                />
              }
            />
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-pulse text-primary-600 font-medium">
              Loading storage cost data...
            </div>
          </div>
        )}

        {error && <Banner variant="danger">{error}</Banner>}

        {!loading && usageRows.length > 0 && summary && (
          <Suspense fallback={<div>Loading table...</div>}>
            <UsageTypeTable
              rows={usageRows}
              currentPeriod={summary.periods.current}
              prevPeriod={summary.periods.prev_month}
              yoyPeriod={summary.periods.yoy}
            />
          </Suspense>
        )}
      </main>

      <Footer />
    </div>
  );
}
