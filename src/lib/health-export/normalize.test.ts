import { describe, expect, it } from "vitest";
import sample from "../../../scripts/sample-payload.json";
import {
  convert,
  ENERGY_TO_KCAL,
  localParts,
  normalizePayload,
  parseHaeDate,
  sleepNightKey,
  summarizeSleepStages,
} from "./normalize";
import { PayloadSchema } from "./schema";

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("parseHaeDate", () => {
  it("parses Health Auto Export dates and keeps their UTC offset", () => {
    const d = parseHaeDate("2024-01-01 08:00:00 -0500");
    expect(iso(d!.date)).toBe("2024-01-01T13:00:00.000Z");
    expect(d!.tzOffsetMin).toBe(-300);
    expect(parseHaeDate("2026-10-25 07:00:00 +0530")!.tzOffsetMin).toBe(330);
  });

  it("accepts ISO 8601 and bare dates", () => {
    expect(parseHaeDate("2024-01-01T08:00:00Z")).toEqual({ date: new Date("2024-01-01T08:00:00Z"), tzOffsetMin: 0 });
    expect(iso(parseHaeDate("2024-01-01")!.date)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("rejects anything else", () => {
    expect(parseHaeDate("yesterday")).toBeNull();
    expect(parseHaeDate("2024-13-45 08:00:00")).toBeNull();
  });
});

describe("localParts / sleepNightKey", () => {
  it("derives the local date, hour and weekday from the recorded offset", () => {
    // 23:30 UTC on Saturday is 02:30 on Sunday in Israel.
    const parts = localParts({ date: new Date("2026-10-24T23:30:00Z"), tzOffsetMin: 180 });
    expect(iso(parts.localDate)).toBe("2026-10-25T00:00:00.000Z");
    expect(parts.localHour).toBe(2);
    expect(parts.localWeekday).toBe(0);
  });

  it("files sleep under the morning you woke up", () => {
    expect(iso(sleepNightKey(parseHaeDate("2026-10-26 06:45:00 +0300")!))).toBe("2026-10-26T00:00:00.000Z");
    // A segment ending late in the evening belongs to the next night.
    expect(iso(sleepNightKey(parseHaeDate("2026-10-25 23:45:00 +0300")!))).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("convert", () => {
  it("converts units case-insensitively and passes unknown ones through", () => {
    expect(convert(418.4, "kJ", ENERGY_TO_KCAL)).toBeCloseTo(100);
    expect(convert(250, "kcal", ENERGY_TO_KCAL)).toBe(250);
    expect(convert(7, "furlongs", ENERGY_TO_KCAL)).toBe(7);
    expect(convert(undefined, "kJ", ENERGY_TO_KCAL)).toBeUndefined();
  });
});

describe("normalizePayload (scripts/sample-payload.json)", () => {
  const out = normalizePayload(PayloadSchema.parse(sample));

  it("maps known metrics, skips unknown ones and counts invalid records", () => {
    expect(out.metricsReceived).toBe(8);
    expect(out.skippedMetrics).toEqual(["dietary_water"]);
    // The active-energy row with qty: null is dropped, never stored as 0.
    expect(out.invalidRecords).toBe(1);
    expect(out.samples).toHaveLength(7);
  });

  it("keeps heart rate as min/avg/max with local time", () => {
    const hr = out.samples.find((s) => s.type === "HEART_RATE")!;
    expect(hr).toMatchObject({ min: 52, avg: 61.5, max: 74, qty: null, tzOffsetMin: 180, localHour: 7 });
  });

  it("converts energy from kJ to kcal", () => {
    const energy = out.samples.filter((s) => s.type === "ACTIVE_ENERGY").map((s) => s.qty);
    expect(energy[0]).toBeCloseTo(100);
    expect(energy[1]).toBeCloseTo(500);
  });

  it("normalizes v2 workouts (miles, kJ, feet) and v1 workouts", () => {
    const [run, lift] = out.workouts;
    expect(run.name).toBe("Outdoor Run");
    expect(run.durationSec).toBe(1950);
    expect(run.distanceKm).toBeCloseTo(5.6327, 4);
    expect(run.activeEnergyKcal).toBeCloseTo(400);
    expect(run.elevationUpM).toBeCloseTo(36.576);
    expect(run).toMatchObject({ avgHr: 152, maxHr: 176, minHr: 98 });
    expect(iso(run.localDate)).toBe("2026-10-25T00:00:00.000Z");

    expect(lift).toMatchObject({ name: "Traditional Strength Training", durationSec: 3000, activeEnergyKcal: 310, avgHr: 118, maxHr: 151, distanceKm: null });
  });

  it("reads both aggregated nights and stage segments", () => {
    expect(out.sleepSessions).toHaveLength(1);
    expect(out.sleepSessions[0].totalSleep).toBe(7.25);
    expect(out.sleepStages).toHaveLength(5);
  });
});

describe("summarizeSleepStages", () => {
  it("rolls segments up into one night per source", () => {
    const { sleepStages } = normalizePayload(PayloadSchema.parse(sample));
    const [night] = summarizeSleepStages(sleepStages);
    expect(iso(night.date)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(night.sleepStart)).toBe("2026-10-25T20:50:00.000Z");
    expect(iso(night.sleepEnd)).toBe("2026-10-26T03:45:00.000Z");
    expect(night.coreHours).toBeCloseTo(4.75);
    expect(night.deepHours).toBeCloseTo(0.75);
    expect(night.remHours).toBeCloseTo(80 / 60);
    expect(night.awakeHours).toBeCloseTo(5 / 60);
    // Awake time doesn't count as sleep.
    expect(night.totalSleep).toBeCloseTo(4.75 + 0.75 + 80 / 60);
  });
});
