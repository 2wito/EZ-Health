import "server-only";
import { isRun, paceLabel } from "@/lib/analytics/activity";
import { addDays, isoDay } from "@/lib/analytics/range";
import { computeReadiness, type Readiness } from "@/lib/analytics/readiness";
import { clockLabel, durationLabel, minutesSinceNoon } from "@/lib/analytics/sleep";
import { mean } from "@/lib/analytics/trend";
import { createFormat } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getEvaluation, type Evaluation } from "@/lib/queries/evaluation";

// Everything the coach knows, computed with the same code as the dashboards so
// the advice and the charts never disagree. Only this summary is sent to the
// AI provider — never the raw samples.

export interface CoachSnapshot {
  asOf: string;
  readiness: Readiness | null;
  today: {
    hrv: number | null;
    hrvBaseline: number | null;
    rhr: number | null;
    rhrBaseline: number | null;
    sleep: { hours: number; bed: string | null; wake: string | null } | null;
  };
  evaluation: Evaluation | null;
  workouts: { day: string; name: string; minutes: number; km: number | null; pace: string | null; avgHr: number | null }[];
  weeks: { ending: string; workouts: number; minutes: number; runKm: number }[];
  sleepWeek: { avgHours: number; avgBed: string | null; avgWake: string | null; nights: number } | null;
  maxHrSeen: number | null;
}

export async function getCoachSnapshot(): Promise<CoachSnapshot | null> {
  const [anchor] = await prisma.$queryRaw<{ d: Date | null }[]>`
    SELECT GREATEST(
      (SELECT max("localDate") FROM "MetricSample"),
      (SELECT max("localDate") FROM "Workout"),
      (SELECT max("date") FROM "SleepSession")
    ) AS d`;
  if (!anchor?.d) return null;
  const end = anchor.d;
  const from = addDays(end, -30);

  const [daily, nights, workouts, maxHr, evaluation] = await Promise.all([
    prisma.$queryRaw<{ type: string; day: Date; value: number }[]>`
      SELECT type::text AS type, "localDate" AS day, avg(qty)::float8 AS value FROM "MetricSample"
      WHERE type = ANY(ARRAY['RESTING_HEART_RATE', 'HEART_RATE_VARIABILITY']::"MetricType"[])
        AND qty IS NOT NULL AND "localDate" BETWEEN ${isoDay(from)}::date AND ${isoDay(end)}::date
      GROUP BY 1, 2 ORDER BY 2`,
    prisma.$queryRaw<{ date: Date; tzOffsetMin: number; totalSleep: number; sleepStart: Date | null; sleepEnd: Date | null }[]>`
      SELECT DISTINCT ON ("date") "date", "tzOffsetMin", "totalSleep", "sleepStart", "sleepEnd" FROM "SleepSession"
      WHERE "totalSleep" > 0 AND "date" BETWEEN ${isoDay(addDays(end, -6))}::date AND ${isoDay(end)}::date
      ORDER BY "date" DESC, "totalSleep" DESC`,
    prisma.workout.findMany({
      where: { localDate: { gte: addDays(end, -27), lte: end } },
      orderBy: { start: "desc" },
      select: { localDate: true, name: true, durationSec: true, distanceKm: true, avgSpeedKmh: true, avgHr: true },
    }),
    prisma.workout.aggregate({ where: { localDate: { gte: addDays(end, -89) } }, _max: { maxHr: true } }),
    getEvaluation(),
  ]);

  // Latest reading vs the 30 days before it.
  const latestVsBaseline = (type: string) => {
    const rows = daily.filter((r) => r.type === type);
    const last = rows.at(-1);
    if (!last) return { latest: null, baseline: null };
    const base = mean(rows.slice(0, -1).map((r) => r.value));
    return { latest: last.value, baseline: base };
  };
  const hrv = latestVsBaseline("HEART_RATE_VARIABILITY");
  const rhr = latestVsBaseline("RESTING_HEART_RATE");

  // Last night only counts if it's the most recent day of data.
  const lastNight = nights[0] && isoDay(nights[0].date) >= isoDay(addDays(end, -1)) ? nights[0] : null;
  const clockOf = (at: Date | null, n: (typeof nights)[number]) => (at ? clockLabel(minutesSinceNoon(at, n.tzOffsetMin, n.date)) : null);
  const minsOf = (pick: "sleepStart" | "sleepEnd") =>
    nights.filter((n) => n[pick]).map((n) => minutesSinceNoon(n[pick]!, n.tzOffsetMin, n.date));

  const readiness = computeReadiness({
    hrv: hrv.latest !== null && hrv.baseline !== null ? { latest: hrv.latest, baseline: hrv.baseline } : null,
    rhr: rhr.latest !== null && rhr.baseline !== null ? { latest: rhr.latest, baseline: rhr.baseline } : null,
    sleepHours: lastNight?.totalSleep ?? null,
  });

  const weeks = [0, 1, 2, 3].map((i) => {
    const wEnd = addDays(end, -7 * i);
    const wStart = addDays(wEnd, -6);
    const inWeek = workouts.filter((w) => w.localDate >= wStart && w.localDate <= wEnd);
    return {
      ending: isoDay(wEnd),
      workouts: inWeek.length,
      minutes: Math.round(inWeek.reduce((a, w) => a + w.durationSec / 60, 0)),
      runKm: Number(inWeek.filter((w) => isRun(w.name)).reduce((a, w) => a + (w.distanceKm ?? 0), 0).toFixed(1)),
    };
  });

  const avgBed = mean(minsOf("sleepStart"));
  const avgWake = mean(minsOf("sleepEnd"));

  return {
    asOf: isoDay(end),
    readiness,
    today: {
      hrv: hrv.latest,
      hrvBaseline: hrv.baseline,
      rhr: rhr.latest,
      rhrBaseline: rhr.baseline,
      sleep: lastNight
        ? { hours: lastNight.totalSleep, bed: clockOf(lastNight.sleepStart, lastNight), wake: clockOf(lastNight.sleepEnd, lastNight) }
        : null,
    },
    evaluation,
    workouts: workouts
      .filter((w) => w.localDate >= addDays(end, -13))
      .map((w) => ({
        day: isoDay(w.localDate),
        name: w.name,
        minutes: Math.round(w.durationSec / 60),
        km: w.distanceKm === null ? null : Number(w.distanceKm.toFixed(2)),
        pace: isRun(w.name) ? paceLabel(w.avgSpeedKmh) : null,
        avgHr: w.avgHr === null ? null : Math.round(w.avgHr),
      })),
    weeks,
    sleepWeek: nights.length
      ? {
          avgHours: mean(nights.map((n) => n.totalSleep))!,
          avgBed: avgBed === null ? null : clockLabel(avgBed),
          avgWake: avgWake === null ? null : clockLabel(avgWake),
          nights: nights.length,
        }
      : null,
    maxHrSeen: maxHr._max.maxHr === null ? null : Math.round(maxHr._max.maxHr),
  };
}

// The briefing is always English; the model is told which language to answer in.
const day = (iso: string) => createFormat("en").chartDay(iso, 0, true);
const r0 = (v: number | null) => (v === null ? "n/a" : String(Math.round(v)));

/** Compact markdown briefing handed to the model as part of its instructions. */
export function snapshotToBriefing(s: CoachSnapshot): string {
  const lines: string[] = [`Data as of ${day(s.asOf)} (the latest day with data). Metric units.`];

  lines.push("", "## Readiness today");
  if (s.readiness) lines.push(`${s.readiness.score}/100, "${s.readiness.label}"`);
  else lines.push("Not enough data for a readiness score.");
  lines.push(
    `- HRV ${r0(s.today.hrv)} ms (30-day average ${r0(s.today.hrvBaseline)} ms)`,
    `- Resting heart rate ${r0(s.today.rhr)} bpm (30-day average ${r0(s.today.rhrBaseline)} bpm)`,
    s.today.sleep
      ? `- Last night: ${durationLabel(s.today.sleep.hours)} asleep${s.today.sleep.bed ? `, ${s.today.sleep.bed} to ${s.today.sleep.wake}` : ""}`
      : "- Last night: no sleep recorded",
  );
  if (s.maxHrSeen) lines.push(`- Highest heart rate recorded in the last 90 days: ${s.maxHrSeen} bpm`);

  if (s.evaluation) {
    lines.push("", "## Trends (latest N days vs the N days before)");
    for (const h of s.evaluation.horizons) {
      const overall = h.overall === "up" ? "trending up" : h.overall === "down" ? "trending down" : h.overall === "steady" ? "holding steady" : "not enough history";
      const signals = h.signals
        .filter((x) => x.trend.current !== null)
        .map((x) => `${x.label} ${x.trend.current!.toFixed(x.digits)} ${x.unit} (${x.trend.verdict ?? "too few readings"})`)
        .join("; ");
      lines.push(`- ${h.days} days: ${overall}. ${signals}`);
    }
  }

  lines.push("", "## Workouts, last 14 days (newest first)");
  if (s.workouts.length === 0) lines.push("None recorded.");
  for (const w of s.workouts) {
    const parts = [`${w.minutes} min`, w.km ? `${w.km} km` : null, w.pace ? `${w.pace} /km` : null, w.avgHr ? `avg HR ${w.avgHr}` : null];
    lines.push(`- ${day(w.day)}: ${w.name}, ${parts.filter(Boolean).join(", ")}`);
  }

  lines.push("", "## Weekly volume, last 4 weeks");
  for (const w of s.weeks) {
    lines.push(`- Week ending ${day(w.ending)}: ${w.workouts} workouts, ${durationLabel(w.minutes / 60)}, ${w.runKm} km running`);
  }

  if (s.sleepWeek) {
    lines.push(
      "",
      "## Sleep, last 7 nights",
      `- Average ${durationLabel(s.sleepWeek.avgHours)} asleep over ${s.sleepWeek.nights} nights; usually asleep by ${s.sleepWeek.avgBed ?? "n/a"}, up at ${s.sleepWeek.avgWake ?? "n/a"}`,
    );
  }
  return lines.join("\n");
}
