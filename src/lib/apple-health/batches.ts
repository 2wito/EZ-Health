import type { MetricSampleRecord, SleepStageRecord, WorkoutRecord } from "@/lib/health-export/normalize";
import type { DailyActivityRecord } from "@/lib/health-export/store";

// Client-safe. Splits a parsed export into request bodies small enough for
// serverless hosts (Vercel rejects bodies over 4.5 MB).

export type Batch =
  | { kind: "samples"; records: MetricSampleRecord[] }
  | { kind: "sleepStages"; records: SleepStageRecord[] }
  | { kind: "workouts"; records: WorkoutRecord[] }
  | { kind: "activity"; records: DailyActivityRecord[] };

export const MAX_BATCH_RECORDS = 5_000;
export const MAX_BATCH_BYTES = 3_000_000;

export interface ParsedRecords {
  samples: MetricSampleRecord[];
  sleepStages: SleepStageRecord[];
  workouts: WorkoutRecord[];
  activity: DailyActivityRecord[];
}

/** JSON bodies, each under MAX_BATCH_BYTES and MAX_BATCH_RECORDS. */
export function toBatches(parsed: ParsedRecords, maxBytes = MAX_BATCH_BYTES, maxRecords = MAX_BATCH_RECORDS): string[] {
  const out: string[] = [];
  const add = (batch: Batch) => {
    const body = JSON.stringify(batch);
    if (body.length <= maxBytes || batch.records.length === 1) {
      out.push(body);
      return;
    }
    // Too big (e.g. workouts with long heart-rate curves): halve and retry.
    const mid = Math.ceil(batch.records.length / 2);
    add({ ...batch, records: batch.records.slice(0, mid) } as Batch);
    add({ ...batch, records: batch.records.slice(mid) } as Batch);
  };

  // Sleep in night order, so a night's segments usually travel together.
  const sleep = [...parsed.sleepStages].sort((a, b) => a.night.getTime() - b.night.getTime() || a.start.getTime() - b.start.getTime());
  const groups: Batch[] = [
    { kind: "samples", records: parsed.samples },
    { kind: "sleepStages", records: sleep },
    { kind: "workouts", records: parsed.workouts },
    { kind: "activity", records: parsed.activity },
  ];
  for (const { kind, records } of groups) {
    for (let i = 0; i < records.length; i += maxRecords) {
      add({ kind, records: records.slice(i, i + maxRecords) } as Batch);
    }
  }
  return out;
}

/** Distinct (night, source) pairs: what the import summary calls nights of sleep. */
export const countSleepNights = (stages: SleepStageRecord[]) =>
  new Set(stages.map((s) => `${s.night.getTime()}|${s.source}`)).size;
