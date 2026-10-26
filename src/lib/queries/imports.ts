import type { ImportJob } from "@/generated/prisma/client";
import { isActiveImport, toImportJobView } from "@/lib/apple-health/job-view";
import { prisma } from "@/lib/prisma";

// A running import touches its row at least every few seconds. One that has
// gone quiet this long was killed (server restart, crash) and won't finish.
const STALE_AFTER_MS = 10 * 60_000;

async function failIfStale(job: ImportJob): Promise<ImportJob> {
  if (!isActiveImport(job.status) || Date.now() - job.updatedAt.getTime() < STALE_AFTER_MS) return job;
  return prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      error: "The import stopped before finishing, probably because the server restarted. Upload the file again.",
      finishedAt: new Date(),
    },
  });
}

export async function getImportJob(id: string) {
  const job = await prisma.importJob.findUnique({ where: { id } });
  return job && toImportJobView(await failIfStale(job));
}

export async function getRecentImports(take = 8) {
  const jobs = await prisma.importJob.findMany({ orderBy: { createdAt: "desc" }, take });
  return (await Promise.all(jobs.map(failIfStale))).map(toImportJobView);
}

export async function getActiveImport() {
  const job = await prisma.importJob.findFirst({
    where: { status: { notIn: ["DONE", "FAILED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!job) return null;
  const checked = await failIfStale(job);
  return isActiveImport(checked.status) ? toImportJobView(checked) : null;
}
