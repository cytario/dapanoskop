import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CostSummary } from "~/types/cost-data";

// Mock config module
vi.mock("~/lib/config", () => ({
  getConfig: vi.fn(),
}));

// Mock credentials module
vi.mock("~/lib/credentials", () => ({
  getAwsCredentials: vi.fn(),
}));

import { fetchSummary, discoverPeriods } from "./data";
import { getConfig } from "./config";

const mockGetConfig = vi.mocked(getConfig);

const fakeSummary: CostSummary = {
  collected_at: "2026-02-08T03:00:00Z",
  period: "2026-01",
  periods: { current: "2026-01", prev_month: "2025-12", yoy: "2025-01" },
  storage_config: { include_efs: true, include_ebs: false },
  storage_metrics: {
    total_cost_usd: 1234.56,
    prev_month_cost_usd: 1084.56,
    total_volume_bytes: 5000000000000,
    hot_tier_percentage: 62.3,
    cost_per_tb_usd: 23.0,
  },
  cost_centers: [],
  tagging_coverage: {
    tagged_cost_usd: 14000,
    untagged_cost_usd: 1000,
    tagged_percentage: 93.3,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockGetConfig.mockResolvedValue({
    cognitoDomain: "",
    cognitoClientId: "",
    userPoolId: "",
    identityPoolId: "",
    awsRegion: "eu-north-1",
    dataBucketName: "test-bucket",
    redirectUri: "/",
    authBypass: true,
  });
});

describe("fetchSummary", () => {
  it("fetches correct URL in bypass mode", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeSummary),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchSummary("2026-01");
    expect(result).toEqual(fakeSummary);
    expect(mockFetch).toHaveBeenCalledWith("/data/2026-01/summary.json");

    vi.unstubAllGlobals();
  });

  it("rejects malicious period values (path traversal)", async () => {
    await expect(fetchSummary("../../etc/passwd")).rejects.toThrow(
      "Invalid period format",
    );
  });

  it("rejects periods with wrong format", async () => {
    await expect(fetchSummary("2026-1")).rejects.toThrow(
      "Invalid period format",
    );
    await expect(fetchSummary("abcd-ef")).rejects.toThrow(
      "Invalid period format",
    );
    await expect(fetchSummary("")).rejects.toThrow("Invalid period format");
  });

  it("accepts valid period format", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeSummary),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(fetchSummary("2025-12")).resolves.toBeDefined();

    vi.unstubAllGlobals();
  });
});

describe("discoverPeriods", () => {
  it("returns sorted period list from index.json", async () => {
    const periods = ["2026-01", "2025-12", "2025-11"];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ periods }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await discoverPeriods();
    expect(result).toEqual(periods);
    expect(mockFetch).toHaveBeenCalledWith("/data/index.json");

    vi.unstubAllGlobals();
  });

  it("falls back to probing when index.json is unavailable", async () => {
    const mockFetch = vi
      .fn()
      .mockImplementation((url: string, opts?: object) => {
        if (url.endsWith("index.json")) {
          return Promise.resolve({ ok: false, status: 404 });
        }
        // HEAD requests for period probing - make first two succeed
        if (opts && (opts as { method?: string }).method === "HEAD") {
          if (url.includes("2026-02") || url.includes("2026-01")) {
            return Promise.resolve({ ok: true });
          }
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: false, status: 404 });
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await discoverPeriods();
    expect(result.length).toBeGreaterThan(0);
    // Should have been called at least for index.json + HEAD requests
    expect(mockFetch).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
