import { describe, expect, it } from "vitest";
import { bucketRows, bucketStart, eachDay, granularityFor, inWindow, isoDay, parseRange, rangeWindow, windowEnding } from "./range";

const D = (s: string) => new Date(`${s}T00:00:00Z`);

describe("rangeWindow", () => {
  it("fixed ranges compare with the equally long period before", () => {
    const w = rangeWindow("7d", D("2026-10-25"), D("2025-01-01"));
    expect(w.comparison).toBe("previous");
    expect([w.start, w.recentStart, w.prevStart, w.prevEnd, w.from].map(isoDay)).toEqual([
      "2026-10-19",
      "2026-10-19",
      "2026-10-12",
      "2026-10-18",
      "2026-10-12",
    ]);
  });

  it("all time spans the whole history and compares its second half with the first", () => {
    const w = rangeWindow("all", D("2026-10-30"), D("2026-10-01"));
    expect(w.days).toBe(30);
    expect(w.comparison).toBe("halves");
    expect([w.start, w.end, w.prevStart, w.prevEnd, w.recentStart, w.recentEnd, w.from].map(isoDay)).toEqual([
      "2026-10-01",
      "2026-10-30",
      "2026-10-01",
      "2026-10-15",
      "2026-10-16",
      "2026-10-30",
      "2026-10-01",
    ]);
  });

  it("copes with a single day of history", () => {
    const w = rangeWindow("all", D("2026-10-30"), D("2026-10-30"));
    expect(w.days).toBe(1);
    expect(isoDay(w.recentStart)).toBe("2026-10-30");
  });
});

describe("chart buckets", () => {
  it("switches to weeks past ~4 months and months past two years", () => {
    expect(granularityFor(90)).toBe("day");
    expect(granularityFor(120)).toBe("day");
    expect(granularityFor(400)).toBe("week");
    expect(granularityFor(1_000)).toBe("month");
  });

  it("starts weeks on Sunday and months on the 1st", () => {
    expect(bucketStart("2026-10-28", "week")).toBe("2026-10-25"); // Wednesday → Sunday
    expect(bucketStart("2026-10-25", "week")).toBe("2026-10-25");
    expect(bucketStart("2026-10-28", "month")).toBe("2026-10-01");
    expect(bucketStart("2026-10-28", "day")).toBe("2026-10-28");
  });

  it("averages each field over the days that have it", () => {
    const rows = [
      { day: "2026-10-25", hr: 50, hrv: null },
      { day: "2026-10-26", hr: 60, hrv: 40 },
      { day: "2026-11-01", hr: 70, hrv: null },
    ];
    expect(bucketRows(rows, "week", ["hr", "hrv"])).toEqual([
      { day: "2026-10-25", hr: 55, hrv: 40 },
      { day: "2026-11-01", hr: 70, hrv: null },
    ]);
    expect(bucketRows(rows, "day", ["hr"])).toBe(rows);
  });
});

describe("parseRange", () => {
  it("accepts 7d and 90d and falls back to 30d", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("90d")).toBe("90d");
    expect(parseRange("all")).toBe("all");
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
