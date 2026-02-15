import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { TrendPoint } from "~/lib/useTrendData";

// Mock recharts to avoid JSDOM dimension issues
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactElement }) => (
    <div>{children}</div>
  ),
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="composed-chart">{children}</svg>
  ),
  Bar: ({ name }: { name: string }) => <g data-name={name} />,
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
  Legend: ({
    payload,
    verticalAlign,
  }: {
    payload?: { value: string }[];
    verticalAlign?: string;
  }) => (
    <div data-vertical-align={verticalAlign}>
      {payload?.map((p) => (
        <span key={p.value}>{p.value}</span>
      ))}
    </div>
  ),
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

  it("renders Legend with verticalAlign bottom", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    const legend = container.querySelector('[data-vertical-align="bottom"]');
    expect(legend).not.toBeNull();
  });

  it("renders moving average line in pink-700 with dashed style", () => {
    const { container } = render(
      <CostTrendChart points={points} costCenterNames={costCenterNames} />,
    );
    const line = container.querySelector('g[data-datakey="_movingAvg"]');
    expect(line?.getAttribute("data-stroke")).toBe("#be185d");
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
    // The Line element should still be in the DOM
    const line = container.querySelector('g[data-datakey="_movingAvg"]');
    expect(line).not.toBeNull();
  });
});
