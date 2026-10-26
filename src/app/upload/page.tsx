import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { connection } from "next/server";
import { PageHeader } from "@/components/shell/page-header";
import { DemoNotice } from "@/components/upload/demo-notice";
import { Uploader } from "@/components/upload/uploader";
import { Card, SectionTitle } from "@/components/ui/card";
import { isActiveImport, type ImportJobView } from "@/lib/apple-health/job-view";
import { formatAgo, formatBytes, formatCompact, formatNumber } from "@/lib/format";
import { hasDemoData } from "@/lib/demo/demo-data";
import { getActiveImport, getRecentImports } from "@/lib/queries/imports";
import { cn } from "@/lib/utils";

export const metadata = { title: "Import Health Data" };

export default async function UploadPage() {
  await connection();
  const [active, recent, demo] = await Promise.all([getActiveImport(), getRecentImports(), hasDemoData()]).catch(
    () => [null, [] as ImportJobView[], false] as const,
  );

  return (
    <>
      <PageHeader title="Import Health Data" />
      {demo && (
        <div className="mb-6">
          <DemoNotice />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Uploader activeJob={active} />

        <Card className="h-fit">
          <h2 className="text-[17px] font-semibold">Export from your iPhone</h2>
          <ol className="mt-3 space-y-3 text-[15px] leading-[21px]">
            {[
              "Open the Health app.",
              "Tap your profile picture, then Export All Health Data.",
              "Save or AirDrop export.zip to this computer, then drop it here.",
            ].map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[13px] font-semibold">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[13px] leading-[18px] text-muted-foreground">
            Exports with years of history can be several gigabytes. They&apos;re read in pieces, so size isn&apos;t a
            problem, but the first import can take a few minutes.
          </p>
        </Card>
      </div>

      {recent.length > 0 && (
        <>
          <SectionTitle>Recent imports</SectionTitle>
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

function ImportRow({ job }: { job: ImportJobView }) {
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
          {running ? "Importing now" : failed ? (job.error ?? "Failed") : `Imported ${formatAgo(new Date(job.createdAt))}`}
          {job.fileBytes > 0 && `, ${formatBytes(job.fileBytes)}`}
        </p>
      </div>
      {job.status === "DONE" && (
        <p className="hidden shrink-0 text-right text-[13px] text-muted-foreground sm:block">
          {formatCompact(job.recordsRead)} records
          <br />
          {formatNumber(job.workoutsSaved)} workouts
        </p>
      )}
    </div>
  );
}
