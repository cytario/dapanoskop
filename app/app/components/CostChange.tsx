import { formatChange } from "~/lib/format";

interface CostChangeProps {
  current: number;
  previous: number;
  label?: string;
}

export function CostChange({ current, previous, label }: CostChangeProps) {
  const { text, direction, color } = formatChange(current, previous);
  const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "";

  return (
    <span className={color}>
      {label && <span className="text-gray-500 text-sm mr-1">{label}</span>}
      {text} {arrow}
    </span>
  );
}
