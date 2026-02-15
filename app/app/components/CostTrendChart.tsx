import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatPeriodLabel, formatUsd } from "~/lib/format";
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

  const total = payload.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium mb-1">{formatPeriodLabel(label)}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: {formatUsd(entry.value)}
        </p>
      ))}
      <p className="font-medium border-t border-gray-100 mt-1 pt-1">
        Total: {formatUsd(total)}
      </p>
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
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={points}>
        <XAxis
          dataKey="period"
          tickFormatter={formatPeriodLabel}
          tick={{ fontSize: 12 }}
        />
        <YAxis tickFormatter={formatCompactUsd} tick={{ fontSize: 12 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        {costCenterNames.map((name, i) => (
          <Bar
            key={name}
            dataKey={name}
            stackId="cost"
            fill={getColor(i)}
            name={name}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
