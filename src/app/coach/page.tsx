import { Sparkles } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { CoachChat } from "@/components/coach/coach-chat";
import { ReadinessCard } from "@/components/coach/readiness-card";
import { formatChartDay } from "@/components/charts/format";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { getCoachModel } from "@/lib/coach/model";
import { getCoachSnapshot, type CoachSnapshot } from "@/lib/coach/snapshot";

export const metadata = { title: "AI Coach" };

export default async function CoachPage() {
  await connection();
  let snapshot: CoachSnapshot | null;
  try {
    snapshot = await getCoachSnapshot();
  } catch (err) {
    return (
      <>
        <PageHeader title="AI Coach" />
        <DatabaseError message={err instanceof Error ? err.message : String(err)} />
      </>
    );
  }

  if (!snapshot) {
    return (
      <>
        <PageHeader title="AI Coach" />
        <EmptyState icon={Sparkles} tile="bg-spectrum" title="Your coach needs some data">
          <p>
            With a week or two of heart, sleep and workout history, the coach suggests what to train today and builds
            running and strength plans around how recovered you are.
          </p>
          <Link href="/upload" className="mt-3 inline-block font-medium text-primary">
            Import an Apple Health export
          </Link>
        </EmptyState>
      </>
    );
  }

  const coach = getCoachModel();
  return (
    <>
      <PageHeader title="AI Coach" subtitle={`Based on your data through ${formatChartDay(snapshot.asOf, 0, true)}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <ReadinessCard readiness={snapshot.readiness} />
          <Card>
            <h2 className="text-[15px] font-semibold">What the coach sees</h2>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-[20px] text-muted-foreground">
              <li>Today&apos;s readiness, HRV, resting heart rate and last night&apos;s sleep</li>
              <li>Your 7, 30 and 90 day fitness and recovery trends</li>
              <li>{snapshot.workouts.length} workouts from the last 14 days and 4 weeks of training volume</li>
            </ul>
            <p className="mt-3 text-[13px] leading-[18px] text-subtle-foreground">
              When you ask a question, this summary (not your raw data) is sent to {coach ? coach.label.split(" ")[0] : "the AI provider"}.
              The coach isn&apos;t a doctor.
            </p>
          </Card>
        </div>
        <CoachChat enabled={coach !== null} modelLabel={coach?.label ?? null} />
      </div>
    </>
  );
}
