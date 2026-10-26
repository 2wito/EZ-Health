import { NextResponse } from "next/server";
import { StartSchema } from "@/lib/apple-health/batch-schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts an import the browser has already parsed (see components/upload).
 * The parsed records follow in batches to /api/import/:id/batch, then
 * /api/import/:id/finish closes the job. Each request stays far below
 * serverless body limits, so exports of any size work on Vercel.
 */
export async function POST(req: Request) {
  const parsed = StartSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid import details." }, { status: 400 });

  const { fileBytes, bytesTotal, ...rest } = parsed.data;
  const job = await prisma.importJob.create({
    data: { ...rest, status: "SAVING", fileBytes, bytesTotal, bytesRead: bytesTotal },
  });
  return NextResponse.json({ jobId: job.id }, { status: 201 });
}
