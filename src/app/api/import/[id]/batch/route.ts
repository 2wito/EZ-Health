import { NextResponse } from "next/server";
import { BatchSchema } from "@/lib/apple-health/batch-schema";
import { upsertDailyActivity, upsertSamples, upsertSleepStages, upsertWorkouts } from "@/lib/health-export/store";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Saves one batch of browser-parsed records. Idempotent, so a retried batch is harmless. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.importJob.findUnique({ where: { id }, select: { status: true } });
  if (!job) return NextResponse.json({ error: "Import not found." }, { status: 404 });
  if (job.status !== "SAVING") return NextResponse.json({ error: "This import has already finished." }, { status: 409 });

  const parsed = BatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid batch." }, { status: 400 });

  const batch = parsed.data;
  try {
    let saved: number;
    if (batch.kind === "samples") saved = await upsertSamples(batch.records);
    else if (batch.kind === "sleepStages") saved = await upsertSleepStages(batch.records);
    else if (batch.kind === "workouts") saved = await upsertWorkouts(batch.records);
    else saved = await upsertDailyActivity(batch.records);

    // Also keeps the job fresh, so it isn't mistaken for an abandoned import.
    await prisma.importJob.update({
      where: { id },
      data: batch.kind === "samples" ? { samplesSaved: { increment: saved } } : { updatedAt: new Date() },
    });
    return NextResponse.json({ saved });
  } catch (err) {
    console.error(`[import ${id}] batch failed:`, err);
    return NextResponse.json({ error: "Couldn't save this part of the import." }, { status: 500 });
  }
}
