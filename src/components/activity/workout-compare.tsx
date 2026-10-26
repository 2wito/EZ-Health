"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { isRun, paceLabel } from "@/lib/analytics/activity";
import type { Format } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/messages";
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

function buildMetrics(t: Messages, f: Format): Metric[] {
  const { metrics: l, words: w } = t.compare;
  const u = t.units;
  return [
    { key: "duration", label: l.duration, value: (x) => x.durationMin, show: (x) => `${Math.round(x.durationMin)} ${u.min}`, better: "neutral", delta: (d) => `${Math.round(d)} ${u.min}`, words: [w.longer, w.shorter] },
    { key: "distance", label: l.distance, value: (x) => x.distanceKm, show: (x) => (x.distanceKm ? `${f.number(x.distanceKm, 2)} ${u.km}` : null), better: "neutral", delta: (d) => `${d.toFixed(2)} ${u.km}`, words: [w.farther, w.shorter], best: true },
    // Pace is compared as min/km: lower is faster.
    { key: "pace", label: l.pace, value: (x) => (x.speedKmh ? 60 / x.speedKmh : null), show: (x) => (x.speedKmh ? `${paceLabel(x.speedKmh)} ${u.perKm}` : null), better: "lower", delta: (d) => `${Math.round(d * 60)} ${u.sPerKm}`, words: [w.slower, w.faster], runsOnly: true, best: true },
    { key: "avgHr", label: l.avgHr, value: (x) => x.avgHr, show: (x) => (x.avgHr ? `${Math.round(x.avgHr)} ${u.bpm}` : null), better: "neutral", delta: (d) => `${Math.round(d)} ${u.bpm}`, words: [w.higher, w.lower] },
    { key: "maxHr", label: l.maxHr, value: (x) => x.maxHr, show: (x) => (x.maxHr ? `${Math.round(x.maxHr)} ${u.bpm}` : null), better: "neutral", delta: (d) => `${Math.round(d)} ${u.bpm}`, words: [w.higher, w.lower] },
    { key: "efficiency", label: l.efficiency, value: (x) => x.efficiency, show: (x) => (x.efficiency ? `${x.efficiency.toFixed(2)} ${u.mPerBeat}` : null), better: "higher", delta: (d) => `${d.toFixed(2)} ${u.mPerBeat}`, words: [w.more, w.less], runsOnly: true, best: true },
    { key: "kcal", label: l.kcal, value: (x) => x.kcal, show: (x) => (x.kcal ? `${Math.round(x.kcal)} ${u.kcal}` : null), better: "neutral", delta: (d) => `${Math.round(d)} ${u.kcal}`, words: [w.more, w.fewer] },
  ];
}

/**
 * Pick two workouts of the same type and compare them side by side;
 * the table below lists every workout of that type with the best values marked.
 */
export function WorkoutCompare({ workouts }: { workouts: WorkoutRow[] }) {
  const { t, f } = useI18n();
  const METRICS = useMemo(() => buildMetrics(t, f), [t, f]);
  const dateLabel = (w: WorkoutRow) => f.chartDay(w.day, 0, true);
  const typeName = (name: string) => t.workoutNames[name] ?? name;
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
          <h3 className="text-[17px] font-semibold">{t.activity.compareTitle}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{t.compare.desc}</p>
        </div>
        {types.length > 1 && (
          <div role="radiogroup" aria-label={t.compare.type} className="flex flex-wrap gap-1 rounded-[9px] bg-muted p-0.5">
            {types.slice(0, 5).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={name === type}
                onClick={() => chooseType(name)}
                className={cn(
                  "h-7 rounded-[7px] px-3 text-[13px] font-medium",
                  name === type && "bg-segment-thumb font-semibold shadow-[0_3px_8px_rgb(0_0_0/0.12)]",
                )}
              >
                {typeName(name)}
              </button>
            ))}
          </div>
        )}
      </div>

      {pair.length === 2 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-start text-[15px]">
            <thead>
              <tr className="text-[13px] text-muted-foreground">
                <th scope="col" className="pb-2 font-medium" />
                {pair.map((w, i) => (
                  <th key={w.id} scope="col" className="pb-2 font-medium">
                    <span className="me-1.5 inline-grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    {dateLabel(w)}
                  </th>
                ))}
                <th scope="col" className="pb-2 font-medium">
                  {t.compare.vs}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {metrics.map((m) => {
                const [a, b] = pair.map((w) => m.value(w));
                return (
                  <tr key={m.key}>
                    <th scope="row" className="py-2 pe-4 text-[13px] font-medium text-muted-foreground">
                      {m.label}
                    </th>
                    {pair.map((w) => (
                      <td key={w.id} className="py-2 pe-4 font-semibold tabular-nums">
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
          {ofType.length < 2 ? t.compare.onlyOne(typeName(type)) : t.compare.selectTwo}
        </p>
      )}

      {/* Long histories hold hundreds of workouts: scroll inside the card, header pinned. */}
      <div className="max-h-[28rem] overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-start text-[13px] tabular-nums">
          <caption className="sr-only">{t.compare.caption(typeName(type))}</caption>
          <thead className="sticky top-0 z-10 bg-card-elevated text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2 font-medium">
                <span className="sr-only">{t.compare.compare}</span>
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t.common.date}
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
                      aria-label={t.compare.compareOn(typeName(type), dateLabel(w))}
                      className="size-4 accent-[var(--primary)]"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {slot >= 0 && (
                      <span className="me-1.5 inline-grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                        {slot + 1}
                      </span>
                    )}
                    {dateLabel(w)}
                  </td>
                  {metrics.map((m) => (
                    <td key={m.key} className="whitespace-nowrap px-3 py-1.5">
                      {m.show(w) ?? "—"}
                      {bestIds.get(m.key) === w.id && (
                        <span className="ms-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold">{t.compare.best}</span>
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
  const { t } = useI18n();
  const tiny = Math.abs(diff) < 1e-9 || metric.delta(Math.abs(diff)).startsWith("0 ");
  if (tiny) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
        <Minus aria-hidden className="size-3.5" /> {t.compare.same}
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
