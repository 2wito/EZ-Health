import "server-only";
import { connection } from "next/server";
import type { SleepStageType } from "@/generated/prisma/enums";
import { eachDay, inWindow, isoDay, RANGES, windowEnding, type RangeKey } from "@/lib/analytics/range";
import { consistencyScore, minutesSinceNoon, sleepScore } from "@/lib/analytics/sleep";
import { computeTrend, mean, type Trend } from "@/lib/analytics/trend";
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
  /** Every day in the window; null where no night was recorded. */
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
  const latest = await prisma.sleepSession.findFirst({
    where: { totalSleep: { gt: 0 } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return null;
  const w = windowEnding(latest.date, RANGES[range]);

  // Several sources can log a night (iPhone "In Bed", Watch stages, other apps):
  // keep the one that measured the most sleep.
  const rows = await prisma.$queryRaw<NightRow[]>`
    SELECT DISTINCT ON ("date")
      id, "date", "tzOffsetMin", "sleepStart", "sleepEnd", "inBedStart", "inBedEnd", "totalSleep",
      "coreHours", "deepHours", "remHours", "awakeHours", "asleepHours"
    FROM "SleepSession"
    WHERE "totalSleep" > 0 AND "date" BETWEEN ${isoDay(w.prevStart)}::date AND ${isoDay(w.end)}::date
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
  const previous = rows.filter((r) => inWindow(r.date, w.prevStart, w.prevEnd));
  const nights = current.map(toNight);
  const prevNights = previous.map(toNight);

  const pick = (ns: SleepNight[], f: (n: SleepNight) => number | null) =>
    ns.map(f).filter((v): v is number => v !== null);
  const consistencyOf = (ns: SleepNight[]) => consistencyScore(pick(ns, (n) => n.bed), pick(ns, (n) => n.wake));
  const consistency = consistencyOf(nights);
  const prevConsistency = consistencyOf(prevNights);

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

  return {
    range,
    start: isoDay(w.start),
    end: isoDay(w.end),
    calendar: eachDay(w.start, w.end).map((day) => ({ day, night: byDay.get(day) ?? null })),
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
      score: computeTrend(pick(nights, (n) => n.score), pick(prevNights, (n) => n.score), { better: "higher", threshold: 3 }),
      duration: computeTrend(pick(nights, (n) => n.total), pick(prevNights, (n) => n.total), { better: "higher", threshold: 0.25 }),
      bed: computeTrend(pick(nights, (n) => n.bed), pick(prevNights, (n) => n.bed), { better: "neutral", threshold: 15 }),
      wake: computeTrend(pick(nights, (n) => n.wake), pick(prevNights, (n) => n.wake), { better: "neutral", threshold: 15 }),
      consistency: computeTrend(
        consistency === null ? [] : [consistency],
        prevConsistency === null ? [] : [prevConsistency],
        { better: "higher", threshold: 5, minPoints: 1 },
      ),
    },
  };
}
