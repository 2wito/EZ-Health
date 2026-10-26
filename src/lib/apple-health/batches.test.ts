import { describe, expect, it } from "vitest";
import { BatchSchema } from "./batch-schema";
import { countSleepNights, toBatches, type ParsedRecords } from "./batches";
import { AppleHealthXmlParser } from "./xml-parser";

function sampleRecords(n: number): ParsedRecords["samples"] {
  return Array.from({ length: n }, (_, i) => ({
    type: "HEART_RATE" as const,
    timestamp: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000),
    tzOffsetMin: 180,
    localDate: new Date(Date.UTC(2026, 9, 1)),
    localHour: i % 24,
    localWeekday: 4,
    qty: null,
    min: 50,
    avg: 60,
    max: 70,
    unit: "bpm",
    source: "Apple Watch",
  }));
}

const empty: ParsedRecords = { samples: [], sleepStages: [], workouts: [], activity: [] };

describe("toBatches", () => {
  it("caps records per batch", () => {
    const batches = toBatches({ ...empty, samples: sampleRecords(12_000) }, 3_000_000, 5_000);
    expect(batches.map((b) => JSON.parse(b).records.length)).toEqual([5_000, 5_000, 2_000]);
  });

  it("splits further when a batch is too many bytes, keeping every record", () => {
    const batches = toBatches({ ...empty, samples: sampleRecords(1_000) }, 50_000, 5_000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length <= 50_000)).toBe(true);
    expect(batches.reduce((n, b) => n + JSON.parse(b).records.length, 0)).toBe(1_000);
  });

  it("produces nothing for an empty export", () => {
    expect(toBatches(empty)).toEqual([]);
  });
});

describe("browser parse → batches → server validation", () => {
  const xml = `<HealthData>
    <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" startDate="2026-10-25 07:05:00 +0300" endDate="2026-10-25 07:05:00 +0300" value="61"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-10-25 23:50:00 +0300" endDate="2026-10-26 01:20:00 +0300" value="HKCategoryValueSleepAnalysisAsleepCore"/>
    <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Watch" startDate="2026-10-26 01:20:00 +0300" endDate="2026-10-26 02:05:00 +0300" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
    <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Watch" startDate="2026-10-25 18:00:00 +0300" endDate="2026-10-25 18:30:00 +0300"/>
    <ActivitySummary dateComponents="2026-10-25" activeEnergyBurned="650" activeEnergyBurnedUnit="kcal" appleExerciseTime="45"/>
  </HealthData>`;
  const parser = new AppleHealthXmlParser();
  parser.write(xml);
  const parsed = parser.finish();

  it("survives the JSON trip with dates and values intact", () => {
    const batches = toBatches(parsed).map((body) => BatchSchema.parse(JSON.parse(body)));
    expect(batches.map((b) => b.kind)).toEqual(["samples", "sleepStages", "workouts", "activity"]);

    const [samples, sleep, workouts] = batches;
    expect(samples.records[0]).toEqual(parsed.samples[0]);
    expect(sleep.records).toEqual(parsed.sleepStages);
    expect(workouts.records[0]).toEqual(parsed.workouts[0]);
  });

  it("counts nights per source", () => {
    expect(countSleepNights(parsed.sleepStages)).toBe(1);
  });

  it("rejects malformed batches", () => {
    expect(BatchSchema.safeParse({ kind: "samples", records: [] }).success).toBe(false);
    expect(BatchSchema.safeParse({ kind: "samples", records: [{ ...parsed.samples[0], type: "DROP TABLE" }] }).success).toBe(false);
    expect(BatchSchema.safeParse({ kind: "files", records: [{}] }).success).toBe(false);
  });
});
