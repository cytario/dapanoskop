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

/**
 * Formats a partial period date range into a human-readable label.
 * e.g. ("2026-01-01", "2026-01-08") => "Jan 1–7"
 * e.g. ("2025-12-01", "2026-01-01") => "Dec 1–31"
 */
export function formatPartialPeriodLabel(
  start: string,
  endExclusive: string,
): string {
  const startDate = new Date(start + "T00:00:00");
  const endDate = new Date(endExclusive + "T00:00:00");
  // endExclusive is exclusive, so the last included day is endDate - 1 day
  const lastDay = new Date(endDate);
  lastDay.setDate(lastDay.getDate() - 1);

  const month = startDate.toLocaleDateString("en-US", { month: "short" });
  const startDay = startDate.getDate();
  const endDay = lastDay.getDate();

  if (startDay === endDay) {
    return `${month} ${startDay}`;
  }
  return `${month} ${startDay}\u2013${endDay}`;
}

export function formatBytes(bytes: number): string {
  const pb = bytes / 1_125_899_906_842_624; // 2^50
  if (pb >= 1) return `${pb.toFixed(1)} PiB`;
  const tb = bytes / 1_099_511_627_776; // 2^40
  if (tb >= 1) return `${tb.toFixed(1)} TiB`;
  const gb = bytes / 1_073_741_824; // 2^30
  return `${gb.toFixed(1)} GiB`;
}
