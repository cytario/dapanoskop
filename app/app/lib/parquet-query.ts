import type { UsageTypeCostRow } from "~/types/cost-data";

/**
 * DuckDB query helpers for cost-by-usage-type.parquet.
 *
 * The parquet files carry cost_usd as the GROSS (pre-credit/discount,
 * UnblendedCost) figure — the primary one — plus an optional net_cost_usd
 * column (NetAmortizedCost, i.e. after credits/RI-SP amortization/discounts).
 * Older files lack net_cost_usd and only have the net figure under cost_usd,
 * in which case both figures are simply "net" (same value); the fallback
 * semantics are net = net_cost_usd ?? cost_usd.
 *
 * Queries that project net_cost_usd are retried without it when DuckDB
 * raises a binder error ("Referenced column ... not found") for the older
 * file layout.
 */

/** Minimal structural types so the helper is testable without DuckDB-wasm. */
export interface ParquetStatement {
  query(...args: unknown[]): Promise<ResultTableLike>;
  close(): Promise<void>;
}

export interface ResultTableLike {
  numRows: number;
  getChildAt(index: number): { get(i: number): unknown } | null;
}

export interface ParquetConnection {
  query(sql: string): Promise<unknown>;
  prepare(sql: string): Promise<ParquetStatement>;
}

const SELECT_WITH_NET = `
  SELECT workload, usage_type, category, period, cost_usd, net_cost_usd, usage_quantity
  FROM read_parquet(__SOURCE__)
`;

const SELECT_GROSS_ONLY = `
  SELECT workload, usage_type, category, period, cost_usd, usage_quantity
  FROM read_parquet(__SOURCE__)
`;

function buildQuery(select: string, source: string, tail: string): string {
  return (
    select.replace("__SOURCE__", source) + (tail ? "\n            " + tail : "")
  );
}

/**
 * True when the thrown error is DuckDB complaining about the missing
 * net_cost_usd column (binder error), meaning the parquet file predates the
 * column and the gross-only projection should be retried.
 */
export function isMissingColumnError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  // DuckDB reports the column name at the end: 'Referenced column
  // "net_cost_usd" not found!'. Both quote styles appear across versions.
  const binder = /binder error|catalog error/i.test(message);
  const column =
    /referenced column\s+"net_cost_usd"|column with name "net_cost_usd"/i.test(
      message,
    );
  return binder && column;
}

/**
 * Runs the usage-type SELECT, projecting net_cost_usd, retrying without it
 * (gross-only fallback) when the parquet file is older and lacks the column.
 *
 * `runQuery` receives the final SQL string (with `tail` appended — e.g. a
 * WHERE clause and/or ORDER BY — and the parquet source substituted in) and
 * returns the arrow-like result; it may throw — a missing-column error
 * triggers exactly one retry with the gross-only projection.
 */
export async function queryUsageTypeRows(
  runQuery: (sql: string) => Promise<ResultTableLike>,
  parquetSource: string,
  tail = "",
): Promise<{ rows: UsageTypeCostRow[]; hasNet: boolean }> {
  let result: ResultTableLike;
  try {
    result = await runQuery(buildQuery(SELECT_WITH_NET, parquetSource, tail));
  } catch (e) {
    if (isMissingColumnError(e)) {
      result = await runQuery(
        buildQuery(SELECT_GROSS_ONLY, parquetSource, tail),
      );
      return { rows: mapResultRows(result, false), hasNet: false };
    }
    throw e;
  }
  return { rows: mapResultRows(result, true), hasNet: true };
}

function mapResultRows(
  result: ResultTableLike,
  hasNet: boolean,
): UsageTypeCostRow[] {
  const rows: UsageTypeCostRow[] = [];
  for (let i = 0; i < result.numRows; i++) {
    rows.push({
      workload: stringAt(result, i, 0),
      usage_type: stringAt(result, i, 1),
      category: stringAt(result, i, 2) as UsageTypeCostRow["category"],
      period: stringAt(result, i, 3),
      cost_usd: requiredNumberAt(result, i, 4, 0),
      ...(hasNet ? { net_cost_usd: optionalNumberAt(result, i, 5) } : {}),
      usage_quantity: requiredNumberAt(result, i, hasNet ? 6 : 5, 0),
    });
  }
  return rows;
}

function stringAt(result: ResultTableLike, i: number, col: number): string {
  return String(result.getChildAt(col)?.get(i) ?? "");
}

/** Nullable column: NULL / missing cell maps to undefined. */
function optionalNumberAt(
  result: ResultTableLike,
  i: number,
  col: number,
): number | undefined {
  const value = result.getChildAt(col)?.get(i);
  return value == null ? undefined : Number(value);
}

/** Required column: NULL / missing cell maps to the fallback. */
function requiredNumberAt(
  result: ResultTableLike,
  i: number,
  col: number,
  fallback: number,
): number {
  const value = result.getChildAt(col)?.get(i);
  return value == null ? fallback : Number(value);
}
