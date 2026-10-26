import { Activity, BedDouble, Dumbbell, Flame, Heart, MoonStar, Sparkles, Wind } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { TodayLabel } from "@/components/shell/today-label";
import { ConnectCard } from "@/components/summary/connect-card";
import { SectionTitle } from "@/components/ui/card";
import { DatabaseError } from "@/components/ui/database-error";
import { MetricTile } from "@/components/ui/metric-tile";
import { formatClock, formatDay, formatNumber, formatWhen, hoursToMeasure } from "@/lib/format";
import { sleepScore } from "@/lib/analytics/sleep";
import { getSummary, type Summary } from "@/lib/queries/summary";

export default async function SummaryPage() {
  const result = await getSummary();

  return (
    <>
      <PageHeader
        title="Summary"
        subtitle={<TodayLabel />}
        actions={
          // The sidebar has Import on larger screens.
          <Link href="/upload" className="mb-1.5 text-[17px] text-primary lg:hidden">
            Import
          </Link>
        }
      />
      {result.ok ? <SummaryContent data={result.data} /> : <DatabaseError message={result.error} />}
    </>
  );
}

async function SummaryContent({ data }: { data: Summary }) {
  const { readiness, readinessDay, restingHr, hrv, breathing, activeEnergy, sleep, workout } = data;
  const score = sleep
    ? sleepScore({ total: sleep.totalSleep, deep: sleep.deepHours, rem: sleep.remHours, awake: sleep.awakeHours })
    : null;

  return (
    <>
      {data.isEmpty && (
        <div className="mb-8">
          <ConnectCard endpoint={await ingestEndpoint()} />
        </div>
      )}

      <SectionTitle>Latest</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Readiness"
          icon={Sparkles}
          tint="coach"
          href="/coach"
          measure={readiness ? [[String(readiness.score), "/ 100"]] : null}
          caption={readiness && readinessDay ? formatDay(readinessDay, restingHr?.tzOffsetMin ?? 0) : undefined}
          detail={readiness?.label}
        />
        <MetricTile
          label="Sleep Score"
          icon={MoonStar}
          tint="sleep"
          href="/sleep"
          measure={score !== null ? [[String(score), "/ 100"]] : null}
          caption={sleep ? formatDay(sleep.date, sleep.tzOffsetMin) : undefined}
          detail={sleep ? `${hoursToMeasure(sleep.totalSleep).map(([v, u]) => `${v} ${u}`).join(" ")} asleep` : undefined}
        />
        <MetricTile
          label="Resting Heart Rate"
          icon={Heart}
          tint="heart"
          href="/heart"
          measure={restingHr?.qty != null ? [[formatNumber(restingHr.qty), "bpm"]] : null}
          caption={restingHr ? formatWhen(restingHr.timestamp, restingHr.tzOffsetMin) : undefined}
        />
        <MetricTile
          label="Heart Rate Variability"
          icon={Activity}
          tint="heart"
          href="/heart"
          measure={hrv?.qty != null ? [[formatNumber(hrv.qty), "ms"]] : null}
          caption={hrv ? formatWhen(hrv.timestamp, hrv.tzOffsetMin) : undefined}
        />
        <MetricTile
          label="Respiratory Rate"
          icon={Wind}
          tint="breathing"
          href="/heart"
          measure={breathing?.qty != null ? [[formatNumber(breathing.qty, 1), "breaths/min"]] : null}
          caption={breathing ? formatWhen(breathing.timestamp, breathing.tzOffsetMin) : undefined}
        />
        <MetricTile
          label="Sleep"
          icon={BedDouble}
          tint="sleep"
          href="/sleep"
          measure={sleep ? hoursToMeasure(sleep.totalSleep) : null}
          caption={sleep ? formatDay(sleep.date, sleep.tzOffsetMin) : undefined}
          detail={
            sleep?.sleepStart && sleep.sleepEnd
              ? `${formatClock(sleep.sleepStart, sleep.tzOffsetMin)} – ${formatClock(sleep.sleepEnd, sleep.tzOffsetMin)}`
              : undefined
          }
        />
        <MetricTile
          label="Active Energy"
          icon={Flame}
          tint="activity"
          href="/activity"
          measure={activeEnergy ? [[formatNumber(activeEnergy.kcal), "kcal"]] : null}
          caption={activeEnergy ? formatDay(activeEnergy.localDate, activeEnergy.tzOffsetMin) : undefined}
        />
        <MetricTile
          label="Workout"
          icon={Dumbbell}
          tint="workout"
          href="/activity"
          measure={workout ? [[String(Math.round(workout.durationSec / 60)), "min"]] : null}
          caption={workout ? formatWhen(workout.start, workout.tzOffsetMin) : undefined}
          detail={
            workout
              ? [workout.name, workout.distanceKm ? `${formatNumber(workout.distanceKm, 2)} km` : null]
                  .filter(Boolean)
                  .join(", ")
              : undefined
          }
        />
      </div>
    </>
  );
}

async function ingestEndpoint() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/health-ingest`;
}
