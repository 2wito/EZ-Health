"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { HeatCell } from "@/lib/queries/activity";

const STEPS = ["var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

/**
 * Weekday × hour heatmap of average active calories. Four validated sequential
 * steps; near-zero hours use the neutral fill so "quiet" never reads as data.
 */
export function ActivityHeatmap({ cells }: { cells: HeatCell[] }) {
  const { t, f } = useI18n();
  const [hover, setHover] = useState<HeatCell | null>(null);
  const max = Math.max(...cells.map((c) => c.kcal));
  // Square-root scale: workout hours (hundreds of kcal) would otherwise flatten
  // everyday movement (tens of kcal) into the empty bin.
  const step = (kcal: number) =>
    max <= 0 || kcal < Math.max(2, max * 0.005) ? -1 : Math.min(3, Math.floor(Math.sqrt(kcal / max) * 4));
  const at = (weekday: number, hour: number) => cells[weekday * 24 + hour];
  const edges = [0, 0.25, 0.5, 0.75].map((x) => Math.round(x * x * max));

  return (
    <div>
      <p className="mb-3 h-5 text-[13px] text-muted-foreground" aria-live="polite">
        {hover ? (
          <>
            <span className="font-semibold text-foreground">
              {Math.round(hover.kcal)} {t.units.kcal}
            </span>
            {t.heatmap.hover(f.weekdays[hover.weekday], f.hour(hover.hour))}
          </>
        ) : (
          t.heatmap.hoverHint
        )}
      </p>

      <div className="overflow-x-auto">
        {/* Hours run left to right in every language, like the other charts. */}
        <div
          role="img"
          aria-label={t.heatmap.aria}
          dir="ltr"
          className="grid min-w-[560px] grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-0.5"
          onPointerLeave={() => setHover(null)}
        >
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pb-1 text-center text-[11px] text-muted-foreground">
              {h % 3 === 0 ? f.hourTick(h) : ""}
            </div>
          ))}
          {f.weekdaysAxis.map((label, weekday) => (
            <div key={weekday} className="contents">
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

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>{t.heatmap.less}</span>
        <span className="h-3 w-5 rounded-[3px] bg-muted" title={t.heatmap.none} />
        {STEPS.map((c, i) => (
          <span
            key={c}
            className="h-3 w-5 rounded-[3px]"
            style={{ background: c }}
            title={`${edges[i] ? `${edges[i]}+` : t.heatmap.under(edges[1])} ${t.units.kcal}`}
          />
        ))}
        <span>{t.heatmap.more}</span>
        <span className="ms-2">{t.heatmap.steps(edges[1], edges[2], edges[3], Math.round(max))}</span>
      </div>
    </div>
  );
}
