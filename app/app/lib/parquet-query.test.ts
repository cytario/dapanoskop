import { describe, expect, test, vi } from "vitest";
import { queryUsageTypeRows, isMissingColumnError } from "./parquet-query";
import type { ResultTableLike } from "./parquet-query";

/**
 * Unit tests for the net_cost_usd parquet retry logic. DuckDB-wasm cannot
 * run under jsdom, so these tests exercise the pure helper with a mocked
 * query runner and a minimal arrow-like result.
 */

const SOURCE = "'s3://bucket/2026-01/cost-by-usage-type.parquet'";

function fakeResult(rows: (string | number | null)[][]): ResultTableLike {
  return {
    numRows: rows.length,
    getChildAt(col: number) {
      return {
        get(i: number) {
          return rows[i][col];
        },
      };
    },
  };
}

// New schema column order:
// workload, usage_type, category, period, cost_usd, net_cost_usd, usage_quantity
const SAMPLE_ROWS = [
  ["web-app", "APN1-TimedStorage-ByteHrs", "Storage", "2026-01", 110, 100, 500],
  ["web-app", "APN1-BoxUsage:m5.xlarge", "Compute", "2026-01", 200, null, 10],
];

describe("isMissingColumnError", () => {
  test("matches DuckDB binder error for missing net_cost_usd", () => {
    expect(
      isMissingColumnError(
        'Invalid Input Error: Binder Error: Referenced column "net_cost_usd" not found!',
      ),
    ).toBe(true);
    expect(
      isMissingColumnError(
        'Catalog Error: Column with name "net_cost_usd" not found!',
      ),
    ).toBe(true);
  });

  test("rejects unrelated errors", () => {
    expect(
      isMissingColumnError(
        'Invalid Input Error: Binder Error: Referenced column "other" not found!',
      ),
    ).toBe(false);
    expect(
      isMissingColumnError(
        'Binder Error: Referenced column "gross_cost_usd" not found!',
      ),
    ).toBe(false);
    expect(isMissingColumnError("Failed to fetch parquet: 404")).toBe(false);
    expect(isMissingColumnError(new Error("network error"))).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });
});

describe("queryUsageTypeRows", () => {
  test("projects net_cost_usd and maps rows when the column exists", async () => {
    const runQuery = vi.fn().mockResolvedValue(fakeResult(SAMPLE_ROWS));

    const { rows, hasNet } = await queryUsageTypeRows(runQuery, SOURCE);

    expect(hasNet).toBe(true);
    expect(runQuery).toHaveBeenCalledTimes(1);
    const sql = runQuery.mock.calls[0][0];
    expect(sql).toContain("net_cost_usd");
    expect(sql).toContain(SOURCE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      workload: "web-app",
      usage_type: "APN1-TimedStorage-ByteHrs",
      category: "Storage",
      period: "2026-01",
      cost_usd: 110,
      net_cost_usd: 100,
      usage_quantity: 500,
    });
    // NULL net in the parquet stays undefined (falls back to gross downstream)
    expect(rows[1].net_cost_usd).toBeUndefined();
  });

  test("retries gross-only projection when net_cost_usd column is missing", async () => {
    const binderError = new Error(
      'Invalid Input Error: Binder Error: Referenced column "net_cost_usd" not found!',
    );
    // Old schema column order: workload, usage_type, category, period,
    // cost_usd, usage_quantity
    const oldRows = [
      ["web-app", "APN1-TimedStorage-ByteHrs", "Storage", "2026-01", 100, 500],
    ];
    const runQuery = vi
      .fn()
      .mockRejectedValueOnce(binderError)
      .mockResolvedValueOnce(fakeResult(oldRows));

    const { rows, hasNet } = await queryUsageTypeRows(runQuery, SOURCE);

    expect(hasNet).toBe(false);
    expect(runQuery).toHaveBeenCalledTimes(2);
    // First attempt projects net; retry omits it
    expect(runQuery.mock.calls[0][0]).toContain("net_cost_usd");
    expect(runQuery.mock.calls[1][0]).not.toContain("net_cost_usd");
    expect(rows).toHaveLength(1);
    expect(rows[0].net_cost_usd).toBeUndefined();
    expect(rows[0].cost_usd).toBe(100);
    // usage_quantity maps from column 5 in the old layout
    expect(rows[0].usage_quantity).toBe(500);
  });

  test("rethrows non-binder errors without retrying", async () => {
    const runQuery = vi
      .fn()
      .mockRejectedValue(new Error("Failed to fetch parquet: 403"));

    await expect(queryUsageTypeRows(runQuery, SOURCE)).rejects.toThrow("403");
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  test("appends the query tail (WHERE / ORDER BY) to both attempts", async () => {
    const binderError = new Error(
      'Binder Error: Referenced column "net_cost_usd" not found!',
    );
    const runQuery = vi
      .fn()
      .mockRejectedValueOnce(binderError)
      .mockResolvedValueOnce(fakeResult([]));

    await queryUsageTypeRows(
      runQuery,
      SOURCE,
      "WHERE workload = ?\n ORDER BY cost_usd DESC",
    );

    expect(runQuery.mock.calls[0][0]).toContain("WHERE workload = ?");
    expect(runQuery.mock.calls[1][0]).toContain("WHERE workload = ?");
    expect(runQuery.mock.calls[1][0]).not.toContain("net_cost_usd");
  });

  test("defaults null required cells (cost, usage_quantity) sensibly", async () => {
    const rows = [
      ["web-app", "APN1-X", "Other", "2026-01", null, null, null],
    ] as (string | number | null)[][];
    const runQuery = vi.fn().mockResolvedValue(fakeResult(rows));

    const { rows: mapped } = await queryUsageTypeRows(runQuery, SOURCE);

    expect(mapped[0].net_cost_usd).toBeUndefined();
    expect(mapped[0].cost_usd).toBe(0);
    expect(mapped[0].usage_quantity).toBe(0);
  });
});
