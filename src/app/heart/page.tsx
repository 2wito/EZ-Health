import { Activity, Dumbbell, Heart, Wind } from "lucide-react";
import Link from "next/link";
import { ChartCard, dailyTableRows } from "@/components/charts/chart-card";
import { formatChartDay } from "@/components/charts/format";
import { TimeSeriesChart, type Series } from "@/components/charts/time-series-chart";
import { PageHeader } from "@/components/shell/page-header";
import { DatabaseError } from "@/components/ui/database-error";
import { EmptyState } from "@/components/ui/empty-state";
import { RangePicker } from "@/components/ui/range-picker";
import { TrendTile } from "@/components/ui/trend-tile";
import { parseRange, RANGES } from "@/lib/analytics/range";
import { getHeartData, type HeartData } from "@/lib/queries/heart";

export const metadata = { title: "Heart & Breathing" };

const COLORS = { resting: "var(--heart)", workout: "var(--primary)", hrv: "var(--heart)", breathing: "var(--breathing)" };

export default async function HeartPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const result = await getHeartData(range);

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Heart & Breathing" />
        <DatabaseError message={result.error} />
      </>
    );
  }
  if (!result.data) {
    return (
      <>
        <PageHeader title="Heart & Breathing" />
        <EmptyState icon={Heart} tile="bg-heart" title="No heart data yet">
          <p>
            Once heart rate, HRV and respiratory rate arrive, you&apos;ll see resting versus workout heart rate over
            time and whether each is improving.
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
      <PageHeader
        title="Heart & Breathing"
        subtitle={`${formatChartDay(data.start, 30)} to ${formatChartDay(data.end, 30)}`}
      />
      <div className="mb-6">
        <RangePicker value={range} basePath="/heart" />
      </div>
      <HeartContent data={data} />
    </>
  );
}

function HeartContent({ data }: { data: HeartData }) {
  const { days, trends } = data;
  const period = `${RANGES[data.range]} days`;
  const has = (key: "resting" | "workout" | "hrv" | "breathing") => days.some((d) => d[key] !== null);

  const comparison: Series[] = [
    { key: "resting", label: "Resting", color: COLORS.resting, kind: "line" },
    { key: "workout", label: "Workouts", color: COLORS.workout, kind: "dots" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrendTile label="Resting HR" icon={Heart} tint="heart" unit="bpm" trend={trends.resting} spark={days.map((d) => d.resting)} periodLabel={period} />
        <TrendTile label="Workout HR" icon={Dumbbell} tint="primary" unit="bpm" trend={trends.workout} spark={days.map((d) => d.workout)} sparkStyle="dots" periodLabel={period} />
        <TrendTile label="HRV" icon={Activity} tint="heart" unit="ms" trend={trends.hrv} spark={days.map((d) => d.hrv)} periodLabel={period} />
        <TrendTile label="Respiratory Rate" icon={Wind} tint="breathing" unit="br/min" digits={1} trend={trends.breathing} spark={days.map((d) => d.breathing)} periodLabel={period} />
      </div>

      <ChartCard
        title="Resting vs workout heart rate"
        description="Resting heart rate each day, and the average heart rate of that day's workouts."
        legend={[
          { label: "Resting", color: COLORS.resting, kind: "line" },
          { label: "Workouts", color: COLORS.workout, kind: "dot" },
        ]}
        table={{
          columns: ["Date", "Resting (bpm)", "Workout avg (bpm)"],
          rows: dailyTableRows(days, [(d) => round(d.resting), (d) => round(d.workout)]),
        }}
      >
        {has("resting") || has("workout") ? (
          <TimeSeriesChart data={days} series={comparison} unit="bpm" days={days.length} height={260} />
        ) : (
          <NoReadings what="heart rate" />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Heart rate variability"
          description="Daily average (SDNN). Higher usually means you're better recovered."
          table={{ columns: ["Date", "HRV (ms)"], rows: dailyTableRows(days, [(d) => round(d.hrv)]) }}
        >
          {has("hrv") ? (
            <TimeSeriesChart
              data={days}
              series={[{ key: "hrv", label: "HRV", color: COLORS.hrv, kind: "area" }]}
              unit="ms"
              days={days.length}
              height={200}
            />
          ) : (
            <NoReadings what="HRV" />
          )}
        </ChartCard>

        <ChartCard
          title="Respiratory rate"
          description="Breaths per minute, measured by Apple Watch while you sleep."
          table={{ columns: ["Date", "Breaths/min"], rows: dailyTableRows(days, [(d) => round(d.breathing, 1)]) }}
        >
          {has("breathing") ? (
            <TimeSeriesChart
              data={days}
              series={[{ key: "breathing", label: "Respiratory rate", color: COLORS.breathing, kind: "area", digits: 1 }]}
              unit="br/min"
              days={days.length}
              height={200}
            />
          ) : (
            <NoReadings what="respiratory rate" />
          )}
        </ChartCard>
      </div>

      <p className="mt-3 max-w-3xl text-[13px] leading-[18px] text-muted-foreground">
        Trends compare this period&apos;s average with the period before it. Changes smaller than everyday variation (1
        bpm for resting heart rate, 3 ms for HRV, 0.5 breaths/min) count as stable. Workout heart rate depends on what
        you did, so it shows a direction without a verdict. This is not medical advice.
      </p>
    </div>
  );
}

function NoReadings({ what }: { what: string }) {
  return (
    <p className="grid h-40 place-items-center text-[15px] text-subtle-foreground">No {what} readings in this period.</p>
  );
}

const round = (v: number | null, digits = 0) => (v === null ? null : Number(v.toFixed(digits)));
