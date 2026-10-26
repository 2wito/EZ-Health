import { Clock, Dumbbell, Flame, Timer } from "lucide-react";
import Link from "next/link";
import { TrendEvaluator } from "@/components/activity/trend-evaluator";
import { WorkoutCompare } from "@/components/activity/workout-compare";
import { ActivityHeatmap } from "@/components/charts/activity-heatmap";
import { ChartCard } from "@/components/charts/chart-card";
import { formatChartDay } from "@/components/charts/format";
import { PageHeader } from "@/components/shell/page-header";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { RangePicker } from "@/components/ui/range-picker";
import { TrendTile } from "@/components/ui/trend-tile";
import { hourLabel, paceLabel } from "@/lib/analytics/activity";
import { parseRange, RANGES } from "@/lib/analytics/range";
import { getActivityData, type ActivityData } from "@/lib/queries/activity";

export const metadata = { title: "Workouts & Trends" };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const result = await getActivityData(range);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Workouts & Trends" />
        <DatabaseError message={result.error} />
      </>
    );
  }
  if (!result.data) {
    return (
      <>
        <PageHeader title="Workouts & Trends" />
        <EmptyState icon={Flame} tile="bg-activity" title="No activity yet">
          <p>
            Record a workout to compare it with past ones, see your most and least active hours, and track whether your
            fitness is trending up over 7, 30 and 90 days.
          </p>
          <Link href="/upload" className="mt-3 inline-block font-medium text-primary">
            Import an Apple Health export
          </Link>
        </EmptyState>
      </>
    );
  }

  const data = result.data;
  return (
    <>
      <PageHeader title="Workouts & Trends" subtitle={`${formatChartDay(data.start, 30)} to ${formatChartDay(data.end, 30)}`} />
      <div className="mb-6">
        <RangePicker value={range} basePath="/activity" />
      </div>
      <ActivityContent data={data} />
    </>
  );
}

function ActivityContent({ data }: { data: ActivityData }) {
  const { trends, heatmap, byWeekday, workouts, evaluation } = data;
  const period = `${RANGES[data.range]} days`;

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
        <TrendTile label="Workouts" icon={Dumbbell} tint="workout" unit="" trend={trends.count} spark={[]} periodLabel={period}
          summary="Total" format={(v) => [v.toFixed(0), v === 1 ? "workout" : "workouts"]} formatDelta={(abs) => `${abs.toFixed(0)}`}
          directionLabels={{ up: "more", down: "fewer" }} />
        <TrendTile label="Training Time" icon={Timer} tint="workout" unit="" trend={trends.minutes} spark={[]} periodLabel={period}
          summary="Total" format={(v) => (v >= 60 ? [`${Math.floor(v / 60)}h ${Math.round(v % 60)}m`, ""] : [v.toFixed(0), "min"])}
          formatDelta={(abs) => (abs >= 60 ? `${Math.floor(abs / 60)}h ${Math.round(abs % 60)}m` : `${Math.round(abs)} min`)}
          directionLabels={{ up: "more", down: "less" }} />
        <TrendTile label="Active Energy" icon={Flame} tint="activity" unit="kcal" trend={trends.energy} spark={[]} periodLabel={period}
          summary="Daily average" />
        <TrendTile label="Running Pace" icon={Clock} tint="workout" unit="" trend={trends.pace} spark={[]} periodLabel={period}
          format={(v) => [paceLabel(60 / v) ?? "—", "/km"]} formatDelta={(abs) => `${Math.round(abs * 60)} s/km`}
          directionLabels={{ up: "slower", down: "faster" }} />
      </div>

      {evaluation && <TrendEvaluator evaluation={evaluation} />}

      <ChartCard
        title="When you're most active"
        description="Average active calories for each hour of each weekday."
        table={{
          columns: ["Weekday", "Avg kcal per day", "Busiest hour"],
          rows: byWeekday
            .filter((d) => d.days > 0)
            .map((d) => {
              const cells = heatmap.filter((c) => c.weekday === d.weekday);
              const top = cells.reduce((a, b) => (b.kcal > a.kcal ? b : a));
              return [WEEKDAYS[d.weekday], Math.round(d.kcal), `${hourLabel(top.hour)} (${Math.round(top.kcal)} kcal)`];
            }),
        }}
      >
        <ActivityHeatmap cells={heatmap} />
        {busiestDay && quietestDay && (
          <dl className="grid gap-3 border-t border-border pt-4 text-[15px] sm:grid-cols-2 lg:grid-cols-4">
            <Callout term="Most active day" value={WEEKDAYS[busiestDay.weekday]} note={`${Math.round(busiestDay.kcal)} kcal on average`} />
            <Callout term="Least active day" value={WEEKDAYS[quietestDay.weekday]} note={`${Math.round(quietestDay.kcal)} kcal on average`} />
            <Callout term="Peak time" value={`${WEEKDAYS[peakCell.weekday]}s, ${hourLabel(peakCell.hour)}`} note={`Busiest hour overall: ${hourLabel(peakHour.hour)}`} />
            <Callout term="Quietest waking hour" value={hourLabel(quietHour.hour)} note={`${Math.round(quietHour.kcal)} kcal on average`} />
          </dl>
        )}
      </ChartCard>

      {workouts.length > 0 ? (
        <WorkoutCompare workouts={workouts} />
      ) : (
        <ChartCard title="Compare workouts">
          <p className="text-[15px] text-muted-foreground">No workouts in this period.</p>
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
