import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { after, NextResponse, type NextRequest } from "next/server";
import { runImport } from "@/lib/apple-health/import";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Receives an Apple Health export as the raw request body (not multipart),
 * streams it to a temp file so even multi-GB uploads never sit in memory,
 * then parses it in the background. Poll GET /api/upload-xml/:id for progress.
 *
 * Headers: `x-file-name: export.zip` (URI-encoded).
 */
export async function POST(req: NextRequest) {
  const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "").trim();
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== ".zip" && ext !== ".xml") {
    return NextResponse.json({ error: "Upload export.zip or export.xml from the Health app." }, { status: 415 });
  }
  if (!req.body) {
    return NextResponse.json({ error: "The upload was empty." }, { status: 400 });
  }

  const job = await prisma.importJob.create({ data: { fileName, status: "UPLOADING" } });
  const dir = path.join(tmpdir(), "ez-health-imports");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${job.id}${ext}`);

  const fail = async (error: string, status: number) => {
    await rm(filePath, { force: true });
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "FAILED", error, finishedAt: new Date() } });
    return NextResponse.json({ error, jobId: job.id }, { status });
  };

  try {
    await pipeline(Readable.fromWeb(req.body as WebReadableStream), createWriteStream(filePath));
  } catch {
    return fail("The upload was interrupted. Try again.", 400);
  }

  const { size } = await stat(filePath);
  if (size === 0) return fail("The upload was empty.", 400);

  await prisma.importJob.update({ where: { id: job.id }, data: { status: "QUEUED", fileBytes: size } });
  // Respond right away; parsing a full export can take a few minutes.
  after(() => runImport(job.id, filePath));

  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
