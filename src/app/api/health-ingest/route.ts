import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ingestHealthPayload } from "@/lib/health-export/ingest";
import { PayloadSchema } from "@/lib/health-export/schema";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Large backfills (months of heart-rate samples) can take a while.
export const maxDuration = 60;

/**
 * Webhook for the Health Auto Export iOS app ("REST API" automation, JSON format).
 * Configure the automation with a header: `x-api-key: <INGEST_API_KEY>`
 * (or `Authorization: Bearer <INGEST_API_KEY>`).
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  const authError = checkAuth(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unrecognized payload shape", issues: z.flattenError(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const result = await ingestHealthPayload(parsed.data);
    await prisma.ingestLog.create({
      data: {
        status: result.invalidRecords > 0 ? "partial" : "ok",
        metricsReceived: result.metricsReceived,
        samplesUpserted: result.samplesUpserted,
        sleepNights: result.sleepNights,
        workoutsUpserted: result.workoutsUpserted,
        skippedMetrics: result.skippedMetrics,
        durationMs: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[health-ingest] failed:", err);
    await prisma.ingestLog
      .create({ data: { status: "error", error: message.slice(0, 2000), durationMs: Date.now() - startedAt } })
      .catch(() => {}); // DB may be the thing that's down
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}

function checkAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) {
    console.error("[health-ingest] INGEST_API_KEY is not configured");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const provided =
    req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
