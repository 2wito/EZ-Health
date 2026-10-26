import { z } from "zod";
import { MetricType, SleepStageType } from "@/generated/prisma/enums";
import { MAX_BATCH_RECORDS } from "./batches";

// Validates batches of browser-parsed records before they reach the database.
// Dates arrive as ISO strings (JSON) and are revived here.

const date = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), "invalid date");
const num = z.number().finite();
const optNum = num.nullable();
const offset = z.number().int().min(-14 * 60).max(14 * 60);
const source = z.string().max(200);

const sample = z.object({
  type: z.enum(Object.values(MetricType) as [MetricType, ...MetricType[]]),
  timestamp: date,
  tzOffsetMin: offset,
  localDate: date,
  localHour: z.number().int().min(0).max(23),
  localWeekday: z.number().int().min(0).max(6),
  qty: optNum,
  min: optNum,
  avg: optNum,
  max: optNum,
  unit: z.string().max(40),
  source,
});

const sleepStage = z.object({
  stage: z.enum(Object.values(SleepStageType) as [SleepStageType, ...SleepStageType[]]),
  start: date,
  end: date,
  tzOffsetMin: offset,
  source,
  night: date,
});

const workout = z.object({
  externalId: z.string().max(200).nullable(),
  name: z.string().min(1).max(200),
  source,
  start: date,
  end: date,
  tzOffsetMin: offset,
  localDate: date,
  durationSec: z.number().int().min(0),
  activeEnergyKcal: optNum,
  distanceKm: optNum,
  avgSpeedKmh: optNum,
  elevationUpM: optNum,
  stepCount: optNum,
  intensityMet: optNum,
  avgHr: optNum,
  minHr: optNum,
  maxHr: optNum,
  hrSeries: z
    .array(z.object({ t: z.string(), min: optNum, avg: optNum, max: optNum }))
    .max(20_000)
    .nullable(),
});

const activity = z.object({
  date,
  activeEnergyKcal: optNum,
  activeEnergyGoal: optNum,
  exerciseMin: optNum,
  exerciseGoalMin: optNum,
  standHours: optNum,
  standGoalHours: optNum,
});

const records = <T extends z.ZodType>(schema: T) => z.array(schema).min(1).max(MAX_BATCH_RECORDS);

export const BatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("samples"), records: records(sample) }),
  z.object({ kind: z.literal("sleepStages"), records: records(sleepStage) }),
  z.object({ kind: z.literal("workouts"), records: records(workout) }),
  z.object({ kind: z.literal("activity"), records: records(activity) }),
]);

const count = z.number().int().min(0);

/** What the browser learned while parsing, recorded on the ImportJob. */
export const StartSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileBytes: count,
  bytesTotal: count,
  recordsRead: count,
  recordsSkipped: count,
  parseWarnings: count,
  dataFrom: date.nullable(),
  dataTo: date.nullable(),
});

export const FinishSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DONE"), sleepNights: count, workoutsSaved: count, activityDays: count }),
  z.object({ status: z.literal("FAILED"), error: z.string().max(500) }),
]);
