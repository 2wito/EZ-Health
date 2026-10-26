import "server-only";
import { connection } from "next/server";
import { computeTrend, type Trend } from "@/lib/analytics/trend";
import { eachDay, inWindow, isoDay, RANGES, windowEnding, type RangeKey } from "@/lib/analytics/range";
import { prisma } from "@/lib/prisma";

// A type alias (not an interface) so rows can be passed straight to the chart's Record-typed data.
export type HeartDay = {
  day: string;
  resting: number | null;
  /** Mean of that day's workout average HRs. */
  workout: number | null;
  hrv: number | null;
  breathing: number | null;
};

export interface HeartWorkout {
  day: string;
  name: string;
  avgHr: number;
  maxHr: number | null;
  durationMin: number;
}

export interface HeartData {
  range: RangeKey;
  start: string;
  end: string;
  days: HeartDay[];
  workouts: HeartWorkout[];
  trends: { resting: Trend; workout: Trend; hrv: Trend; breathing: Trend };
}

export type HeartResult = { ok: true; data: HeartData | null } | { ok: false; error: string };

export async function getHeartData(range: RangeKey): Promise<HeartResult> {
  await connection();
  try {
    return { ok: true, data: await load(range) };
  } catch (err) {
    console.error("[heart] query failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function load(range: RangeKey): Promise<HeartData | null> {
  const [anchor] = await prisma.$queryRaw<{ d: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max("localDate") FROM "MetricSample"
        WHERE type = ANY(ARRAY['RESTING_HEART_RATE', 'HEART_RATE_VARIABILITY', 'RESPIRATORY_RATE']::"MetricType"[])),
      (SELECT max("localDate") FROM "Workout" WHERE "avgHr" IS NOT NULL)
    ) AS d`;
  if (!anchor?.d) return null;

  const w = windowEnding(anchor.d, RANGES[range]);

  // Daily means across sources; covers the previous window too, for trends.
  const [rows, workouts] = await Promise.all([
    prisma.$queryRaw<{ type: string; day: Date; value: number }[]>`
      SELECT type::text AS type, "localDate" AS day, avg(qty)::float8 AS value
      FROM "MetricSample"
      WHERE type = ANY(ARRAY['RESTING_HEART_RATE', 'HEART_RATE_VARIABILITY', 'RESPIRATORY_RATE']::"MetricType"[])
        AND qty IS NOT NULL
        AND "localDate" BETWEEN ${isoDay(w.prevStart)}::date AND ${isoDay(w.end)}::date
      GROUP BY 1, 2`,
    prisma.workout.findMany({
      where: { localDate: { gte: w.prevStart, lte: w.end }, avgHr: { not: null } },
      select: { localDate: true, name: true, avgHr: true, maxHr: true, durationSec: true },
      orderBy: { start: "asc" },
    }),
  ]);

  const byType = (type: string) => new Map(rows.filter((r) => r.type === type).map((r) => [isoDay(r.day), r.value]));
  const resting = byType("RESTING_HEART_RATE");
  const hrv = byType("HEART_RATE_VARIABILITY");
  const breathing = byType("RESPIRATORY_RATE");

  const workoutHrByDay = new Map<string, number[]>();
  for (const wo of workouts) {
    const day = isoDay(wo.localDate);
    workoutHrByDay.set(day, [...(workoutHrByDay.get(day) ?? []), wo.avgHr!]);
  }
  const avg = (xs: number[] | undefined) => (xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const days: HeartDay[] = eachDay(w.start, w.end).map((day) => ({
    day,
    resting: resting.get(day) ?? null,
    workout: avg(workoutHrByDay.get(day)),
    hrv: hrv.get(day) ?? null,
    breathing: breathing.get(day) ?? null,
  }));

  // Split a day-keyed map into current / previous window values.
  const split = (m: Map<string, number>) => {
    const cur: number[] = [];
    const prev: number[] = [];
    for (const [day, v] of m) {
      if (inWindow(day, w.start, w.end)) cur.push(v);
      else if (inWindow(day, w.prevStart, w.prevEnd)) prev.push(v);
    }
    return [cur, prev] as const;
  };
  const workoutHrs = (from: Date, to: Date) =>
    workouts.filter((wo) => inWindow(wo.localDate, from, to)).map((wo) => wo.avgHr!);

  return {
    range,
    start: isoDay(w.start),
    end: isoDay(w.end),
    days,
    workouts: workouts
      .filter((wo) => inWindow(wo.localDate, w.start, w.end))
      .map((wo) => ({
        day: isoDay(wo.localDate),
        name: wo.name,
        avgHr: wo.avgHr!,
        maxHr: wo.maxHr,
        durationMin: Math.round(wo.durationSec / 60),
      })),
    trends: {
      // Thresholds ≈ ordinary day-to-day variation for each metric.
      resting: computeTrend(...split(resting), { better: "lower", threshold: 1 }),
      // Workout HR depends on what you did, so it's reported without a verdict.
      workout: computeTrend(workoutHrs(w.start, w.end), workoutHrs(w.prevStart, w.prevEnd), {
        better: "neutral",
        threshold: 3,
      }),
      hrv: computeTrend(...split(hrv), { better: "higher", threshold: 3 }),
      breathing: computeTrend(...split(breathing), { better: "lower", threshold: 0.5 }),
    },
  };
}
