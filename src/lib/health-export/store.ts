import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  sleepNightKey,
  summarizeSleepStages,
  type MetricSampleRecord,
  type SleepSessionRecord,
  type SleepStageRecord,
  type WorkoutRecord,
} from "./normalize";

// Idempotent writers shared by the webhook and the export.xml importer.

const CHUNK = 5_000;
const DAY_MS = 86_400_000;

/**
 * Bulk upsert via unnest(). Health Auto Export re-sends overlapping windows and
 * the current hour's aggregate grows over time, so later values must overwrite
 * earlier ones — createMany({ skipDuplicates }) would keep stale numbers.
 */
export async function upsertSamples(samples: MetricSampleRecord[]): Promise<number> {
  // ON CONFLICT can't touch the same row twice in one statement: dedupe, last wins.
  const unique = [
    ...new Map(samples.map((s) => [`${s.type}|${s.timestamp.toISOString()}|${s.source}`, s])).values(),
  ];

  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = unique.slice(i, i + CHUNK);
    const col = <T>(f: (s: MetricSampleRecord) => T) => rows.map(f);
    await prisma.$executeRaw`
      INSERT INTO "MetricSample"
        ("id", "type", "timestamp", "tzOffsetMin", "localDate", "localHour", "localWeekday",
         "qty", "min", "avg", "max", "unit", "source")
      SELECT * FROM unnest(
        ${col(() => randomUUID())}::text[],
        ${col((s) => s.type)}::text[]::"MetricType"[],
        ${col((s) => s.timestamp.toISOString())}::timestamptz[],
        ${col((s) => s.tzOffsetMin)}::int[],
        ${col((s) => s.localDate.toISOString().slice(0, 10))}::date[],
        ${col((s) => s.localHour)}::smallint[],
        ${col((s) => s.localWeekday)}::smallint[],
        ${col((s) => s.qty)}::float8[],
        ${col((s) => s.min)}::float8[],
        ${col((s) => s.avg)}::float8[],
        ${col((s) => s.max)}::float8[],
        ${col((s) => s.unit)}::text[],
        ${col((s) => s.source)}::text[]
      )
      ON CONFLICT ("type", "timestamp", "source") DO UPDATE SET
        "tzOffsetMin" = EXCLUDED."tzOffsetMin",
        "localDate" = EXCLUDED."localDate",
        "localHour" = EXCLUDED."localHour",
        "localWeekday" = EXCLUDED."localWeekday",
        "qty" = EXCLUDED."qty",
        "min" = EXCLUDED."min",
        "avg" = EXCLUDED."avg",
        "max" = EXCLUDED."max",
        "unit" = EXCLUDED."unit"`;
  }
  return unique.length;
}

/**
 * Bulk upsert keyed on (date, source). One statement per chunk instead of a
 * row-by-row transaction, which blew Prisma's 5 s transaction limit on years
 * of history. Returns the row id for each "date|source".
 */
export async function upsertSleepSessions(sessions: SleepSessionRecord[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const unique = [...new Map(sessions.map((s) => [sessionKey(s.date, s.source), s])).values()];
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = unique.slice(i, i + CHUNK);
    const col = <T>(f: (s: SleepSessionRecord) => T) => rows.map(f);
    const saved = await prisma.$queryRaw<{ id: string; date: Date; source: string }[]>`
      INSERT INTO "SleepSession"
        ("id", "date", "tzOffsetMin", "sleepStart", "sleepEnd", "inBedStart", "inBedEnd", "inBedHours",
         "totalSleep", "coreHours", "deepHours", "remHours", "awakeHours", "asleepHours", "source", "updatedAt")
      SELECT u.*, now() FROM unnest(
        ${col(() => randomUUID())}::text[],
        ${col((s) => s.date.toISOString().slice(0, 10))}::date[],
        ${col((s) => s.tzOffsetMin)}::int[],
        ${col((s) => iso(s.sleepStart))}::timestamptz[],
        ${col((s) => iso(s.sleepEnd))}::timestamptz[],
        ${col((s) => iso(s.inBedStart))}::timestamptz[],
        ${col((s) => iso(s.inBedEnd))}::timestamptz[],
        ${col((s) => s.inBedHours)}::float8[],
        ${col((s) => s.totalSleep)}::float8[],
        ${col((s) => s.coreHours)}::float8[],
        ${col((s) => s.deepHours)}::float8[],
        ${col((s) => s.remHours)}::float8[],
        ${col((s) => s.awakeHours)}::float8[],
        ${col((s) => s.asleepHours)}::float8[],
        ${col((s) => s.source)}::text[]
      ) AS u
      ON CONFLICT ("date", "source") DO UPDATE SET
        "tzOffsetMin" = EXCLUDED."tzOffsetMin",
        "sleepStart" = EXCLUDED."sleepStart",
        "sleepEnd" = EXCLUDED."sleepEnd",
        "inBedStart" = EXCLUDED."inBedStart",
        "inBedEnd" = EXCLUDED."inBedEnd",
        "inBedHours" = EXCLUDED."inBedHours",
        "totalSleep" = EXCLUDED."totalSleep",
        "coreHours" = EXCLUDED."coreHours",
        "deepHours" = EXCLUDED."deepHours",
        "remHours" = EXCLUDED."remHours",
        "awakeHours" = EXCLUDED."awakeHours",
        "asleepHours" = EXCLUDED."asleepHours",
        "updatedAt" = now()
      RETURNING "id", "date", "source"`;
    for (const s of saved) ids.set(sessionKey(s.date, s.source), s.id);
  }
  return ids;
}

const sessionKey = (night: Date, source: string) => `${night.toISOString()}|${source}`;

/**
 * Stores stage segments, then rebuilds the nightly summary for every
 * (night, source) touched — from *all* stored segments, since one night can
 * arrive split across several webhook calls.
 * Returns the number of nights rebuilt.
 */
export async function upsertSleepStages(stages: SleepStageRecord[]): Promise<number> {
  if (stages.length === 0) return 0;

  for (let i = 0; i < stages.length; i += CHUNK) {
    await prisma.sleepStage.createMany({
      data: stages.slice(i, i + CHUNK).map((s) => ({
        stage: s.stage,
        start: s.start,
        end: s.end,
        tzOffsetMin: s.tzOffsetMin,
        source: s.source,
      })),
      skipDuplicates: true,
    });
  }

  const nightKey = sessionKey;
  const touched = new Set(stages.map((s) => nightKey(s.night, s.source)));
  // reduce, not Math.min(...): a full export has far more segments than the argument limit.
  let first = Infinity;
  let last = -Infinity;
  for (const s of stages) {
    first = Math.min(first, s.night.getTime());
    last = Math.max(last, s.night.getTime());
  }
  const stored = await prisma.sleepStage.findMany({
    where: {
      source: { in: [...new Set(stages.map((s) => s.source))] },
      end: { gte: new Date(first - 2 * DAY_MS), lte: new Date(last + 2 * DAY_MS) },
    },
  });

  const relevant = stored
    .map((s) => ({ ...s, night: sleepNightKey({ date: s.end, tzOffsetMin: s.tzOffsetMin }) }))
    .filter((s) => touched.has(nightKey(s.night, s.source)));

  const sessions = summarizeSleepStages(relevant);
  const sessionIds = await upsertSleepSessions(sessions);

  // Link every segment to its night in bulk.
  const links = relevant.map((s) => [s.id, sessionIds.get(nightKey(s.night, s.source))!] as const);
  for (let i = 0; i < links.length; i += CHUNK) {
    const chunk = links.slice(i, i + CHUNK);
    await prisma.$executeRaw`
      UPDATE "SleepStage" AS st SET "sessionId" = l.session_id
      FROM unnest(${chunk.map((l) => l[0])}::text[], ${chunk.map((l) => l[1])}::text[]) AS l(stage_id, session_id)
      WHERE st.id = l.stage_id`;
  }
  return sessions.length;
}

/**
 * Upsert by start time. On update, null fields are left alone so one source
 * can't wipe what another provided (e.g. the XML has no HR curve, the webhook does).
 */
export async function upsertWorkouts(workouts: WorkoutRecord[]): Promise<number> {
  for (const w of workouts) {
    const { hrSeries, ...fields } = w;
    const create = { ...fields, hrSeries: hrSeries ?? Prisma.DbNull };
    const update = Object.fromEntries(Object.entries({ ...fields, hrSeries }).filter(([, v]) => v !== null));
    await prisma.workout.upsert({ where: { start: w.start }, create, update });
  }
  return workouts.length;
}

export interface DailyActivityRecord {
  date: Date;
  activeEnergyKcal: number | null;
  activeEnergyGoal: number | null;
  exerciseMin: number | null;
  exerciseGoalMin: number | null;
  standHours: number | null;
  standGoalHours: number | null;
}

export async function upsertDailyActivity(days: DailyActivityRecord[]): Promise<number> {
  const unique = [...new Map(days.map((d) => [d.date.getTime(), d])).values()];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = unique.slice(i, i + CHUNK);
    const col = <T>(f: (d: DailyActivityRecord) => T) => rows.map(f);
    await prisma.$executeRaw`
      INSERT INTO "DailyActivity"
        ("date", "activeEnergyKcal", "activeEnergyGoal", "exerciseMin", "exerciseGoalMin",
         "standHours", "standGoalHours", "updatedAt")
      SELECT u.*, now() FROM unnest(
        ${col((d) => d.date.toISOString().slice(0, 10))}::date[],
        ${col((d) => d.activeEnergyKcal)}::float8[],
        ${col((d) => d.activeEnergyGoal)}::float8[],
        ${col((d) => d.exerciseMin)}::float8[],
        ${col((d) => d.exerciseGoalMin)}::float8[],
        ${col((d) => d.standHours)}::float8[],
        ${col((d) => d.standGoalHours)}::float8[]
      ) AS u
      ON CONFLICT ("date") DO UPDATE SET
        "activeEnergyKcal" = EXCLUDED."activeEnergyKcal",
        "activeEnergyGoal" = EXCLUDED."activeEnergyGoal",
        "exerciseMin" = EXCLUDED."exerciseMin",
        "exerciseGoalMin" = EXCLUDED."exerciseGoalMin",
        "standHours" = EXCLUDED."standHours",
        "standGoalHours" = EXCLUDED."standGoalHours",
        "updatedAt" = now()`;
  }
  return unique.length;
}
