import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/useTrendData", () => ({
  useTrendData: vi.fn(),
}));

// Mock CostTrendChart to avoid Recharts complexity in this test
vi.mock("~/components/CostTrendChart", () => ({
  default: () => <div data-testid="chart">Chart</div>,
}));

import { CostTrendSection } from "./CostTrendSection";
import { useTrendData } from "~/lib/useTrendData";

const mockUseTrendData = vi.mocked(useTrendData);

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
      expect(container.textContent).toContain("Chart");
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
});
