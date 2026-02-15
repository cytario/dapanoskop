import { useEffect, useState, lazy, Suspense } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { CostSummary, UsageTypeCostRow } from "~/types/cost-data";
import { fetchSummary } from "~/lib/data";
import { initAuth, isAuthenticated, login } from "~/lib/auth";
import { getConfig } from "~/lib/config";
import { getAwsCredentials } from "~/lib/credentials";
import { buildS3ConfigStatements } from "~/lib/duckdb-config";
import { formatUsd } from "~/lib/format";
import { CostChange } from "~/components/CostChange";

const UsageTypeTable = lazy(() =>
  import("~/components/UsageTypeTable").then((m) => ({
    default: m.UsageTypeTable,
  })),
);

export function meta() {
  return [{ title: "Dapanoskop — Workload Detail" }];
}

export default function WorkloadDetail() {
  const { name } = useParams();
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

        const DUCKDB_BUNDLES = {
          mvp: {
            mainModule: new URL(
              "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm",
              import.meta.url,
            ).href,
            mainWorker: new URL(
              "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
              import.meta.url,
            ).href,
          },
          eh: {
            mainModule: new URL(
              "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm",
              import.meta.url,
            ).href,
            mainWorker: new URL(
              "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
              import.meta.url,
            ).href,
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

        if (cfg.authBypass) {
          const dataBase = import.meta.env.VITE_DATA_BASE_URL ?? "/data";
          const parquetUrl = `${dataBase}/${period}/cost-by-usage-type.parquet`;
          await db.registerFileURL(
            "usage.parquet",
            parquetUrl,
            duckdb.DuckDBDataProtocol.HTTP,
            false,
          );
          parquetSource = "'usage.parquet'";
        } else {
          // Load experimental httpfs for S3 protocol support (see duckdb/duckdb-wasm#2107)
          const creds = await getAwsCredentials();
          const conn = await db.connect();
          await conn.query("SET builtin_httpfs = false");
          await conn.query("LOAD httpfs");
          await conn.query("SET enable_object_cache = true");
          const stmts = buildS3ConfigStatements({
            region: cfg.awsRegion,
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
          });
          for (const stmt of stmts) {
            await conn.query(stmt);
          }
          await conn.close();
          parquetSource = `'s3://${cfg.dataBucketName}/${period}/cost-by-usage-type.parquet'`;
        }

        const conn = await db.connect();
        try {
          const stmt = await conn.prepare(`
            SELECT workload, usage_type, category, period, cost_usd, usage_quantity
            FROM read_parquet(${parquetSource})
            WHERE workload = ?
            ORDER BY cost_usd DESC
          `);
          const result = await stmt.query(name);

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
              ? `Failed to load workload detail: ${e}`
              : "Failed to load workload detail. Please try again later.",
          );
        }
      } finally {
        if (db) await db.terminate().catch(() => {});
        if (worker) worker.terminate();
      }
      if (!cancelled) setLoading(false);
    }

    async function init() {
      await initAuth();
      if (cancelled) return;
      if (!isAuthenticated()) {
        login();
        return;
      }
      if (!period || !name) return;
      if (!/^\d{4}-\d{2}$/.test(period)) return;
      await loadData();
    }
    init();

    return () => {
      cancelled = true;
    };
  }, [period, name]);

  // Find workload in summary
  const workload = summary?.cost_centers
    .flatMap((cc) => cc.workloads.map((wl) => ({ ...wl, costCenter: cc.name })))
    .find((wl) => wl.name === name);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-cytario-gradient px-6 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-lg font-bold text-white">Dapanoskop</h1>
      </header>

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

        {workload && (
          <>
            <div>
              <h2 className="text-2xl font-bold">Workload: {workload.name}</h2>
              <p className="text-sm text-gray-500 mt-1">
                Cost Center: {workload.costCenter}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                <div className="text-sm text-gray-500">Current</div>
                <div className="text-xl font-semibold mt-1">
                  {formatUsd(workload.current_cost_usd)}
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                <div className="text-sm text-gray-500">vs Last Month</div>
                <div className="text-lg font-medium mt-1">
                  <CostChange
                    current={workload.current_cost_usd}
                    previous={workload.prev_month_cost_usd}
                  />
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 transition-shadow hover:shadow-md">
                <div className="text-sm text-gray-500">vs Last Year</div>
                <div className="text-lg font-medium mt-1">
                  {workload.yoy_cost_usd > 0 ? (
                    <CostChange
                      current={workload.current_cost_usd}
                      previous={workload.yoy_cost_usd}
                    />
                  ) : (
                    <span className="text-gray-400">N/A</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-pulse text-primary-600 font-medium">
              Loading usage type data...
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
            {error}
          </div>
        )}

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

      <footer className="text-center py-4 text-xs text-gray-400">
        Dapanoskop v0.1.0
      </footer>
    </div>
  );
}
