import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, it, expect } from "vitest";
import { StorageOverview } from "./StorageOverview";
import type { StorageMetrics } from "~/types/cost-data";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("StorageOverview", () => {
  const metrics: StorageMetrics = {
    total_cost_usd: 1234.56,
    prev_month_cost_usd: 1084.56,
    total_volume_bytes: 180000000000000,
    hot_tier_percentage: 62.3,
    cost_per_tb_usd: 23.33,
  };

  it("renders the storage cost card", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).toContain("Storage Cost");
    expect(container.textContent).toContain("$1,234.56");
  });

  it("renders the cost per TB card", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).toContain("Cost / TB");
    expect(container.textContent).toContain("$23.33");
  });

  it("renders the hot tier card", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).toContain("Hot Tier");
    expect(container.textContent).toContain("62.3%");
  });

  it("renders tooltip explanations for each metric card", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    // With React Aria Tooltip, tooltip text is in the aria-label of the trigger button
    const tooltipButtons = container.querySelectorAll("button[aria-label]");
    expect(tooltipButtons.length).toBe(3);

    const labels = Array.from(tooltipButtons).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toContain("Total cost of S3 storage for this period.");
    expect(labels).toContain(
      "Total storage cost divided by the total volume of data stored, measured in terabytes (TB). Lower values indicate better storage cost efficiency.",
    );
    expect(labels).toContain(
      "Percentage of stored data in frequently accessed tiers (e.g., S3 Standard, EFS Standard). High values may indicate optimization opportunities via lifecycle policies.",
    );
  });

  it("renders dynamic tooltip when storageConfig includes EFS and EBS", () => {
    const { container } = renderWithRouter(
      <StorageOverview
        metrics={metrics}
        storageConfig={{ include_efs: true, include_ebs: true }}
        period="2026-01"
      />,
    );
    const labels = Array.from(
      container.querySelectorAll("button[aria-label]"),
    ).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain(
      "Total cost of S3, EFS, EBS storage for this period.",
    );
  });

  it("renders dynamic tooltip when storageConfig includes only EFS", () => {
    const { container } = renderWithRouter(
      <StorageOverview
        metrics={metrics}
        storageConfig={{ include_efs: true, include_ebs: false }}
        period="2026-01"
      />,
    );
    const labels = Array.from(
      container.querySelectorAll("button[aria-label]"),
    ).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Total cost of S3, EFS storage for this period.");
  });

  it("renders dynamic tooltip when storageConfig includes only EBS", () => {
    const { container } = renderWithRouter(
      <StorageOverview
        metrics={metrics}
        storageConfig={{ include_efs: false, include_ebs: true }}
        period="2026-01"
      />,
    );
    const labels = Array.from(
      container.querySelectorAll("button[aria-label]"),
    ).map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("Total cost of S3, EBS storage for this period.");
  });

  it("renders CostChange for storage cost month-over-month", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    // The CostChange component should show a delta between current and prev month
    expect(container.textContent).toContain("+$150.00");
  });

  it("renders Total Stored card when storage_lens_total_bytes is present", () => {
    const metricsWithLens: StorageMetrics = {
      ...metrics,
      storage_lens_total_bytes: 5 * 1_099_511_627_776, // 5 TB (binary)
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsWithLens} period="2026-01" />,
    );
    expect(container.textContent).toContain("Total Stored");
    expect(container.textContent).toContain("5.0 TB");
  });

  it("does not render Total Stored card when storage_lens_total_bytes is absent", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).not.toContain("Total Stored");
  });

  it("renders Storage Lens tooltip on Total Stored card", () => {
    const metricsWithLens: StorageMetrics = {
      ...metrics,
      storage_lens_total_bytes: 1_000_000_000_000,
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsWithLens} period="2026-01" />,
    );
    const tooltipButtons = container.querySelectorAll("button[aria-label]");
    // Should have 4 tooltip triggers now (Storage Cost, Total Stored, Cost/TB, Hot Tier)
    expect(tooltipButtons.length).toBe(4);
    const labels = Array.from(tooltipButtons).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels.some((l) => l?.includes("S3 Storage Lens"))).toBeTruthy();
  });

  it("renders storage cost card as a link to storage-cost detail", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    const link = container.querySelector(
      'a[href="/storage-cost?period=2026-01"]',
    );
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Storage Cost");
  });

  it("renders Total Stored card as a link to storage-detail when storage_lens_total_bytes is present", () => {
    const metricsWithLens: StorageMetrics = {
      ...metrics,
      storage_lens_total_bytes: 5 * 1_099_511_627_776, // 5 TB (binary)
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsWithLens} period="2026-01" />,
    );
    const link = container.querySelector(
      'a[href="/storage-detail?period=2026-01"]',
    );
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain("Total Stored");
    expect(link?.textContent).toContain("5.0 TB");
  });
});
