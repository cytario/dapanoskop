import { formatPeriodLabel } from "~/lib/format";

interface PeriodSelectorProps {
  periods: string[];
  selected: string;
  onSelect: (period: string) => void;
  currentMonth?: string;
}

export function PeriodSelector({
  periods,
  selected,
  onSelect,
  currentMonth,
}: PeriodSelectorProps) {
  return (
    <div className="flex gap-1 overflow-x-auto py-2">
      {periods.map((period) => {
        const isSelected = period === selected;
        const isMtd = period === currentMonth;
        return (
          <button
            key={period}
            onClick={() => onSelect(period)}
            className={`
              px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors
              ${
                isSelected
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }
            `}
          >
            {formatPeriodLabel(period)}
            {isMtd && <span className="ml-1 text-xs opacity-75">MTD</span>}
          </button>
        );
      })}
    </div>
  );
}
