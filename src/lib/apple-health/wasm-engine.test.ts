import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { WasmHealthParser, type EngineFactory } from "./wasm-engine";
import { AppleHealthXmlParser, type ParseResult } from "./xml-parser";

// The WebAssembly build of telemetry-engine must produce exactly what the
// TypeScript parser produces. The module is committed (public/wasm); build it
// with `telemetry-engine/scripts/build.sh --wasm`. CI sets EZT_REQUIRE_WASM=1
// so a missing module fails instead of skipping.

const MODULE = fileURLToPath(new URL("../../../public/wasm/ez-telemetry.mjs", import.meta.url));
const SAMPLE = fileURLToPath(new URL("../../../scripts/sample-export.xml", import.meta.url));
const present = existsSync(MODULE);
if (!present && process.env.EZT_REQUIRE_WASM) throw new Error(`${MODULE} is missing: run telemetry-engine/scripts/build.sh --wasm`);

async function engine() {
  const { default: create } = (await import(/* @vite-ignore */ pathToFileURL(MODULE).href)) as { default: EngineFactory };
  return create();
}

/** Parses with the engine, feeding the bytes in uneven chunks that split tags and characters. */
async function parseWasm(bytes: Uint8Array): Promise<ParseResult> {
  const parser = new WasmHealthParser(await engine());
  let step = 1;
  for (let pos = 0; pos < bytes.length; pos += step, step = (step * 7) % 997 + 1) {
    parser.write(bytes.subarray(pos, Math.min(bytes.length, pos + step)));
  }
  return parser.finish();
}

function parseTs(xml: string): ParseResult {
  const parser = new AppleHealthXmlParser();
  parser.write(xml);
  return parser.finish();
}

/** Record order differs (hash-map buckets), so compare as sorted JSON. */
const sorted = (records: object[]) => records.map((r) => JSON.stringify(r)).sort();

function expectSameResult(wasm: ParseResult, ts: ParseResult) {
  for (const kind of ["samples", "sleepStages", "workouts", "activity"] as const) {
    expect(sorted(wasm[kind]), kind).toEqual(sorted(ts[kind]));
  }
  expect(wasm.recordsRead).toBe(ts.recordsRead);
  expect(wasm.recordsSkipped).toBe(ts.recordsSkipped);
  expect(wasm.warnings).toBe(ts.warnings);
  expect(wasm.dataFrom).toEqual(ts.dataFrom);
  expect(wasm.dataTo).toEqual(ts.dataTo);
}

describe.skipIf(!present)("WebAssembly engine", () => {
  it("matches the TypeScript parser on the sample export", async () => {
    const bytes = readFileSync(SAMPLE);
    const wasm = await parseWasm(bytes);
    expect(wasm.samples.length).toBeGreaterThan(0);
    expect(wasm.workouts.length).toBe(2);
    expect(wasm.samples[0].timestamp).toBeInstanceOf(Date);
    expectSameResult(wasm, parseTs(bytes.toString("utf8")));
  });

  it("matches on entities, half-hour offsets, unit conversions and workouts", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [ <!ATTLIST Record type CDATA #REQUIRED> ]>
<HealthData>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Dana&apos;s Watch &amp; Co" startDate="2026-03-01 10:05:00 +0530" value="61"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Dana&apos;s Watch &amp; Co" startDate="2026-03-01 10:59:59 +0530" value="99"/>
 <Record type="HKQuantityTypeIdentifierBasalEnergyBurned" sourceName="iPhone" unit="kJ" startDate="2026-03-01 10:10:00 -0330" value="100"/>
 <Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="שעון" startDate="2026-03-01 03:00:00 +0200" value="48.25"/>
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" startDate="not a date" value="5"/>
 <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="W" value="HKCategoryValueSleepAnalysisAsleepREM" startDate="2026-03-01 23:30:00 +0200" endDate="2026-03-02 00:10:00 +0200"/>
 <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="1.5" durationUnit="hr" sourceName="W" startDate="2026-03-02 09:00:00 +0200" endDate="2026-03-02 10:30:00 +0200">
  <MetadataEntry key="HKElevationAscended" value="120 m"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceCycling" sum="30" unit="mi"/>
 </Workout>
 <Workout workoutActivityType="HKWorkoutActivityTypeHighIntensityIntervalTraining" sourceName="W" startDate="2026-03-03 09:00:00 +0200" endDate="2026-03-03 09:20:30 +0200" totalEnergyBurned="840" totalEnergyBurnedUnit="kJ"/>
 <ActivitySummary dateComponents="2026-03-02" activeEnergyBurned="2092" activeEnergyBurnedUnit="kJ" appleExerciseTime="35"/>
</HealthData>`;
    const wasm = await parseWasm(new TextEncoder().encode(xml));
    expect(wasm.workouts.map((w) => w.name).sort()).toEqual(["HIIT", "Outdoor Cycle"]);
    expect(wasm.samples.some((s) => s.source === "Dana's Watch & Co")).toBe(true);
    expectSameResult(wasm, parseTs(xml));
  });
});
