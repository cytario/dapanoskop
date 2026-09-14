import { describe, expect, test } from "vitest";
import { grossDiffersFromNet, deltaPair } from "./gross";

describe("grossDiffersFromNet", () => {
  test("false when net is absent (old data: no separate net figure)", () => {
    expect(grossDiffersFromNet(100, undefined)).toBe(false);
    expect(grossDiffersFromNet(100, null)).toBe(false);
  });

  test("false when gross equals net", () => {
    expect(grossDiffersFromNet(100, 100)).toBe(false);
    expect(grossDiffersFromNet(100.005, 100)).toBe(false);
  });

  test("false for sub-threshold differences", () => {
    expect(grossDiffersFromNet(100.009, 100)).toBe(false);
  });

  test("true when gross exceeds net by >= $0.01", () => {
    expect(grossDiffersFromNet(100.01, 100)).toBe(true);
    expect(grossDiffersFromNet(150, 100)).toBe(true);
  });

  test("false when gross is below net", () => {
    // gross >= net per the schema; a lower gross is not surfaced
    expect(grossDiffersFromNet(90, 100)).toBe(false);
  });
});

describe("deltaPair", () => {
  test("gross-vs-gross when both sides have gross", () => {
    expect(deltaPair(120, 100, 110, 95)).toEqual({
      current: 120,
      previous: 110,
    });
  });

  test("net-to-net when current gross is absent", () => {
    expect(deltaPair(undefined, 100, 110, 95)).toEqual({
      current: 100,
      previous: 95,
    });
  });

  test("net-to-net when previous gross is absent", () => {
    expect(deltaPair(120, 100, undefined, 95)).toEqual({
      current: 100,
      previous: 95,
    });
  });

  test("net-to-net when both gross are absent (old data)", () => {
    expect(deltaPair(null, 100, null, 95)).toEqual({
      current: 100,
      previous: 95,
    });
  });

  test("works with zero values (valid zero-cost data)", () => {
    expect(deltaPair(0, 0, 0, 0)).toEqual({ current: 0, previous: 0 });
  });
});
