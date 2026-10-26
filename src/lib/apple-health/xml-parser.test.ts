import { describe, expect, it } from "vitest";
import { AppleHealthXmlParser } from "./xml-parser";

const record = (type: string, start: string, value: number | string, extra = "") =>
  `<Record type="${type}" sourceName="Apple Watch" unit="x" startDate="${start}" endDate="${start}" value="${value}" ${extra}/>`;

const EXPORT = `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_IL">
 ${record("HKQuantityTypeIdentifierHeartRate", "2026-10-25 07:05:00 +0300", 60)}
 ${record("HKQuantityTypeIdentifierHeartRate", "2026-10-25 07:20:00 +0300", 72)}
 ${record("HKQuantityTypeIdentifierHeartRate", "2026-10-25 07:55:00 +0300", 66)}
 ${record("HKQuantityTypeIdentifierHeartRate", "2026-10-25 08:01:00 +0300", 90)}
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Apple Watch" unit="kJ" startDate="2026-10-25 18:10:00 +0300" endDate="2026-10-25 18:11:00 +0300" value="418.4"/>
 <Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="Apple Watch" unit="kJ" startDate="2026-10-25 18:40:00 +0300" endDate="2026-10-25 18:41:00 +0300" value="836.8"/>
 ${record("HKQuantityTypeIdentifierRestingHeartRate", "2026-10-25 00:00:00 +0300", 54)}
 ${record("HKQuantityTypeIdentifierOxygenSaturation", "2026-10-25 03:00:00 +0300", 0.97)}
 ${record("HKQuantityTypeIdentifierDietaryWater", "2026-10-25 12:00:00 +0300", 500)}
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-25 23:50:00 +0300" endDate="2026-10-26 01:20:00 +0300" value="HKCategoryValueSleepAnalysisAsleepCore"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" startDate="2026-10-26 01:20:00 +0300" endDate="2026-10-26 02:05:00 +0300" value="HKCategoryValueSleepAnalysisAsleepDeep"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Apple Watch" startDate="2026-10-25 18:00:00 +0300" endDate="2026-10-25 18:30:00 +0300">
  <MetadataEntry key="HKIndoorWorkout" value="1"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="6" unit="km"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="400" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="150" minimum="110" maximum="172" unit="count/min"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" sourceName="Apple Watch" startDate="2026-10-24 17:00:00 +0300" endDate="2026-10-24 17:45:00 +0300"/>
 <ActivitySummary dateComponents="2026-10-25" activeEnergyBurned="650" activeEnergyBurnedGoal="600" activeEnergyBurnedUnit="kcal" appleExerciseTime="45" appleExerciseTimeGoal="30" appleStandHours="11" appleStandHoursGoal="12"/>
 <ActivitySummary dateComponents="2019-01-01" activeEnergyBurned="0" activeEnergyBurnedUnit="kcal" appleExerciseTime="0"/>
</HealthData>`;

/** Feeds the export in small chunks, so tags are split across writes like a real stream. */
function parse(xml: string, chunkSize = 97) {
  const parser = new AppleHealthXmlParser();
  for (let i = 0; i < xml.length; i += chunkSize) parser.write(xml.slice(i, i + chunkSize));
  return parser.finish();
}

describe("AppleHealthXmlParser", () => {
  const result = parse(EXPORT);

  it("counts what it read and what it skipped", () => {
    expect(result.recordsRead).toBe(11);
    expect(result.recordsSkipped).toBe(1); // dietary water
    expect(result.warnings).toBe(0);
  });

  it("rolls heart rate into local-hour min/avg/max buckets", () => {
    const hr = result.samples
      .filter((s) => s.type === "HEART_RATE")
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    expect(hr).toHaveLength(2);
    expect(hr[0]).toMatchObject({ min: 60, avg: 66, max: 72, qty: null, localHour: 7, tzOffsetMin: 180 });
    expect(hr[0].timestamp.toISOString()).toBe("2026-10-25T04:00:00.000Z");
    expect(hr[1]).toMatchObject({ min: 90, max: 90, localHour: 8 });
  });

  it("sums energy per hour and converts kJ to kcal", () => {
    const energy = result.samples.filter((s) => s.type === "ACTIVE_ENERGY");
    expect(energy).toHaveLength(1);
    expect(energy[0].qty).toBeCloseTo(300);
  });

  it("keeps daily metrics as-is and scales SpO2 to percent", () => {
    expect(result.samples.find((s) => s.type === "RESTING_HEART_RATE")?.qty).toBe(54);
    expect(result.samples.find((s) => s.type === "BLOOD_OXYGEN")?.qty).toBeCloseTo(97);
  });

  it("reads sleep stages and files them under the wake date", () => {
    expect(result.sleepStages.map((s) => s.stage)).toEqual(["CORE", "DEEP"]);
    expect(result.sleepStages.every((s) => s.night.toISOString() === "2026-10-26T00:00:00.000Z")).toBe(true);
  });

  it("builds workouts from statistics and metadata", () => {
    const [run, lift] = result.workouts;
    expect(run).toMatchObject({
      name: "Indoor Run",
      durationSec: 1800,
      distanceKm: 6,
      activeEnergyKcal: 400,
      avgSpeedKmh: 12,
      avgHr: 150,
      minHr: 110,
      maxHr: 172,
    });
    expect(lift).toMatchObject({ name: "Traditional Strength Training", durationSec: 2700 });
  });

  it("keeps Activity ring days and drops the empty ones", () => {
    expect(result.activity).toHaveLength(1);
    expect(result.activity[0]).toMatchObject({ activeEnergyKcal: 650, exerciseMin: 45, standHours: 11 });
  });

  it("tracks the date range of the data", () => {
    expect(result.dataFrom?.toISOString()).toBe("2026-10-24T14:00:00.000Z");
    expect(result.dataTo?.toISOString()).toBe("2026-10-25T22:20:00.000Z");
  });

  it("gives the same result whatever the chunk size", () => {
    const whole = parse(EXPORT, EXPORT.length);
    expect(parse(EXPORT, 13).samples).toHaveLength(whole.samples.length);
    expect(parse(EXPORT, 13).workouts).toEqual(whole.workouts);
  });
});
