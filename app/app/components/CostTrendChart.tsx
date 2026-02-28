import { useState } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatPeriodLabel, formatUsd } from "~/lib/format";
import { computeMovingAverage } from "~/lib/moving-average";
import type { TrendPoint } from "~/lib/useTrendData";

// Hardcoded hex values because Recharts can't consume CSS custom properties.
// Values sourced from cytario design tokens (tokens/base.json).
const COLORS = [
  "#6b2695", // --color-purple-600
  "#2a9b9c", // --color-teal-600
  "#0891b2", // cyan-600
  "#059669", // emerald-600
  "#d97706", // --color-amber-600
  "#e11d48", // --color-rose-600
];

const MA_COLOR = "#be123c"; // --color-rose-700

function getColor(index: number): string {
  return COLORS[index % COLORS.length];
}

function formatCompactUsd(value: number): string {
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value}`;
}

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;

  // Separate bar entries from the moving average line
  const barEntries = payload.filter((e) => e.dataKey !== "_movingAvg");
  const maEntry = payload.find((e) => e.dataKey === "_movingAvg");

  const total = barEntries.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium mb-1">{formatPeriodLabel(label)}</p>
      {barEntries.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {formatUsd(entry.value)}
        </p>
      ))}
      <p className="font-medium border-t border-gray-100 mt-1 pt-1">
        Total: {formatUsd(total)}
      </p>
      {maEntry && maEntry.value != null && (
        <p className="text-xs mt-1" style={{ color: MA_COLOR }}>
          3-Month Avg: {formatUsd(maEntry.value)}
        </p>
      )}
    </div>
  );
}

/** Custom bar shape that renders MTD bars with reduced opacity. */
function MtdAwareBar(props: Record<string, unknown>) {
  const { x, y, width, height, fill, payload } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    payload: TrendPoint;
  };
  const isMtd = payload?._isMtd === true;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fill}
      fillOpacity={isMtd ? 0.5 : 1}
    />
  );
}

interface LegendEntry {
  name: string;
  color: string;
}

function CollapsibleLegend({ entries }: { entries: LegendEntry[] }) {
  const [showLegend, setShowLegend] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setShowLegend((v) => !v)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
      >
        {showLegend ? (
          <>
            <ChevronUp size={14} /> Hide legend
          </>
        ) : (
          <>
            <ChevronDown size={14} /> Show legend
          </>
        )}
      </button>
      {showLegend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600">
          {entries.map((e) => (
            <span key={e.name} className="flex items-center gap-1.5">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ backgroundColor: e.color }}
              />
              {e.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface CostTrendChartProps {
  points: TrendPoint[];
  costCenterNames: string[];
}

export default function CostTrendChart({
  points,
  costCenterNames,
}: CostTrendChartProps) {
  // Compute moving average and enrich data points
  const maValues = computeMovingAverage(points, costCenterNames);
  const enrichedPoints = points.map((pt, i) => ({
    ...pt,
    _movingAvg: maValues[i],
  }));

  const legendEntries: LegendEntry[] = [
    ...costCenterNames.map((name, i) => ({ name, color: getColor(i) })),
    { name: "3-Month Avg", color: MA_COLOR },
  ];

  return (
    <>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={enrichedPoints}>
          <XAxis
            dataKey="period"
            tickFormatter={formatPeriodLabel}
            tick={{ fontSize: 12 }}
          />
          <YAxis tickFormatter={formatCompactUsd} tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          {costCenterNames.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              stackId="cost"
              fill={getColor(i)}
              name={name}
              shape={<MtdAwareBar />}
            />
          ))}
          <Line
            type="monotone"
            dataKey="_movingAvg"
            stroke={MA_COLOR}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            name="3-Month Avg"
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <CollapsibleLegend entries={legendEntries} />
    </>
  );
}
