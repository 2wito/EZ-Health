import { AlarmClock, BedDouble, CalendarCheck, Moon, Sparkles } from "lucide-react";
import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { formatChartDay } from "@/components/charts/format";
import { Hypnogram, ScheduleChart, StagesChart } from "@/components/charts/sleep-charts";
import { StageMix } from "@/components/charts/stage-mix";
import { STAGES } from "@/components/charts/stages";
import { PageHeader } from "@/components/shell/page-header";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { RangePicker } from "@/components/ui/range-picker";
import { TrendTile } from "@/components/ui/trend-tile";
import { parseRange, RANGES } from "@/lib/analytics/range";
import { clockLabel, durationLabel } from "@/lib/analytics/sleep";
import { getSleepData, type SleepData } from "@/lib/queries/sleep";

export const metadata = { title: "Sleep & Recovery" };

export default async function SleepPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const result = await getSleepData(range);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Sleep & Recovery" />
        <DatabaseError message={result.error} />
      </>
    );
  }
  if (!result.data) {
    return (
      <>
        <PageHeader title="Sleep & Recovery" />
        <EmptyState icon={BedDouble} tile="bg-sleep" title="No sleep data yet">
          <p>
            After a night with your Apple Watch, you&apos;ll see your sleep stages, usual bedtime and wake time, and how
            consistent your schedule is.
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
      <PageHeader title="Sleep & Recovery" subtitle={`${formatChartDay(data.start, 30)} to ${formatChartDay(data.end, 30)}`} />
      <div className="mb-6">
        <RangePicker value={range} basePath="/sleep" />
      </div>
      <SleepContent data={data} />
    </>
  );
}

const clock = (m: number): [string, string] => {
  const [time, ampm] = clockLabel(m).split(" ");
  return [time, ampm];
};
const minutes = (abs: number) => durationLabel(abs / 60);
/** 7.43 → "7h 26m" */
const compactDuration = (hours: number) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)}h ${total % 60}m`;
};

function SleepContent({ data }: { data: SleepData }) {
  const { trends, nights, calendar, lastNight, averages } = data;
  const period = `${RANGES[data.range]} days`;
  const spark = (f: (n: NonNullable<(typeof calendar)[number]["night"]>) => number | null) =>
    calendar.map((c) => (c.night ? f(c.night) : null));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <TrendTile label="Sleep Score" icon={Sparkles} tint="sleep" unit="" trend={trends.score} spark={spark((n) => n.score)} periodLabel={period}
          format={(v) => [v.toFixed(0), "/ 100"]} formatDelta={(abs) => `${abs.toFixed(0)} points`} />
        <TrendTile label="Time Asleep" icon={BedDouble} tint="sleep" unit="" trend={trends.duration} spark={spark((n) => n.total)} periodLabel={period}
          format={(v) => [compactDuration(v), ""]}
          formatDelta={(abs) => durationLabel(abs)} />
        <TrendTile label="Bedtime" icon={Moon} tint="sleep" unit="" trend={trends.bed} spark={spark((n) => n.bed)} periodLabel={period}
          format={clock} formatDelta={minutes} directionLabels={{ up: "later", down: "earlier" }} />
        <TrendTile label="Wake Time" icon={AlarmClock} tint="sleep" unit="" trend={trends.wake} spark={spark((n) => n.wake)} periodLabel={period}
          format={clock} formatDelta={minutes} directionLabels={{ up: "later", down: "earlier" }} />
        <TrendTile label="Consistency" icon={CalendarCheck} tint="sleep" unit="" trend={trends.consistency} spark={[]} periodLabel={period}
          summary="Score" format={(v) => [v.toFixed(0), "/ 100"]} formatDelta={(abs) => `${abs.toFixed(0)} points`} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title={lastNight ? `Last night, ${formatChartDay(lastNight.night.day, 0, true)}` : "Last night"}
          description={lastNight ? `${durationLabel(lastNight.night.total)} asleep. Hover or tab through the stages for times.` : undefined}
          table={
            lastNight && lastNight.segments.length
              ? {
                  columns: ["Stage", "From", "To", "Duration"],
                  rows: lastNight.segments.map((s) => [
                    STAGES.find((x) => x.stage === s.stage)?.label ?? "Asleep",
                    clockLabel(s.start),
                    clockLabel(s.end),
                    durationLabel((s.end - s.start) / 60),
                  ]),
                }
              : undefined
          }
        >
          {lastNight && lastNight.segments.length > 0 ? (
            <>
              <Hypnogram segments={lastNight.segments} />
              <StageMix mix={lastNight.night} />
            </>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              Stage timing isn&apos;t available for this night. Apple Health exports and unaggregated Health Auto Export
              data include it.
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Sleep schedule"
          description={
            trends.bed.current !== null && trends.wake.current !== null
              ? `Usually asleep by ${clockLabel(trends.bed.current)} and up at ${clockLabel(trends.wake.current)}. Lines mark those averages.`
              : "When you fell asleep and woke up each night."
          }
          table={{
            columns: ["Night", "Asleep", "Woke", "Duration"],
            rows: [...nights].reverse().map((n) => [
              formatChartDay(n.day, 0, true),
              n.bed === null ? null : clockLabel(n.bed),
              n.wake === null ? null : clockLabel(n.wake),
              durationLabel(n.total),
            ]),
          }}
        >
          <ScheduleChart calendar={calendar} avgBed={trends.bed.current} avgWake={trends.wake.current} />
        </ChartCard>
      </div>

      <ChartCard
        title="Sleep stages by night"
        description="Hours in each stage. Adults typically spend about 13–23% of sleep in deep and 20–25% in REM."
        legend={STAGES.map((s) => ({ label: s.label, color: s.color, kind: "square" as const }))}
        table={{
          columns: ["Night", "Deep", "Core", "REM", "Awake", "Asleep"],
          rows: [...nights].reverse().map((n) => [
            formatChartDay(n.day, 0, true),
            durationLabel(n.deep),
            durationLabel(n.core),
            durationLabel(n.rem),
            durationLabel(n.awake),
            durationLabel(n.total),
          ]),
        }}
      >
        <StagesChart calendar={calendar} />
        {averages && (
          <div className="border-t border-border pt-4">
            <p className="mb-3 text-[15px] font-semibold">Average night: {durationLabel(averages.total)} asleep</p>
            <StageMix mix={averages} />
          </div>
        )}
      </ChartCard>

      <p className="mt-3 max-w-3xl text-[13px] leading-[18px] text-muted-foreground">
        Sleep score (0–100) weighs duration (50 points, full marks for 7–9 hours), deep and REM share (30 points, full
        marks at 40% of sleep) and time awake (20 points, none at an hour awake). Consistency is 100 when you fall asleep
        and wake at the same times every night, and drops to 0 as those times vary by two hours. This is not medical
        advice.
      </p>
    </div>
  );
}
