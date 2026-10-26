import { describe, expect, it } from "vitest";
import { createFormat } from "./format";

const en = createFormat("en");
const he = createFormat("he");
const now = new Date("2026-10-26T12:00:00Z");

describe("createFormat", () => {
  it("uses a 12-hour clock in English and 24-hour in Hebrew", () => {
    expect(en.clockLabel(690)).toBe("11:30 PM");
    expect(he.clockLabel(690)).toBe("23:30");
    expect(en.clockParts(1170)).toEqual(["7:30", "AM"]);
    expect(he.clockParts(1170)).toEqual(["07:30", ""]);
    expect(en.clockTick(720)).toBe("12 AM");
    expect(he.clockTick(720)).toBe("00");
    expect(en.hour(18)).toBe("6 PM");
    expect(he.hour(18)).toBe("18:00");
    expect(en.hourTick(18)).toBe("6p");
    expect(he.hourTick(6)).toBe("6");
  });

  it("formats durations in each language", () => {
    expect(en.duration(1.25)).toBe("1 hr 15 min");
    expect(he.duration(1.25)).toBe("1 שע׳ 15 דק׳");
    expect(en.hoursToMeasure(0.5)).toEqual([["30", "min"]]);
    expect(en.compactDuration(7.43)).toBe("7h 26m");
    expect(he.compactDuration(7.43)).toBe("7 ש׳ 26 ד׳");
  });

  it("describes when a reading was taken, in the zone it was recorded in", () => {
    // 01:30 on the 26th in Israel (UTC+3), though it's still the 25th in UTC.
    expect(en.when(new Date("2026-10-25T22:30:00Z"), 180, now)).toBe("1:30 AM");
    expect(en.when(new Date("2026-10-25T08:00:00Z"), 180, now)).toBe("Yesterday");
    expect(he.when(new Date("2026-10-25T08:00:00Z"), 180, now)).toBe("אתמול");
    expect(en.when(new Date("2026-10-22T08:00:00Z"), 180, now)).toBe("Thursday");
    expect(en.day(new Date("2026-10-26T00:00:00Z"), 180, now)).toBe("Today");
    expect(he.day(new Date("2026-10-26T00:00:00Z"), 180, now)).toBe("היום");
  });

  it("formats relative times", () => {
    expect(en.ago(new Date(now.getTime() - 10_000), now)).toBe("just now");
    expect(he.ago(new Date(now.getTime() - 10_000), now)).toBe("הרגע");
    expect(en.ago(new Date(now.getTime() - 5 * 60_000), now)).toBe("5 minutes ago");
    expect(en.ago(new Date(now.getTime() - 3 * 3_600_000), now)).toBe("3 hours ago");
  });

  it("formats chart days in UTC and names weekdays from Sunday", () => {
    expect(en.chartDay("2026-10-25", 7)).toBe("Sun");
    expect(en.chartDay("2026-10-25", 30)).toBe("Oct 25");
    expect(en.chartDay("2026-10-25", 0, true)).toBe("Sun, Oct 25");
    expect(he.chartDay("2026-10-25", 30)).toContain("25");
    expect(en.weekdays[0]).toBe("Sunday");
    expect(he.weekdays[0]).toBe("יום ראשון");
  });

  it("formats sizes and counts", () => {
    expect(en.bytes(500)).toBe("1 KB");
    expect(en.bytes(5 * 1024 ** 2)).toBe("5 MB");
    expect(en.bytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
    expect(en.compact(1_204_331)).toBe("1.2M");
    expect(en.number(12345.678, 1)).toBe("12,345.7");
  });
});
