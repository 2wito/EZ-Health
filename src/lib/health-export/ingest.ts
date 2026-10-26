import { normalizePayload } from "./normalize";
import type { HealthPayload } from "./schema";
import { upsertSamples, upsertSleepSessions, upsertSleepStages, upsertWorkouts } from "./store";

export interface IngestResult {
  metricsReceived: number;
  samplesUpserted: number;
  sleepNights: number;
  workoutsUpserted: number;
  skippedMetrics: string[];
  invalidRecords: number;
}

export async function ingestHealthPayload(payload: HealthPayload): Promise<IngestResult> {
  const data = normalizePayload(payload);

  const samplesUpserted = await upsertSamples(data.samples);
  const stageNights = await upsertSleepStages(data.sleepStages);
  await upsertSleepSessions(data.sleepSessions);
  await upsertWorkouts(data.workouts);

  return {
    metricsReceived: data.metricsReceived,
    samplesUpserted,
    sleepNights: data.sleepSessions.length + stageNights,
    workoutsUpserted: data.workouts.length,
    skippedMetrics: data.skippedMetrics,
    invalidRecords: data.invalidRecords,
  };
}
