/** Formatting utilities for cost display. */

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const pctFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatUsd(value: number): string {
  return usdFormat.format(value);
}

export function formatChange(
  current: number,
  previous: number,
): { text: string; direction: "up" | "down" | "flat"; color: string } {
  const delta = current - previous;
  const sign = delta >= 0 ? "+" : "";

  if (Math.abs(delta) < 0.01) {
    return { text: "$0 (0.0%)", direction: "flat", color: "text-gray-500" };
  }
  if (previous === 0) {
    return {
      text: `${sign}${formatUsd(delta)} (New)`,
      direction: delta > 0 ? "up" : "down",
      color: delta > 0 ? "text-red-600" : "text-green-600",
    };
  }

  const pct = delta / previous;
  const text = `${sign}${formatUsd(delta)} (${sign}${pctFormat.format(pct)})`;

  if (delta > 0) {
    return { text, direction: "up", color: "text-red-600" };
  }
  return { text, direction: "down", color: "text-green-600" };
}

export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function formatBytes(bytes: number): string {
  const tb = bytes / 1_000_000_000_000;
  if (tb >= 1) return `${tb.toFixed(1)} TB`;
  const gb = bytes / 1_000_000_000;
  return `${gb.toFixed(1)} GB`;
}
