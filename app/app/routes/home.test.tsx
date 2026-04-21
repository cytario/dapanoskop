// @vitest-environment jsdom
import { render, cleanup, waitFor, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router";
import type { CostSummary } from "~/types/cost-data";

vi.mock("~/lib/auth", () => ({
  initAuth: vi.fn().mockResolvedValue(undefined),
  isAuthenticated: vi.fn(() => true),
  login: vi.fn(),
  handleCallback: vi.fn().mockResolvedValue(true),
  logout: vi.fn(),
}));

vi.mock("~/lib/data", () => ({
  discoverPeriods: vi.fn(),
  fetchSummary: vi.fn(),
}));

// Keep the tree small and deterministic — the Home component is what we're
// testing, not the downstream rendering of child components.
vi.mock("~/components/PeriodSelector", () => ({
  PeriodSelector: ({
    periods,
    selected,
  }: {
    periods: string[];
    selected: string;
  }) => (
    <div data-testid="period-selector">
      periods={periods.join(",")};selected={selected}
    </div>
  ),
}));
vi.mock("~/components/GlobalSummary", () => ({
  GlobalSummary: () => <div data-testid="global-summary" />,
}));
vi.mock("~/components/TaggingCoverage", () => ({
  TaggingCoverage: () => <div data-testid="tagging-coverage" />,
}));
vi.mock("~/components/CostCenterCard", () => ({
  CostCenterCard: ({ costCenter }: { costCenter: { name: string } }) => (
    <div data-testid="cost-center-card">{costCenter.name}</div>
  ),
}));
vi.mock("~/components/StorageOverview", () => ({
  StorageOverview: () => <div data-testid="storage-overview" />,
}));
vi.mock("~/components/CostTrendSection", () => ({
  CostTrendSection: () => <div data-testid="cost-trend" />,
}));
vi.mock("~/components/Header", () => ({
  Header: () => <header data-testid="header" />,
}));
vi.mock("~/components/Footer", () => ({
  Footer: () => <footer data-testid="footer" />,
}));
vi.mock("~/components/DeltaLogo", () => ({
  DeltaLogo: () => <svg data-testid="delta-logo" />,
}));
vi.mock("~/components/MtdBanner", () => ({
  MtdBanner: ({
    collectedAt,
    mtdComparison,
  }: {
    collectedAt: string;
    mtdComparison?: { prior_partial_start: string };
  }) => (
    <div role="alert" data-testid="mtd-banner">
      Month-to-date — collectedAt={collectedAt}
      {mtdComparison
        ? `;priorPartialStart=${mtdComparison.prior_partial_start}`
        : ""}
    </div>
  ),
}));

import Home from "./home";
import * as auth from "~/lib/auth";
import * as data from "~/lib/data";

const mockedAuth = vi.mocked(auth);
const mockedData = vi.mocked(data);

function makeSummary(overrides: Partial<CostSummary> = {}): CostSummary {
  return {
    collected_at: "2026-02-15T03:00:00Z",
    period: "2026-01",
    periods: { current: "2026-01", prev_month: "2025-12", yoy: "2025-01" },
    totals: {
      current_cost_usd: 1000,
      prev_month_cost_usd: 900,
      yoy_cost_usd: 800,
    },
    storage_config: { include_efs: false, include_ebs: false },
    storage_metrics: {
      total_cost_usd: 100,
      prev_month_cost_usd: 90,
      total_volume_bytes: 1_099_511_627_776,
      hot_tier_percentage: 50,
      cost_per_tb_usd: 10,
    },
    cost_centers: [
      {
        name: "Engineering",
        current_cost_usd: 1000,
        prev_month_cost_usd: 900,
        yoy_cost_usd: 800,
        workloads: [],
      },
    ],
    tagging_coverage: {
      tagged_cost_usd: 900,
      untagged_cost_usd: 100,
      tagged_percentage: 90,
    },
    ...overrides,
  };
}

function renderHome(path: string = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Home />
    </MemoryRouter>,
  );
}

/** Flush all pending microtasks triggered by useEffect chains. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Home route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuth.isAuthenticated.mockReturnValue(true);
    mockedAuth.initAuth.mockResolvedValue(undefined);
    mockedAuth.handleCallback.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders sign-in UI when unauthenticated", async () => {
    mockedAuth.isAuthenticated.mockReturnValue(false);

    renderHome();
    await flush();

    expect(screen.getByText(/sign in to view your cost report/i)).toBeTruthy();
    const signInButton = screen.getByRole("button", { name: /sign in/i });
    signInButton.click();
    expect(mockedAuth.login).toHaveBeenCalledOnce();
    // No selector, summary, or cost-center card should render
    expect(screen.queryByTestId("period-selector")).toBeNull();
    expect(screen.queryByTestId("cost-center-card")).toBeNull();
  });

  it("defaults to most recent non-current-month period when ≥2 periods exist", async () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Periods are sorted newest first: [currentMonth, "2026-01", ...]
    mockedData.discoverPeriods.mockResolvedValue([
      currentMonth,
      "2026-01",
      "2025-12",
    ]);
    mockedData.fetchSummary.mockResolvedValue(makeSummary());

    renderHome("/");

    await waitFor(() =>
      expect(screen.getByTestId("period-selector")).toBeTruthy(),
    );
    expect(screen.getByTestId("period-selector").textContent).toContain(
      "selected=2026-01",
    );
    // fetchSummary must be called for the defaulted period, not MTD
    expect(mockedData.fetchSummary).toHaveBeenCalledWith("2026-01");
  });

  it("falls back to the only period when discovery returns a single month", async () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    mockedData.discoverPeriods.mockResolvedValue([currentMonth]);
    mockedData.fetchSummary.mockResolvedValue(
      makeSummary({ is_mtd: true, period: currentMonth }),
    );

    renderHome();

    await waitFor(() =>
      expect(screen.getByTestId("period-selector")).toBeTruthy(),
    );
    expect(screen.getByTestId("period-selector").textContent).toContain(
      `selected=${currentMonth}`,
    );
    expect(mockedData.fetchSummary).toHaveBeenCalledWith(currentMonth);
  });

  it("uses the ?period= URL parameter when it matches a discovered period", async () => {
    mockedData.discoverPeriods.mockResolvedValue([
      "2026-02",
      "2026-01",
      "2025-12",
    ]);
    mockedData.fetchSummary.mockResolvedValue(
      makeSummary({ period: "2025-12" }),
    );

    renderHome("/?period=2025-12");

    await waitFor(() =>
      expect(screen.getByTestId("period-selector")).toBeTruthy(),
    );
    expect(screen.getByTestId("period-selector").textContent).toContain(
      "selected=2025-12",
    );
    expect(mockedData.fetchSummary).toHaveBeenCalledWith("2025-12");
  });

  it("ignores ?period= when it does not match any discovered period", async () => {
    mockedData.discoverPeriods.mockResolvedValue(["2026-01", "2025-12"]);
    mockedData.fetchSummary.mockResolvedValue(makeSummary());

    renderHome("/?period=9999-01");

    await waitFor(() =>
      expect(screen.getByTestId("period-selector")).toBeTruthy(),
    );
    expect(screen.getByTestId("period-selector").textContent).toContain(
      "selected=2026-01",
    );
  });

  it("renders MtdBanner only when summary.is_mtd is true", async () => {
    mockedData.discoverPeriods.mockResolvedValue(["2026-02", "2026-01"]);
    mockedData.fetchSummary.mockResolvedValue(
      makeSummary({
        is_mtd: true,
        collected_at: "2026-02-15T03:00:00Z",
        mtd_comparison: {
          prior_partial_start: "2026-01-01",
          prior_partial_end_exclusive: "2026-01-15",
          cost_centers: [],
        },
      }),
    );

    renderHome();

    const banner = await screen.findByTestId("mtd-banner");
    expect(banner.textContent).toContain("collectedAt=2026-02-15T03:00:00Z");
    expect(banner.textContent).toContain("priorPartialStart=2026-01-01");
  });

  it("does not render MtdBanner when summary.is_mtd is false", async () => {
    mockedData.discoverPeriods.mockResolvedValue(["2026-02", "2026-01"]);
    mockedData.fetchSummary.mockResolvedValue(makeSummary({ is_mtd: false }));

    renderHome();

    await waitFor(() => screen.getByTestId("global-summary"));
    expect(screen.queryByTestId("mtd-banner")).toBeNull();
  });

  it("shows an error Banner when discoverPeriods rejects", async () => {
    mockedData.discoverPeriods.mockRejectedValue(new Error("network"));

    renderHome();

    await waitFor(() =>
      expect(screen.getByText(/Failed to discover periods/i)).toBeTruthy(),
    );
    // fetchSummary should never be called when period discovery fails
    expect(mockedData.fetchSummary).not.toHaveBeenCalled();
  });

  it("shows an error Banner when discoverPeriods returns an empty array", async () => {
    mockedData.discoverPeriods.mockResolvedValue([]);

    renderHome();

    await waitFor(() =>
      expect(screen.getByText(/No cost data available/i)).toBeTruthy(),
    );
  });

  it("shows an error Banner when fetchSummary rejects", async () => {
    mockedData.discoverPeriods.mockResolvedValue(["2026-01"]);
    mockedData.fetchSummary.mockRejectedValue(new Error("bucket 403"));

    renderHome();

    await waitFor(() =>
      expect(screen.getByText(/Failed to load data for 2026-01/i)).toBeTruthy(),
    );
  });
});
