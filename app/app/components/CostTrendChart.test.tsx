import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { TrendPoint } from "~/lib/useTrendData";

// Mock recharts to avoid JSDOM dimension issues
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({
    children,
    data,
  }: {
    children: React.ReactNode;
    data: TrendPoint[];
  }) => (
    <svg data-testid="composed-chart" data-point-count={data.length}>
      {children}
    </svg>
  ),
  Bar: ({
    name,
    shape,
    dataKey,
  }: {
    name: string;
    shape?: React.ReactElement;
    dataKey: string;
  }) => {
    // If shape is provided (MtdAwareBar), render it with test-friendly props
    if (shape) {
      return (
        <g data-name={name} data-datakey={dataKey} data-has-shape="true" />
      );
    }
    return <g data-name={name} data-datakey={dataKey} />;
  },
  Line: ({
    name,
    dataKey,
    stroke,
    strokeDasharray,
  }: {
    name: string;
    dataKey: string;
    stroke?: string;
    strokeDasharray?: string;
  }) => (
    <g
      data-name={name}
      data-datakey={dataKey}
      data-stroke={stroke}
      data-strokedasharray={strokeDasharray}
    />
  ),
  XAxis: () => <g />,
  YAxis: () => <g />,
  Tooltip: () => <g />,
}));

// Mock lucide-react icons used by CollapsibleLegend
vi.mock("lucide-react", () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
}));

import CostTrendChart from "./CostTrendChart";

const points: TrendPoint[] = [
  { period: "2025-10", Engineering: 13000, "Data Science": 6200 },
  { period: "2025-11", Engineering: 13800, "Data Science": 6500 },
  { period: "2025-12", Engineering: 14200, "Data Science": 6800 },
];

const costCenterNames = ["Engineering", "Data Science"];

describe("CostTrendChart", () => {
  it("renders a ComposedChart", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a Bar for each cost center", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    const bars = container.querySelectorAll("g[data-name]");
    const barNames = Array.from(bars).map((b) => b.getAttribute("data-name"));
    expect(barNames).toContain("Engineering");
    expect(barNames).toContain("Data Science");
  });

  it("renders a Line for the moving average", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    const line = container.querySelector('g[data-datakey="_movingAvg"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute("data-name")).toBe("3-Month Avg");
  });

  it("renders moving average line in rose-700 with dashed style", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    const line = container.querySelector('g[data-datakey="_movingAvg"]');
    expect(line?.getAttribute("data-stroke")).toBe("#be123c");
    expect(line?.getAttribute("data-strokedasharray")).toBe("6 3");
  });

  it("renders moving average line even with fewer than 3 points", () => {
    const twoPoints: TrendPoint[] = [
      { period: "2025-11", Engineering: 13800 },
      { period: "2025-12", Engineering: 14200 },
    ];
    const { container } = render(
      <CostTrendChart points={twoPoints} costCenterNames={["Engineering"]} />,
    );
    const line = container.querySelector('g[data-datakey="_movingAvg"]');
    expect(line).not.toBeNull();
  });

  it("uses MtdAwareBar shape for all bars", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    const bars = container.querySelectorAll('g[data-has-shape="true"]');
    expect(bars.length).toBe(costCenterNames.length);
  });

  describe("collapsible legend", () => {
    it("legend content is hidden by default", () => {
      const { container } = render(
        <CostTrendChart points={points} costCenterNames={costCenterNames} />,
      );
      // The "Show legend" button should be present
      const toggleBtn = container.querySelector("button");
      expect(toggleBtn).not.toBeNull();
      expect(toggleBtn!.textContent).toContain("Show legend");

      // Legend entries should NOT be visible
      expect(container.textContent).not.toContain("Engineering");
    });

    it("clicking toggle shows legend entries", () => {
      const { container } = render(
        <CostTrendChart points={points} costCenterNames={costCenterNames} />,
      );
      const toggleBtn = container.querySelector("button")!;
      fireEvent.click(toggleBtn);

      // Now legend entries should be visible
      expect(toggleBtn.textContent).toContain("Hide legend");
      expect(container.textContent).toContain("Engineering");
      expect(container.textContent).toContain("Data Science");
      expect(container.textContent).toContain("3-Month Avg");
    });

    it("clicking toggle again hides legend entries", () => {
      const { container } = render(
        <CostTrendChart points={points} costCenterNames={costCenterNames} />,
      );
      const toggleBtn = container.querySelector("button")!;

      // Open
      fireEvent.click(toggleBtn);
      expect(container.textContent).toContain("Engineering");

      // Close
      fireEvent.click(toggleBtn);
      expect(container.textContent).not.toContain("Engineering");
      expect(toggleBtn.textContent).toContain("Show legend");
    });
  });
});
