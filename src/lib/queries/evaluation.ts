import "server-only";
import { isRun, metresPerBeat } from "@/lib/analytics/activity";
import { addDays, eachDay, inWindow, isoDay } from "@/lib/analytics/range";
import { computeTrend, type Trend, type TrendOptions } from "@/lib/analytics/trend";
import { prisma } from "@/lib/prisma";

// Health Trend Evaluator: is fitness / recovery trending up or down over the
// last 7, 30 and 90 days? Each horizon compares the latest N days with the N
// days before, per signal, then combines the signals' verdicts.

export const HORIZONS = [7, 30, 90] as const;

export interface Signal {
  key: string;
  label: string;
  group: "Fitness" | "Recovery";
  trend: Trend;
  unit: string;
  digits: number;
}

export interface HorizonAssessment {
  days: number;
  /** -1…1: mean of improving (+1) / stable (0) / declining (−1) across signals with enough data. */
  score: number | null;
  overall: "up" | "steady" | "down" | null;
  signals: Signal[];
}

export interface Evaluation {
  end: string;
  horizons: HorizonAssessment[];
}

export async function getEvaluation(): Promise<Evaluation | null> {
  const [anchor] = await prisma.$queryRaw<{ d: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max("localDate") FROM "MetricSample"),
      (SELECT max("localDate") FROM "Workout"),
      (SELECT max("date") FROM "SleepSession")
    ) AS d`;
  if (!anchor?.d) return null;

  const end = anchor.d;
  const from = addDays(end, -(2 * 90 - 1));

  const [daily, sleep, workouts] = await Promise.all([
    prisma.$queryRaw<{ type: string; day: Date; value: number }[]>`
      SELECT type::text AS type, "localDate" AS day, avg(qty)::float8 AS value
      FROM "MetricSample"
      WHERE type = ANY(ARRAY['RESTING_HEART_RATE', 'HEART_RATE_VARIABILITY', 'VO2_MAX']::"MetricType"[])
        AND qty IS NOT NULL AND "localDate" BETWEEN ${isoDay(from)}::date AND ${isoDay(end)}::date
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ day: Date; total: number }[]>`
      SELECT "date" AS day, max("totalSleep")::float8 AS total FROM "SleepSession"
      WHERE "totalSleep" > 0 AND "date" BETWEEN ${isoDay(from)}::date AND ${isoDay(end)}::date
      GROUP BY 1`,
    prisma.workout.findMany({
      where: { localDate: { gte: from, lte: end } },
      select: { localDate: true, name: true, durationSec: true, avgSpeedKmh: true, avgHr: true },
    }),
  ]);

  const series = (type: string) =>
    daily.filter((r) => r.type === type).map((r) => ({ day: isoDay(r.day), value: r.value }));
  const sleepSeries = sleep.map((r) => ({ day: isoDay(r.day), value: r.total }));
  const efficiency = workouts
    .filter((w) => isRun(w.name))
    .map((w) => ({ day: isoDay(w.localDate), value: metresPerBeat(w.avgSpeedKmh, w.avgHr) }))
    .filter((p): p is { day: string; value: number } => p.value !== null);
  // Training minutes per day, zeros included so rest days count, but only
  // from the first recorded workout (days before that are "no data", not rest).
  const minutesByDay = new Map<string, number>();
  for (const w of workouts) {
    const day = isoDay(w.localDate);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + w.durationSec / 60);
  }
  const firstWorkout = [...minutesByDay.keys()].sort()[0];
  const volume = eachDay(from, end)
    .filter((day) => firstWorkout !== undefined && day >= firstWorkout)
    .map((day) => ({ day, value: minutesByDay.get(day) ?? 0 }));
  const hasWorkouts = workouts.length > 0;

  type Def = { key: string; label: string; group: Signal["group"]; unit: string; digits: number; points: { day: string; value: number }[]; opts: TrendOptions };
  const defs: Def[] = [
    { key: "efficiency", label: "Running efficiency", group: "Fitness", unit: "m/beat", digits: 2, points: efficiency, opts: { better: "higher", threshold: 0.02 } },
    ...(hasWorkouts
      ? [{ key: "volume", label: "Training time", group: "Fitness", unit: "min/day", digits: 0, points: volume, opts: { better: "higher", threshold: 3 } } as Def]
      : []),
    { key: "vo2", label: "VO2 max", group: "Fitness", unit: "ml/kg/min", digits: 1, points: series("VO2_MAX"), opts: { better: "higher", threshold: 0.5 } },
    { key: "rhr", label: "Resting heart rate", group: "Recovery", unit: "bpm", digits: 0, points: series("RESTING_HEART_RATE"), opts: { better: "lower", threshold: 1 } },
    { key: "hrv", label: "HRV", group: "Recovery", unit: "ms", digits: 0, points: series("HEART_RATE_VARIABILITY"), opts: { better: "higher", threshold: 3 } },
    { key: "sleep", label: "Sleep duration", group: "Recovery", unit: "h", digits: 1, points: sleepSeries, opts: { better: "higher", threshold: 0.25 } },
  ];

  const horizons = HORIZONS.map((days): HorizonAssessment => {
    const start = addDays(end, -(days - 1));
    const prevStart = addDays(start, -days);
    const prevEnd = addDays(start, -1);
    const signals: Signal[] = defs
      .filter((d) => d.points.length > 0)
      .map((d) => ({
        key: d.key,
        label: d.label,
        group: d.group,
        unit: d.unit,
        digits: d.digits,
        trend: computeTrend(
          d.points.filter((p) => inWindow(p.day, start, end)).map((p) => p.value),
          d.points.filter((p) => inWindow(p.day, prevStart, prevEnd)).map((p) => p.value),
          d.opts,
        ),
      }));
    const votes = signals
      .map((s) => s.trend.verdict)
      .filter((v) => v !== null)
      .map((v) => (v === "improving" ? 1 : v === "declining" ? -1 : 0));
    const score = votes.length >= 2 ? votes.reduce((a: number, b) => a + b, 0) / votes.length : null;
    return {
      days,
      score,
      overall: score === null ? null : score >= 0.34 ? "up" : score <= -0.34 ? "down" : "steady",
      signals,
    };
  });

  return { end: isoDay(end), horizons };
}
