"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { formatChartDay } from "@/components/charts/format";
import { isRun, paceLabel } from "@/lib/analytics/activity";
import type { WorkoutRow } from "@/lib/queries/activity";
import { cn } from "@/lib/utils";

interface Metric {
  key: string;
  label: string;
  value: (w: WorkoutRow) => number | null;
  show: (w: WorkoutRow) => string | null;
  /** How a difference is worded and judged; "neutral" never gets a good/bad tone. */
  better: "higher" | "lower" | "neutral";
  delta: (abs: number) => string;
  words: [up: string, down: string];
  runsOnly?: boolean;
  /** Mark the best workout in the table for this metric. */
  best?: boolean;
}

const METRICS: Metric[] = [
  { key: "duration", label: "Duration", value: (w) => w.durationMin, show: (w) => `${Math.round(w.durationMin)} min`, better: "neutral", delta: (d) => `${Math.round(d)} min`, words: ["longer", "shorter"] },
  { key: "distance", label: "Distance", value: (w) => w.distanceKm, show: (w) => (w.distanceKm ? `${w.distanceKm.toFixed(2)} km` : null), better: "neutral", delta: (d) => `${d.toFixed(2)} km`, words: ["farther", "shorter"], best: true },
  // Pace is compared as min/km: lower is faster.
  { key: "pace", label: "Pace", value: (w) => (w.speedKmh ? 60 / w.speedKmh : null), show: (w) => (w.speedKmh ? `${paceLabel(w.speedKmh)} /km` : null), better: "lower", delta: (d) => `${Math.round(d * 60)} s/km`, words: ["slower", "faster"], runsOnly: true, best: true },
  { key: "avgHr", label: "Avg heart rate", value: (w) => w.avgHr, show: (w) => (w.avgHr ? `${Math.round(w.avgHr)} bpm` : null), better: "neutral", delta: (d) => `${Math.round(d)} bpm`, words: ["higher", "lower"] },
  { key: "maxHr", label: "Max heart rate", value: (w) => w.maxHr, show: (w) => (w.maxHr ? `${Math.round(w.maxHr)} bpm` : null), better: "neutral", delta: (d) => `${Math.round(d)} bpm`, words: ["higher", "lower"] },
  { key: "efficiency", label: "Efficiency", value: (w) => w.efficiency, show: (w) => (w.efficiency ? `${w.efficiency.toFixed(2)} m/beat` : null), better: "higher", delta: (d) => `${d.toFixed(2)} m/beat`, words: ["more", "less"], runsOnly: true, best: true },
  { key: "kcal", label: "Active calories", value: (w) => w.kcal, show: (w) => (w.kcal ? `${Math.round(w.kcal)} kcal` : null), better: "neutral", delta: (d) => `${Math.round(d)} kcal`, words: ["more", "fewer"] },
];

const dateLabel = (w: WorkoutRow) => formatChartDay(w.day, 0, true);

/**
 * Pick two workouts of the same type and compare them side by side;
 * the table below lists every workout of that type with the best values marked.
 */
export function WorkoutCompare({ workouts }: { workouts: WorkoutRow[] }) {
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of workouts) counts.set(w.name, (counts.get(w.name) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [workouts]);

  const [type, setType] = useState(types[0]);
  const ofType = workouts.filter((w) => w.name === type); // newest first
  const [picked, setPicked] = useState<string[]>(() => ofType.slice(0, 2).map((w) => w.id));

  const metrics = METRICS.filter((m) => (!m.runsOnly || isRun(type ?? "")) && ofType.some((w) => m.value(w) !== null));
  const pair = picked
    .map((id) => ofType.find((w) => w.id === id))
    .filter((w): w is WorkoutRow => Boolean(w))
    .sort((a, b) => a.start.localeCompare(b.start)); // earlier first

  const bestIds = new Map<string, string>();
  for (const m of metrics.filter((x) => x.best)) {
    const ranked = ofType.filter((w) => m.value(w) !== null).sort((a, b) => m.value(a)! - m.value(b)!);
    const best = m.better === "lower" ? ranked[0] : ranked.at(-1);
    if (best && ranked.length > 1) bestIds.set(m.key, best.id);
  }

  function chooseType(next: string) {
    setType(next);
    setPicked(workouts.filter((w) => w.name === next).slice(0, 2).map((w) => w.id));
  }
  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  }

  if (!type) return null;

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold">Compare workouts</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">Pick any two workouts of the same type to compare them.</p>
        </div>
        {types.length > 1 && (
          <div role="radiogroup" aria-label="Workout type" className="flex flex-wrap gap-1 rounded-[9px] bg-muted p-0.5">
            {types.slice(0, 5).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={t === type}
                onClick={() => chooseType(t)}
                className={cn(
                  "h-7 rounded-[7px] px-3 text-[13px] font-medium",
                  t === type && "bg-segment-thumb font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12)]",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {pair.length === 2 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-[15px]">
            <thead>
              <tr className="text-[13px] text-muted-foreground">
                <th scope="col" className="pb-2 font-medium" />
                {pair.map((w, i) => (
                  <th key={w.id} scope="col" className="pb-2 font-medium">
                    <span className="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    {dateLabel(w)}
                  </th>
                ))}
                <th scope="col" className="pb-2 font-medium">
                  2 vs 1
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {metrics.map((m) => {
                const [a, b] = pair.map((w) => m.value(w));
                return (
                  <tr key={m.key}>
                    <th scope="row" className="py-2 pr-4 text-[13px] font-medium text-muted-foreground">
                      {m.label}
                    </th>
                    {pair.map((w) => (
                      <td key={w.id} className="py-2 pr-4 font-semibold tabular-nums">
                        {m.show(w) ?? "—"}
                      </td>
                    ))}
                    <td className="py-2">{a !== null && b !== null ? <Delta metric={m} diff={b - a} /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[15px] text-muted-foreground">
          {ofType.length < 2 ? `Only one ${type} in this period. Widen the time range to compare.` : "Select two workouts below."}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-left text-[13px] tabular-nums">
          <caption className="sr-only">{type} workouts in this period</caption>
          <thead className="bg-card-elevated text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2 font-medium">
                <span className="sr-only">Compare</span>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Date
              </th>
              {metrics.map((m) => (
                <th key={m.key} scope="col" className="px-3 py-2 font-medium">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ofType.map((w) => {
              const slot = pair.findIndex((p) => p.id === w.id);
              return (
                <tr key={w.id} className={cn(slot >= 0 && "bg-primary/5")}>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={picked.includes(w.id)}
                      onChange={() => toggle(w.id)}
                      aria-label={`Compare ${type} on ${dateLabel(w)}`}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {slot >= 0 && (
                      <span className="mr-1.5 inline-grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                        {slot + 1}
                      </span>
                    )}
                    {dateLabel(w)}
                  </td>
                  {metrics.map((m) => (
                    <td key={m.key} className="whitespace-nowrap px-3 py-1.5">
                      {m.show(w) ?? "—"}
                      {bestIds.get(m.key) === w.id && (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold">Best</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Delta({ metric, diff }: { metric: Metric; diff: number }) {
  const tiny = Math.abs(diff) < 1e-9 || metric.delta(Math.abs(diff)).startsWith("0 ");
  if (tiny) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
        <Minus aria-hidden className="size-3.5" /> Same
      </span>
    );
  }
  const up = diff > 0;
  const good = metric.better === "neutral" ? null : (metric.better === "higher") === up;
  const tone = good === null ? "var(--gray)" : good ? "var(--good)" : "var(--warning)";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium">
      <Icon aria-hidden className="size-3.5" strokeWidth={2.75} style={{ color: tone }} />
      {metric.delta(Math.abs(diff))} {up ? metric.words[0] : metric.words[1]}
    </span>
  );
}
