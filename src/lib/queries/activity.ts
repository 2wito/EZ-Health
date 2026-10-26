import "server-only";
import { connection } from "next/server";
import { isRun, metresPerBeat, paceMinPerKm } from "@/lib/analytics/activity";
import { inWindow, isoDay, rangeWindow, type DayWindow, type RangeKey } from "@/lib/analytics/range";
import { mean, splitByWindow, windowTrend, type Trend } from "@/lib/analytics/trend";
import { prisma } from "@/lib/prisma";
import { getEvaluation, type Evaluation } from "./evaluation";

export interface WorkoutRow {
  id: string;
  day: string;
  start: string;
  tzOffsetMin: number;
  name: string;
  durationMin: number;
  distanceKm: number | null;
  speedKmh: number | null;
  avgHr: number | null;
  maxHr: number | null;
  kcal: number | null;
  elevationM: number | null;
  /** metres per heartbeat, runs only */
  efficiency: number | null;
}

export interface HeatCell {
  weekday: number; // 0 = Sunday
  hour: number;
  kcal: number; // average active kcal in that hour on that weekday
}

export interface ActivityData {
  range: RangeKey;
  start: string;
  end: string;
  comparison: DayWindow["comparison"];
  workouts: WorkoutRow[];
  heatmap: HeatCell[];
  /** Average active kcal per day, by weekday (days with data only). */
  byWeekday: { weekday: number; kcal: number; days: number }[];
  trends: { count: Trend; minutes: Trend; energy: Trend; pace: Trend };
  evaluation: Evaluation | null;
}

export type ActivityResult = { ok: true; data: ActivityData | null } | { ok: false; error: string };

export async function getActivityData(range: RangeKey): Promise<ActivityResult> {
  await connection();
  try {
    return { ok: true, data: await load(range) };
  } catch (err) {
    console.error("[activity] query failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function load(range: RangeKey): Promise<ActivityData | null> {
  const [bounds] = await prisma.$queryRaw<{ first: Date | null; last: Date | null }[]>`
    SELECT
      LEAST(
        (SELECT min("localDate") FROM "MetricSample" WHERE type = 'ACTIVE_ENERGY'::"MetricType"),
        (SELECT min("localDate") FROM "Workout")
      ) AS first,
      GREATEST(
        (SELECT max("localDate") FROM "MetricSample" WHERE type = 'ACTIVE_ENERGY'::"MetricType"),
        (SELECT max("localDate") FROM "Workout")
      ) AS last`;
  if (!bounds?.last) return null;
  const w = rangeWindow(range, bounds.last, bounds.first);

  const [workouts, hours, evaluation] = await Promise.all([
    prisma.workout.findMany({
      where: { localDate: { gte: w.from, lte: w.end } },
      orderBy: { start: "desc" },
    }),
    // Hourly active energy; where several sources cover an hour (Watch + iPhone),
    // count the hour once, using the larger source, like the Health app's de-duplication.
    prisma.$queryRaw<{ day: Date; hour: number; weekday: number; kcal: number }[]>`
      SELECT day, hour, weekday, max(kcal)::float8 AS kcal FROM (
        SELECT "localDate" AS day, "localHour" AS hour, "localWeekday" AS weekday, source, sum(qty) AS kcal
        FROM "MetricSample"
        WHERE type = 'ACTIVE_ENERGY'::"MetricType" AND qty IS NOT NULL
          AND "localDate" BETWEEN ${isoDay(w.from)}::date AND ${isoDay(w.end)}::date
        GROUP BY 1, 2, 3, 4
      ) per_source
      GROUP BY 1, 2, 3`,
    getEvaluation(),
  ]);
  // Totals (workout count, minutes) are only comparable when data covers the
  // whole comparison span; a half-covered window would look like a big jump.
  const prevCovered = !!bounds.first && isoDay(bounds.first) <= isoDay(w.prevStart);

  const rows: WorkoutRow[] = workouts.map((wo) => ({
    id: wo.id,
    day: isoDay(wo.localDate),
    start: wo.start.toISOString(),
    tzOffsetMin: wo.tzOffsetMin,
    name: wo.name,
    durationMin: wo.durationSec / 60,
    distanceKm: wo.distanceKm,
    speedKmh: wo.avgSpeedKmh,
    avgHr: wo.avgHr,
    maxHr: wo.maxHr,
    kcal: wo.activeEnergyKcal,
    elevationM: wo.elevationUpM,
    efficiency: isRun(wo.name) ? metresPerBeat(wo.avgSpeedKmh, wo.avgHr) : null,
  }));
  const current = rows.filter((r) => inWindow(r.day, w.start, w.end));
  const recent = rows.filter((r) => inWindow(r.day, w.recentStart, w.recentEnd));
  const previous = rows.filter((r) => inWindow(r.day, w.prevStart, w.prevEnd));

  // Daily active-energy totals, current vs previous window.
  const dayTotals = new Map<string, { kcal: number; weekday: number }>();
  for (const h of hours) {
    const day = isoDay(h.day);
    const t = dayTotals.get(day) ?? { kcal: 0, weekday: h.weekday };
    t.kcal += h.kcal;
    dayTotals.set(day, t);
  }

  // Heatmap: average kcal per (weekday, hour), dividing by how many of that
  // weekday had any data, so quiet hours count as zero rather than missing.
  const daysPerWeekday = new Map<number, number>();
  for (const [day, t] of dayTotals) if (inWindow(day, w.start, w.end)) daysPerWeekday.set(t.weekday, (daysPerWeekday.get(t.weekday) ?? 0) + 1);
  const sums = new Map<string, number>();
  for (const h of hours) {
    if (!inWindow(h.day, w.start, w.end)) continue;
    const key = `${h.weekday}|${h.hour}`;
    sums.set(key, (sums.get(key) ?? 0) + h.kcal);
  }
  const heatmap: HeatCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const n = daysPerWeekday.get(weekday) ?? 0;
    for (let hour = 0; hour < 24; hour++) {
      heatmap.push({ weekday, hour, kcal: n ? (sums.get(`${weekday}|${hour}`) ?? 0) / n : 0 });
    }
  }
  const byWeekday = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const totals = [...dayTotals]
      .filter(([day, t]) => t.weekday === weekday && inWindow(day, w.start, w.end))
      .map(([, t]) => t.kcal);
    return { weekday, kcal: mean(totals) ?? 0, days: totals.length };
  });

  const runPaces = (rs: WorkoutRow[]) =>
    rs.filter((r) => isRun(r.name) && r.speedKmh).map((r) => paceMinPerKm(r.speedKmh!));
  const sumMinutes = (rs: WorkoutRow[]) => [rs.reduce((a, r) => a + r.durationMin, 0)];

  return {
    range,
    start: isoDay(w.start),
    end: isoDay(w.end),
    comparison: w.comparison,
    workouts: current,
    heatmap,
    byWeekday,
    trends: {
      // Totals swing with the calendar (a 30-day window holds 4 or 5 Saturdays),
      // so count a change only past ~10% of the previous period.
      count: windowTrend([current.length], [recent.length], prevCovered ? [previous.length] : [], {
        better: "higher",
        threshold: Math.max(2, previous.length * 0.1),
        minPoints: 1,
      }),
      minutes: windowTrend(sumMinutes(current), sumMinutes(recent), prevCovered ? sumMinutes(previous) : [], {
        better: "higher",
        threshold: Math.max(20, sumMinutes(previous)[0] * 0.1),
        minPoints: 1,
      }),
      energy: windowTrend(
        ...splitByWindow([...dayTotals].map(([day, t]) => [day, t.kcal] as const), w),
        { better: "higher", threshold: 25 },
      ),
      pace: windowTrend(runPaces(current), runPaces(recent), runPaces(previous), { better: "lower", threshold: 0.1 }),
    },
    evaluation,
  };
}
