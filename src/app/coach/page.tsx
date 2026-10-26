import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { CoachChat } from "@/components/coach/coach-chat";
import { ReadinessCard } from "@/components/coach/readiness-card";
import { PageHeader } from "@/components/shell/page-header";
import { Card } from "@/components/ui/card";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { getAllowance } from "@/lib/coach/limit";
import { getCoachModel } from "@/lib/coach/model";
import { getCoachSnapshot, type CoachSnapshot } from "@/lib/coach/snapshot";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.coach.title };
}

export default async function CoachPage() {
  await connection();
  const { t, f } = await getI18n();
  const title = t.nav.coach.title;
  let snapshot: CoachSnapshot | null;
  try {
    snapshot = await getCoachSnapshot();
  } catch (err) {
    return (
      <>
        <PageHeader title={title} />
        <DatabaseError message={err instanceof Error ? err.message : String(err)} />
      </>
    );
  }

  if (!snapshot) {
    return (
      <>
        <PageHeader title={title} />
        <EmptyState icon={Sparkles} tile="bg-spectrum" title={t.coach.emptyTitle}>
          <p>{t.coach.emptyBody}</p>
          <Link href="/upload" className="mt-3 inline-block font-medium text-primary">
            {t.common.importExport}
          </Link>
        </EmptyState>
      </>
    );
  }

  const coach = getCoachModel();
  const allowance = coach ? await getAllowance(await headers()).catch(() => null) : null;
  return (
    <>
      <PageHeader title={title} subtitle={t.coach.basedOn(f.chartDay(snapshot.asOf, 0, true))} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <ReadinessCard readiness={snapshot.readiness} />
          <Card>
            <h2 className="text-[15px] font-semibold">{t.coach.sees}</h2>
            <ul className="mt-2 space-y-1.5 text-[14px] leading-[20px] text-muted-foreground">
              <li>{t.coach.sees1}</li>
              <li>{t.coach.sees2}</li>
              <li>{t.coach.sees3(snapshot.workouts.length)}</li>
            </ul>
            <p className="mt-3 text-[13px] leading-[18px] text-subtle-foreground">
              {t.coach.privacy(coach ? coach.label.split(" ")[0] : t.coach.theProvider)}
            </p>
          </Card>
        </div>
        <CoachChat enabled={coach !== null} modelLabel={coach?.label ?? null} allowance={allowance} />
      </div>
    </>
  );
}
