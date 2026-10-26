// Realistic demo data, so the dashboards can be explored before importing a
// real export. Generates an Apple Health export.xml and feeds it through the
// real import pipeline. Every row is tagged with a "EZ Health Demo" source so
// it can be removed cleanly.
//
//   npm run demo:import   # ~120 days ending yesterday
//   npm run demo:clear    # remove it again
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import JSZip from "jszip";
import { runImport } from "@/lib/apple-health/import";
import { clearDemoData, DEMO_JOB_NAME } from "@/lib/demo/demo-data";
import { prisma } from "@/lib/prisma";

const WATCH = "EZ Health Demo Watch";
const PHONE = "EZ Health Demo iPhone";
// DEMO_DAYS makes a longer history (e.g. to try the All time range); the default matches the live demo.
const DAYS = Number(process.env.DEMO_DAYS) || 120;
const TZ_MIN = 120; // +02:00


async function clear() {
  const removed = await clearDemoData();
  console.log(
    `Removed demo data: ${removed.samples} samples, ${removed.sessions} nights (${removed.stages} stages), ` +
      `${removed.workouts} workouts, ${removed.jobs} import records.`,
  );
}

async function importDemo() {
  const dir = await mkdtemp(path.join(tmpdir(), "ez-health-demo-"));
  const file = path.join(dir, "export.xml");
  await writeExport(file);
  const job = await prisma.importJob.create({ data: { fileName: DEMO_JOB_NAME, status: "QUEUED" } });
  await runImport(job.id, file);
  await rm(dir, { recursive: true, force: true });
  const done = await prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
  console.log(
    done.status === "DONE"
      ? `Imported ${DAYS} days of demo data: ${done.recordsRead} records, ${done.sleepNights} nights, ${done.workoutsSaved} workouts.`
      : `Demo import failed: ${done.error}`,
  );
}

/** Writes the demo as export.xml and as an export.zip laid out like the Health app's. */
async function exportFiles(dir: string) {
  await mkdir(dir, { recursive: true });
  const xml = path.join(dir, "export.xml");
  await writeExport(xml);
  const zip = new JSZip();
  zip.file("apple_health_export/export.xml", await readFile(xml));
  const zipPath = path.join(dir, "export.zip");
  await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`Wrote ${xml} and ${zipPath}`);
}

// ─── Generator ───────────────────────────────────────────────────────────────

// Deterministic PRNG so the demo looks the same every time.
let seed = 20261026;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rand() * (b - a);
// Steps draw from their own sequence, so adding them left every other demo value
// unchanged (re-importing over an older demo must not shift the sleep segments).
const stepSeq = (() => {
  let s = 77_001;
  return () => {
    s = (Math.imul(s, 1_103_515_245) + 12_345) >>> 0;
    return s / 4_294_967_296;
  };
})();
const noise = (spread: number) => (rand() + rand() + rand() - 1.5) * (spread / 1.5);

const pad = (n: number) => String(n).padStart(2, "0");
/** Local wall-clock minutes since the local epoch day → "YYYY-MM-DD HH:MM:SS +0200". */
function fmt(localMs: number) {
  const d = new Date(localMs);
  const sign = TZ_MIN >= 0 ? "+" : "-";
  const off = `${sign}${pad(Math.floor(Math.abs(TZ_MIN) / 60))}${pad(Math.abs(TZ_MIN) % 60)}`;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${off}`;
}
const MIN = 60_000;
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

async function writeExport(file: string) {
  const out = createWriteStream(file);
  const write = async (s: string) => {
    if (!out.write(s)) await once(out, "drain");
  };
  const record = (type: string, unit: string, start: number, end: number, value: number | string, source = WATCH) =>
    write(
      ` <Record type="${type}" sourceName="${attr(source)}" unit="${unit}" startDate="${fmt(start)}" endDate="${fmt(end)}" value="${value}"/>\n`,
    );
  const sleep = (start: number, end: number, value: string, source = WATCH) =>
    write(
      ` <Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${attr(source)}" startDate="${fmt(start)}" endDate="${fmt(end)}" value="HKCategoryValueSleepAnalysis${value}"/>\n`,
    );

  await write('<?xml version="1.0" encoding="UTF-8"?>\n<HealthData locale="en_US">\n');

  // Local midnight "today", as a wall-clock timestamp.
  const now = new Date(Date.now() + TZ_MIN * MIN);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const workouts: string[] = [];

  for (let i = DAYS; i >= 1; i--) {
    const day = today - i * 86_400_000;
    const progress = (DAYS - i) / DAYS; // 0 → 1: fitness slowly improves
    const weekday = new Date(day).getUTCDay(); // 0 = Sunday
    const weekend = weekday === 5 || weekday === 6; // Fri/Sat weekend

    // Workouts: run Sun/Tue/Thu, strength Mon/Wed, long run Sat.
    const plan: { kind: "run" | "strength"; hour: number; min: number } | null =
      weekday === 0 || weekday === 2 || weekday === 4
        ? { kind: "run", hour: 18, min: Math.round(between(28, 45)) }
        : weekday === 1 || weekday === 3
          ? { kind: "strength", hour: 19, min: Math.round(between(45, 60)) }
          : weekday === 6
            ? { kind: "run", hour: 9, min: Math.round(between(55, 75)) }
            : null;
    const skipped = rand() < 0.12;
    const workout = plan && !skipped ? plan : null;
    const hardYesterday = rand() < 0.25;

    // Sleep the night before `day` (ending that morning).
    const bed = day - 86_400_000 + (weekend ? 24.4 : 23.3) * 60 * MIN + noise(45) * MIN;
    const wake = day + (weekend ? 8.4 : 6.9) * 60 * MIN + noise(25) * MIN;
    await sleep(bed - 10 * MIN, wake + 5 * MIN, "InBed", PHONE);
    let t = bed + between(8, 20) * MIN;
    let cycle = 0;
    while (t < wake - 20 * MIN) {
      const early = cycle < 2;
      const segs: [string, number][] = [
        ["AsleepCore", between(25, 45)],
        ["AsleepDeep", early ? between(20, 35) : between(0, 10)],
        ["AsleepCore", between(10, 20)],
        ["AsleepREM", early ? between(8, 15) : between(20, 35)],
      ];
      if (rand() < 0.35) segs.push(["Awake", between(1, 6)]);
      for (const [stage, mins] of segs) {
        if (mins < 1 || t >= wake) continue;
        const end = Math.min(t + mins * MIN, wake);
        await sleep(t, end, stage);
        t = end;
      }
      cycle++;
    }

    // Overnight respiratory rate + HRV.
    for (let h = 1; h <= 5; h++) {
      const at = day + h * 60 * MIN + between(0, 50) * MIN;
      await record("HKQuantityTypeIdentifierRespiratoryRate", "count/min", at, at, (14.6 + noise(0.8) + (hardYesterday ? 0.4 : 0)).toFixed(1));
    }
    const hrvBase = 42 + 10 * progress - (hardYesterday ? 7 : 0);
    for (const h of [3, 9, 15]) {
      const at = day + h * 60 * MIN + between(0, 40) * MIN;
      await record("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "ms", at, at + MIN, Math.max(18, hrvBase + noise(9)).toFixed(1));
    }

    const rhr = 58.5 - 4 * progress + noise(1.6) + (hardYesterday ? 1.5 : 0);
    await record("HKQuantityTypeIdentifierRestingHeartRate", "count/min", day, day + 86_399_000, Math.round(rhr));

    // Heart rate every 10 minutes; active energy per 10 minutes with a daily rhythm.
    const wStart = workout ? day + workout.hour * 60 * MIN : -1;
    const wEnd = workout ? wStart + workout.min * MIN : -1;
    for (let m = 0; m < 1440; m += 10) {
      const at = day + m * MIN;
      const hour = m / 60;
      const asleep = at < wake;
      const inWorkout = at >= wStart && at < wEnd;
      const hr = inWorkout
        ? (workout!.kind === "run" ? 150 - 5 * progress : 118) + noise(12)
        : asleep
          ? rhr + noise(3)
          : rhr + 14 + noise(10);
      await record("HKQuantityTypeIdentifierHeartRate", "count/min", at, at, Math.round(hr));

      if (asleep && !inWorkout) continue;
      const peak = (center: number, width: number, height: number) => height * Math.exp(-(((hour - center) / width) ** 2));
      const rhythm = weekend
        ? peak(11, 1.5, 9) + peak(17, 2, 6)
        : peak(8.3, 0.6, 10) + peak(12.6, 0.5, 7) + peak(17.8, 0.8, 6);
      const kcal = inWorkout ? (workout!.kind === "run" ? 105 : 62) : Math.max(0.3, rhythm + 1.4 + noise(1.5));
      await record("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", at, at + 10 * MIN, kcal.toFixed(2));

      // Steps from the Watch, plus a lower count from the iPhone (not always carried):
      // the dashboards must count each hour once, not add the two up.
      const steps = inWorkout ? (workout!.kind === "run" ? 1_550 : 120) : rhythm * 40 + 25;
      const watchSteps = Math.round(steps * (0.85 + stepSeq() * 0.3));
      await record("HKQuantityTypeIdentifierStepCount", "count", at, at + 10 * MIN, watchSteps);
      if (!inWorkout && stepSeq() < 0.8) {
        await record("HKQuantityTypeIdentifierStepCount", "count", at, at + 10 * MIN, Math.round(watchSteps * (0.7 + stepSeq() * 0.2)), PHONE);
      }
    }

    if (workout) {
      const run = workout.kind === "run";
      const paceMinPerKm = 5.9 - 0.45 * progress + noise(0.15) + (workout.min > 50 ? 0.3 : 0);
      const km = run ? workout.min / paceMinPerKm : 0;
      const avgHr = run ? 150 - 5 * progress + noise(3) + (workout.min > 50 ? -3 : 0) : 118 + noise(5);
      const kcal = workout.min * (run ? 10.5 : 6.2);
      workouts.push(
        ` <Workout workoutActivityType="HKWorkoutActivityType${run ? "Running" : "TraditionalStrengthTraining"}" duration="${workout.min}" durationUnit="min" sourceName="${WATCH}" startDate="${fmt(wStart)}" endDate="${fmt(wEnd)}">\n` +
          `  <MetadataEntry key="HKIndoorWorkout" value="0"/>\n` +
          (run ? `  <MetadataEntry key="HKElevationAscended" value="${Math.round(between(2000, 9000))} cm"/>\n` : "") +
          `  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" sum="${kcal.toFixed(1)}" unit="kcal"/>\n` +
          `  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="${avgHr.toFixed(1)}" minimum="${Math.round(avgHr - 45)}" maximum="${Math.round(avgHr + (run ? 24 : 32))}" unit="count/min"/>\n` +
          (run
            ? `  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" sum="${km.toFixed(2)}" unit="km"/>\n` +
              `  <WorkoutStatistics type="HKQuantityTypeIdentifierStepCount" sum="${Math.round(km * 1350)}" unit="count"/>\n`
            : "") +
          ` </Workout>\n`,
      );
    }
  }

  for (const w of workouts) await write(w);
  await write("</HealthData>\n");
  out.end();
  await once(out, "finish");
}

// Run last: top-level code above must be initialized first.
const command = process.argv[2];
if (command === "clear") await clear();
else if (command === "import") await importDemo();
else if (command === "export" && process.argv[3]) await exportFiles(path.resolve(process.argv[3]));
else console.error("Usage: tsx scripts/demo-data.mts <import|clear|export <dir>>");
await prisma.$disconnect();
