import { SegmentedControl, SegmentedControlItem, Badge } from "@cytario/design";
import type { Key } from "react-aria-components";
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
    <div className="overflow-x-auto pb-1">
      <SegmentedControl
        selectedKeys={new Set([selected])}
        onSelectionChange={(keys: Set<Key>) => {
          const key = [...keys][0];
          if (key != null) onSelect(String(key));
        }}
        aria-label="Reporting period"
        className="flex-nowrap"
      >
        {periods.map((period) => {
          const isMtd = period === currentMonth;
          return (
            <SegmentedControlItem
              key={period}
              id={period}
              className="shrink-0 whitespace-nowrap"
            >
              {formatPeriodLabel(period)}
              {isMtd && (
                <Badge variant="amber" size="sm" className="ml-1.5">
                  MTD
                </Badge>
              )}
            </SegmentedControlItem>
          );
        })}
      </SegmentedControl>
    </div>
  );
}
