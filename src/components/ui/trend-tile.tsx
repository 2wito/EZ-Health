import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { Trend } from "@/lib/analytics/trend";
import { getI18n } from "@/lib/i18n/server";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { Card, tintColor, type Tint } from "./card";

/**
 * Stat tile for a dashboard window: the period average, how it moved against
 * the previous period, a verdict badge, and a sparkline of the daily values.
 */
export async function TrendTile({
  label,
  icon: Icon,
  tint,
  unit,
  trend,
  spark,
  sparkStyle = "line",
  digits = 0,
  periodLabel,
  format,
  formatDelta,
  directionLabels,
  summary,
}: {
  label: string;
  icon: LucideIcon;
  tint: Tint;
  unit: string;
  trend: Trend;
  /** Daily values in the window (nulls are gaps). */
  spark: (number | null)[];
  /** "dots" for sparse events (workouts) that shouldn't be joined into a line. */
  sparkStyle?: "line" | "dots";
  digits?: number;
  /** e.g. "30 days" */
  periodLabel: string;
  /** Custom value display, e.g. a clock time → ["11:42", "PM"]. */
  format?: (v: number) => [value: string, unit: string];
  /** Custom change display, e.g. minutes → "18 min". Receives the absolute delta. */
  formatDelta?: (abs: number) => string;
  /** Words for an up/down move, e.g. bedtime: { up: "later", down: "earlier" }. */
  directionLabels?: { up: string; down: string };
  /** How the headline value was derived, e.g. "Average" or "Score". */
  summary?: string;
}) {
  const { t } = await getI18n();
  const [value, valueUnit] = format ? format(trend.current ?? 0) : [(trend.current ?? 0).toFixed(digits), unit];

  return (
    <Card tint={tint} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[15px] font-semibold" style={{ color: tintColor(tint) }}>
          <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2.5} />
          {label}
        </span>
        <TrendBadge trend={trend} directionLabels={directionLabels} />
      </div>

      {trend.current === null ? (
        <p className="text-[17px] font-medium text-subtle-foreground">{t.trend.noReadings}</p>
      ) : (
        <div>
          <p className="font-rounded">
            <span className="text-[34px] font-semibold leading-none tracking-tight [unicode-bidi:isolate]">{value}</span>
            {valueUnit && <span className="ms-1 text-[17px] font-semibold text-muted-foreground [unicode-bidi:isolate]">{valueUnit}</span>}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {describeChange(
              t,
              trend,
              periodLabel,
              summary ?? t.trend.average,
              formatDelta ?? ((abs) => `${abs.toFixed(Math.max(digits, abs < 1 ? 1 : 0))} ${unit}`),
              directionLabels,
            )}
          </p>
        </div>
      )}

      {spark.length > 0 && <Sparkline values={spark} color={tintColor(tint)} style={sparkStyle} />}
    </Card>
  );
}

function describeChange(
  t: Messages,
  trend: Trend,
  periodLabel: string,
  summary: string,
  formatDelta: (abs: number) => string,
  labels = { up: t.trend.higher, down: t.trend.lower },
) {
  const lead = t.trend.lead(summary, periodLabel);
  if (trend.delta === null || trend.direction === null) return t.trend.noCompare(lead);
  if (trend.direction === "flat") return t.trend.flat(lead, periodLabel);
  return t.trend.moved(lead, formatDelta(Math.abs(trend.delta)), trend.direction === "up" ? labels.up : labels.down, periodLabel);
}

const TONES = { improving: "var(--good)", declining: "var(--warning)", stable: "var(--gray)" } as const;

/** Status always carries an icon and a word, never color alone. */
export async function TrendBadge({
  trend,
  directionLabels,
}: {
  trend: Trend;
  directionLabels?: { up: string; down: string };
}) {
  if (trend.direction === null) return null;
  const { t } = await getI18n();
  const Icon: LucideIcon = trend.direction === "up" ? ArrowUpRight : trend.direction === "down" ? ArrowDownRight : Minus;
  // Neutral metrics (e.g. workout HR) report direction without judging it.
  const words = directionLabels ?? { up: t.trend.higher, down: t.trend.lower };
  const word = trend.direction === "up" ? words.up : words.down;
  const label = trend.verdict ? t.trend[trend.verdict] : word.charAt(0).toUpperCase() + word.slice(1);
  const tone = trend.verdict ? TONES[trend.verdict] : "var(--gray)";

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full py-0.5 ps-1.5 pe-2 text-[12px] font-semibold text-foreground"
      style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)` }}
    >
      <Icon aria-hidden className="size-3.5" strokeWidth={2.75} style={{ color: tone }} />
      {label}
    </span>
  );
}

/** Minimal SVG sparkline; gaps where a day has no reading. */
export function Sparkline({
  values,
  color,
  style = "line",
  className,
}: {
  values: (number | null)[];
  color: string;
  style?: "line" | "dots";
  className?: string;
}) {
  const points = values.map((v, i) => ({ i, v })).filter((p): p is { i: number; v: number } => p.v !== null);
  if (points.length < 2) return <div className={cn("h-8", className)} />;

  const W = 100;
  const H = 32;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * W;
  const y = (v: number) => (max === min ? H / 2 : H - 3 - ((v - min) / (max - min)) * (H - 6));
  // The SVG stretches to the card width, so round marks are zero-length
  // strokes with round caps; non-scaling strokes keep them circular.
  const dot = (p: { i: number; v: number }) => `M${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}h0`;
  const stroke = { strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke", fill: "none" } as const;

  if (style === "dots") {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className={cn("h-8 w-full overflow-visible", className)}>
        <path d={points.map(dot).join("")} stroke={color} strokeWidth={5} {...stroke} />
      </svg>
    );
  }

  // Break the line at missing days instead of drawing across them.
  let d = "";
  let prev = -2;
  for (const p of points) {
    d += `${p.i === prev + 1 ? "L" : "M"}${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`;
    prev = p.i;
  }
  const last = dot(points[points.length - 1]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className={cn("h-8 w-full overflow-visible", className)}>
      <path d={d} stroke={color} strokeWidth={2} {...stroke} />
      <path d={last} stroke="var(--card)" strokeWidth={11} {...stroke} />
      <path d={last} stroke={color} strokeWidth={7} {...stroke} />
    </svg>
  );
}
