"use client";

import { Check, CircleAlert, FileArchive, FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { isActiveImport, type ImportJobView } from "@/lib/apple-health/job-view";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle"; error?: string }
  | { kind: "uploading"; fileName: string; loaded: number; total: number }
  | { kind: "job"; job: ImportJobView };

const POLL_MS = 1000;

export function Uploader({ activeJob }: { activeJob: ImportJobView | null }) {
  const router = useRouter();
  const { t, f } = useI18n();
  const [state, setState] = useState<State>(activeJob ? { kind: "job", job: activeJob } : { kind: "idle" });
  const xhr = useRef<XMLHttpRequest | null>(null);

  const fetchJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/upload-xml/${id}`, { cache: "no-store" });
    if (res.ok) setState({ kind: "job", job: (await res.json()) as ImportJobView });
  }, []);

  // Poll while the server is working; refresh the page (recent imports, nav sync status) when it stops.
  const jobId = state.kind === "job" ? state.job.id : null;
  const running = state.kind === "job" && isActiveImport(state.job.status);
  useEffect(() => {
    if (!jobId) return;
    if (!running) {
      router.refresh();
      return;
    }
    const timer = setInterval(() => void fetchJob(jobId).catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, running, fetchJob, router]);

  function upload(file: File) {
    if (!/\.(zip|xml)$/i.test(file.name)) {
      setState({ kind: "idle", error: t.upload.notExport(file.name) });
      return;
    }

    // XHR rather than fetch: fetch can't report upload progress.
    const req = new XMLHttpRequest();
    xhr.current = req;
    req.open("POST", "/api/upload-xml");
    req.setRequestHeader("content-type", "application/octet-stream");
    req.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    req.upload.onprogress = (e) =>
      setState({ kind: "uploading", fileName: file.name, loaded: e.loaded, total: e.total || file.size });
    req.onload = () => {
      let body: { jobId?: string; error?: string } = {};
      try {
        body = JSON.parse(req.responseText);
      } catch {}
      if (req.status === 202 && body.jobId) void fetchJob(body.jobId);
      else setState({ kind: "idle", error: body.error ?? t.upload.httpFailed(req.status) });
    };
    req.onerror = () =>
      setState({ kind: "idle", error: t.upload.unreachable });
    req.onabort = () => setState({ kind: "idle" });
    req.send(file);
    setState({ kind: "uploading", fileName: file.name, loaded: 0, total: file.size });
  }

  if (state.kind === "idle") return <DropZone onFile={upload} error={state.error} />;

  if (state.kind === "uploading") {
    return (
      <ProgressCard
        fileName={state.fileName}
        fileBytes={state.total}
        step={0}
        label={t.upload.uploading}
        progress={state.total ? state.loaded / state.total : null}
        detail={t.upload.progressOf(f.bytes(state.loaded), f.bytes(state.total))}
        action={
          <button type="button" onClick={() => xhr.current?.abort()} className="text-[15px] font-medium text-primary">
            {t.upload.cancel}
          </button>
        }
      />
    );
  }

  const { job } = state;
  if (job.status === "DONE") return <DoneCard job={job} onReset={() => setState({ kind: "idle" })} />;
  if (job.status === "FAILED") {
    return (
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-destructive text-white">
            <CircleAlert aria-hidden className="size-6" strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold">{t.upload.importFailed}</h2>
            <p className="mt-1 break-words text-[15px] leading-[22px] text-muted-foreground">{job.error}</p>
            <button type="button" onClick={() => setState({ kind: "idle" })} className={cn(buttonClass, "mt-5")}>
              {t.upload.tryAgain}
            </button>
          </div>
        </div>
      </Card>
    );
  }

  const reading = job.status === "READING";
  return (
    <ProgressCard
      fileName={job.fileName}
      fileBytes={job.fileBytes}
      step={job.status === "SAVING" ? 2 : 1}
      label={job.status === "SAVING" ? t.upload.saving : t.upload.reading}
      progress={reading && job.bytesTotal ? job.bytesRead / job.bytesTotal : null}
      detail={
        job.status === "QUEUED"
          ? t.upload.opening
          : t.upload.recordsRead(f.number(job.recordsRead), job.status === "SAVING")
      }
    />
  );
}

const buttonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-[17px] font-semibold text-primary-foreground transition-opacity active:opacity-80";
const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-xl bg-muted px-5 text-[17px] font-semibold text-primary transition-opacity active:opacity-80";

function DropZone({ onFile, error }: { onFile: (file: File) => void; error?: string }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <Card
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={cn(
        "flex flex-col items-center border-2 border-dashed px-6 py-14 text-center transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <span
        className={cn(
          "grid size-16 place-items-center rounded-[16px] text-white transition-transform",
          dragging ? "scale-110 bg-primary" : "bg-gray",
        )}
      >
        <FileUp aria-hidden className="size-8" strokeWidth={2} />
      </span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-tight">
        {dragging ? t.upload.dropping : t.upload.drop}
      </h2>
      <p className="mt-1.5 max-w-sm text-[15px] leading-[22px] text-muted-foreground">
        {t.upload.dropHint}
      </p>
      <button type="button" onClick={() => input.current?.click()} className={cn(buttonClass, "mt-6")}>
        {t.upload.choose}
      </button>
      <input
        ref={input}
        type="file"
        accept=".zip,.xml,application/zip,text/xml,application/xml"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-selecting the same file
          if (file) onFile(file);
        }}
      />
      {error && (
        <p role="alert" className="mt-5 flex items-start gap-2 text-start text-[15px] text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </Card>
  );
}


function ProgressCard({
  fileName,
  fileBytes,
  step,
  label,
  progress,
  detail,
  action,
}: {
  fileName: string;
  fileBytes: number;
  step: number;
  label: string;
  /** 0–1, or null while the duration is unknown. */
  progress: number | null;
  detail: string;
  action?: React.ReactNode;
}) {
  const { t, f } = useI18n();
  const steps = t.upload.steps;
  return (
    <Card className="p-6">
      <div className="flex items-center gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-[11px] bg-gray text-white">
          <FileArchive aria-hidden className="size-6" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{fileName}</p>
          {fileBytes > 0 && <p className="text-[15px] text-muted-foreground">{f.bytes(fileBytes)}</p>}
        </div>
        {action}
      </div>

      <ol className="mt-6 flex items-center gap-2" aria-label={t.upload.progress}>
        {steps.map((name, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={name} className="flex flex-1 items-center gap-2 last:flex-none">
              <span
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 text-[13px] font-semibold",
                  done || current ? "text-foreground" : "text-subtle-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] text-white",
                    done ? "bg-workout" : current ? "bg-primary" : "bg-muted text-subtle-foreground",
                  )}
                >
                  {done ? <Check aria-hidden className="size-3" strokeWidth={3} /> : i + 1}
                </span>
                {name}
              </span>
              {i < steps.length - 1 && <span className={cn("h-px flex-1", done ? "bg-workout" : "bg-border")} />}
            </li>
          );
        })}
      </ol>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px] font-semibold">{label}</p>
          {progress !== null && (
            <p className="font-rounded text-[15px] tabular-nums text-muted-foreground">{Math.floor(progress * 100)}%</p>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === null ? undefined : Math.floor(progress * 100)}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          {progress === null ? (
            <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" />
          ) : (
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
          )}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">{detail}</p>
      </div>
    </Card>
  );
}

function DoneCard({ job, onReset }: { job: ImportJobView; onReset: () => void }) {
  const { t, f } = useI18n();
  const stats: [string, string][] = [
    [t.upload.statRecords, f.compact(job.recordsRead)],
    [t.upload.statWorkouts, f.number(job.workoutsSaved)],
    [t.upload.statNights, f.number(job.sleepNights)],
    [t.upload.statDays, f.number(job.activityDays)],
  ];

  return (
    <Card tint="workout" className="p-6">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-workout text-white">
          <Check aria-hidden className="size-6" strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold">{t.upload.complete}</h2>
          <p className="mt-0.5 text-[15px] text-muted-foreground">
            {job.dataFrom && job.dataTo
              ? t.upload.covers(job.fileName, f.monthYear(job.dataFrom), f.monthYear(job.dataTo))
              : t.upload.wasImported(job.fileName)}
          </p>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border xl:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-card-elevated px-4 py-3">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
            <dd className="font-rounded text-[22px] font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {job.parseWarnings > 0 && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          {t.upload.skipped(f.number(job.parseWarnings))}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className={buttonClass}>
          {t.upload.viewSummary}
        </Link>
        <button type="button" onClick={onReset} className={secondaryButtonClass}>
          {t.upload.another}
        </button>
      </div>
    </Card>
  );
}
