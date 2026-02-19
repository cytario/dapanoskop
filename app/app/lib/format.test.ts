import { describe, expect, test } from "vitest";
import {
  formatUsd,
  formatChange,
  formatPeriodLabel,
  formatBytes,
} from "./format";

describe("formatUsd", () => {
  test("positive value", () => {
    expect(formatUsd(1234.56)).toBe("$1,234.56");
  });

  test("zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  test("large value with thousands separators", () => {
    expect(formatUsd(1234567.89)).toBe("$1,234,567.89");
  });

  test("small decimal rounds to 2 places", () => {
    expect(formatUsd(0.1)).toBe("$0.10");
  });
});

describe("formatChange", () => {
  test("increase returns red with up direction", () => {
    const result = formatChange(1500, 1000);
    expect(result.direction).toBe("up");
    expect(result.color).toBe("text-red-600");
    expect(result.text).toBe("+$500.00 (+50.0%)");
  });

  test("decrease returns green with down direction", () => {
    const result = formatChange(800, 1000);
    expect(result.direction).toBe("down");
    expect(result.color).toBe("text-green-600");
    expect(result.text).toBe("-$200.00 (-20.0%)");
  });

  test("flat when delta is less than 0.01", () => {
    const result = formatChange(100.004, 100);
    expect(result.direction).toBe("flat");
    expect(result.color).toBe("text-gray-500");
    expect(result.text).toBe("$0 (0.0%)");
  });

  test("new when previous is 0", () => {
    const result = formatChange(500, 0);
    expect(result.direction).toBe("up");
    expect(result.color).toBe("text-red-600");
    expect(result.text).toBe("+$500.00 (New)");
  });

  test("negative delta with non-zero previous", () => {
    const result = formatChange(750, 1000);
    expect(result.direction).toBe("down");
    expect(result.color).toBe("text-green-600");
    expect(result.text).toBe("-$250.00 (-25.0%)");
  });

  test("both current and previous are 0 returns flat", () => {
    const result = formatChange(0, 0);
    expect(result.direction).toBe("flat");
    expect(result.color).toBe("text-gray-500");
    expect(result.text).toBe("$0 (0.0%)");
  });
});

describe("formatPeriodLabel", () => {
  test("formats 2026-01 as Jan 26", () => {
    expect(formatPeriodLabel("2026-01")).toBe("Jan 26");
  });

  test("formats 2025-12 as Dec 25", () => {
    expect(formatPeriodLabel("2025-12")).toBe("Dec 25");
  });
});

describe("formatBytes", () => {
  test("TB range", () => {
    // 5 TB (binary: 5 * 2^40)
    expect(formatBytes(5 * 1_099_511_627_776)).toBe("5.0 TB");
  });

  test("GB range", () => {
    // 512 GB (binary: 512 * 2^30)
    expect(formatBytes(512 * 1_073_741_824)).toBe("512.0 GB");
  });

  test("exact boundary at 1 TB", () => {
    expect(formatBytes(1_099_511_627_776)).toBe("1.0 TB");
  });

  test("0 bytes", () => {
    expect(formatBytes(0)).toBe("0.0 GB");
  });

  test("PB range", () => {
    // Real AWS Storage Lens value: 1.5 PB
    expect(formatBytes(1_649_188_949_133_511)).toBe("1.5 PB");
  });

  test("exact boundary at 1 PB", () => {
    expect(formatBytes(1_125_899_906_842_624)).toBe("1.0 PB");
  });
});
