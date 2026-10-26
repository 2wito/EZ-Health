import { describe, expect, it } from "vitest";
import { hourLabel, isRun, metresPerBeat, paceLabel } from "./activity";

describe("activity helpers", () => {
  it("turns speed into min:sec per km", () => {
    expect(paceLabel(12)).toBe("5:00");
    expect(paceLabel(10.7)).toBe("5:36");
    expect(paceLabel(0)).toBeNull();
    expect(paceLabel(null)).toBeNull();
  });

  it("measures running efficiency as metres per heartbeat", () => {
    expect(metresPerBeat(12, 150)).toBeCloseTo(1.333, 3);
    expect(metresPerBeat(null, 150)).toBeNull();
  });

  it("recognizes runs by name", () => {
    expect(isRun("Outdoor Run")).toBe(true);
    expect(isRun("Running")).toBe(true);
    expect(isRun("Rowing")).toBe(false);
    expect(isRun("Traditional Strength Training")).toBe(false);
  });

  it("labels hours on a 12-hour clock", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(18)).toBe("6 PM");
  });
});
