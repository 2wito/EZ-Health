import { describe, expect, it } from "vitest";
import { computeTrend, mean } from "./trend";

describe("mean", () => {
  it("averages, and is null for no values", () => {
    expect(mean([2, 4, 9])).toBe(5);
    expect(mean([])).toBeNull();
  });
});

describe("computeTrend", () => {
  it("calls a rise improving when higher is better", () => {
    const t = computeTrend([10, 12], [8, 8], { better: "higher", threshold: 1 });
    expect(t).toMatchObject({ current: 11, previous: 8, delta: 3, direction: "up", verdict: "improving" });
  });

  it("calls a rise declining when lower is better (e.g. resting heart rate)", () => {
    const t = computeTrend([60, 62], [55, 55], { better: "lower", threshold: 1 });
    expect(t).toMatchObject({ direction: "up", verdict: "declining" });
  });

  it("treats changes under the threshold as stable noise", () => {
    const t = computeTrend([55.4, 55.6], [55, 55], { better: "lower", threshold: 1 });
    expect(t).toMatchObject({ direction: "flat", verdict: "stable" });
  });

  it("reports direction without a verdict for neutral metrics", () => {
    const t = computeTrend([150, 160], [130, 130], { better: "neutral", threshold: 3 });
    expect(t).toMatchObject({ direction: "up", verdict: null });
  });

  it("refuses to compare windows with too few readings", () => {
    const t = computeTrend([70], [60, 61], { better: "higher", threshold: 1 });
    expect(t).toMatchObject({ current: 70, delta: null, verdict: null, direction: null });
    expect(computeTrend([70], [60], { better: "higher", threshold: 1, minPoints: 1 }).verdict).toBe("improving");
  });
});
