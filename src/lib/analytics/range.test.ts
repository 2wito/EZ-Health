import { describe, expect, it } from "vitest";
import { eachDay, inWindow, isoDay, parseRange, windowEnding } from "./range";

describe("parseRange", () => {
  it("accepts 7d and 90d and falls back to 30d", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("90d")).toBe("90d");
    expect(parseRange("1y")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
    expect(parseRange(["7d"])).toBe("30d");
  });
});

describe("windowEnding", () => {
  it("builds the window and the equally long one before it", () => {
    const w = windowEnding(new Date("2026-10-25T00:00:00Z"), 7);
    expect([w.start, w.end, w.prevStart, w.prevEnd].map(isoDay)).toEqual([
      "2026-10-19",
      "2026-10-25",
      "2026-10-12",
      "2026-10-18",
    ]);
  });
});

describe("eachDay / inWindow", () => {
  it("lists every calendar day inclusive, across month ends", () => {
    expect(eachDay(new Date("2026-09-29T00:00:00Z"), new Date("2026-10-02T00:00:00Z"))).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("checks membership with inclusive bounds", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-10-07T00:00:00Z");
    expect(inWindow("2026-10-01", from, to)).toBe(true);
    expect(inWindow(new Date("2026-10-07T00:00:00Z"), from, to)).toBe(true);
    expect(inWindow("2026-10-08", from, to)).toBe(false);
  });
});
