import { NextResponse } from "next/server";
import { FinishSchema } from "@/lib/apple-health/batch-schema";
import { toImportJobView } from "@/lib/apple-health/job-view";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Marks a browser-parsed import done (with its totals) or failed. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = FinishSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const { count } = await prisma.importJob.updateMany({
    where: { id, status: "SAVING" },
    data: { ...parsed.data, finishedAt: new Date() },
  });
  if (count === 0) return NextResponse.json({ error: "Import not found or already finished." }, { status: 409 });

  const job = await prisma.importJob.findUniqueOrThrow({ where: { id } });
  return NextResponse.json(toImportJobView(job));
}
