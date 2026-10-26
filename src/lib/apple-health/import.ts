import { createReadStream } from "node:fs";
import { open, readFile, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import JSZip from "jszip";
import type { Prisma } from "@/generated/prisma/client";
import { upsertDailyActivity, upsertSamples, upsertSleepStages, upsertWorkouts } from "@/lib/health-export/store";
import { prisma } from "@/lib/prisma";
import { AppleHealthXmlParser, NotAHealthExportError } from "./xml-parser";

const PROGRESS_INTERVAL_MS = 750;

/** A failure the person can act on. Anything else is shown as a generic message and logged. */
export class ImportError extends Error {}

/**
 * Parse an uploaded export.zip / export.xml and store it. Progress and the
 * outcome are written to the ImportJob row; this never throws.
 * The file is deleted afterwards unless `keepFile` is set.
 */
export async function runImport(jobId: string, filePath: string, { keepFile = false } = {}) {
  const update = (data: Prisma.ImportJobUpdateInput) => prisma.importJob.update({ where: { id: jobId }, data });
  // Saving a large export can go minutes between progress updates; keep the
  // row fresh so it isn't mistaken for an abandoned import.
  const heartbeat = setInterval(() => void update({ updatedAt: new Date() }).catch(() => {}), 30_000);

  try {
    await update({ status: "READING" });
    const { stream, totalBytes } = await openExportXml(filePath);
    await update({ bytesTotal: totalBytes });

    const parser = new AppleHealthXmlParser();
    const decoder = new StringDecoder("utf8"); // chunks can split multi-byte characters
    let bytesRead = 0;
    let lastReport = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      bytesRead += chunk.length;
      parser.write(decoder.write(chunk));
      if (Date.now() - lastReport > PROGRESS_INTERVAL_MS) {
        lastReport = Date.now();
        await update({ bytesRead, recordsRead: parser.recordsRead, parseWarnings: parser.warnings });
      }
    }
    parser.write(decoder.end());
    const result = parser.finish();

    await update({
      status: "SAVING",
      bytesRead,
      recordsRead: result.recordsRead,
      recordsSkipped: result.recordsSkipped,
      parseWarnings: result.warnings,
      dataFrom: result.dataFrom,
      dataTo: result.dataTo,
    });

    if (result.recordsRead === 0 && result.workouts.length === 0) {
      throw new ImportError("This file has no health records. Make sure it's the export.xml from Export All Health Data.");
    }

    const samplesSaved = await upsertSamples(result.samples);
    await update({ samplesSaved });
    const sleepNights = await upsertSleepStages(result.sleepStages);
    await update({ sleepNights });
    const workoutsSaved = await upsertWorkouts(result.workouts);
    const activityDays = await upsertDailyActivity(result.activity);

    await update({ status: "DONE", workoutsSaved, activityDays, finishedAt: new Date() });
  } catch (err) {
    console.error(`[import ${jobId}] failed:`, err);
    const message =
      err instanceof ImportError || err instanceof NotAHealthExportError
        ? err.message
        : "Something went wrong while importing. Try again, and check the server log if it keeps happening.";
    await update({ status: "FAILED", error: message, finishedAt: new Date() }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    if (!keepFile) await rm(filePath, { force: true }).catch(() => {});
  }
}

/** Opens export.xml as a byte stream, unzipping first if needed (sniffed, not trusted from the name). */
async function openExportXml(filePath: string): Promise<{ stream: Readable; totalBytes: number }> {
  if (!(await isZip(filePath))) {
    return {
      stream: createReadStream(filePath, { highWaterMark: 1 << 20 }),
      totalBytes: (await stat(filePath)).size,
    };
  }

  // JSZip needs the archive itself in memory (it's compressed, typically
  // 100–400 MB), but export.xml is inflated as a stream, never held whole.
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readFile(filePath));
  } catch {
    throw new ImportError("This ZIP file is damaged or incomplete. Export your data from the Health app again.");
  }
  const entry = Object.values(zip.files).find((f) => !f.dir && /(^|\/)export\.xml$/i.test(f.name));
  if (!entry) {
    throw new ImportError("No export.xml in this ZIP. Upload the export.zip the Health app creates.");
  }
  // Not part of JSZip's typings, but present on every loaded entry.
  const totalBytes = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  // JSZip returns an old-style stream; wrap it so it's async-iterable.
  return { stream: new Readable().wrap(entry.nodeStream("nodebuffer")), totalBytes };
}

async function isZip(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const { buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0);
    return buffer.readUInt32LE(0) === 0x04034b50; // "PK\x03\x04"
  } finally {
    await handle.close();
  }
}
