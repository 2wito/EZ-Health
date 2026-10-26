import { Clock, Dumbbell, Flame, Timer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TrendEvaluator } from "@/components/activity/trend-evaluator";
import { WorkoutCompare } from "@/components/activity/workout-compare";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { ChartCard } from "@/components/charts/chart-card";
import { PageHeader } from "@/components/shell/page-header";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { RangePicker } from "@/components/ui/range-picker";
import { TrendTile } from "@/components/ui/trend-tile";
import { paceLabel } from "@/lib/analytics/activity";
import { parseRange, RANGES } from "@/lib/analytics/range";
import { getI18n } from "@/lib/i18n/server";
import { getActivityData, type ActivityData } from "@/lib/queries/activity";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.activity.title };
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const [result, { t, f }] = await Promise.all([getActivityData(range), getI18n()]);
  const title = t.nav.activity.title;

  if (!result.ok) {
    return (
      <>
        <PageHeader title={title} />
        <DatabaseError message={result.error} />
      </>
    );
  }
  if (!result.data) {
    return (
      <>
        <PageHeader title={title} />
        <EmptyState icon={Flame} tile="bg-activity" title={t.activity.emptyTitle}>
          <p>{t.activity.emptyBody}</p>
          <Link href="/upload" className="mt-3 inline-block font-medium text-primary">
            {t.common.importExport}
          </Link>
        </EmptyState>
      </>
    );
  }

  const data = result.data;
  return (
    <>
      <PageHeader title={title} subtitle={t.common.dateRange(f.chartDay(data.start, 30), f.chartDay(data.end, 30))} />
      <div className="mb-6">
        <RangePicker value={range} basePath="/activity" />
      </div>
      <ActivityContent data={data} />
    </>
  );
}

async function ActivityContent({ data }: { data: ActivityData }) {
  const { t, f } = await getI18n();
  const { trends, heatmap, byWeekday, workouts, evaluation } = data;
  const period = t.common.rangeDays(RANGES[data.range]);
  const u = t.units;
  const hm = (minutes: number) => f.compactDuration(minutes / 60);

  // Callouts from the heatmap. "Quietest" only looks at waking hours.
  const days = byWeekday.filter((d) => d.days > 0);
  const busiestDay = days.length ? days.reduce((a, b) => (b.kcal > a.kcal ? b : a)) : null;
  const quietestDay = days.length ? days.reduce((a, b) => (b.kcal < a.kcal ? b : a)) : null;
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    kcal: heatmap.filter((c) => c.hour === hour).reduce((a, c) => a + c.kcal, 0) / 7,
  }));
  const peakHour = hourly.reduce((a, b) => (b.kcal > a.kcal ? b : a));
  const quietHour = hourly.filter((h) => h.hour >= 8 && h.hour <= 21).reduce((a, b) => (b.kcal < a.kcal ? b : a));
  const peakCell = heatmap.reduce((a, b) => (b.kcal > a.kcal ? b : a));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrendTile label={t.activity.workouts} icon={Dumbbell} tint="workout" unit="" trend={trends.count} spark={[]} periodLabel={period}
          summary={t.trend.total} format={(v) => [v.toFixed(0), t.activity.workoutUnit(v)]} formatDelta={(abs) => `${abs.toFixed(0)}`}
          directionLabels={{ up: t.activity.more, down: t.activity.fewer }} />
        <TrendTile label={t.activity.trainingTime} icon={Timer} tint="workout" unit="" trend={trends.minutes} spark={[]} periodLabel={period}
          summary={t.trend.total} format={(v) => (v >= 60 ? [hm(v), ""] : [v.toFixed(0), u.min])}
          formatDelta={(abs) => (abs >= 60 ? hm(abs) : `${Math.round(abs)} ${u.min}`)}
          directionLabels={{ up: t.activity.more, down: t.activity.less }} />
        <TrendTile label={t.activity.activeEnergy} icon={Flame} tint="activity" unit={u.kcal} trend={trends.energy} spark={[]} periodLabel={period}
          summary={t.trend.dailyAverage} />
        <TrendTile label={t.activity.pace} icon={Clock} tint="workout" unit="" trend={trends.pace} spark={[]} periodLabel={period}
          format={(v) => [paceLabel(60 / v) ?? "—", u.perKm]} formatDelta={(abs) => `${Math.round(abs * 60)} ${u.sPerKm}`}
          directionLabels={{ up: t.activity.slower, down: t.activity.faster }} />
      </div>

      {evaluation && <TrendEvaluator evaluation={evaluation} />}

      <ChartCard
        title={t.activity.heatTitle}
        description={t.activity.heatDesc}
        table={{
          columns: [t.activity.weekdayCol, t.activity.avgKcalCol, t.activity.busiestHourCol],
          rows: byWeekday
            .filter((d) => d.days > 0)
            .map((d) => {
              const cells = heatmap.filter((c) => c.weekday === d.weekday);
              const top = cells.reduce((a, b) => (b.kcal > a.kcal ? b : a));
              return [f.weekdays[d.weekday], Math.round(d.kcal), `${f.hour(top.hour)} (${Math.round(top.kcal)} ${u.kcal})`];
            }),
        }}
      >
        <ActivityHeatmap cells={heatmap} />
        {busiestDay && quietestDay && (
          <dl className="grid gap-3 border-t border-border pt-4 text-[15px] sm:grid-cols-2 lg:grid-cols-4">
            <Callout term={t.activity.mostActiveDay} value={f.weekdays[busiestDay.weekday]} note={t.activity.kcalAverage(Math.round(busiestDay.kcal))} />
            <Callout term={t.activity.leastActiveDay} value={f.weekdays[quietestDay.weekday]} note={t.activity.kcalAverage(Math.round(quietestDay.kcal))} />
            <Callout term={t.activity.peakTime} value={t.activity.peakTimeValue(f.weekdays[peakCell.weekday], f.hour(peakCell.hour))} note={t.activity.busiestOverall(f.hour(peakHour.hour))} />
            <Callout term={t.activity.quietestHour} value={f.hour(quietHour.hour)} note={t.activity.kcalAverage(Math.round(quietHour.kcal))} />
          </dl>
        )}
      </ChartCard>

      {workouts.length > 0 ? (
        <WorkoutCompare workouts={workouts} />
      ) : (
        <ChartCard title={t.activity.compareTitle}>
          <p className="text-[15px] text-muted-foreground">{t.activity.noWorkouts}</p>
        </ChartCard>
      )}
    </div>
  );
}

function Callout({ term, value, note }: { term: string; value: string; note: string }) {
  return (
    <div>
      <dt className="text-[13px] text-muted-foreground">{term}</dt>
      <dd className="font-semibold">{value}</dd>
      <dd className="text-[13px] text-muted-foreground">{note}</dd>
    </div>
  );
}
