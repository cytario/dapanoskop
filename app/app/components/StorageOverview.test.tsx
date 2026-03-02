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
    prev_month_hot_tier_percentage: 60.1,
    cost_per_tb_usd: 23.33,
    prev_month_cost_per_tb_usd: 22.79,
  };

  it("renders the storage cost card with DeltaIndicator", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).toContain("Storage Cost");
    expect(container.textContent).toContain("$1,234.56");
    expect(container.textContent).toContain("+$150.00");
  });

  it("renders the cost per TiB card with DeltaIndicator", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).toContain("Cost / TiB");
    expect(container.textContent).toContain("$23.33");
    // DeltaIndicator should show the change from 22.79 to 23.33
    expect(container.textContent).toContain("+$0.54");
  });

  it("renders cost per TiB without DeltaIndicator when prev_month is absent", () => {
    const metricsNoPrev: StorageMetrics = {
      ...metrics,
      prev_month_cost_per_tb_usd: undefined,
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsNoPrev} period="2026-01" />,
    );
    expect(container.textContent).toContain("Cost / TiB");
    expect(container.textContent).toContain("$23.33");
  });

  it("renders the combined storage volume card", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    expect(container.textContent).toContain("Storage Volume");
    // 180000000000000 bytes = ~163.7 TiB
    expect(container.textContent).toContain("TiB");
    expect(container.textContent).toContain("Hot Tier");
    expect(container.textContent).toContain("62.3%");
  });

  it("shows hot tier trend when prev_month_hot_tier_percentage is present", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    // hot_tier changed from 60.1% to 62.3% — DeltaIndicator with format="percentage" should show the change
    expect(container.textContent).toContain("62.3%");
  });

  it("does not show hot tier trend when prev_month_hot_tier_percentage is absent", () => {
    const metricsNoPrev: StorageMetrics = {
      ...metrics,
      prev_month_hot_tier_percentage: undefined,
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsNoPrev} period="2026-01" />,
    );
    expect(container.textContent).toContain("62.3%");
  });

  it("prefers storage_lens_total_bytes when available", () => {
    const metricsWithLens: StorageMetrics = {
      ...metrics,
      storage_lens_total_bytes: 5 * 1_099_511_627_776, // 5 TiB
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsWithLens} period="2026-01" />,
    );
    expect(container.textContent).toContain("Storage Volume");
    expect(container.textContent).toContain("5.0 TiB");
  });

  it("shows Storage Lens tooltip when storage_lens_total_bytes is present", () => {
    const metricsWithLens: StorageMetrics = {
      ...metrics,
      storage_lens_total_bytes: 5 * 1_099_511_627_776,
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsWithLens} period="2026-01" />,
    );
    const tooltipButtons = container.querySelectorAll("button[aria-label]");
    const labels = Array.from(tooltipButtons).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels.some((l) => l?.includes("Storage Lens"))).toBeTruthy();
  });

  it("shows Cost Explorer tooltip when storage_lens_total_bytes is absent", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    const tooltipButtons = container.querySelectorAll("button[aria-label]");
    const labels = Array.from(tooltipButtons).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels.some((l) => l?.includes("Cost Explorer"))).toBeTruthy();
  });

  it("always renders exactly 3 cards", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    // The grid should always have exactly 3 MetricCard children
    const grid = container.querySelector(".grid");
    expect(grid?.children.length).toBe(3);
  });

  it("always renders exactly 3 cards even with storage_lens_total_bytes", () => {
    const metricsWithLens: StorageMetrics = {
      ...metrics,
      storage_lens_total_bytes: 5 * 1_099_511_627_776,
    };
    const { container } = renderWithRouter(
      <StorageOverview metrics={metricsWithLens} period="2026-01" />,
    );
    const grid = container.querySelector(".grid");
    expect(grid?.children.length).toBe(3);
  });

  it("renders tooltip explanations for each metric card", () => {
    const { container } = renderWithRouter(
      <StorageOverview metrics={metrics} period="2026-01" />,
    );
    const tooltipButtons = container.querySelectorAll("button[aria-label]");
    expect(tooltipButtons.length).toBe(3);

    const labels = Array.from(tooltipButtons).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toContain("Total cost of S3 storage for this period.");
    expect(labels).toContain(
      "Total storage cost divided by the total volume of data stored, measured in tebibytes (TiB). Lower values indicate better storage cost efficiency.",
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
});
