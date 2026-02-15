import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("~/lib/useTrendData", () => ({
  useTrendData: vi.fn(),
}));

// Mock CostTrendChart to avoid Recharts complexity in this test
vi.mock("~/components/CostTrendChart", () => ({
  default: ({
    points,
    costCenterNames,
  }: {
    points: { period: string }[];
    costCenterNames: string[];
  }) => (
    <div data-testid="chart">
      Chart:{points.length}pts,{costCenterNames.join(",")}
    </div>
  ),
}));

import { CostTrendSection } from "./CostTrendSection";
import { useTrendData } from "~/lib/useTrendData";
import type { TrendPoint } from "~/lib/useTrendData";

const mockUseTrendData = vi.mocked(useTrendData);

afterEach(() => {
  cleanup();
});

describe("CostTrendSection", () => {
  it("renders loading skeleton when loading", () => {
    mockUseTrendData.mockReturnValue({
      points: [],
      costCenterNames: [],
      loading: true,
      error: null,
    });

    const { container } = render(<CostTrendSection />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("renders error message on error", () => {
    mockUseTrendData.mockReturnValue({
      points: [],
      costCenterNames: [],
      loading: false,
      error: "Failed to load trend data.",
    });

    const { container } = render(<CostTrendSection />);
    expect(container.textContent).toContain("Failed to load trend data.");
  });

  it("renders chart when data is available", async () => {
    mockUseTrendData.mockReturnValue({
      points: [{ period: "2025-12", Engineering: 14200 }],
      costCenterNames: ["Engineering"],
      loading: false,
      error: null,
    });

    const { container } = render(<CostTrendSection />);
    expect(container.textContent).toContain("Cost Trend");
    await waitFor(() => {
      expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
    });
  });

  it("renders heading always", () => {
    mockUseTrendData.mockReturnValue({
      points: [],
      costCenterNames: [],
      loading: true,
      error: null,
    });

    const { container } = render(<CostTrendSection />);
    expect(container.textContent).toContain("Cost Trend");
  });

  it("renders custom title when provided", () => {
    mockUseTrendData.mockReturnValue({
      points: [],
      costCenterNames: [],
      loading: false,
      error: null,
    });

    const { container } = render(
      <CostTrendSection
        points={[]}
        costCenterNames={[]}
        loading={false}
        error={null}
        title="Engineering Cost Trend"
      />,
    );
    expect(container.textContent).toContain("Engineering Cost Trend");
  });

  describe("time range toggle", () => {
    function makePoints(count: number): TrendPoint[] {
      const pts: TrendPoint[] = [];
      for (let i = 0; i < count; i++) {
        const year = i < 12 ? "2025" : "2026";
        const m = ((i % 12) + 1).toString().padStart(2, "0");
        pts.push({ period: `${year}-${m}`, Eng: 1000 + i * 100 });
      }
      return pts;
    }

    it("hides toggle when data has 12 or fewer points", async () => {
      mockUseTrendData.mockReturnValue({
        points: makePoints(12),
        costCenterNames: ["Eng"],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });
      expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    });

    it("shows toggle when data has more than 12 points", async () => {
      mockUseTrendData.mockReturnValue({
        points: makePoints(15),
        costCenterNames: ["Eng"],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });
      expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    });

    it("defaults to 1 Year showing last 12 points", async () => {
      const points = makePoints(15);
      mockUseTrendData.mockReturnValue({
        points,
        costCenterNames: ["Eng"],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });

      // Default is "1 Year" -- should show 12 points
      const chart = container.querySelector('[data-testid="chart"]');
      expect(chart?.textContent).toContain("12pts");
    });

    it("shows all points when All Time is selected", async () => {
      const points = makePoints(15);
      mockUseTrendData.mockReturnValue({
        points,
        costCenterNames: ["Eng"],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });

      const allTimeBtn = container.querySelector(
        '[role="radio"][aria-checked="false"]',
      );
      expect(allTimeBtn).not.toBeNull();
      fireEvent.click(allTimeBtn!);

      const chart = container.querySelector('[data-testid="chart"]');
      expect(chart?.textContent).toContain("15pts");
    });

    it("switches back to 1 Year from All Time", async () => {
      const points = makePoints(15);
      mockUseTrendData.mockReturnValue({
        points,
        costCenterNames: ["Eng"],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });

      // Click "All Time"
      const allTimeBtn = container.querySelector(
        '[role="radio"][aria-checked="false"]',
      );
      fireEvent.click(allTimeBtn!);
      expect(
        container.querySelector('[data-testid="chart"]')?.textContent,
      ).toContain("15pts");

      // Click "1 Year" (now it's the unchecked one)
      const oneYearBtn = container.querySelector(
        '[role="radio"][aria-checked="false"]',
      );
      fireEvent.click(oneYearBtn!);
      expect(
        container.querySelector('[data-testid="chart"]')?.textContent,
      ).toContain("12pts");
    });

    it("shows toggle and filters to 12 points when data has exactly 13 points", async () => {
      const points = makePoints(13);
      mockUseTrendData.mockReturnValue({
        points,
        costCenterNames: ["Eng"],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });

      // Toggle should be visible (13 > 12)
      expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();

      // Default "1 Year" should show 12 points
      const chart = container.querySelector('[data-testid="chart"]');
      expect(chart?.textContent).toContain("12pts");

      // "All Time" should show all 13 points
      const allTimeBtn = container.querySelector(
        '[role="radio"][aria-checked="false"]',
      );
      fireEvent.click(allTimeBtn!);
      expect(chart?.textContent).toContain("13pts");
    });

    it("handles empty data gracefully", async () => {
      mockUseTrendData.mockReturnValue({
        points: [],
        costCenterNames: [],
        loading: false,
        error: null,
      });

      const { container } = render(<CostTrendSection />);
      // Should render heading and no chart
      expect(container.textContent).toContain("Cost Trend");
      expect(container.querySelector('[data-testid="chart"]')).toBeNull();
      expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    });
  });

  describe("external data props", () => {
    it("uses external points and names instead of hook data", async () => {
      mockUseTrendData.mockReturnValue({
        points: [{ period: "2025-01", HookCC: 999 }],
        costCenterNames: ["HookCC"],
        loading: false,
        error: null,
      });

      const externalPoints = [
        { period: "2025-06", MyCC: 5000 },
        { period: "2025-07", MyCC: 5500 },
      ];

      const { container } = render(
        <CostTrendSection
          points={externalPoints}
          costCenterNames={["MyCC"]}
          loading={false}
          error={null}
        />,
      );

      await waitFor(() => {
        expect(container.querySelector('[data-testid="chart"]')).not.toBeNull();
      });
      const chart = container.querySelector('[data-testid="chart"]');
      expect(chart?.textContent).toContain("MyCC");
      expect(chart?.textContent).toContain("2pts");
    });
  });
});
