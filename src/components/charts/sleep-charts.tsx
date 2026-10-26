"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/lib/i18n/client";
import type { SleepNight, StageSegment } from "@/lib/queries/sleep";
import { STAGES, UNSPECIFIED } from "./stages";
import { niceTicks } from "./time-series-chart";
import { TooltipBox, TooltipRow } from "./tooltip";

const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

// ─── Hypnogram ───────────────────────────────────────────────────────────────

const ROW_H = 36;

/** Last night's stages over time, one row per stage, like the Health app. */
export function Hypnogram({ segments }: { segments: StageSegment[] }) {
  const { t, f } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const hasUnspecified = segments.some((s) => s.stage === "ASLEEP");
  const rows = hasUnspecified ? [...STAGES, UNSPECIFIED] : STAGES;
  const rowOf = (stage: string) => rows.findIndex((r) => r.stage === stage);

  const start = Math.min(...segments.map((s) => s.start));
  const end = Math.max(...segments.map((s) => s.end));
  const span = Math.max(1, end - start);
  const x = (m: number) => `${((m - start) / span) * 100}%`;

  // Hour ticks, every 2 h on long nights.
  const step = span > 10 * 60 ? 120 : 60;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / step) * step; t <= end; t += step) ticks.push(t);

  const focus = active === null ? null : segments[active];

  return (
    <div>
      <p className="mb-3 h-5 text-[13px] text-muted-foreground" aria-live="polite">
        {focus ? (
          <>
            <span className="font-semibold text-foreground">{t.stages[rows[rowOf(focus.stage)].key]}</span>{" "}
            {t.sleep.span(f.clockLabel(focus.start), f.clockLabel(focus.end))}, {f.duration((focus.end - focus.start) / 60)}
          </>
        ) : (
          t.sleep.span(f.clockLabel(start), f.clockLabel(end))
        )}
      </p>

      {/* Time runs left to right in every language, like the other charts. */}
      <div dir="ltr" className="grid grid-cols-[52px_minmax(0,1fr)]">
        <div>
          {rows.map((r) => (
            <div key={r.stage} className="flex items-center text-[12px] text-muted-foreground" style={{ height: ROW_H }}>
              {t.stages[r.key]}
            </div>
          ))}
        </div>

        <div className="relative" style={{ height: rows.length * ROW_H }} onPointerLeave={() => setActive(null)}>
          {rows.map((r, i) => (
            <div key={r.stage} className="absolute inset-x-0 border-b border-border" style={{ top: i * ROW_H, height: ROW_H }} />
          ))}
          {/* Hairline connectors between consecutive stages. */}
          {segments.slice(1).map((s, i) => {
            const prev = segments[i];
            if (Math.abs(prev.end - s.start) > 1) return null;
            const a = rowOf(prev.stage);
            const b = rowOf(s.stage);
            return (
              <div
                key={`c${i}`}
                aria-hidden
                className="absolute w-px bg-subtle-foreground/50"
                style={{ left: x(s.start), top: Math.min(a, b) * ROW_H + ROW_H / 2, height: Math.abs(a - b) * ROW_H }}
              />
            );
          })}
          {segments.map((s, i) => {
            const row = rows[rowOf(s.stage)];
            return (
              <button
                key={i}
                type="button"
                aria-label={`${t.stages[row.key]}, ${t.sleep.span(f.clockLabel(s.start), f.clockLabel(s.end))}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="absolute rounded-[4px] outline-offset-1 transition-opacity"
                style={{
                  left: x(s.start),
                  width: `max(2px, ${((s.end - s.start) / span) * 100}%)`,
                  top: rowOf(s.stage) * ROW_H + 8,
                  height: ROW_H - 16,
                  background: row.color,
                  opacity: active === null || active === i ? 1 : 0.45,
                }}
              />
            );
          })}
        </div>

        <div />
        <div className="relative mt-2 h-4 text-[12px] text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(t) }}>
              {f.clockTick(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Schedule (bedtime → wake) ───────────────────────────────────────────────

type CalendarRow = { day: string; night: SleepNight | null };

/** One floating bar per night from bedtime to wake time; a steady schedule lines up. */
export function ScheduleChart({
  calendar,
  avgBed,
  avgWake,
  height = 260,
}: {
  calendar: CalendarRow[];
  avgBed: number | null;
  avgWake: number | null;
  height?: number;
}) {
  const { t, f } = useI18n();
  const data = calendar.map(({ day, night }) => ({
    day,
    night,
    range: night?.bed != null && night.wake != null ? [night.bed, night.wake] : null,
  }));
  const times = data.flatMap((d) => d.range ?? []);
  if (!times.length) return null;
  const lo = Math.floor((Math.min(...times) - 30) / 60) * 60;
  const hi = Math.ceil((Math.max(...times) + 30) / 60) * 60;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += hi - lo > 8 * 60 ? 120 : 60) ticks.push(t);

  return (
    <div style={{ height }} dir="ltr" className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => f.chartDay(d, calendar.length)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            reversed
            width={56}
            domain={[lo, hi]}
            ticks={ticks}
            tickFormatter={(m: number) => f.clockTick(m)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row?.night || !row.range) return null;
              return (
                <TooltipBox title={f.chartDay(row.day, 0, true)}>
                  <TooltipRow color="var(--sleep)" mark="square" value={t.sleep.span(f.clockLabel(row.range[0]), f.clockLabel(row.range[1]))} label="" />
                  <p className="mt-0.5 text-muted-foreground">{t.sleep.asleep(f.duration(row.night.total))}</p>
                </TooltipBox>
              );
            }}
          />
          <Bar dataKey="range" fill="var(--sleep)" radius={4} maxBarSize={24} isAnimationActive={false} />
          {/* After the bars so the average lines stay visible across them. */}
          {avgBed !== null && <ReferenceLine y={avgBed} stroke="var(--foreground)" strokeOpacity={0.55} />}
          {avgWake !== null && <ReferenceLine y={avgWake} stroke="var(--foreground)" strokeOpacity={0.55} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Nightly stages (stacked) ────────────────────────────────────────────────

/** Hours in each stage per night. 2px surface-colored strokes separate the segments. */
export function StagesChart({ calendar, height = 240 }: { calendar: CalendarRow[]; height?: number }) {
  const showUnspecified = calendar.some((c) => (c.night?.unspecified ?? 0) > 0);
  // Bottom-up stacking: deepest stage on the baseline.
  const series = [...(showUnspecified ? [UNSPECIFIED] : []), ...[...STAGES].reverse()];
  const { t, f } = useI18n();
  const data = calendar.map(({ day, night }) => ({
    day,
    night,
    deep: night?.deep ?? null,
    core: night?.core ?? null,
    rem: night?.rem ?? null,
    awake: night?.awake ?? null,
    unspecified: night?.unspecified ?? null,
  }));
  const max = Math.max(1, ...calendar.map((c) => (c.night ? c.night.total + c.night.awake : 0)));
  const ticks = niceTicks(0, max);

  return (
    <div style={{ height }} dir="ltr" className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => f.chartDay(d, calendar.length)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            width={40}
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
            tickFormatter={(h: number) => t.units.hourTick(h)}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !row?.night) return null;
              const n = row.night;
              return (
                <TooltipBox title={f.chartDay(row.day, 0, true)}>
                  {[...STAGES, ...(showUnspecified ? [UNSPECIFIED] : [])].map((s) => (
                    <TooltipRow key={s.key} color={s.color} mark="square" value={f.duration(n[s.key])} label={t.stages[s.key]} />
                  ))}
                  <p className="mt-0.5 text-muted-foreground">{t.sleep.asleep(f.duration(n.total))}</p>
                </TooltipBox>
              );
            }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={t.stages[s.key]}
              stackId="night"
              fill={s.color}
              stroke="var(--card)"
              strokeWidth={2}
              maxBarSize={24}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
