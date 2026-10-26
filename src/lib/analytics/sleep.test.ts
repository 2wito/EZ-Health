import { describe, expect, it } from "vitest";
import { clockLabel, consistencyScore, durationLabel, minutesSinceNoon, sleepScore } from "./sleep";

const night = new Date("2026-10-25T00:00:00Z"); // the wake date, as stored (@db.Date)

describe("minutesSinceNoon", () => {
  it("measures local clock time from noon the day before", () => {
    // 23:30 in Israel (UTC+3) the evening before.
    expect(minutesSinceNoon(new Date("2026-10-24T20:30:00Z"), 180, night)).toBe(690);
    // 06:45 local on the wake date.
    expect(minutesSinceNoon(new Date("2026-10-25T03:45:00Z"), 180, night)).toBe(1125);
  });

  it("keeps bedtimes either side of midnight in order, so they average correctly", () => {
    const before = minutesSinceNoon(new Date("2026-10-24T20:30:00Z"), 180, night); // 23:30
    const after = minutesSinceNoon(new Date("2026-10-24T21:30:00Z"), 180, night); // 00:30
    expect((before + after) / 2).toBe(720); // midnight, not noon
  });
});

describe("clockLabel / durationLabel", () => {
  it("formats minutes since noon as a 12-hour clock", () => {
    expect(clockLabel(0)).toBe("12:00 PM");
    expect(clockLabel(690)).toBe("11:30 PM");
    expect(clockLabel(720)).toBe("12:00 AM");
    expect(clockLabel(1170)).toBe("7:30 AM");
    expect(clockLabel(690.9)).toBe("11:30 PM"); // seconds are truncated, like iOS
  });

  it("formats hours as hr/min", () => {
    expect(durationLabel(1.25)).toBe("1 hr 15 min");
    expect(durationLabel(0.5)).toBe("30 min");
    expect(durationLabel(8)).toBe("8 hr");
  });
});

describe("sleepScore", () => {
  it("is null without sleep", () => {
    expect(sleepScore({ total: 0, deep: 0, rem: 0, awake: 0 })).toBeNull();
  });

  it("gives full marks for 8 h with 40% deep + REM and no time awake", () => {
    expect(sleepScore({ total: 8, deep: 1.6, rem: 1.6, awake: 0 })).toBe(100);
  });

  it("scores short nights proportionally and penalizes time awake", () => {
    // Duration 50 × 3.5/7 = 25, restoration full (30), continuity 20 × (1 − 30/60) = 10.
    expect(sleepScore({ total: 3.5, deep: 0.7, rem: 0.7, awake: 0.5 })).toBe(65);
  });

  it("rescales nights without stage data to 100", () => {
    // (25 duration + 20 continuity) / 70
    expect(sleepScore({ total: 3.5, deep: 0, rem: 0, awake: 0 })).toBe(64);
  });
});

describe("consistencyScore", () => {
  it("needs at least three nights", () => {
    expect(consistencyScore([690, 700], [1150, 1160])).toBeNull();
  });

  it("is 100 for an identical schedule and 0 at two hours of variation", () => {
    expect(consistencyScore([690, 690, 690], [1170, 1170, 1170])).toBe(100);
    expect(consistencyScore([600, 840, 600, 840], [1050, 1290, 1050, 1290])).toBe(0);
  });
});
