import { AlarmClock, BedDouble, CalendarCheck, Moon, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { Hypnogram, ScheduleChart, StagesChart } from "@/components/charts/sleep-charts";
import { StageMix } from "@/components/charts/stage-mix";
import { STAGES, UNSPECIFIED } from "@/components/charts/stages";
import { PageHeader } from "@/components/shell/page-header";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { RangePicker } from "@/components/ui/range-picker";
import { TrendTile } from "@/components/ui/trend-tile";
import { parseRange, RANGE_DAYS } from "@/lib/analytics/range";
import { getI18n } from "@/lib/i18n/server";
import { getSleepData, type SleepData } from "@/lib/queries/sleep";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.sleep.title };
}

export default async function SleepPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const [result, { t, f }] = await Promise.all([getSleepData(range), getI18n()]);
  const title = t.nav.sleep.title;

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
        <EmptyState icon={BedDouble} tile="bg-sleep" title={t.sleep.emptyTitle}>
          <p>{t.sleep.emptyBody}</p>
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
      <PageHeader title={title} subtitle={
          data.range === "all"
            ? t.common.dateRange(f.dateWithYear(data.start), f.dateWithYear(data.end))
            : t.common.dateRange(f.chartDay(data.start, 30), f.chartDay(data.end, 30))
        } />
      <div className="mb-6">
        <RangePicker value={range} basePath="/sleep" />
      </div>
      <SleepContent data={data} />
    </>
  );
}

async function SleepContent({ data }: { data: SleepData }) {
  const { t, f } = await getI18n();
  const { trends, nights, calendar, lastNight, averages } = data;
  const period = data.range === "all" ? t.common.rangeAll : t.common.rangeDays(RANGE_DAYS[data.range]);
  const halves = data.comparison === "halves";
  const g = data.granularity;
  const note = g === "day" ? "" : ` ${t.common.bucketNote[g]}`;
  // Table rows: nights, or week/month averages for long windows (newest first).
  const tableNights = (g === "day" ? nights : calendar.flatMap((c) => (c.night ? [c.night] : []))).toReversed();
  const spark = (pick: (n: NonNullable<(typeof calendar)[number]["night"]>) => number | null) =>
    calendar.map((c) => (c.night ? pick(c.night) : null));
  const minutes = (abs: number) => f.duration(abs / 60);
  const points = (abs: number) => t.trend.points(abs.toFixed(0));
  const shift = { up: t.sleep.later, down: t.sleep.earlier };
  const stageName = (stage: string) => {
    const s = [...STAGES, UNSPECIFIED].find((x) => x.stage === stage);
    return t.stages[s?.key ?? "unspecified"];
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <TrendTile label={t.sleep.score} icon={Sparkles} tint="sleep" unit="" trend={trends.score} spark={spark((n) => n.score)} periodLabel={period} halves={halves}
          format={(v) => [v.toFixed(0), t.units.of100]} formatDelta={points} />
        <TrendTile label={t.sleep.timeAsleep} icon={BedDouble} tint="sleep" unit="" trend={trends.duration} spark={spark((n) => n.total)} periodLabel={period} halves={halves}
          format={(v) => [f.compactDuration(v), ""]}
          formatDelta={(abs) => f.duration(abs)} />
        <TrendTile label={t.sleep.bedtime} icon={Moon} tint="sleep" unit="" trend={trends.bed} spark={spark((n) => n.bed)} periodLabel={period} halves={halves}
          format={f.clockParts} formatDelta={minutes} directionLabels={shift} />
        <TrendTile label={t.sleep.wakeTime} icon={AlarmClock} tint="sleep" unit="" trend={trends.wake} spark={spark((n) => n.wake)} periodLabel={period} halves={halves}
          format={f.clockParts} formatDelta={minutes} directionLabels={shift} />
        <TrendTile label={t.sleep.consistency} icon={CalendarCheck} tint="sleep" unit="" trend={trends.consistency} spark={[]} periodLabel={period} halves={halves}
          summary={t.trend.score} format={(v) => [v.toFixed(0), t.units.of100]} formatDelta={points} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title={lastNight ? t.sleep.lastNightOn(f.chartDay(lastNight.night.day, 0, true)) : t.sleep.lastNight}
          description={lastNight ? t.sleep.lastNightDesc(f.duration(lastNight.night.total)) : undefined}
          table={
            lastNight && lastNight.segments.length
              ? {
                  columns: [t.sleep.stage, t.sleep.from, t.sleep.to, t.common.duration],
                  rows: lastNight.segments.map((s) => [
                    stageName(s.stage),
                    f.clockLabel(s.start),
                    f.clockLabel(s.end),
                    f.duration((s.end - s.start) / 60),
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
            <p className="text-[15px] text-muted-foreground">{t.sleep.noStages}</p>
          )}
        </ChartCard>

        <ChartCard
          title={t.sleep.scheduleTitle}
          description={
            (trends.bed.current !== null && trends.wake.current !== null
              ? t.sleep.scheduleDesc(f.clockLabel(trends.bed.current), f.clockLabel(trends.wake.current))
              : t.sleep.scheduleDescEmpty) + note
          }
          table={{
            columns: [t.common.night, t.sleep.asleepCol, t.sleep.wokeCol, t.common.duration],
            rows: tableNights.map((n) => [
              f.period(n.day, g, 0, true),
              n.bed === null ? null : f.clockLabel(n.bed),
              n.wake === null ? null : f.clockLabel(n.wake),
              f.duration(n.total),
            ]),
          }}
        >
          <ScheduleChart calendar={calendar} avgBed={trends.bed.current} avgWake={trends.wake.current} granularity={g} />
        </ChartCard>
      </div>

      <ChartCard
        title={t.sleep.stagesTitle}
        description={t.sleep.stagesDesc + note}
        legend={STAGES.map((s) => ({ label: t.stages[s.key], color: s.color, kind: "square" as const }))}
        table={{
          columns: [t.common.night, t.stages.deep, t.stages.core, t.stages.rem, t.stages.awake, t.stages.unspecified],
          rows: tableNights.map((n) => [
            f.period(n.day, g, 0, true),
            f.duration(n.deep),
            f.duration(n.core),
            f.duration(n.rem),
            f.duration(n.awake),
            f.duration(n.total),
          ]),
        }}
      >
        <StagesChart calendar={calendar} granularity={g} />
        {averages && (
          <div className="border-t border-border pt-4">
            <p className="mb-3 text-[15px] font-semibold">{t.sleep.averageNight(f.duration(averages.total))}</p>
            <StageMix mix={averages} />
          </div>
        )}
      </ChartCard>

      <p className="mt-3 max-w-3xl text-[13px] leading-[18px] text-muted-foreground">
        {t.sleep.footnote} {halves && `${t.common.halvesNote} `}{t.common.notMedical}
      </p>
    </div>
  );
}
