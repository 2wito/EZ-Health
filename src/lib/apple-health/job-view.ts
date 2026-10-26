import type { ImportJob } from "@/generated/prisma/client";

// Client-safe: no database imports here.

/** JSON-safe view of an ImportJob (BigInt → number, Date → ISO string). */
export interface ImportJobView {
  id: string;
  status: ImportJob["status"];
  fileName: string;
  fileBytes: number;
  bytesRead: number;
  bytesTotal: number;
  recordsRead: number;
  samplesSaved: number;
  sleepNights: number;
  workoutsSaved: number;
  activityDays: number;
  recordsSkipped: number;
  parseWarnings: number;
  dataFrom: string | null;
  dataTo: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export function toImportJobView(job: ImportJob): ImportJobView {
  return {
    id: job.id,
    status: job.status,
    fileName: job.fileName,
    fileBytes: Number(job.fileBytes),
    bytesRead: Number(job.bytesRead),
    bytesTotal: Number(job.bytesTotal),
    recordsRead: job.recordsRead,
    samplesSaved: job.samplesSaved,
    sleepNights: job.sleepNights,
    workoutsSaved: job.workoutsSaved,
    activityDays: job.activityDays,
    recordsSkipped: job.recordsSkipped,
    parseWarnings: job.parseWarnings,
    dataFrom: job.dataFrom?.toISOString() ?? null,
    dataTo: job.dataTo?.toISOString() ?? null,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export const isActiveImport = (status: ImportJob["status"]) => status !== "DONE" && status !== "FAILED";
