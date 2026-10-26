import { describe, expect, it } from "vitest";
import { computeReadiness } from "./readiness";

describe("computeReadiness", () => {
  it("needs at least two of the three signals", () => {
    expect(computeReadiness({ hrv: { latest: 50, baseline: 50 }, rhr: null, sleepHours: null })).toBeNull();
  });

  it("gives full marks for HRV up 10%, resting HR 3 bpm down and 8 h of sleep", () => {
    const r = computeReadiness({ hrv: { latest: 55, baseline: 50 }, rhr: { latest: 52, baseline: 55 }, sleepHours: 8 });
    expect(r).toMatchObject({ score: 100, level: "push", label: "Ready to push" });
    expect(r?.notes.every((n) => n.tone === "good")).toBe(true);
  });

  it("recommends recovery when every signal is poor, worst reason first", () => {
    const r = computeReadiness({ hrv: { latest: 35, baseline: 50 }, rhr: { latest: 61, baseline: 55 }, sleepHours: 4 });
    expect(r).toMatchObject({ score: 15, level: "recover" });
    expect(r?.notes.map((n) => n.kind)).toEqual(["sleep", "hrv", "rhr"]);
    expect(r?.notes[1]).toMatchObject({ kind: "hrv", pct: -30, tone: "bad", text: "HRV is 30% below your 30-day average" });
    expect(r?.notes[2]).toMatchObject({ kind: "rhr", diff: 6, text: "Resting heart rate is 6 bpm above your baseline" });
  });

  it("says to train as planned on a middling day", () => {
    const r = computeReadiness({ hrv: { latest: 46, baseline: 50 }, rhr: { latest: 56, baseline: 55 }, sleepHours: 6.5 });
    expect(r?.level).toBe("normal");
  });

  it("breaks the score down by signal, in a fixed order, adding up to the score", () => {
    const r = computeReadiness({ hrv: { latest: 46, baseline: 50 }, rhr: { latest: 56, baseline: 55 }, sleepHours: 6.5 })!;
    expect(r.drivers.map((d) => d.kind)).toEqual(["hrv", "rhr", "sleep"]);
    expect(r.drivers.map((d) => d.max)).toEqual([35, 30, 35]);
    // HRV at 92% of baseline → 19.6 of 35, resting HR +1 → 17.5 of 30, 6.5 h of sleep → 20 of 35.
    expect(r.drivers.map((d) => d.points)).toEqual([19.6, 17.5, 20]);
    const total = r.drivers.reduce((a, d) => a + d.points, 0) / r.drivers.reduce((a, d) => a + d.max, 0);
    expect(Math.round(total * 100)).toBe(r.score);
    expect(r.drivers[0]).toMatchObject({ kind: "hrv", latest: 46, baseline: 50, pct: -8, tone: "neutral" });
    expect(r.drivers[1]).toMatchObject({ kind: "rhr", latest: 56, baseline: 55, diff: 1 });
  });

  it("only lists the signals it had", () => {
    const r = computeReadiness({ hrv: null, rhr: { latest: 55, baseline: 55 }, sleepHours: 8 })!;
    expect(r.drivers.map((d) => d.kind)).toEqual(["rhr", "sleep"]);
  });

  it("rounds sleep once, so 7.99 h reads 8h 0m", () => {
    const r = computeReadiness({ hrv: null, rhr: { latest: 55, baseline: 55 }, sleepHours: 7.999 });
    expect(r?.notes.find((n) => n.kind === "sleep")).toMatchObject({ h: 8, m: 0, text: "You slept 8h 0m last night" });
  });
});
