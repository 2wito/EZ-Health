// Import an Apple Health export from disk, skipping the browser upload.
// Handy for multi-GB exports. Usage: npm run import:export -- ~/Downloads/export.zip
import "dotenv/config";
import { stat } from "node:fs/promises";
import path from "node:path";
import { runImport } from "@/lib/apple-health/import";
import { prisma } from "@/lib/prisma";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run import:export -- <path to export.zip or export.xml>");
  process.exit(1);
}

const { size } = await stat(file);
const job = await prisma.importJob.create({
  data: { fileName: path.basename(file), fileBytes: size, status: "QUEUED" },
});
console.log(`Importing ${path.basename(file)} (job ${job.id})…`);

const started = Date.now();
await runImport(job.id, path.resolve(file), { keepFile: true });

const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
console.log(
  done.status === "DONE"
    ? `Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${done.recordsRead} records, ${done.samplesSaved} samples, ` +
        `${done.sleepNights} nights, ${done.workoutsSaved} workouts, ${done.activityDays} activity days` +
        (done.parseWarnings ? `, ${done.parseWarnings} unreadable records skipped` : "")
    : `Failed: ${done.error}`,
);
await prisma.$disconnect();
process.exit(done.status === "DONE" ? 0 : 1);
