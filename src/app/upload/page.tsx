import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { DemoNotice } from "@/components/upload/demo-notice";
import { Uploader } from "@/components/upload/uploader";
import { Card, SectionTitle } from "@/components/ui/card";
import { isActiveImport, type ImportJobView } from "@/lib/apple-health/job-view";
import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { hasDemoData } from "@/lib/demo/demo-data";
import { getActiveImport, getRecentImports } from "@/lib/queries/imports";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.upload.title };
}

export default async function UploadPage() {
  await connection();
  const { t } = await getI18n();
  const [active, recent, demo] = await Promise.all([getActiveImport(), getRecentImports(), hasDemoData()]).catch(
    () => [null, [] as ImportJobView[], false] as const,
  );

  return (
    <>
      <PageHeader title={t.nav.upload.title} />
      {demo && (
        <div className="mb-6">
          <DemoNotice />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Uploader activeJob={active} />

        <Card className="h-fit">
          <h2 className="text-[17px] font-semibold">{t.upload.exportTitle}</h2>
          <ol className="mt-3 space-y-3 text-[15px] leading-[21px]">
            {t.upload.exportSteps.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-semibold">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[13px] leading-[18px] text-muted-foreground">{t.upload.exportNote}</p>
        </Card>
      </div>

      {recent.length > 0 && (
        <>
          <SectionTitle>{t.upload.recent}</SectionTitle>
          <Card className="divide-y divide-border p-0">
            {recent.map((job) => (
              <ImportRow key={job.id} job={job} />
            ))}
          </Card>
        </>
      )}
    </>
  );
}

async function ImportRow({ job }: { job: ImportJobView }) {
  const { t, f } = await getI18n();
  const running = isActiveImport(job.status);
  const failed = job.status === "FAILED";
  const Icon = running ? LoaderCircle : failed ? CircleAlert : Check;

  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full text-white",
          running ? "bg-primary" : failed ? "bg-destructive" : "bg-workout",
        )}
      >
        <Icon aria-hidden className={cn("size-4", running && "animate-spin motion-reduce:animate-none")} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[17px]">{job.fileName}</p>
        <p className="truncate text-[13px] text-muted-foreground">
          {running ? t.upload.importingNow : failed ? (job.error ?? t.upload.failed) : t.upload.imported(f.ago(new Date(job.createdAt)))}
          {job.fileBytes > 0 && `, ${f.bytes(job.fileBytes)}`}
        </p>
      </div>
      {job.status === "DONE" && (
        <p className="hidden shrink-0 text-end text-[13px] text-muted-foreground sm:block">
          {t.upload.records(f.compact(job.recordsRead))}
          <br />
          {t.upload.workouts(f.number(job.workoutsSaved))}
        </p>
      )}
    </div>
  );
}
