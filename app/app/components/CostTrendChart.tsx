import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatPeriodLabel, formatUsd } from "~/lib/format";
import { computeMovingAverage } from "~/lib/moving-average";
import type { TrendPoint } from "~/lib/useTrendData";

const COLORS = [
  "#2563eb", // blue-600
  "#7c3aed", // violet-600
  "#0891b2", // cyan-600
  "#059669", // emerald-600
  "#d97706", // amber-600
  "#dc2626", // red-600
];

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
        <p className="text-xs mt-1" style={{ color: "#be185d" }}>
          3-Month Avg: {formatUsd(maEntry.value)}
        </p>
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

  return (
    <ResponsiveContainer width="100%" height={360}>
      <ComposedChart data={enrichedPoints}>
        <XAxis
          dataKey="period"
          tickFormatter={formatPeriodLabel}
          tick={{ fontSize: 12 }}
        />
        <YAxis tickFormatter={formatCompactUsd} tick={{ fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 12 }} />
        {costCenterNames.map((name, i) => (
          <Bar
            key={name}
            dataKey={name}
            stackId="cost"
            fill={getColor(i)}
            name={name}
          />
        ))}
        <Line
          type="monotone"
          dataKey="_movingAvg"
          stroke="#be185d"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          name="3-Month Avg"
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
