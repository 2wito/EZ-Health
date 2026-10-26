import { SaxesParser, type SaxesTagPlain } from "saxes";
import type { MetricType, SleepStageType } from "@/generated/prisma/enums";
import {
  convert,
  DISTANCE_TO_KM,
  ENERGY_TO_KCAL,
  LENGTH_TO_M,
  localParts,
  parseHaeDate,
  sleepNightKey,
  SPEED_TO_KMH,
  type MetricSampleRecord,
  type ParsedDate,
  type SleepStageRecord,
  type WorkoutRecord,
} from "@/lib/health-export/normalize";
import type { DailyActivityRecord } from "@/lib/health-export/store";

/** Thrown when the input clearly isn't a Health export. */
export class NotAHealthExportError extends Error {}

// Streaming parser for the Health app's "Export All Health Data" export.xml.
//
// Exports run to several GB, so the file is fed in chunks to a SAX parser and
// only compact aggregates are kept: high-frequency quantities (heart rate,
// energy…) are rolled into hourly buckets per source, matching the shape the
// Health Auto Export webhook produces. No I/O here — see ./import.ts.

type Aggregation =
  | "sample" // keep each record (daily-ish metrics)
  | "stats" // hourly min / avg / max
  | "sum"; // hourly total

interface RecordSpec {
  type: MetricType;
  unit: string;
  agg: Aggregation;
  energy?: boolean;
  scale?: number;
}

const RECORD_SPECS: Record<string, RecordSpec> = {
  HKQuantityTypeIdentifierHeartRate: { type: "HEART_RATE", unit: "bpm", agg: "stats" },
  HKQuantityTypeIdentifierRestingHeartRate: { type: "RESTING_HEART_RATE", unit: "bpm", agg: "sample" },
  HKQuantityTypeIdentifierWalkingHeartRateAverage: { type: "WALKING_HEART_RATE_AVG", unit: "bpm", agg: "sample" },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { type: "HEART_RATE_VARIABILITY", unit: "ms", agg: "sample" },
  HKQuantityTypeIdentifierRespiratoryRate: { type: "RESPIRATORY_RATE", unit: "breaths/min", agg: "stats" },
  HKQuantityTypeIdentifierOxygenSaturation: { type: "BLOOD_OXYGEN", unit: "%", agg: "stats", scale: 100 },
  HKQuantityTypeIdentifierVO2Max: { type: "VO2_MAX", unit: "ml/kg/min", agg: "sample" },
  HKQuantityTypeIdentifierActiveEnergyBurned: { type: "ACTIVE_ENERGY", unit: "kcal", agg: "sum", energy: true },
  HKQuantityTypeIdentifierBasalEnergyBurned: { type: "BASAL_ENERGY", unit: "kcal", agg: "sum", energy: true },
  HKQuantityTypeIdentifierStepCount: { type: "STEP_COUNT", unit: "count", agg: "sum" },
  HKQuantityTypeIdentifierAppleExerciseTime: { type: "EXERCISE_TIME", unit: "min", agg: "sum" },
};

const SLEEP_VALUES: Record<string, SleepStageType> = {
  HKCategoryValueSleepAnalysisInBed: "IN_BED",
  HKCategoryValueSleepAnalysisAwake: "AWAKE",
  HKCategoryValueSleepAnalysisAsleep: "ASLEEP",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "ASLEEP",
  HKCategoryValueSleepAnalysisAsleepCore: "CORE",
  HKCategoryValueSleepAnalysisAsleepDeep: "DEEP",
  HKCategoryValueSleepAnalysisAsleepREM: "REM",
};

/** HKWorkoutActivityType suffix → the name the Health app shows. */
const WORKOUT_NAMES: Record<string, string | [outdoor: string, indoor: string]> = {
  Running: ["Outdoor Run", "Indoor Run"],
  Walking: ["Outdoor Walk", "Indoor Walk"],
  Cycling: ["Outdoor Cycle", "Indoor Cycle"],
  HighIntensityIntervalTraining: "HIIT",
  MixedCardio: "Mixed Cardio",
  StairClimbing: "Stair Stepper",
};

const HOUR_MS = 3_600_000;
const MAX_WARNINGS = 10_000;

interface Bucket {
  spec: RecordSpec;
  hourStart: number;
  tzOffsetMin: number;
  source: string;
  sum: number;
  count: number;
  min: number;
  max: number;
}

interface OpenWorkout {
  attrs: Record<string, string>;
  meta: Record<string, string>;
  stats: Record<string, Record<string, string>>;
}

export interface ParseResult {
  samples: MetricSampleRecord[];
  sleepStages: SleepStageRecord[];
  workouts: WorkoutRecord[];
  activity: DailyActivityRecord[];
  recordsRead: number;
  /** Record types we don't track (e.g. dietary, audio exposure). */
  recordsSkipped: number;
  warnings: number;
  dataFrom: Date | null;
  dataTo: Date | null;
}

export class AppleHealthXmlParser {
  private readonly sax = new SaxesParser<{ xmlns: false; position: false }>({ xmlns: false, position: false });
  private readonly stack: string[] = [];
  private readonly buckets = new Map<string, Bucket>();
  private readonly points: MetricSampleRecord[] = [];
  private readonly sleepStages: SleepStageRecord[] = [];
  private readonly workouts: WorkoutRecord[] = [];
  private readonly activity: DailyActivityRecord[] = [];
  private workout: OpenWorkout | null = null;
  private readonly sources = new Map<string, string>();

  recordsRead = 0;
  recordsSkipped = 0;
  warnings = 0;
  private dataFrom = Infinity;
  private dataTo = -Infinity;

  constructor() {
    this.sax.on("opentag", (tag) => this.onOpen(tag));
    this.sax.on("closetag", (tag) => this.onClose(tag));
    // Real exports are occasionally malformed (bad DTD, stray characters).
    // Log and keep going rather than failing a multi-GB import.
    this.sax.on("error", () => {
      if (++this.warnings > MAX_WARNINGS) throw new NotAHealthExportError("This file doesn't look like an Apple Health export.");
    });
  }

  write(chunk: string) {
    this.sax.write(chunk);
  }

  finish(): ParseResult {
    this.sax.close();
    for (const b of this.buckets.values()) this.points.push(bucketToSample(b));
    this.buckets.clear();

    return {
      samples: this.points,
      sleepStages: this.sleepStages,
      workouts: this.workouts,
      activity: this.activity,
      recordsRead: this.recordsRead,
      recordsSkipped: this.recordsSkipped,
      warnings: this.warnings,
      dataFrom: Number.isFinite(this.dataFrom) ? new Date(this.dataFrom) : null,
      dataTo: Number.isFinite(this.dataTo) ? new Date(this.dataTo) : null,
    };
  }

  private onOpen(tag: SaxesTagPlain) {
    const parent = this.stack.at(-1);
    this.stack.push(tag.name);
    const a = tag.attributes as Record<string, string>;

    switch (tag.name) {
      case "Record":
        this.recordsRead++;
        this.onRecord(a);
        break;
      case "Workout":
        this.workout = { attrs: a, meta: {}, stats: {} };
        break;
      case "MetadataEntry":
        if (parent === "Workout" && this.workout && a.key) this.workout.meta[a.key] = a.value ?? "";
        break;
      case "WorkoutStatistics":
        if (parent === "Workout" && this.workout && a.type) this.workout.stats[a.type] = a;
        break;
      case "ActivitySummary":
        this.onActivitySummary(a);
        break;
    }
  }

  private onClose(tag: SaxesTagPlain) {
    this.stack.pop();
    if (tag.name === "Workout" && this.workout) {
      const w = buildWorkout(this.workout);
      if (w) {
        w.source = this.source(w.source);
        this.workouts.push(w);
        this.trackRange(w.start);
      } else this.warnings++;
      this.workout = null;
    }
  }

  private onRecord(a: Record<string, string>) {
    if (a.type === "HKCategoryTypeIdentifierSleepAnalysis") return this.onSleep(a);

    const spec = RECORD_SPECS[a.type];
    if (!spec) {
      this.recordsSkipped++;
      return;
    }

    const when = a.startDate ? parseHaeDate(a.startDate) : null;
    let value = Number(a.value);
    if (!when || !Number.isFinite(value)) {
      this.warnings++;
      return;
    }
    if (spec.energy) value = convert(value, a.unit, ENERGY_TO_KCAL) ?? value;
    if (spec.scale) value *= spec.scale;
    this.trackRange(when.date);

    const source = this.source(a.sourceName);
    if (spec.agg === "sample") {
      this.points.push(makeSample(spec, when, value, source));
      return;
    }

    // Bucket on the local hour (works for half-hour offsets too).
    const offsetMs = when.tzOffsetMin * 60_000;
    const hourStart = Math.floor((when.date.getTime() + offsetMs) / HOUR_MS) * HOUR_MS - offsetMs;
    const key = `${spec.type}|${hourStart}|${source}`;
    const b = this.buckets.get(key);
    if (b) {
      b.sum += value;
      b.count++;
      if (value < b.min) b.min = value;
      if (value > b.max) b.max = value;
    } else {
      this.buckets.set(key, {
        spec,
        hourStart,
        tzOffsetMin: when.tzOffsetMin,
        source,
        sum: value,
        count: 1,
        min: value,
        max: value,
      });
    }
  }

  private onSleep(a: Record<string, string>) {
    const stage = SLEEP_VALUES[a.value];
    const start = a.startDate ? parseHaeDate(a.startDate) : null;
    const end = a.endDate ? parseHaeDate(a.endDate) : null;
    if (!stage || !start || !end || end.date <= start.date) {
      this.warnings++;
      return;
    }
    this.trackRange(start.date);
    this.sleepStages.push({
      stage,
      start: start.date,
      end: end.date,
      tzOffsetMin: end.tzOffsetMin,
      source: this.source(a.sourceName),
      night: sleepNightKey(end),
    });
  }

  private onActivitySummary(a: Record<string, string>) {
    const day = a.dateComponents ? parseHaeDate(a.dateComponents) : null;
    if (!day) return;
    const num = (k: string) => (a[k] !== undefined && Number.isFinite(Number(a[k])) ? Number(a[k]) : null);
    const energy = num("activeEnergyBurned");
    const exercise = num("appleExerciseTime");
    // Apple writes empty rows for days before you had a watch.
    if (!energy && !exercise) return;
    const unit = a.activeEnergyBurnedUnit;
    const kcal = (v: number | null) => (v === null ? null : (convert(v, unit, ENERGY_TO_KCAL) ?? v));
    this.activity.push({
      date: day.date,
      activeEnergyKcal: kcal(energy),
      activeEnergyGoal: kcal(num("activeEnergyBurnedGoal")),
      exerciseMin: exercise,
      exerciseGoalMin: num("appleExerciseTimeGoal"),
      standHours: num("appleStandHours"),
      standGoalHours: num("appleStandHoursGoal"),
    });
  }

  /**
   * Attribute values are V8 *slices* of the 1 MB chunk being parsed, and a
   * slice keeps its whole parent string alive. Storing them as-is pinned every
   * chunk of the file in memory (650 MB for a 325 MB export). Copy each
   * distinct source name once and reuse it.
   */
  private source(raw: string | undefined): string {
    if (!raw) return "";
    let copy = this.sources.get(raw);
    if (copy === undefined) {
      // A JSON round trip makes a flat copy, and works in browsers too (no Buffer there).
      copy = JSON.parse(JSON.stringify(raw)) as string;
      this.sources.set(copy, copy);
    }
    return copy;
  }

  private trackRange(d: Date) {
    const t = d.getTime();
    if (t < this.dataFrom) this.dataFrom = t;
    if (t > this.dataTo) this.dataTo = t;
  }
}

function makeSample(spec: RecordSpec, when: ParsedDate, value: number, source: string): MetricSampleRecord {
  return {
    type: spec.type,
    timestamp: when.date,
    tzOffsetMin: when.tzOffsetMin,
    ...localParts(when),
    qty: value,
    min: null,
    avg: null,
    max: null,
    unit: spec.unit,
    source,
  };
}

function bucketToSample(b: Bucket): MetricSampleRecord {
  const when = { date: new Date(b.hourStart), tzOffsetMin: b.tzOffsetMin };
  const avg = b.sum / b.count;
  const base = makeSample(b.spec, when, b.spec.agg === "sum" ? b.sum : avg, b.source);
  // Heart rate keeps the min/avg/max shape the webhook uses.
  return b.spec.type === "HEART_RATE" ? { ...base, qty: null, min: b.min, avg, max: b.max } : base;
}

/** "4500 cm" / "9.5 kcal/hr·kg" → [4500, "cm"] */
function quantity(raw: string | undefined): [number, string] | null {
  if (!raw) return null;
  const m = /^\s*(-?[\d.]+)\s*(.*)$/.exec(raw);
  return m && Number.isFinite(Number(m[1])) ? [Number(m[1]), m[2].trim()] : null;
}

function workoutName(activityType: string | undefined, indoor: boolean) {
  const key = (activityType ?? "").replace(/^HKWorkoutActivityType/, "");
  const mapped = WORKOUT_NAMES[key];
  if (Array.isArray(mapped)) return indoor ? mapped[1] : mapped[0];
  if (mapped) return mapped;
  // "TraditionalStrengthTraining" → "Traditional Strength Training"
  return key.replace(/([a-z])([A-Z])/g, "$1 $2") || "Workout";
}

function buildWorkout({ attrs: a, meta, stats }: OpenWorkout): WorkoutRecord | null {
  const start = a.startDate ? parseHaeDate(a.startDate) : null;
  const end = a.endDate ? parseHaeDate(a.endDate) : null;
  if (!start || !end) return null;

  const num = (v: string | undefined) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined);
  const n = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : v);

  const durationMin = num(a.duration);
  const durationSec = Math.round(
    durationMin !== undefined
      ? durationMin * (a.durationUnit === "s" ? 1 : a.durationUnit === "hr" ? 3600 : 60)
      : (end.date.getTime() - start.date.getTime()) / 1000,
  );

  // iOS 16+ puts totals in <WorkoutStatistics>; older exports use attributes.
  const energyStat = stats.HKQuantityTypeIdentifierActiveEnergyBurned;
  const kcal = energyStat
    ? convert(num(energyStat.sum), energyStat.unit, ENERGY_TO_KCAL)
    : convert(num(a.totalEnergyBurned), a.totalEnergyBurnedUnit, ENERGY_TO_KCAL);

  const distanceKey = Object.keys(stats).find((k) => k.startsWith("HKQuantityTypeIdentifierDistance"));
  const distanceStat = distanceKey ? stats[distanceKey] : undefined;
  const distanceKm = distanceStat
    ? convert(num(distanceStat.sum), distanceStat.unit, DISTANCE_TO_KM)
    : convert(num(a.totalDistance), a.totalDistanceUnit, DISTANCE_TO_KM);

  const speedStat = stats.HKQuantityTypeIdentifierRunningSpeed;
  const avgSpeedKmh =
    (speedStat ? convert(num(speedStat.average), speedStat.unit, SPEED_TO_KMH) : undefined) ??
    (distanceKm && durationSec > 0 ? distanceKm / (durationSec / 3600) : undefined);

  const hr = stats.HKQuantityTypeIdentifierHeartRate;
  const elevation = quantity(meta.HKElevationAscended);
  const mets = quantity(meta.HKAverageMETs);

  return {
    externalId: null,
    name: workoutName(a.workoutActivityType, meta.HKIndoorWorkout === "1"),
    source: a.sourceName ?? "",
    start: start.date,
    end: end.date,
    tzOffsetMin: start.tzOffsetMin,
    localDate: localParts(start).localDate,
    durationSec,
    activeEnergyKcal: n(kcal),
    distanceKm: n(distanceKm),
    avgSpeedKmh: n(avgSpeedKmh),
    elevationUpM: elevation ? n(convert(elevation[0], elevation[1], LENGTH_TO_M)) : null,
    stepCount: n(num(stats.HKQuantityTypeIdentifierStepCount?.sum)),
    intensityMet: mets ? mets[0] : null,
    avgHr: n(num(hr?.average)),
    minHr: n(num(hr?.minimum)),
    maxHr: n(num(hr?.maximum)),
    hrSeries: null,
  };
}
