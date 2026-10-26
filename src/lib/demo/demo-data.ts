import { prisma } from "@/lib/prisma";

// Demo rows are tagged by source (see scripts/demo-data.mts) so they can be
// told apart from, and removed without touching, real data.
export const DEMO_SOURCE_PREFIX = "EZ Health Demo";
export const DEMO_JOB_NAME = "EZ Health demo data";

export async function hasDemoData() {
  const where = { source: { startsWith: DEMO_SOURCE_PREFIX } };
  const [sample, workout] = await Promise.all([
    prisma.metricSample.findFirst({ where, select: { id: true } }),
    prisma.workout.findFirst({ where, select: { id: true } }),
  ]);
  return Boolean(sample ?? workout);
}

export async function clearDemoData() {
  const where = { source: { startsWith: DEMO_SOURCE_PREFIX } };
  const [samples, stages, sessions, workouts, jobs] = await prisma.$transaction([
    prisma.metricSample.deleteMany({ where }),
    prisma.sleepStage.deleteMany({ where }),
    prisma.sleepSession.deleteMany({ where }),
    prisma.workout.deleteMany({ where }),
    prisma.importJob.deleteMany({ where: { fileName: DEMO_JOB_NAME } }),
  ]);
  return { samples: samples.count, stages: stages.count, sessions: sessions.count, workouts: workouts.count, jobs: jobs.count };
}
