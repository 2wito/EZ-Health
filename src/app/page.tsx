import { Activity, BedDouble, Dumbbell, Flame, Heart, MoonStar, Sparkles, Wind } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { TodayLabel } from "@/components/shell/today-label";
import { ConnectCard } from "@/components/summary/connect-card";
import { SectionTitle } from "@/components/ui/card";
import { DatabaseError } from "@/components/ui/database-error";
import { MetricTile } from "@/components/ui/metric-tile";
import { sleepScore } from "@/lib/analytics/sleep";
import { getI18n } from "@/lib/i18n/server";
import { getSummary, type Summary } from "@/lib/queries/summary";

export default async function SummaryPage() {
  const [result, { t }] = await Promise.all([getSummary(), getI18n()]);

  return (
    <>
      <PageHeader
        title={t.nav.summary.title}
        subtitle={<TodayLabel />}
        actions={
          // The sidebar has Import on larger screens.
          <Link href="/upload" className="mb-1.5 text-[17px] text-primary lg:hidden">
            {t.summary.import}
          </Link>
        }
      />
      {result.ok ? <SummaryContent data={result.data} /> : <DatabaseError message={result.error} />}
    </>
  );
}

async function SummaryContent({ data }: { data: Summary }) {
  const { t, f } = await getI18n();
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

      <SectionTitle>{t.summary.latest}</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label={t.summary.readiness}
          icon={Sparkles}
          tint="coach"
          href="/coach"
          measure={readiness ? [[String(readiness.score), t.units.of100]] : null}
          caption={readiness && readinessDay ? f.day(readinessDay, restingHr?.tzOffsetMin ?? 0) : undefined}
          detail={readiness ? t.readiness.levels[readiness.level] : undefined}
        />
        <MetricTile
          label={t.summary.sleepScore}
          icon={MoonStar}
          tint="sleep"
          href="/sleep"
          measure={score !== null ? [[String(score), t.units.of100]] : null}
          caption={sleep ? f.day(sleep.date, sleep.tzOffsetMin) : undefined}
          detail={sleep ? t.summary.asleep(f.duration(sleep.totalSleep)) : undefined}
        />
        <MetricTile
          label={t.summary.restingHr}
          icon={Heart}
          tint="heart"
          href="/heart"
          measure={restingHr?.qty != null ? [[f.number(restingHr.qty), t.units.bpm]] : null}
          caption={restingHr ? f.when(restingHr.timestamp, restingHr.tzOffsetMin) : undefined}
        />
        <MetricTile
          label={t.summary.hrv}
          icon={Activity}
          tint="heart"
          href="/heart"
          measure={hrv?.qty != null ? [[f.number(hrv.qty), t.units.ms]] : null}
          caption={hrv ? f.when(hrv.timestamp, hrv.tzOffsetMin) : undefined}
        />
        <MetricTile
          label={t.summary.respiratory}
          icon={Wind}
          tint="breathing"
          href="/heart"
          measure={breathing?.qty != null ? [[f.number(breathing.qty, 1), t.units.breathsMin]] : null}
          caption={breathing ? f.when(breathing.timestamp, breathing.tzOffsetMin) : undefined}
        />
        <MetricTile
          label={t.summary.sleep}
          icon={BedDouble}
          tint="sleep"
          href="/sleep"
          measure={sleep ? f.hoursToMeasure(sleep.totalSleep) : null}
          caption={sleep ? f.day(sleep.date, sleep.tzOffsetMin) : undefined}
          detail={
            sleep?.sleepStart && sleep.sleepEnd
              ? t.sleep.span(f.clock(sleep.sleepStart, sleep.tzOffsetMin), f.clock(sleep.sleepEnd, sleep.tzOffsetMin))
              : undefined
          }
        />
        <MetricTile
          label={t.summary.activeEnergy}
          icon={Flame}
          tint="activity"
          href="/activity"
          measure={activeEnergy ? [[f.number(activeEnergy.kcal), t.units.kcal]] : null}
          caption={activeEnergy ? f.day(activeEnergy.localDate, activeEnergy.tzOffsetMin) : undefined}
        />
        <MetricTile
          label={t.summary.workout}
          icon={Dumbbell}
          tint="workout"
          href="/activity"
          measure={workout ? [[String(Math.round(workout.durationSec / 60)), t.units.min]] : null}
          caption={workout ? f.when(workout.start, workout.tzOffsetMin) : undefined}
          detail={
            workout
              ? [t.workoutNames[workout.name] ?? workout.name, workout.distanceKm ? `${f.number(workout.distanceKm, 2)} ${t.units.km}` : null]
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
