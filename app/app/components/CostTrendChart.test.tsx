import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { TrendPoint } from "~/lib/useTrendData";

// Mock recharts to avoid JSDOM dimension issues
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
    <div>{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="bar-chart">{children}</svg>
  ),
  Bar: ({ name }: { name: string }) => <g data-name={name} />,
  XAxis: () => <g />,
  YAxis: () => <g />,
  Tooltip: () => <g />,
  Legend: ({ payload }: { payload?: { value: string }[] }) => (
    <div>
      {payload?.map((p) => (
        <span key={p.value}>{p.value}</span>
      ))}
    </div>
  ),
}));

import CostTrendChart from "./CostTrendChart";

const points: TrendPoint[] = [
  { period: "2025-11", Engineering: 13800, "Data Science": 6500 },
  { period: "2025-12", Engineering: 14200, "Data Science": 6800 },
];

const costCenterNames = ["Engineering", "Data Science"];

describe("CostTrendChart", () => {
  it("renders an SVG chart", () => {
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
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute("data-name")).toBe("Engineering");
    expect(bars[1].getAttribute("data-name")).toBe("Data Science");
  });
});
