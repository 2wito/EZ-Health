import "server-only";
import { connection } from "next/server";
import type { MetricType } from "@/generated/prisma/enums";
import { getCoachSnapshot } from "@/lib/coach/snapshot";
import { prisma } from "@/lib/prisma";

export type SummaryResult = { ok: true; data: Summary } | { ok: false; error: string };
export type Summary = Awaited<ReturnType<typeof loadSummary>>;

/** Latest reading for each Summary tile. Never throws: DB problems come back as `ok: false`. */
export async function getSummary(): Promise<SummaryResult> {
  await connection(); // always render per request
  try {
    return { ok: true, data: await loadSummary() };
  } catch (err) {
    console.error("[summary] query failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadSummary() {
  const latest = (type: MetricType) =>
    prisma.metricSample.findFirst({
      where: { type, qty: { not: null } },
      orderBy: { timestamp: "desc" },
      select: { qty: true, timestamp: true, tzOffsetMin: true, localDate: true },
    });

  const [restingHr, hrv, breathing, energyLatest, stepsLatest, sleep, workout, snapshot] = await Promise.all([
    latest("RESTING_HEART_RATE"),
    latest("HEART_RATE_VARIABILITY"),
    latest("RESPIRATORY_RATE"),
    latest("ACTIVE_ENERGY"),
    latest("STEP_COUNT"),
    prisma.sleepSession.findFirst({
      // Several sources can log the same night (an iPhone "In Bed" entry next to
      // the Watch's stages); show the one that actually measured sleep.
      orderBy: [{ date: "desc" }, { totalSleep: "desc" }],
      select: {
        date: true,
        tzOffsetMin: true,
        totalSleep: true,
        sleepStart: true,
        sleepEnd: true,
        deepHours: true,
        remHours: true,
        awakeHours: true,
      },
    }),
    prisma.workout.findFirst({
      orderBy: { start: "desc" },
      select: { name: true, start: true, tzOffsetMin: true, durationSec: true, activeEnergyKcal: true, distanceKm: true },
    }),
    getCoachSnapshot(),
  ]);

  const [energyTotal, stepTotal] = await Promise.all([dailyTotal("ACTIVE_ENERGY", energyLatest), dailyTotal("STEP_COUNT", stepsLatest)]);
  const activeEnergy = energyTotal && { kcal: energyTotal.total, localDate: energyTotal.localDate, tzOffsetMin: energyTotal.tzOffsetMin };
  const steps = stepTotal && { count: Math.round(stepTotal.total), localDate: stepTotal.localDate, tzOffsetMin: stepTotal.tzOffsetMin };

  return {
    readiness: snapshot?.readiness ?? null,
    /** The day readiness describes (latest day with data). */
    readinessDay: snapshot ? new Date(`${snapshot.asOf}T00:00:00Z`) : null,
    restingHr,
    hrv,
    breathing,
    activeEnergy,
    steps,
    sleep,
    workout,
    isEmpty: !restingHr && !hrv && !breathing && !activeEnergy && !steps && !sleep && !workout,
  };
}

/**
 * A day's total for an hourly-summed metric (energy, steps). Hourly buckets can
 * come from several sources (Watch + iPhone, webhook + export); like the Health
 * app, each hour counts once: take the biggest source, then add up the hours.
 */
async function dailyTotal(type: MetricType, day: { localDate: Date; tzOffsetMin: number } | null) {
  if (!day) return null;
  const [row] = await prisma.$queryRaw<{ total: number | null }[]>`
    SELECT SUM(hour_total)::float8 AS total FROM (
      SELECT MAX(source_total) AS hour_total FROM (
        SELECT "localHour", source, SUM(qty) AS source_total
        FROM "MetricSample"
        WHERE type = ${type}::"MetricType" AND "localDate" = ${day.localDate}::date
        GROUP BY "localHour", source
      ) per_source
      GROUP BY "localHour"
    ) per_hour`;
  return { total: row?.total ?? 0, localDate: day.localDate, tzOffsetMin: day.tzOffsetMin };
}

/** Latest data arrival: a webhook sync or a finished file import. */
export async function getLastSync() {
  await connection();
  try {
    const [hook, file] = await Promise.all([
      prisma.ingestLog.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true, status: true } }),
      prisma.importJob.findFirst({
        where: { status: { in: ["DONE", "FAILED"] } },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true, status: true },
      }),
    ]);
    const candidates = [
      hook && { at: hook.receivedAt, failed: hook.status === "error" },
      file?.finishedAt && { at: file.finishedAt, failed: file.status === "FAILED" },
    ].filter((c): c is { at: Date; failed: boolean } => Boolean(c));
    return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
  } catch {
    return undefined; // database unreachable — the page itself explains this
  }
}
