import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PeriodSelector } from "./PeriodSelector";

describe("PeriodSelector", () => {
  const periods = ["2026-01", "2025-12", "2025-11"];
  const onSelect = vi.fn();

  it("renders all period options", () => {
    render(
      <PeriodSelector
        periods={periods}
        selected="2026-01"
        onSelect={onSelect}
      />,
    );
    // SegmentedControl renders toggle buttons with role="radio"
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("calls onSelect with correct period when clicked", () => {
    render(
      <PeriodSelector
        periods={periods}
        selected="2026-01"
        onSelect={onSelect}
      />,
    );
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[1]);
    expect(onSelect).toHaveBeenCalledWith("2025-12");
  });

  it("labels current month as MTD", () => {
    render(
      <PeriodSelector
        periods={periods}
        selected="2026-01"
        onSelect={onSelect}
        currentMonth="2026-01"
      />,
    );
    expect(screen.getByText("MTD")).toBeInTheDocument();
  });
});
