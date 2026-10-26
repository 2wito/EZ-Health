import type { MetricType, SleepStageType } from "@/generated/prisma/enums";
import {
  MinAvgMaxSampleSchema,
  QtySampleSchema,
  SleepAggregatedSchema,
  SleepSegmentSchema,
  WorkoutSchema,
  type HealthPayload,
} from "./schema";

// Pure functions that turn a Health Auto Export payload into DB-ready records.
// No I/O here, so it can be unit tested against sample payloads.

// ─── Dates & local time ──────────────────────────────────────────────────────

export interface ParsedDate {
  date: Date;
  tzOffsetMin: number;
}

// "2024-01-01 08:00:00 -0500" (HAE default), ISO 8601, or a bare "2024-01-01".
const DATE_RE =
  /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?\s*(Z|[+-]\d{2}:?\d{2})?$/;

export function parseHaeDate(input: string): ParsedDate | null {
  const m = DATE_RE.exec(input.trim());
  if (!m) return null;
  const [, day, time = "00:00:00", tz] = m;

  let tzOffsetMin = 0;
  if (tz && tz !== "Z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const digits = tz.slice(1).replace(":", "");
    tzOffsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }

  const date = new Date(`${day}T${time}${formatOffset(tzOffsetMin)}`);
  return Number.isNaN(date.getTime()) ? null : { date, tzOffsetMin };
}

function formatOffset(min: number) {
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export interface LocalParts {
  /** Local calendar day as a UTC-midnight Date (what Prisma expects for @db.Date). */
  localDate: Date;
  localHour: number;
  localWeekday: number;
}

export function localParts({ date, tzOffsetMin }: ParsedDate): LocalParts {
  const shifted = new Date(date.getTime() + tzOffsetMin * 60_000);
  return {
    localDate: new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())),
    localHour: shifted.getUTCHours(),
    localWeekday: shifted.getUTCDay(),
  };
}

/**
 * Which "night" a sleep segment belongs to: the local date the user woke up.
 * Anything ending before 18:00 counts for that day; later counts for the next
 * day (so falling asleep at 23:30 and a segment ending at 23:45 both belong to
 * tomorrow's night).
 */
export function sleepNightKey(end: ParsedDate): Date {
  const SIX_HOURS = 6 * 3_600_000;
  return localParts({ date: new Date(end.date.getTime() + SIX_HOURS), tzOffsetMin: end.tzOffsetMin }).localDate;
}

// ─── Units ───────────────────────────────────────────────────────────────────

export const ENERGY_TO_KCAL: Record<string, number> = { kcal: 1, cal: 1, kj: 1 / 4.184 };
export const DISTANCE_TO_KM: Record<string, number> = { km: 1, m: 0.001, mi: 1.609344, yd: 0.0009144, ft: 0.0003048 };
export const SPEED_TO_KMH: Record<string, number> = { "km/hr": 1, "km/h": 1, "mi/hr": 1.609344, mph: 1.609344, "m/s": 3.6 };
export const LENGTH_TO_M: Record<string, number> = { m: 1, cm: 0.01, ft: 0.3048, km: 1000, mi: 1609.344 };

export function convert(qty: number | undefined, units: string | undefined, table: Record<string, number>, fallback = 1) {
  if (qty === undefined || !Number.isFinite(qty)) return undefined;
  const factor = units ? table[units.toLowerCase()] : undefined;
  return qty * (factor ?? fallback);
}

const toHours = (v: number | undefined, units: string) =>
  v === undefined ? undefined : units.toLowerCase().startsWith("min") ? v / 60 : v;

// ─── Metric mapping ──────────────────────────────────────────────────────────

/** HAE metric name → our MetricType + canonical unit. */
const METRIC_MAP: Record<string, { type: MetricType; unit: string; energy?: boolean }> = {
  heart_rate: { type: "HEART_RATE", unit: "bpm" },
  resting_heart_rate: { type: "RESTING_HEART_RATE", unit: "bpm" },
  walking_heart_rate_average: { type: "WALKING_HEART_RATE_AVG", unit: "bpm" },
  heart_rate_variability: { type: "HEART_RATE_VARIABILITY", unit: "ms" },
  heart_rate_variability_sdnn: { type: "HEART_RATE_VARIABILITY", unit: "ms" },
  respiratory_rate: { type: "RESPIRATORY_RATE", unit: "breaths/min" },
  active_energy: { type: "ACTIVE_ENERGY", unit: "kcal", energy: true },
  basal_energy_burned: { type: "BASAL_ENERGY", unit: "kcal", energy: true },
  step_count: { type: "STEP_COUNT", unit: "count" },
  apple_exercise_time: { type: "EXERCISE_TIME", unit: "min" },
  vo2_max: { type: "VO2_MAX", unit: "ml/kg/min" },
  blood_oxygen_saturation: { type: "BLOOD_OXYGEN", unit: "%" },
};

const SLEEP_STAGE_MAP: Record<string, SleepStageType> = {
  "in bed": "IN_BED",
  inbed: "IN_BED",
  awake: "AWAKE",
  asleep: "ASLEEP",
  unspecified: "ASLEEP",
  core: "CORE",
  light: "CORE",
  deep: "DEEP",
  rem: "REM",
};

// ─── Output types ────────────────────────────────────────────────────────────

export interface MetricSampleRecord extends LocalParts {
  type: MetricType;
  timestamp: Date;
  tzOffsetMin: number;
  qty: number | null;
  min: number | null;
  avg: number | null;
  max: number | null;
  unit: string;
  source: string;
}

export interface SleepStageRecord {
  stage: SleepStageType;
  start: Date;
  end: Date;
  tzOffsetMin: number;
  source: string;
  night: Date;
}

export interface SleepSessionRecord {
  date: Date;
  tzOffsetMin: number;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  inBedStart: Date | null;
  inBedEnd: Date | null;
  inBedHours: number | null;
  totalSleep: number;
  coreHours: number;
  deepHours: number;
  remHours: number;
  awakeHours: number;
  asleepHours: number;
  source: string;
}

export interface WorkoutRecord {
  externalId: string | null;
  name: string;
  source: string;
  start: Date;
  end: Date;
  tzOffsetMin: number;
  localDate: Date;
  durationSec: number;
  activeEnergyKcal: number | null;
  distanceKm: number | null;
  avgSpeedKmh: number | null;
  elevationUpM: number | null;
  stepCount: number | null;
  intensityMet: number | null;
  avgHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  hrSeries: { t: string; min: number | null; avg: number | null; max: number | null }[] | null;
}

export interface NormalizedPayload {
  samples: MetricSampleRecord[];
  sleepSessions: SleepSessionRecord[];
  sleepStages: SleepStageRecord[];
  workouts: WorkoutRecord[];
  metricsReceived: number;
  skippedMetrics: string[];
  invalidRecords: number;
}

// ─── Normalization ───────────────────────────────────────────────────────────

/** HAE uses null liberally; strip it so optional schema fields just work. */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== null).map(([k, v]) => [k, stripNulls(v)]),
    );
  }
  return value;
}

const n = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : v);
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

export function normalizePayload(payload: HealthPayload): NormalizedPayload {
  const out: NormalizedPayload = {
    samples: [],
    sleepSessions: [],
    sleepStages: [],
    workouts: [],
    metricsReceived: payload.metrics.length,
    skippedMetrics: [],
    invalidRecords: 0,
  };

  for (const metric of payload.metrics) {
    if (metric.name === "sleep_analysis") {
      normalizeSleep(metric.data, metric.units, out);
      continue;
    }

    const mapping = METRIC_MAP[metric.name];
    if (!mapping) {
      out.skippedMetrics.push(metric.name);
      continue;
    }

    for (const raw of metric.data) {
      const record = stripNulls(raw);
      if (mapping.type === "HEART_RATE") {
        const r = MinAvgMaxSampleSchema.safeParse(record);
        const when = r.success ? parseHaeDate(r.data.date) : null;
        if (!r.success || !when || r.data.Avg === undefined) {
          out.invalidRecords++;
          continue;
        }
        out.samples.push({
          type: mapping.type,
          timestamp: when.date,
          tzOffsetMin: when.tzOffsetMin,
          ...localParts(when),
          qty: null,
          min: n(r.data.Min),
          avg: n(r.data.Avg),
          max: n(r.data.Max),
          unit: mapping.unit,
          source: r.data.source ?? "",
        });
        continue;
      }

      const r = QtySampleSchema.safeParse(record);
      const when = r.success ? parseHaeDate(r.data.date) : null;
      if (!r.success || !when) {
        out.invalidRecords++;
        continue;
      }
      const qty = mapping.energy ? convert(r.data.qty, metric.units, ENERGY_TO_KCAL) : r.data.qty;
      out.samples.push({
        type: mapping.type,
        timestamp: when.date,
        tzOffsetMin: when.tzOffsetMin,
        ...localParts(when),
        qty: n(qty),
        min: null,
        avg: null,
        max: null,
        unit: mapping.unit,
        source: r.data.source ?? "",
      });
    }
  }

  for (const raw of payload.workouts) {
    const w = normalizeWorkout(stripNulls(raw));
    if (w) out.workouts.push(w);
    else out.invalidRecords++;
  }

  return out;
}

function normalizeSleep(data: Record<string, unknown>[], units: string, out: NormalizedPayload) {
  for (const raw of data) {
    const record = stripNulls(raw);

    // Unaggregated export: one row per stage segment.
    const seg = SleepSegmentSchema.safeParse(record);
    if (seg.success) {
      const start = parseHaeDate(seg.data.startDate);
      const end = parseHaeDate(seg.data.endDate);
      const stage = SLEEP_STAGE_MAP[seg.data.value.trim().toLowerCase()];
      if (!start || !end || !stage || end.date <= start.date) {
        out.invalidRecords++;
        continue;
      }
      out.sleepStages.push({
        stage,
        start: start.date,
        end: end.date,
        tzOffsetMin: end.tzOffsetMin,
        source: seg.data.source ?? "",
        night: sleepNightKey(end),
      });
      continue;
    }

    // Aggregated export: one row per night.
    const agg = SleepAggregatedSchema.safeParse(record);
    const day = agg.success ? parseHaeDate(agg.data.date) : null;
    if (!agg.success || !day) {
      out.invalidRecords++;
      continue;
    }
    const a = agg.data;
    const parse = (s?: string) => (s ? parseHaeDate(s) : null);
    const sleepStart = parse(a.sleepStart);
    const sleepEnd = parse(a.sleepEnd);
    const inBedStart = parse(a.inBedStart);
    const inBedEnd = parse(a.inBedEnd);

    const core = toHours(a.core, units) ?? 0;
    const deep = toHours(a.deep, units) ?? 0;
    const rem = toHours(a.rem, units) ?? 0;
    const asleep = toHours(a.asleep, units) ?? 0;
    const totalSleep = toHours(a.totalSleep, units) ?? core + deep + rem + asleep;

    out.sleepSessions.push({
      date: sleepEnd ? sleepNightKey(sleepEnd) : localParts(day).localDate,
      tzOffsetMin: (sleepEnd ?? day).tzOffsetMin,
      sleepStart: sleepStart?.date ?? null,
      sleepEnd: sleepEnd?.date ?? null,
      inBedStart: inBedStart?.date ?? null,
      inBedEnd: inBedEnd?.date ?? null,
      inBedHours: n(toHours(a.inBed, units)),
      totalSleep,
      coreHours: core,
      deepHours: deep,
      remHours: rem,
      awakeHours: toHours(a.awake, units) ?? 0,
      asleepHours: asleep,
      source: a.source ?? "",
    });
  }
}

/** Roll individual stage segments up into per-night sessions (one per night + source). */
export function summarizeSleepStages(stages: SleepStageRecord[]): SleepSessionRecord[] {
  const groups = new Map<string, SleepStageRecord[]>();
  for (const s of stages) {
    const key = `${s.night.toISOString()}|${s.source}`;
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }

  const ASLEEP_STAGES: SleepStageType[] = ["CORE", "DEEP", "REM", "ASLEEP"];
  return [...groups.values()].map((segs) => {
    const hours: Record<SleepStageType, number> = { IN_BED: 0, AWAKE: 0, ASLEEP: 0, CORE: 0, DEEP: 0, REM: 0 };
    for (const s of segs) hours[s.stage] += hoursBetween(s.start, s.end);

    const asleep = segs.filter((s) => ASLEEP_STAGES.includes(s.stage));
    const inBed = segs.filter((s) => s.stage === "IN_BED");
    const minStart = (xs: SleepStageRecord[]) =>
      xs.length ? new Date(Math.min(...xs.map((x) => x.start.getTime()))) : null;
    const maxEnd = (xs: SleepStageRecord[]) =>
      xs.length ? new Date(Math.max(...xs.map((x) => x.end.getTime()))) : null;

    const inBedStart = minStart(inBed);
    const inBedEnd = maxEnd(inBed);
    const last = segs.reduce((a, b) => (b.end > a.end ? b : a));

    return {
      date: segs[0].night,
      tzOffsetMin: last.tzOffsetMin,
      sleepStart: minStart(asleep),
      sleepEnd: maxEnd(asleep),
      inBedStart,
      inBedEnd,
      inBedHours: inBedStart && inBedEnd ? hoursBetween(inBedStart, inBedEnd) : null,
      totalSleep: hours.CORE + hours.DEEP + hours.REM + hours.ASLEEP,
      coreHours: hours.CORE,
      deepHours: hours.DEEP,
      remHours: hours.REM,
      awakeHours: hours.AWAKE,
      asleepHours: hours.ASLEEP,
      source: segs[0].source,
    };
  });
}

function normalizeWorkout(record: unknown): WorkoutRecord | null {
  const r = WorkoutSchema.safeParse(record);
  if (!r.success) return null;
  const w = r.data;
  const start = parseHaeDate(w.start);
  const end = parseHaeDate(w.end);
  if (!start || !end) return null;

  const durationSec = Math.round(w.duration ?? (end.date.getTime() - start.date.getTime()) / 1000);

  const sumOrQty = (v: typeof w.activeEnergy) =>
    v === undefined ? undefined : Array.isArray(v) ? { qty: v.reduce((s, x) => s + x.qty, 0), units: undefined } : v;
  const energy = w.activeEnergyBurned ?? sumOrQty(w.activeEnergy);
  const steps = sumOrQty(w.stepCount);

  const distanceKm = convert(w.distance?.qty, w.distance?.units, DISTANCE_TO_KM);
  const speed = w.avgSpeed ?? w.speed;
  const avgSpeedKmh =
    convert(speed?.qty, speed?.units, SPEED_TO_KMH) ??
    (distanceKm && durationSec > 0 ? distanceKm / (durationSec / 3600) : undefined);

  const hrSeries = (w.heartRateData ?? [])
    .map((s) => ({ when: parseHaeDate(s.date), s }))
    .filter((x): x is { when: ParsedDate; s: (typeof x)["s"] } => x.when !== null)
    .map(({ when, s }) => ({ t: when.date.toISOString(), min: n(s.Min), avg: n(s.Avg), max: n(s.Max) }));

  // Fall back to the HR curve when the summary fields are missing.
  const avgs = hrSeries.map((p) => p.avg).filter((v): v is number => v !== null);
  const seriesAvg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : undefined;
  const seriesMax = hrSeries.reduce<number | undefined>((m, p) => {
    const v = p.max ?? p.avg;
    return v !== null && (m === undefined || v > m) ? v : m;
  }, undefined);
  const seriesMin = hrSeries.reduce<number | undefined>((m, p) => {
    const v = p.min ?? p.avg;
    return v !== null && (m === undefined || v < m) ? v : m;
  }, undefined);

  return {
    externalId: w.id ?? null,
    name: w.name,
    source: "",
    start: start.date,
    end: end.date,
    tzOffsetMin: start.tzOffsetMin,
    localDate: localParts(start).localDate,
    durationSec,
    activeEnergyKcal: n(convert(energy?.qty, energy?.units, ENERGY_TO_KCAL)),
    distanceKm: n(distanceKm),
    avgSpeedKmh: n(avgSpeedKmh),
    elevationUpM: n(
      w.elevationUp
        ? convert(w.elevationUp.qty, w.elevationUp.units, LENGTH_TO_M)
        : convert(w.elevation?.ascent, w.elevation?.units, LENGTH_TO_M),
    ),
    stepCount: n(steps?.qty),
    intensityMet: n(w.intensity?.qty),
    avgHr: n(w.heartRate?.avg?.qty ?? w.avgHeartRate?.qty ?? seriesAvg),
    minHr: n(w.heartRate?.min?.qty ?? seriesMin),
    maxHr: n(w.heartRate?.max?.qty ?? w.maxHeartRate?.qty ?? seriesMax),
    hrSeries: hrSeries.length ? hrSeries : null,
  };
}
