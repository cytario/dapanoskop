/** Data fetching utilities. */

import type { CostSummary } from "~/types/cost-data";

const DATA_BASE = import.meta.env.VITE_DATA_BASE_URL ?? "/data";

export async function fetchSummary(period: string): Promise<CostSummary> {
  const response = await fetch(`${DATA_BASE}/${period}/summary.json`);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch summary for ${period}: ${response.status}`,
    );
  }
  return response.json();
}

export async function discoverPeriods(): Promise<string[]> {
  // In production, this would list S3 objects.
  // For local dev with fixtures, we hard-code known periods.
  // The SPA tries fetching index.json first, falls back to known periods.
  try {
    const response = await fetch(`${DATA_BASE}/index.json`);
    if (response.ok) {
      const data = await response.json();
      return data.periods ?? [];
    }
  } catch {
    // Fall through to discovery
  }

  // Discover by probing recent months
  const periods: string[] = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    try {
      const res = await fetch(`${DATA_BASE}/${period}/summary.json`, {
        method: "HEAD",
      });
      if (res.ok) periods.push(period);
    } catch {
      // Skip unavailable periods
    }
  }
  return periods;
}
