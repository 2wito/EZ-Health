"use client";

import { useState } from "react";
import { hourLabel } from "@/lib/analytics/activity";
import type { HeatCell } from "@/lib/queries/activity";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const STEPS = ["var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

/**
 * Weekday × hour heatmap of average active calories. Four validated sequential
 * steps; near-zero hours use the neutral fill so "quiet" never reads as data.
 */
export function ActivityHeatmap({ cells }: { cells: HeatCell[] }) {
  const [hover, setHover] = useState<HeatCell | null>(null);
  const max = Math.max(...cells.map((c) => c.kcal));
  // Square-root scale: workout hours (hundreds of kcal) would otherwise flatten
  // everyday movement (tens of kcal) into the empty bin.
  const step = (kcal: number) =>
    max <= 0 || kcal < Math.max(2, max * 0.005) ? -1 : Math.min(3, Math.floor(Math.sqrt(kcal / max) * 4));
  const at = (weekday: number, hour: number) => cells[weekday * 24 + hour];
  const edges = [0, 0.25, 0.5, 0.75].map((f) => Math.round(f * f * max));

  return (
    <div>
      <p className="mb-3 h-5 text-[13px] text-muted-foreground" aria-live="polite">
        {hover ? (
          <>
            <span className="font-semibold text-foreground">{Math.round(hover.kcal)} kcal</span> on average,{" "}
            {WEEKDAYS_LONG[hover.weekday]}s at {hourLabel(hover.hour)}
          </>
        ) : (
          "Hover a cell for its average."
        )}
      </p>

      <div className="overflow-x-auto">
        <div
          role="img"
          aria-label="Average active calories by weekday and hour. The table view lists every value."
          className="grid min-w-[560px] grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-0.5"
          onPointerLeave={() => setHover(null)}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pb-1 text-center text-[11px] text-muted-foreground">
              {h % 3 === 0 ? hourLabel(h).replace(" ", "").toLowerCase().replace("m", "") : ""}
            </div>
          ))}
          {WEEKDAYS.map((label, weekday) => (
            <div key={label} className="contents">
              <div className="flex items-center text-[12px] text-muted-foreground">{label}</div>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = at(weekday, hour);
                const s = step(cell.kcal);
                const active = hover?.weekday === weekday && hover.hour === hour;
                return (
                  <div
                    key={hour}
                    onPointerEnter={() => setHover(cell)}
                    className="h-6 rounded-[4px] transition-[outline-color]"
                    style={{
                      background: s < 0 ? "var(--muted)" : STEPS[s],
                      outline: active ? "2px solid var(--foreground)" : "2px solid transparent",
                      outlineOffset: 1,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
        <span>Less</span>
        <span className="h-3 w-5 rounded-[3px] bg-muted" title="Little or no activity" />
        {STEPS.map((c, i) => (
          <span key={c} className="h-3 w-5 rounded-[3px]" style={{ background: c }} title={`${edges[i] || "Under " + edges[1]}${edges[i] ? "+" : ""} kcal`} />
        ))}
        <span>More</span>
        <span className="ml-2">
          Steps start at {edges[1]}, {edges[2]} and {edges[3]} kcal; the busiest hour averages {Math.round(max)} kcal.
        </span>
      </div>
    </div>
  );
}
