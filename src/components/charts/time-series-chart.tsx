"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Granularity } from "@/lib/analytics/range";
import { useI18n } from "@/lib/i18n/client";
import { TooltipBox, TooltipRow } from "./tooltip";

export interface Series {
  key: string;
  label: string;
  /** CSS color, e.g. "var(--heart)". Used for marks only, never for text. */
  color: string;
  /** line: connected trend. dots: sparse events (e.g. workouts). area: single series with a wash. */
  kind: "line" | "dots" | "area";
  digits?: number;
}

type Row = { day: string } & Record<string, number | string | null>;

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

/** Round tick values (steps of 1/2/5 × 10ⁿ) spanning the data, so the axis reads 50, 60, 70 rather than 51, 81, 111. */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}
const ringedDot = (color: string, r: number) => ({ r, fill: color, stroke: "var(--card)", strokeWidth: 2 });

/**
 * Daily time series on one shared axis. Marks follow the dataviz spec:
 * 2px lines, ≥8px dots with a 2px surface ring, 10% area wash, hairline grid.
 */
export function TimeSeriesChart({
  data,
  series,
  unit,
  days,
  height = 240,
  granularity = "day",
}: {
  data: Row[];
  series: Series[];
  unit: string;
  /** Number of rows, to pick a sensible x-axis label format. */
  days: number;
  height?: number;
  /** Rows are days, or week/month averages. */
  granularity?: Granularity;
}) {
  const { f } = useI18n();
  const values = data.flatMap((row) => series.map((s) => row[s.key])).filter((v): v is number => typeof v === "number");
  const ticks = values.length ? niceTicks(Math.min(...values), Math.max(...values)) : undefined;
  const decimals = ticks && ticks.length > 1 && ticks[1] - ticks[0] < 1 ? 1 : 0;

  return (
    <div style={{ height }} dir="ltr" className="-ml-2 [&_.recharts-surface]:overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => f.period(d, granularity, days)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            width={40}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            ticks={ticks}
            domain={ticks ? [ticks[0], ticks[ticks.length - 1]] : ["auto", "auto"]}
            tickFormatter={(v: number) => v.toFixed(decimals)}
          />
          <Tooltip
            cursor={{ stroke: "var(--subtle-foreground)", strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, label, payload }) =>
              active && payload?.length ? (
                <ChartTooltip day={String(label)} unit={unit} series={series} row={payload[0].payload as Row} granularity={granularity} />
              ) : null
            }
          />
          {series.map((s) =>
            s.kind === "dots" ? (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke="none"
                dot={ringedDot(s.color, 4)}
                activeDot={ringedDot(s.color, 6)}
                isAnimationActive={false}
              />
            ) : s.kind === "area" ? (
              <Area
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.1}
                connectNulls
                dot={false}
                activeDot={ringedDot(s.color, 5)}
                isAnimationActive={false}
              />
            ) : (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                type="monotone"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls
                dot={false}
                activeDot={ringedDot(s.color, 5)}
                isAnimationActive={false}
              />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** One readout for every series at the hovered day: value first, series name second. */
function ChartTooltip({
  day,
  unit,
  series,
  row,
  granularity,
}: {
  day: string;
  unit: string;
  series: Series[];
  row: Row;
  granularity: Granularity;
}) {
  const { f } = useI18n();
  return (
    <TooltipBox title={f.period(day, granularity, 0, true)}>
      {series.map((s) => {
        const v = row[s.key];
        return (
          <TooltipRow
            key={s.key}
            color={s.color}
            label={s.label}
            value={typeof v === "number" ? `${v.toFixed(s.digits ?? 0)} ${unit}` : "—"}
          />
        );
      })}
    </TooltipBox>
  );
}
