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

  const [restingHr, hrv, breathing, energyLatest, sleep, workout, snapshot] = await Promise.all([
    latest("RESTING_HEART_RATE"),
    latest("HEART_RATE_VARIABILITY"),
    latest("RESPIRATORY_RATE"),
    latest("ACTIVE_ENERGY"),
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

  // Hourly buckets can come from several sources (Watch + iPhone, webhook +
  // export). Like the Health app, count each hour once: take the biggest source.
  let activeEnergy: { kcal: number; localDate: Date; tzOffsetMin: number } | null = null;
  if (energyLatest) {
    const [row] = await prisma.$queryRaw<{ kcal: number | null }[]>`
      SELECT SUM(hour_kcal)::float8 AS kcal FROM (
        SELECT MAX(source_kcal) AS hour_kcal FROM (
          SELECT "localHour", source, SUM(qty) AS source_kcal
          FROM "MetricSample"
          WHERE type = 'ACTIVE_ENERGY'::"MetricType" AND "localDate" = ${energyLatest.localDate}::date
          GROUP BY "localHour", source
        ) per_source
        GROUP BY "localHour"
      ) per_hour`;
    activeEnergy = { kcal: row?.kcal ?? 0, localDate: energyLatest.localDate, tzOffsetMin: energyLatest.tzOffsetMin };
  }

  return {
    readiness: snapshot?.readiness ?? null,
    /** The day readiness describes (latest day with data). */
    readinessDay: snapshot ? new Date(`${snapshot.asOf}T00:00:00Z`) : null,
    restingHr,
    hrv,
    breathing,
    activeEnergy,
    sleep,
    workout,
    isEmpty: !restingHr && !hrv && !breathing && !activeEnergy && !sleep && !workout,
  };
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
