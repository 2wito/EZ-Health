import { NextResponse } from "next/server";
import { getImportJob } from "@/lib/queries/imports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const job = await getImportJob((await params).id);
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  return NextResponse.json(job);
}
