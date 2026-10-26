"use client";

import { Check, CircleAlert, FileArchive, FileUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { countSleepNights, toBatches } from "@/lib/apple-health/batches";
import { isActiveImport, type ImportJobView } from "@/lib/apple-health/job-view";
import type { WorkerMessage } from "@/lib/apple-health/parse.worker";
import type { ParseResult } from "@/lib/apple-health/xml-parser";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type State =
  | { kind: "idle"; error?: string }
  | { kind: "parsing"; fileName: string; fileBytes: number; phase: "open" | "read"; progress: number | null; recordsRead: number }
  | { kind: "saving"; fileName: string; fileBytes: number; sent: number; total: number }
  | { kind: "job"; job: ImportJobView };

const POLL_MS = 1000;

/** A failure the person can act on, already worded for them. */
class ImportFailure extends Error {}

/**
 * Imports run in the browser: a worker unzips and parses the export, then the
 * parsed records go up in batches small enough for any host (Vercel caps
 * request bodies at 4.5 MB). Imports started elsewhere (the CLI) are polled.
 */
export function Uploader({ activeJob }: { activeJob: ImportJobView | null }) {
  const router = useRouter();
  const { t, f } = useI18n();
  const [state, setState] = useState<State>(activeJob ? { kind: "job", job: activeJob } : { kind: "idle" });
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);

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

  // Leaving mid-import would stop it halfway.
  const busy = state.kind === "parsing" || state.kind === "saving";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => () => worker.current?.terminate(), []);

  function upload(file: File) {
    if (!/\.(zip|xml)$/i.test(file.name)) {
      setState({ kind: "idle", error: t.upload.notExport(file.name) });
      return;
    }
    const base = { fileName: file.name, fileBytes: file.size };
    setState({ kind: "parsing", ...base, phase: "open", progress: null, recordsRead: 0 });

    worker.current?.terminate();
    const w = new Worker(new URL("../../lib/apple-health/parse.worker.ts", import.meta.url));
    worker.current = w;
    w.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === "progress") {
        setState({
          kind: "parsing",
          ...base,
          phase: m.phase,
          progress: m.bytesTotal ? m.bytesRead / m.bytesTotal : null,
          recordsRead: m.recordsRead,
        });
        return;
      }
      w.terminate();
      worker.current = null;
      if (m.type === "error") setState({ kind: "idle", error: t.upload.errors[m.code] });
      else void save(file, m.result, m.bytesTotal);
    };
    w.onerror = () => {
      w.terminate();
      worker.current = null;
      setState({ kind: "idle", error: t.upload.errors.generic });
    };
    w.postMessage({ file });
  }

  async function save(file: File, result: ParseResult, bytesTotal: number) {
    const controller = new AbortController();
    abort.current = controller;
    const batches = toBatches(result);
    const base = { fileName: file.name, fileBytes: file.size };
    setState({ kind: "saving", ...base, sent: 0, total: batches.length });

    const post = async (url: string, body: string): Promise<unknown> => {
      // One retry: batches are idempotent, and a cold serverless start can fail once.
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal });
        } catch (err) {
          if (controller.signal.aborted) throw err;
          if (attempt < 1) continue;
          throw new ImportFailure(t.upload.unreachable);
        }
        if (res.ok) return res.json();
        if (res.status >= 500 && attempt < 1) continue;
        throw new ImportFailure(t.upload.httpFailed(res.status));
      }
    };

    let id: string | null = null;
    try {
      const started = (await post(
        "/api/import",
        JSON.stringify({
          fileName: file.name,
          fileBytes: file.size,
          bytesTotal,
          recordsRead: result.recordsRead,
          recordsSkipped: result.recordsSkipped,
          parseWarnings: result.warnings,
          dataFrom: result.dataFrom,
          dataTo: result.dataTo,
        }),
      )) as { jobId: string };
      id = started.jobId;

      for (let i = 0; i < batches.length; i++) {
        await post(`/api/import/${id}/batch`, batches[i]);
        setState({ kind: "saving", ...base, sent: i + 1, total: batches.length });
      }

      const job = (await post(
        `/api/import/${id}/finish`,
        JSON.stringify({
          status: "DONE",
          sleepNights: countSleepNights(result.sleepStages),
          workoutsSaved: result.workouts.length,
          activityDays: result.activity.length,
        }),
      )) as ImportJobView;
      setState({ kind: "job", job });
    } catch (err) {
      const cancelled = controller.signal.aborted;
      const message = cancelled ? t.upload.cancelled : err instanceof ImportFailure ? err.message : t.upload.errors.generic;
      if (!cancelled && !(err instanceof ImportFailure)) console.error("[import] save failed:", err);
      if (id) {
        await fetch(`/api/import/${id}/finish`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "FAILED", error: message }),
        }).catch(() => {});
      }
      setState({ kind: "idle", error: cancelled ? undefined : message });
      router.refresh();
    } finally {
      abort.current = null;
    }
  }

  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    if (abort.current) abort.current.abort();
    else setState({ kind: "idle" });
  }

  const cancelButton = (
    <button type="button" onClick={cancel} className="text-[15px] font-medium text-primary">
      {t.upload.cancel}
    </button>
  );

  if (state.kind === "idle") return <DropZone onFile={upload} error={state.error} />;

  if (state.kind === "parsing") {
    return (
      <ProgressCard
        fileName={state.fileName}
        fileBytes={state.fileBytes}
        step={state.phase === "open" ? 0 : 1}
        label={state.phase === "open" ? t.upload.opening : t.upload.reading}
        progress={state.phase === "read" ? state.progress : null}
        detail={state.phase === "open" ? t.upload.openingHint : t.upload.recordsRead(f.number(state.recordsRead), false)}
        action={cancelButton}
      />
    );
  }

  if (state.kind === "saving") {
    return (
      <ProgressCard
        fileName={state.fileName}
        fileBytes={state.fileBytes}
        step={2}
        label={t.upload.saving}
        progress={state.total ? state.sent / state.total : null}
        detail={t.upload.batchesSent(state.sent, state.total)}
        action={cancelButton}
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
