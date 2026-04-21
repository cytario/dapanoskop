import { render, cleanup, screen } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { MtdBanner } from "./MtdBanner";

afterEach(() => {
  cleanup();
});

describe("MtdBanner", () => {
  it("renders the Month-to-date title and collectedAt formatted as en-US short month + day", () => {
    render(<MtdBanner collectedAt="2026-02-15T03:00:00Z" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Month-to-date");
    expect(alert.textContent).toContain("Data through Feb 15");
    expect(alert.textContent).toContain(
      "Figures will change as the month progresses.",
    );
  });

  it("omits the comparison sentence when mtdComparison is undefined", () => {
    render(<MtdBanner collectedAt="2026-02-15T03:00:00Z" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toContain("Comparisons are against");
  });

  it("includes formatPartialPeriodLabel output in the comparison sentence", () => {
    render(
      <MtdBanner
        collectedAt="2026-02-15T03:00:00Z"
        mtdComparison={{
          prior_partial_start: "2026-01-01",
          prior_partial_end_exclusive: "2026-01-15",
          cost_centers: [],
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    // prior_partial_end_exclusive is exclusive — last included day is Jan 14
    expect(alert.textContent).toMatch(/Comparisons are against Jan 1.14/);
    expect(alert.textContent).toContain("of the prior month.");
  });

  it("formats single-day ranges without a range dash", () => {
    render(
      <MtdBanner
        collectedAt="2026-02-02T03:00:00Z"
        mtdComparison={{
          prior_partial_start: "2026-01-01",
          prior_partial_end_exclusive: "2026-01-02",
          cost_centers: [],
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/Comparisons are against Jan 1\b/);
    expect(alert.textContent).not.toMatch(/Jan 1.\d/);
  });

  it("handles cross-month ranges (end-of-month wrap)", () => {
    render(
      <MtdBanner
        collectedAt="2026-01-05T03:00:00Z"
        mtdComparison={{
          prior_partial_start: "2025-12-01",
          prior_partial_end_exclusive: "2026-01-01",
          cost_centers: [],
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    // Range was Dec 1 through Dec 31 (exclusive end = Jan 1)
    expect(alert.textContent).toMatch(/Comparisons are against Dec 1.31/);
  });
});
