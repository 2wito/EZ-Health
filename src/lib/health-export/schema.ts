import { z } from "zod";

// Shapes sent by the Health Auto Export iOS app (REST API automation, JSON).
// The app has shipped two export format versions (v1 / v2) and many fields are
// optional depending on settings, so these schemas are deliberately permissive:
// we validate the envelope strictly and individual records leniently.

// HAE occasionally sends numbers as strings, and null for missing values.
// Never let null coerce to 0 — that would fabricate readings.
const blankToUndefined = (v: unknown) => (v === null || v === "" ? undefined : v);
const num = z.preprocess(blankToUndefined, z.coerce.number());
const optNum = z.preprocess(blankToUndefined, z.coerce.number().optional());

export const QtySchema = z.object({ qty: num, units: z.string().optional() });

export const MetricSchema = z.object({
  name: z.string(),
  units: z.string().default(""),
  data: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const PayloadSchema = z
  .object({
    data: z
      .object({
        metrics: z.array(MetricSchema).default([]),
        workouts: z.array(z.record(z.string(), z.unknown())).default([]),
      })
      .optional(),
    // Some setups post the inner object directly.
    metrics: z.array(MetricSchema).optional(),
    workouts: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .transform((p) => ({
    metrics: p.data?.metrics ?? p.metrics ?? [],
    workouts: p.data?.workouts ?? p.workouts ?? [],
  }));

export type HealthPayload = z.output<typeof PayloadSchema>;
export type RawMetric = z.output<typeof MetricSchema>;

/** `{ date, qty, source }` — most quantity metrics. */
export const QtySampleSchema = z.object({
  date: z.string(),
  qty: num,
  source: z.string().optional(),
});

/** `{ date, Min, Avg, Max, source }` — heart_rate. */
export const MinAvgMaxSampleSchema = z.object({
  date: z.string(),
  Min: optNum,
  Avg: optNum,
  Max: optNum,
  source: z.string().optional(),
});

/** Aggregated sleep (one record per night). Values are in the metric's units (normally hours). */
export const SleepAggregatedSchema = z.object({
  date: z.string(),
  totalSleep: optNum,
  asleep: optNum,
  core: optNum,
  deep: optNum,
  rem: optNum,
  awake: optNum,
  inBed: optNum,
  sleepStart: z.string().optional(),
  sleepEnd: z.string().optional(),
  inBedStart: z.string().optional(),
  inBedEnd: z.string().optional(),
  source: z.string().optional(),
});

/** Unaggregated sleep: one record per stage segment. */
export const SleepSegmentSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  value: z.string(),
  source: z.string().optional(),
});

export const WorkoutSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  start: z.string(),
  end: z.string(),
  duration: optNum, // seconds (v2)
  // v2 names
  activeEnergyBurned: QtySchema.optional(),
  heartRate: z
    .object({ min: QtySchema.optional(), avg: QtySchema.optional(), max: QtySchema.optional() })
    .optional(),
  avgSpeed: QtySchema.optional(),
  speed: QtySchema.optional(),
  intensity: QtySchema.optional(),
  elevationUp: QtySchema.optional(),
  // v1 names
  activeEnergy: z.union([QtySchema, z.array(QtySampleSchema)]).optional(),
  avgHeartRate: QtySchema.optional(),
  maxHeartRate: QtySchema.optional(),
  elevation: z.object({ ascent: optNum, units: z.string().optional() }).optional(),
  // both
  distance: QtySchema.optional(),
  stepCount: z.union([QtySchema, z.array(QtySampleSchema)]).optional(),
  heartRateData: z.array(MinAvgMaxSampleSchema).optional(),
});
