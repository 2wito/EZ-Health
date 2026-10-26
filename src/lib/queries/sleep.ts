import "server-only";
import { connection } from "next/server";
import type { SleepStageType } from "@/generated/prisma/enums";
import {
  bucketStart,
  eachDay,
  granularityFor,
  inWindow,
  isoDay,
  rangeWindow,
  type DayWindow,
  type Granularity,
  type RangeKey,
} from "@/lib/analytics/range";
import { consistencyScore, minutesSinceNoon, sleepScore } from "@/lib/analytics/sleep";
import { mean, splitByWindow, windowTrend, type Trend } from "@/lib/analytics/trend";
import { prisma } from "@/lib/prisma";

export type SleepNight = {
  day: string;
  /** Minutes since noon the day before (see analytics/sleep). */
  bed: number | null;
  wake: number | null;
  total: number;
  deep: number;
  core: number;
  rem: number;
  awake: number;
  /** Asleep without stage detail (older watches, third-party apps). */
  unspecified: number;
  score: number | null;
};

export interface StageSegment {
  stage: Exclude<SleepStageType, "IN_BED">;
  start: number; // minutes since noon
  end: number;
}

export interface SleepData {
  range: RangeKey;
  start: string;
  end: string;
  comparison: DayWindow["comparison"];
  /** Calendar rows: days, or week/month averages for long windows. */
  granularity: Granularity;
  /** Every day (or week/month) in the window; null where no night was recorded. */
  calendar: { day: string; night: SleepNight | null }[];
  nights: SleepNight[];
  lastNight: { night: SleepNight; segments: StageSegment[] } | null;
  averages: { total: number; deep: number; core: number; rem: number; awake: number; unspecified: number } | null;
  consistency: number | null;
  trends: { score: Trend; duration: Trend; bed: Trend; wake: Trend; consistency: Trend };
}

export type SleepResult = { ok: true; data: SleepData | null } | { ok: false; error: string };

export async function getSleepData(range: RangeKey): Promise<SleepResult> {
  await connection();
  try {
    return { ok: true, data: await load(range) };
  } catch (err) {
    console.error("[sleep] query failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface NightRow {
  id: string;
  date: Date;
  tzOffsetMin: number;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  inBedStart: Date | null;
  inBedEnd: Date | null;
  totalSleep: number;
  coreHours: number;
  deepHours: number;
  remHours: number;
  awakeHours: number;
  asleepHours: number;
}

async function load(range: RangeKey): Promise<SleepData | null> {
  const { _min, _max } = await prisma.sleepSession.aggregate({
    where: { totalSleep: { gt: 0 } },
    _min: { date: true },
    _max: { date: true },
  });
  if (!_max.date) return null;
  const w = rangeWindow(range, _max.date, _min.date);

  // Several sources can log a night (iPhone "In Bed", Watch stages, other apps):
  // keep the one that measured the most sleep.
  const rows = await prisma.$queryRaw<NightRow[]>`
    SELECT DISTINCT ON ("date")
      id, "date", "tzOffsetMin", "sleepStart", "sleepEnd", "inBedStart", "inBedEnd", "totalSleep",
      "coreHours", "deepHours", "remHours", "awakeHours", "asleepHours"
    FROM "SleepSession"
    WHERE "totalSleep" > 0 AND "date" BETWEEN ${isoDay(w.from)}::date AND ${isoDay(w.end)}::date
    ORDER BY "date", "totalSleep" DESC`;

  const toNight = (r: NightRow): SleepNight => {
    const bedAt = r.sleepStart ?? r.inBedStart;
    const wakeAt = r.sleepEnd ?? r.inBedEnd;
    return {
      day: isoDay(r.date),
      bed: bedAt ? minutesSinceNoon(bedAt, r.tzOffsetMin, r.date) : null,
      wake: wakeAt ? minutesSinceNoon(wakeAt, r.tzOffsetMin, r.date) : null,
      total: r.totalSleep,
      deep: r.deepHours,
      core: r.coreHours,
      rem: r.remHours,
      awake: r.awakeHours,
      unspecified: r.asleepHours,
      score: sleepScore({ total: r.totalSleep, deep: r.deepHours, rem: r.remHours, awake: r.awakeHours }),
    };
  };

  const current = rows.filter((r) => inWindow(r.date, w.start, w.end));
  const allNights = rows.map(toNight);
  const nights = current.map(toNight);
  const nightsIn = (from: Date, to: Date) => allNights.filter((n) => inWindow(n.day, from, to));

  const pick = (ns: SleepNight[], f: (n: SleepNight) => number | null) =>
    ns.map(f).filter((v): v is number => v !== null);
  const consistencyOf = (ns: SleepNight[]) => consistencyScore(pick(ns, (n) => n.bed), pick(ns, (n) => n.wake));
  const consistency = consistencyOf(nights);
  const asList = (v: number | null) => (v === null ? [] : [v]);
  const trend = (f: (n: SleepNight) => number | null, opts: Parameters<typeof windowTrend>[3]) =>
    windowTrend(
      ...splitByWindow(
        allNights.flatMap((n) => {
          const v = f(n);
          return v === null ? [] : [[n.day, v] as const];
        }),
        w,
      ),
      opts,
    );

  // Stage timeline for the most recent night (needs per-stage export data).
  const lastRow = current.at(-1);
  let lastNight: SleepData["lastNight"] = null;
  if (lastRow) {
    const stages = await prisma.sleepStage.findMany({
      where: { sessionId: lastRow.id, stage: { not: "IN_BED" } },
      orderBy: { start: "asc" },
      select: { stage: true, start: true, end: true, tzOffsetMin: true },
    });
    lastNight = {
      night: toNight(lastRow),
      segments: stages.map((s) => ({
        stage: s.stage as StageSegment["stage"],
        start: minutesSinceNoon(s.start, s.tzOffsetMin, lastRow.date),
        end: minutesSinceNoon(s.end, s.tzOffsetMin, lastRow.date),
      })),
    };
  }

  const avgOf = (f: (n: SleepNight) => number) => mean(nights.map(f)) ?? 0;
  const byDay = new Map(nights.map((n) => [n.day, n]));
  const granularity = granularityFor(w.days);

  return {
    range,
    start: isoDay(w.start),
    end: isoDay(w.end),
    comparison: w.comparison,
    granularity,
    calendar: bucketCalendar(
      eachDay(w.start, w.end).map((day) => ({ day, night: byDay.get(day) ?? null })),
      granularity,
    ),
    nights,
    lastNight,
    averages: nights.length
      ? {
          total: avgOf((n) => n.total),
          deep: avgOf((n) => n.deep),
          core: avgOf((n) => n.core),
          rem: avgOf((n) => n.rem),
          awake: avgOf((n) => n.awake),
          unspecified: avgOf((n) => n.unspecified),
        }
      : null,
    consistency,
    trends: {
      score: trend((n) => n.score, { better: "higher", threshold: 3 }),
      duration: trend((n) => n.total, { better: "higher", threshold: 0.25 }),
      bed: trend((n) => n.bed, { better: "neutral", threshold: 15 }),
      wake: trend((n) => n.wake, { better: "neutral", threshold: 15 }),
      consistency: windowTrend(
        asList(consistency),
        asList(consistencyOf(nightsIn(w.recentStart, w.recentEnd))),
        asList(consistencyOf(nightsIn(w.prevStart, w.prevEnd))),
        { better: "higher", threshold: 5, minPoints: 1 },
      ),
    },
  };
}

/** Week or month rows for long windows: each field is the mean of the nights recorded in it. */
function bucketCalendar(days: { day: string; night: SleepNight | null }[], g: Granularity) {
  if (g === "day") return days;
  const groups = new Map<string, SleepNight[]>();
  for (const { day, night } of days) {
    const key = bucketStart(day, g);
    const group = groups.get(key) ?? [];
    if (night) group.push(night);
    groups.set(key, group);
  }
  return [...groups].map(([day, ns]) => {
    if (!ns.length) return { day, night: null };
    const avg = (f: (n: SleepNight) => number | null) => mean(ns.map(f).filter((v): v is number => v !== null));
    const night: SleepNight = {
      day,
      bed: avg((n) => n.bed),
      wake: avg((n) => n.wake),
      total: avg((n) => n.total) ?? 0,
      deep: avg((n) => n.deep) ?? 0,
      core: avg((n) => n.core) ?? 0,
      rem: avg((n) => n.rem) ?? 0,
      awake: avg((n) => n.awake) ?? 0,
      unspecified: avg((n) => n.unspecified) ?? 0,
      score: avg((n) => n.score),
    };
    return { day, night };
  });
}
