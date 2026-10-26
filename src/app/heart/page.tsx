import { Activity, Dumbbell, Heart, Wind } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChartCard, dailyTableRows } from "@/components/charts/chart-card";
import { TimeSeriesChart, type Series } from "@/components/charts/time-series-chart";
import { PageHeader } from "@/components/shell/page-header";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { RangePicker } from "@/components/ui/range-picker";
import { TrendTile } from "@/components/ui/trend-tile";
import { parseRange, RANGE_DAYS } from "@/lib/analytics/range";
import { getI18n } from "@/lib/i18n/server";
import type { Format } from "@/lib/format";
import type { Messages } from "@/lib/i18n/messages";
import { getHeartData, type HeartData } from "@/lib/queries/heart";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t.nav.heart.title };
}

const COLORS = { resting: "var(--heart)", workout: "var(--primary)", hrv: "var(--heart)", breathing: "var(--breathing)" };

export default async function HeartPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const [result, { t, f }] = await Promise.all([getHeartData(range), getI18n()]);
  const title = t.nav.heart.title;

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
        <EmptyState icon={Heart} tile="bg-heart" title={t.heart.emptyTitle}>
          <p>{t.heart.emptyBody}</p>
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
      <PageHeader title={title} subtitle={span(data, f, t)} />
      <div className="mb-6">
        <RangePicker value={range} basePath="/heart" />
      </div>
      <HeartContent data={data} />
    </>
  );
}

async function HeartContent({ data }: { data: HeartData }) {
  const { t, f } = await getI18n();
  const { days, trends } = data;
  const period = data.range === "all" ? t.common.rangeAll : t.common.rangeDays(RANGE_DAYS[data.range]);
  const halves = data.comparison === "halves";
  const g = data.granularity;
  const note = g === "day" ? "" : ` ${t.common.bucketNote[g]}`;
  const has = (key: "resting" | "workout" | "hrv" | "breathing") => days.some((d) => d[key] !== null);
  const u = t.units;

  const comparison: Series[] = [
    { key: "resting", label: t.heart.resting, color: COLORS.resting, kind: "line" },
    { key: "workout", label: t.heart.workouts, color: COLORS.workout, kind: "dots" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrendTile label={t.heart.restingHr} icon={Heart} tint="heart" unit={u.bpm} trend={trends.resting} spark={days.map((d) => d.resting)} periodLabel={period} halves={halves} />
        <TrendTile label={t.heart.workoutHr} icon={Dumbbell} tint="primary" unit={u.bpm} trend={trends.workout} spark={days.map((d) => d.workout)} sparkStyle="dots" periodLabel={period} halves={halves} />
        <TrendTile label={t.heart.hrv} icon={Activity} tint="heart" unit={u.ms} trend={trends.hrv} spark={days.map((d) => d.hrv)} periodLabel={period} halves={halves} />
        <TrendTile label={t.heart.respiratory} icon={Wind} tint="breathing" unit={u.brMin} digits={1} trend={trends.breathing} spark={days.map((d) => d.breathing)} periodLabel={period} halves={halves} />
      </div>

      <ChartCard
        title={t.heart.compareTitle}
        description={t.heart.compareDesc + note}
        legend={[
          { label: t.heart.resting, color: COLORS.resting, kind: "line" },
          { label: t.heart.workouts, color: COLORS.workout, kind: "dot" },
        ]}
        table={{
          columns: [t.common.date, t.heart.restingCol, t.heart.workoutCol],
          rows: dailyTableRows(days, [(d) => round(d.resting), (d) => round(d.workout)], f, g),
        }}
      >
        {has("resting") || has("workout") ? (
          <TimeSeriesChart data={days} series={comparison} unit={u.bpm} days={days.length} granularity={g} height={260} />
        ) : (
          <NoReadings text={t.heart.noReadings.heart} />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title={t.heart.hrvTitle}
          description={t.heart.hrvDesc + note}
          table={{ columns: [t.common.date, t.heart.hrvCol], rows: dailyTableRows(days, [(d) => round(d.hrv)], f, g) }}
        >
          {has("hrv") ? (
            <TimeSeriesChart
              data={days}
              series={[{ key: "hrv", label: t.heart.hrv, color: COLORS.hrv, kind: "area" }]}
              unit={u.ms}
              days={days.length} granularity={g}
              height={200}
            />
          ) : (
            <NoReadings text={t.heart.noReadings.hrv} />
          )}
        </ChartCard>

        <ChartCard
          title={t.heart.respTitle}
          description={t.heart.respDesc + note}
          table={{ columns: [t.common.date, t.heart.respCol], rows: dailyTableRows(days, [(d) => round(d.breathing, 1)], f, g) }}
        >
          {has("breathing") ? (
            <TimeSeriesChart
              data={days}
              series={[{ key: "breathing", label: t.heart.respSeries, color: COLORS.breathing, kind: "area", digits: 1 }]}
              unit={u.brMin}
              days={days.length} granularity={g}
              height={200}
            />
          ) : (
            <NoReadings text={t.heart.noReadings.breathing} />
          )}
        </ChartCard>
      </div>

      <p className="mt-3 max-w-3xl text-[13px] leading-[18px] text-muted-foreground">
        {t.heart.footnote} {halves && `${t.common.halvesNote} `}{t.common.notMedical}
      </p>
    </div>
  );
}

function NoReadings({ text }: { text: string }) {
  return <p className="grid h-40 place-items-center text-[15px] text-subtle-foreground">{text}</p>;
}

const round = (v: number | null, digits = 0) => (v === null ? null : Number(v.toFixed(digits)));

/** "Sep 26 to Oct 25", with years when the window is all time. */
function span(data: HeartData, f: Format, t: Messages) {
  return data.range === "all"
    ? t.common.dateRange(f.dateWithYear(data.start), f.dateWithYear(data.end))
    : t.common.dateRange(f.chartDay(data.start, 30), f.chartDay(data.end, 30));
}
