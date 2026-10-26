import { describe, expect, it } from "vitest";
import { computeTrend, mean, splitByWindow, windowTrend } from "./trend";

describe("windowTrend / splitByWindow", () => {
  const D = (s: string) => new Date(`${s}T00:00:00Z`);
  // All time: four days, the second half compared with the first.
  const w = {
    start: D("2026-10-01"),
    end: D("2026-10-04"),
    prevStart: D("2026-10-01"),
    prevEnd: D("2026-10-02"),
    recentStart: D("2026-10-03"),
    recentEnd: D("2026-10-04"),
  };

  it("splits points into shown, recent and previous spans", () => {
    const points = [
      ["2026-10-01", 60],
      ["2026-10-02", 58],
      ["2026-10-03", 55],
      ["2026-10-04", 53],
      ["2026-09-30", 99], // outside the window
    ] as const;
    expect(splitByWindow(points, w)).toEqual([
      [60, 58, 55, 53],
      [55, 53],
      [60, 58],
    ]);
  });

  it("headlines the mean of everything shown, with the change between the spans", () => {
    const t = windowTrend([60, 58, 55, 53], [55, 53], [60, 58], { better: "lower", threshold: 1 });
    expect(t.current).toBe(56.5);
    expect(t.delta).toBe(-5);
    expect(t.verdict).toBe("improving");
  });
});

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
